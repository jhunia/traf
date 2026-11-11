import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { bboxOf, type BBox, type LngLat } from '../lib/geo';
import { REGION } from '../lib/ghana';
import { addIcons } from '../lib/icons';
import type { RoadFeature } from '../lib/osm';
import type { Route } from '../lib/routing';
import type { Position } from '../lib/alerts';
import { MIN_FEATURE_ZOOM } from '../hooks/useRoadFeatures';
import { circle, confidenceText, siteLabel, type CameraData, type CameraSite } from '../lib/cameras';
import { shortTime, type TrafficStretch } from '../lib/traffic';

// A quiet, greyscale OpenStreetMap base (free, no key) so routes and hazards stand out.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export interface Layers {
  traffic: boolean;
  camera: boolean;
  bump: boolean;
  sign: boolean;
  pothole: boolean;
}

interface Props {
  features: RoadFeature[];
  reports: RoadFeature[];
  routes: Route[];
  selectedRoute: number;
  position: Position | null;
  origin: LngLat | null;
  destination: LngLat | null;
  follow: boolean;
  driving: boolean;
  layers: Layers;
  mapboxToken?: string;
  cameras: CameraData | null;
  jams: TrafficStretch[]; // slow stretches on the selected route, labelled with their delay
  onViewChange: (bbox: BBox, zoom: number) => void;
  onContextMenu: (lngLat: LngLat) => void;
  onMapClick: (lngLat: LngLat) => void;
  onSelectRoute: (index: number) => void;
  onUserPan: () => void;
  onRemoveReport: (id: string) => void;
}

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const point = (p: LngLat, props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: p },
  properties: props,
});

function featurePoints(list: RoadFeature[], layers: Layers): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: list
      .filter((f) => layers[f.kind])
      .map((f) =>
        point(f.lngLat, {
          id: f.id,
          icon: f.icon,
          label: f.label,
          source: f.source,
          kind: f.kind,
          from: f.source === 'user' ? 'Reported by you' : f.id.startsWith('tt-') ? 'Reported camera site (unofficial)' : f.id.startsWith('mb-') ? 'From Mapbox' : 'From OpenStreetMap',
        }),
      ),
  };
}

const isNarrow = (map: MLMap) => map.getContainer().clientWidth < 720;

// Remember where the map was, so the app reopens where the driver left it.
const VIEW_KEY = 'roadwise.view.v1';
function savedView(): { center: LngLat; zoom: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    return v && Number.isFinite(v.zoom) && Array.isArray(v.center) && v.center.every(Number.isFinite) ? v : null;
  } catch {
    return null;
  }
}

/** Popup for a reported camera road/zone: what, how reliable, the limit, and links to the sources. */
function cameraPopup(site: CameraSite, data: CameraData): HTMLElement {
  const el = document.createElement('div');
  el.className = 'popup';
  const title = document.createElement('strong');
  title.textContent = siteLabel(site);
  const meta = document.createElement('div');
  meta.className = 'popup-meta';
  meta.textContent = confidenceText(site.confidence);
  el.append(title, meta);
  if (site.limit) {
    const lim = document.createElement('div');
    lim.className = 'popup-meta';
    lim.textContent = `Speed limit: ${site.limit} km/h${site.note ? '. ' + site.note : ''}`;
    el.append(lim);
  }
  for (const key of site.sources) {
    const src = data.sources[key];
    if (!src) continue;
    const a = document.createElement('a');
    a.href = src.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = src.title;
    a.className = 'popup-link';
    el.append(a);
  }
  return el;
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const lastFix = useRef<number | null>(null);
  const hadFix = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  // Create the map once.
  useEffect(() => {
    const saved = savedView();
    const [bw, bs, be, bn] = REGION.bounds;
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      // Reopen where the driver left off; first time, show the whole country.
      ...(saved
        ? { center: saved.center, zoom: saved.zoom }
        : {
            bounds: [[bw, bs], [be, bn]] as [LngLat, LngLat],
            // Keep the country clear of the bottom sheet (phones) or the side panel (wide screens).
            fitBoundsOptions: {
              padding: container.current!.clientWidth < 720 ? { top: 20, bottom: 300, left: 16, right: 16 } : { top: 30, bottom: 30, left: 440, right: 30 },
            },
          }),
      attributionControl: { compact: true },
      maxPitch: 60,
    });
    mapRef.current = map;

    const emitView = () => {
      const b = map.getBounds();
      latest.current.onViewChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
      if (!latest.current.driving) {
        try {
          const c = map.getCenter();
          localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }));
        } catch {
          /* storage blocked */
        }
      }
    };

    map.on('load', () => {
      addIcons(map);
      // Soften the base map: hide shop/POI icons so the drive-relevant layers read first.
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.type === 'symbol' && /poi/i.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
      }

      const token = latest.current.mapboxToken;
      if (token) {
        // Live traffic from Mapbox: each road segment carries a congestion level.
        map.addSource('traffic', {
          type: 'vector',
          tiles: [`https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/{z}/{x}/{y}.vector.pbf?access_token=${encodeURIComponent(token)}`],
          minzoom: 0,
          maxzoom: 16,
          attribution: 'Traffic © Mapbox',
        });
        map.addLayer({
          id: 'traffic',
          type: 'line',
          source: 'traffic',
          'source-layer': 'traffic',
          // Slow roads everywhere, plus free-flowing main roads in green (like Google Maps),
          // so it's clear the traffic data is live.
          filter: [
            'any',
            ['in', ['get', 'congestion'], ['literal', ['moderate', 'heavy', 'severe']]],
            ['all', ['==', ['get', 'congestion'], 'low'], ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]]],
          ],
          layout: { 'line-join': 'round', 'line-cap': 'round', visibility: latest.current.layers.traffic ? 'visible' : 'none' },
          paint: {
            'line-color': ['match', ['get', 'congestion'], 'moderate', '#f5a623', 'heavy', '#e11900', 'severe', '#8a0a00', '#1fa855'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3.5, 17, 7],
            'line-offset': ['interpolate', ['linear'], ['zoom'], 12, 0, 16, 2.5],
            'line-opacity': ['match', ['get', 'congestion'], 'low', 0.55, 0.95],
          },
        });
      }

      // Reported TraffiTech camera areas (soft red circles) and roads (red dashes), under the route.
      map.addSource('cam-zones', { type: 'geojson', data: empty });
      map.addLayer({ id: 'cam-zones', type: 'fill', source: 'cam-zones', minzoom: 10, paint: { 'fill-color': '#e11900', 'fill-opacity': 0.05 } });
      map.addLayer({
        id: 'cam-zones-edge', type: 'line', source: 'cam-zones', minzoom: 10,
        paint: { 'line-color': '#e11900', 'line-opacity': 0.35, 'line-width': 1.2, 'line-dasharray': [2, 2] },
      });
      map.addSource('cam-roads', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'cam-roads', type: 'line', source: 'cam-roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e11900', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 6], 'line-opacity': 0.75, 'line-dasharray': [1.5, 1.5] },
      });
      // Say what the red dashes are, right on the road.
      map.addLayer({
        id: 'cam-road-labels', type: 'symbol', source: 'cam-roads', minzoom: 13,
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 320,
          'text-field': 'Speed cameras reported', 'text-size': 11, 'text-font': ['Noto Sans Bold'],
          'text-keep-upright': true, 'text-offset': [0, -0.9],
        },
        paint: { 'text-color': '#b51500', 'text-halo-color': '#fff', 'text-halo-width': 2 },
      });
      map.addLayer({
        id: 'cam-zone-labels', type: 'symbol', source: 'cam-zones', minzoom: 13,
        layout: { 'text-field': ['concat', 'Cameras reported: ', ['get', 'name']], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': false },
        paint: { 'text-color': '#b51500', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      });
      // Country view: the cities where police confirm cameras operate.
      map.addSource('cam-cities', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'cam-cities', type: 'symbol', source: 'cam-cities', maxzoom: 10,
        layout: {
          'icon-image': 'rw-camera', 'icon-size': 0.55, 'icon-allow-overlap': true,
          'text-field': ['get', 'name'], 'text-size': 11.5, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true,
        },
        paint: { 'text-color': '#b51500', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      });
      for (const layer of ['cam-zones', 'cam-roads', 'cam-cities']) {
        map.on('click', layer, (e) => {
          const p = e.features?.[0]?.properties as { id: string } | undefined;
          const site = latest.current.cameras?.sites.find((s) => s.id === p?.id);
          if (!site) return;
          new maplibregl.Popup({ offset: 10, closeButton: false, maxWidth: '280px' })
            .setLngLat(e.lngLat)
            .setDOMContent(cameraPopup(site, latest.current.cameras!))
            .addTo(map);
        });
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }

      map.addSource('routes', { type: 'geojson', data: empty });
      const lineLayout = { 'line-join': 'round', 'line-cap': 'round' } as const;
      const isSel = ['==', ['get', 'selected'], true] as any;
      const notSel = ['==', ['get', 'selected'], false] as any;
      map.addLayer({ id: 'routes-alt-casing', type: 'line', source: 'routes', layout: lineLayout, filter: notSel, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
      map.addLayer({ id: 'routes-alt', type: 'line', source: 'routes', layout: lineLayout, filter: notSel, paint: { 'line-color': '#a3abb5', 'line-width': 6 } });
      map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: lineLayout, filter: isSel, paint: { 'line-color': '#ffffff', 'line-width': 12 } });
      // Selected route: black where traffic is free-flowing, amber/red where it is slow.
      map.addLayer({
        id: 'routes-main', type: 'line', source: 'routes', layout: lineLayout, filter: isSel,
        paint: {
          'line-color': ['match', ['get', 'congestion'], 'moderate', '#f5a623', 'heavy', '#e11900', 'severe', '#8a0a00', '#000000'],
          // Slow stretches drawn thicker so short jams are visible from a distance.
          'line-width': ['match', ['get', 'congestion'], 'moderate', 8, 'heavy', 9, 'severe', 9, 6],
        },
      });

      const symbol = {
        'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 0.7, 16, 0.9],
      } as any;
      map.addSource('features', { type: 'geojson', data: empty });
      // Cameras show from far out; bumps and potholes at street level; signs and lights only when close.
      map.addLayer({ id: 'features-sign', type: 'symbol', source: 'features', minzoom: 14.5, filter: ['==', ['get', 'kind'], 'sign'], layout: symbol });
      map.addLayer({ id: 'features-hazard', type: 'symbol', source: 'features', minzoom: MIN_FEATURE_ZOOM, filter: ['in', ['get', 'kind'], ['literal', ['bump', 'pothole']]], layout: symbol });
      map.addLayer({ id: 'features-camera', type: 'symbol', source: 'features', minzoom: 10, filter: ['==', ['get', 'kind'], 'camera'], layout: symbol });
      map.addSource('reports', { type: 'geojson', data: empty });
      map.addLayer({ id: 'reports-halo', type: 'circle', source: 'reports', paint: { 'circle-radius': 19, 'circle-color': '#8e24aa', 'circle-opacity': 0.25 } });
      map.addLayer({ id: 'reports', type: 'symbol', source: 'reports', layout: symbol });

      map.addSource('endpoints', { type: 'geojson', data: empty });
      map.addLayer({ id: 'endpoints', type: 'symbol', source: 'endpoints', layout: { ...symbol, 'icon-size': 0.9 } });

      // "+2 min" labels on jams along the selected route (like Google Maps' delay bubbles).
      map.addSource('jam-labels', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'jam-labels', type: 'symbol', source: 'jam-labels',
        layout: {
          'text-field': ['get', 'text'], 'text-size': 12.5, 'text-font': ['Noto Sans Bold'],
          'text-offset': [0, -1.4], 'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': ['match', ['get', 'level'], 'moderate', '#d98a00', '#c41600'],
          'text-halo-width': 4,
        },
      });

      map.addSource('me', { type: 'geojson', data: empty });
      map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 26, 'circle-color': '#1a73e8', 'circle-opacity': 0.14, 'circle-pitch-alignment': 'map' } });
      map.addLayer({
        id: 'me', type: 'symbol', source: 'me',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      map.on('click', 'routes-alt', (e) => {
        const idx = e.features?.[0]?.properties?.index;
        if (idx != null) latest.current.onSelectRoute(Number(idx));
      });
      map.on('mouseenter', 'routes-alt', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'routes-alt', () => (map.getCanvas().style.cursor = ''));

      for (const layer of ['features-sign', 'features-hazard', 'features-camera', 'reports']) {
        map.on('click', layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { id: string; label: string; source: string; from: string };
          const el = document.createElement('div');
          el.className = 'popup';
          const title = document.createElement('strong');
          title.textContent = p.label;
          const meta = document.createElement('div');
          meta.className = 'popup-meta';
          meta.textContent = p.from;
          el.append(title, meta);
          const popup = new maplibregl.Popup({ offset: 14, closeButton: false })
            .setLngLat((f.geometry as GeoJSON.Point).coordinates as LngLat)
            .setDOMContent(el)
            .addTo(map);
          if (p.source === 'user') {
            const btn = document.createElement('button');
            btn.textContent = 'Remove report';
            btn.onclick = () => {
              latest.current.onRemoveReport(p.id);
              popup.remove();
            };
            el.append(btn);
          }
        });
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      setReady(true);
      emitView();
    });

    map.on('moveend', emitView);
    map.on('dragstart', () => latest.current.onUserPan());
    map.on('contextmenu', (e) => latest.current.onContextMenu([e.lngLat.lng, e.lngLat.lat]));
    map.on('click', (e) => latest.current.onMapClick([e.lngLat.lng, e.lngLat.lat]));
    return () => map.remove();
  }, []);

  const set = (id: string, data: GeoJSON.FeatureCollection) =>
    (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data);

  const { routes, selectedRoute, features, reports, layers, position, origin, destination, follow, driving } = props;

  useEffect(() => {
    if (!ready) return;
    const features: GeoJSON.Feature[] = [];
    routes.forEach((r, i) => {
      const selected = i === selectedRoute;
      if (!selected || !r.congestion) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.geometry }, properties: { index: i, selected } });
        return;
      }
      // Split the selected route into runs of equal congestion so each run gets its colour.
      const level = (k: number) => (r.congestion![k] === 'unknown' ? 'low' : r.congestion![k]);
      let start = 0;
      for (let k = 1; k <= r.congestion.length; k++) {
        if (k === r.congestion.length || level(k) !== level(start)) {
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: r.geometry.slice(start, k + 1) },
            properties: { index: i, selected: true, congestion: level(start) },
          });
          start = k;
        }
      }
    });
    // Selected runs last so they draw on top of the alternatives.
    features.sort((a, b) => Number(a.properties!.selected) - Number(b.properties!.selected));
    set('routes', { type: 'FeatureCollection', features });
  }, [ready, routes, selectedRoute]);

  // Frame new routes above the bottom sheet (phones) or beside the side panel (desktop).
  useEffect(() => {
    if (!ready || !routes.length || latest.current.driving) return;
    const map = mapRef.current!;
    const [w, s, e, n] = bboxOf(routes.flatMap((r) => r.geometry));
    // On phones the route sheet covers roughly the lower 55% of the screen.
    const h = map.getContainer().clientHeight;
    const padding = isNarrow(map) ? { top: 80, bottom: Math.round(h * 0.58), left: 40, right: 70 } : { top: 80, bottom: 80, left: 460, right: 100 };
    map.fitBounds([[w, s], [e, n]], { padding, maxZoom: 16, bearing: 0, pitch: 0 });
  }, [ready, routes]);

  useEffect(() => {
    if (ready) set('features', featurePoints(features, layers));
  }, [ready, features, layers]);

  useEffect(() => {
    if (ready) set('reports', featurePoints(reports, layers));
  }, [ready, reports, layers]);

  useEffect(() => {
    if (!ready) return;
    const pts: GeoJSON.Feature[] = [];
    if (origin) pts.push(point(origin, { icon: 'rw-origin' }));
    if (destination) pts.push(point(destination, { icon: 'rw-dest' }));
    set('endpoints', { type: 'FeatureCollection', features: pts });
  }, [ready, origin, destination]);

  useEffect(() => {
    if (!ready) return;
    const moving = position?.heading != null && (position.speedKmh ?? 0) > 3;
    set(
      'me',
      position
        ? { type: 'FeatureCollection', features: [point(position.lngLat, { icon: moving ? 'rw-puck-heading' : 'rw-puck', heading: moving ? position.heading : 0 })] }
        : empty,
    );
    if (!position || !follow) return;
    const map = mapRef.current!;
    if (!driving && routes.length) return; // looking at route options: don't drag the map back to the car
    if (!driving && !hadFix.current) {
      // First GPS fix: go to the driver, wherever in the country they are.
      hadFix.current = true;
      map.flyTo({ center: position.lngLat, zoom: Math.max(map.getZoom(), 14.5), duration: 1200 });
      return;
    }
    hadFix.current = true;
    if (driving) {
      // Navigation camera: tilted, heading-up, car in the lower part of the screen.
      // Animate for exactly the time until the next position arrives, at constant speed,
      // so each move flows into the next instead of being cut off (that caused the stutter).
      const gap = lastFix.current ? position.time - lastFix.current : 1000;
      lastFix.current = position.time;
      const bearingNow = map.getBearing();
      let target = position.heading ?? bearingNow;
      // Ignore tiny heading wobble so the map doesn't jitter.
      if (Math.abs(((target - bearingNow + 540) % 360) - 180) < 4) target = bearingNow;
      map.easeTo({
        center: position.lngLat,
        bearing: target,
        pitch: 50,
        // Zoom out a little at speed so the driver sees further ahead on highways.
        zoom: 16.8 - Math.min(1.6, (position.speedKmh ?? 0) / 70),
        padding: { top: isNarrow(map) ? 260 : 200, bottom: 0, left: 0, right: 0 },
        duration: Math.min(1200, Math.max(300, gap)),
        easing: (t) => t,
      });
    } else {
      map.easeTo({ center: position.lngLat, duration: 450 });
    }
  }, [ready, position, follow, driving, routes.length]);

  // Leaving drive mode: flatten the camera again.
  useEffect(() => {
    if (!ready || driving) return;
    mapRef.current!.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 500 });
  }, [ready, driving]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer('traffic')) map.setLayoutProperty('traffic', 'visibility', layers.traffic ? 'visible' : 'none');
  }, [ready, layers.traffic]);

  // Jam delay labels on the selected route.
  const { jams } = props;
  useEffect(() => {
    if (!ready) return;
    const r = routes[selectedRoute];
    set('jam-labels', {
      type: 'FeatureCollection',
      features: !r ? [] : jams
        .filter((j) => j.delayS >= 20 || j.level !== 'moderate')
        .map((j) => point(r.geometry[Math.floor((j.startIndex + j.endIndex + 1) / 2)], {
          text: j.delayS >= 20 ? `+${shortTime(j.delayS)}` : shortTime(j.timeS),
          level: j.level,
        })),
    });
  }, [ready, jams, routes, selectedRoute]);

  // Reported camera roads and zones.
  const { cameras } = props;
  useEffect(() => {
    if (!ready) return;
    const sites = layers.camera ? cameras?.sites ?? [] : [];
    set('cam-zones', {
      type: 'FeatureCollection',
      features: sites.filter((s) => s.kind === 'zone').map((s) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circle(s.lngLat, (s as { radius: number }).radius)] },
        properties: { id: s.id, name: s.name },
      })),
    });
    set('cam-roads', {
      type: 'FeatureCollection',
      features: sites.filter((s) => s.kind === 'road').map((s) => ({
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: (s as { lines: LngLat[][] }).lines },
        properties: { id: s.id, name: s.name },
      })),
    });
    set('cam-cities', {
      type: 'FeatureCollection',
      features: sites.filter((s) => s.kind === 'city').map((s) => point((s as { lngLat: LngLat }).lngLat, { id: s.id, name: s.name })),
    });
  }, [ready, cameras, layers.camera]);

  // Live traffic changes: reload the traffic tiles every 2 minutes.
  useEffect(() => {
    const token = latest.current.mapboxToken;
    if (!ready || !token) return;
    const id = setInterval(() => {
      const src = mapRef.current?.getSource('traffic') as maplibregl.VectorTileSource | undefined;
      src?.setTiles([
        `https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/{z}/{x}/{y}.vector.pbf?access_token=${encodeURIComponent(token)}&t=${Date.now()}`,
      ]);
    }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [ready]);

  return <div ref={container} className="map" />;
}
