import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapView, type Layers } from './components/MapView';
import { PlaceSearch } from './components/PlaceSearch';
import { Speedometer } from './components/Speedometer';
import { AlertBanner } from './components/AlertBanner';
import { LayersMenu } from './components/LayersMenu';
import { TripBar } from './components/TripBar';
import { Icon } from './components/Icon';
import { GPS_HELP, useGps, type GpsStatus } from './hooks/useGps';
import { useSimulation } from './hooks/useSimulation';
import { useSpeedLimit } from './hooks/useSpeedLimit';
import { useRoadFeatures } from './hooks/useRoadFeatures';
import { useRegionData } from './hooks/useRegionData';
import { cumulative, distance, formatDistance, formatDuration, type BBox, type LngLat } from './lib/geo';
import { sentence, spokenDistance } from './lib/maneuvers';
import { analyzeTraffic, fetchScenarios, freeFlowFactor, jamWord, routeDelay, type TrafficScenarios } from './lib/traffic';
import { TrafficSummary } from './components/TrafficSummary';
import { cityAt, citiesOnRoute, loadCameras, pointFeatures, routeEntryFeatures, siteLabel, sitesHere, type CameraData } from './lib/cameras';
import { useNavigation } from './hooks/useNavigation';
import { NavBanner } from './components/NavBanner';
import { REGION, SPEED_TOLERANCE, SPEED_TOLERANCE_ESTIMATE } from './lib/ghana';
import { getRoutes, type Route, type RoadControl } from './lib/routing';
import { reverseGeocode, shortLabel, type Place } from './lib/search';
import { spokenAlert, upcomingAlerts } from './lib/alerts';
import { loadReports, makeReport, saveReports, type ReportKind } from './lib/reports';
import { addRecent, loadRecents } from './lib/recents';
import { iconUrl } from './lib/icons';
import { beep, speak } from './lib/voice';
import type { RoadFeature } from './lib/osm';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) || undefined;

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** Stable key for a spoken prompt: where the manoeuvre is, so reroutes and traffic refreshes don't repeat it. */
const stepKey = (route: Route, startIndex: number, bucket: string) => {
  const at = route.geometry[Math.min(startIndex, route.geometry.length - 1)];
  return `${at[0].toFixed(4)},${at[1].toFixed(4)}-${bucket}`;
};

type DriveMode = 'off' | 'gps' | 'sim';

const REPORTS: { kind: ReportKind; label: string; icon: string }[] = [
  { kind: 'pothole', label: 'Pothole', icon: 'rw-pothole' },
  { kind: 'bump', label: 'Speed bump', icon: 'rw-bump' },
  { kind: 'camera', label: 'Camera', icon: 'rw-camera' },
  { kind: 'signals', label: 'Traffic light', icon: 'rw-signals' },
];

const CONTROL_LABEL: Record<RoadControl['type'], string> = {
  traffic_signals: 'Traffic lights',
  stop: 'Stop sign',
  give_way: 'Give way',
  railway_crossing: 'Railway crossing',
};
const CONTROL_ICON: Record<RoadControl['type'], string> = {
  traffic_signals: 'rw-signals',
  stop: 'rw-stop',
  give_way: 'rw-give-way',
  railway_crossing: 'rw-sign',
};

const clock = (secondsFromNow: number) =>
  new Date(Date.now() + secondsFromNow * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [origin, setOrigin] = useState<Place | null>(null); // null = current location
  const [destination, setDestination] = useState<Place | null>(null);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState(false);
  const [recents, setRecents] = useState<Place[]>(loadRecents);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState(0);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<TrafficScenarios | null>(null);
  const [bestRoute, setBestRoute] = useState<Route | null>(null); // fastest route when the trip was planned
  const [layers, setLayers] = useState<Layers>({ traffic: !!MAPBOX_TOKEN, camera: true, bump: true, sign: true, pothole: true });
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(false);
  const [drive, setDrive] = useState<DriveMode>('off');
  const [simSpeed, setSimSpeed] = useState(50);
  const [reports, setReports] = useState<RoadFeature[]>(loadReports);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const gps = useGps(true);
  const hasFix = !!gps.position;
  const gpsStatusRef = useRef(gps.status);
  gpsStatusRef.current = gps.status;
  // Where the driver (or, without GPS, the map) is: decides which city road files to load.
  const [mapCenter, setMapCenter] = useState<LngLat | null>(null);
  const region = useRegionData(gps.position?.lngLat ?? mapCenter);
  const [cameras, setCameras] = useState<CameraData | null>(null);
  useEffect(() => {
    loadCameras().then(setCameras);
  }, []);
  const { features, loading: featuresLoading, error: featuresError, loadInView, loadAlongRoute } = useRoadFeatures(region.features, region.covered);
  const route = routes[selected] ?? null;
  const routeLine = route?.geometry ?? null;
  const sim = useSimulation(routeLine, simSpeed, drive === 'sim', () => {
    setDrive('off');
    setToast('You have arrived');
  });
  const position = drive === 'sim' ? sim : gps.position;
  const positionRef = useRef(position);
  positionRef.current = position;
  const limitInfo = useSpeedLimit(position, route, region.roads, region.places, MAPBOX_TOKEN);
  const view = useRef<{ bbox: BBox; zoom: number }>({ bbox: REGION.bounds, zoom: 6 });
  const gpsRef = useRef(gps.position);
  gpsRef.current = gps.position;

  useEffect(() => saveReports(reports), [reports]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const chooseDestination = useCallback((p: Place) => {
    setDestination(p);
    setSearching(false);
    if (p.label !== 'Dropped pin') setRecents((r) => addRecent(r, p));
  }, []);

  // Fetch routes whenever the start or destination changes.
  useEffect(() => {
    setDrive('off');
    if (!destination) {
      setRoutes([]);
      setRouteError(null);
      return;
    }
    const start = origin?.lngLat ?? gpsRef.current?.lngLat ?? null;
    if (!start) {
      // Starting from "my location" but no fix yet: wait (this effect re-runs when the first fix arrives).
      setRoutes([]);
      const waiting = gpsStatusRef.current === 'waiting' || gpsStatusRef.current === 'unavailable';
      setRouting(waiting);
      setRouteError(waiting ? null : GPS_HELP[gpsStatusRef.current as Exclude<GpsStatus, 'ok'>]);
      return;
    }
    let cancelled = false;
    setRouting(true);
    setRouteError(null);
    setScenarios(null);
    getRoutes(start, destination.lngLat, MAPBOX_TOKEN)
      .then((rs) => {
        if (cancelled) return;
        setRoutes(rs);
        setSelected(0);
        setBestRoute(rs[0] ?? null);
        // Light-traffic vs rush-hour predictions for this trip (in the background).
        if (MAPBOX_TOKEN && rs[0]?.source === 'mapbox') {
          fetchScenarios(start, destination.lngLat, MAPBOX_TOKEN).then((s) => !cancelled && setScenarios(s));
        }
      })
      .catch((e) => !cancelled && setRouteError(e instanceof Error ? e.message : 'Could not find a route'))
      .finally(() => !cancelled && setRouting(false));
    return () => {
      cancelled = true;
    };
    // Re-run once when the first GPS fix arrives, or when location gets blocked, if routing from "my location".
  }, [origin, destination, origin ? 'typed' : hasFix ? 'fix' : gps.status]);

  useEffect(() => {
    if (routeLine) loadAlongRoute(routeLine);
  }, [routeLine, loadAlongRoute]);

  const driving = drive !== 'off';
  const drivingRef = useRef(driving);
  drivingRef.current = driving;

  // Jams on each route: where they are, how long to get through, and the delay they add.
  const ffFactor = useMemo(() => (bestRoute ? freeFlowFactor(bestRoute, scenarios?.lightS ?? null) : 1), [bestRoute, scenarios]);
  const jams = useMemo(() => new Map(routes.map((r) => [r.id, analyzeTraffic(r, ffFactor)])), [routes, ffFactor]);
  const routeJams = useMemo(() => (route ? jams.get(route.id) ?? [] : []), [route, jams]);
  const nav = useNavigation(route, position, driving, routeJams);
  const navRef = useRef(nav);
  navRef.current = nav;

  const cum = useMemo(() => (routeLine ? cumulative(routeLine) : null), [routeLine]);
  // Reported TraffiTech cameras: exact points, plus where the route enters a camera road or area.
  const camPoints = useMemo(() => pointFeatures(cameras), [cameras]);
  const camEntries = useMemo(() => (driving ? routeEntryFeatures(cameras, routeLine) : []), [cameras, routeLine, driving]);
  // Traffic lights / stop / give-way / rail crossings that Mapbox knows on the route but
  // OpenStreetMap is missing (e.g. most signalised junctions between West Hills and Mallam).
  const controlFeatures = useMemo<RoadFeature[]>(() => {
    if (!route) return [];
    const osmSigns = features.filter((f) => f.kind === 'sign');
    return route.controls
      .filter((c) => !osmSigns.some((f) => distance(f.lngLat, c.lngLat) < 35))
      .map((c) => ({
        id: `mb-${c.type}-${c.lngLat.map((n) => n.toFixed(5)).join(',')}`,
        kind: 'sign' as const,
        subtype: c.type,
        label: CONTROL_LABEL[c.type],
        icon: CONTROL_ICON[c.type],
        lngLat: c.lngLat,
        source: 'osm' as const,
      }));
  }, [route, features]);

  const mapFeatures = useMemo(() => [...features, ...camPoints, ...controlFeatures], [features, camPoints, controlFeatures]);
  const visible = useMemo(
    () => [...features, ...camPoints, ...camEntries, ...controlFeatures, ...reports].filter((f) => layers[f.kind]),
    [features, camPoints, camEntries, controlFeatures, reports, layers],
  );
  const alerts = useMemo(() => {
    if (!position) return [];
    const ctx = driving && nav && routeLine && cum ? { line: routeLine, cum, along: nav.along } : null;
    const ahead = upcomingAlerts(position, visible, ctx);
    // Driving without a route: tell the driver when they're inside a reported camera road/area.
    if (!ctx && layers.camera && (position.speedKmh ?? 0) >= 5) {
      for (const s of sitesHere(cameras, position.lngLat)) {
        ahead.unshift({
          feature: { id: `tt-here-${s.id}`, kind: 'camera', subtype: 'speed', label: siteLabel(s), icon: 'rw-camera', lngLat: position.lngLat, source: 'osm' },
          distance: 0,
        });
      }
    }
    return ahead.slice(0, 3);
  }, [position, visible, driving, nav, routeLine, cum, cameras, layers.camera]);

  // ---- Turn-by-turn voice: "In 500 metres, turn left onto …", "Turn left now" ----
  const spokenSteps = useRef(new Set<string>());
  useEffect(() => {
    if (!nav?.step || muted || drive === 'off') return;
    const d = nav.distToStep;
    const s = nav.step;
    if (!route) return;
    const key = (b: string) => stepKey(route, s.startIndex, b);
    const say = (bucket: string, text: string) => {
      if (spokenSteps.current.has(key(bucket))) return;
      // Mark this and all farther buckets as done so we never say an older prompt late.
      for (const b of ['far', 'near', 'now'].slice(0, ['far', 'near', 'now'].indexOf(bucket) + 1)) spokenSteps.current.add(key(b));
      speak(text);
    };
    if (s.type === 'arrive') {
      if (d <= 150) say('near', 'Your destination is ahead');
    } else if (d <= 30) say('now', sentence(s));
    else if (d <= 160) say('near', `In ${spokenDistance(d)}, ${lowerFirst(sentence(s))}`);
    else if (d <= 600 && (position?.speedKmh ?? 0) > 35) say('far', `In ${spokenDistance(d)}, ${lowerFirst(sentence(s))}`);
  }, [nav, muted, drive, route, position?.speedKmh]);

  // ---- "Heavy traffic ahead" — said once per slow stretch ----
  const spokenTraffic = useRef(new Set<string>());
  useEffect(() => {
    const t = nav?.trafficAhead;
    if (!t || muted || t.level === 'moderate' || t.inM > 1500) return;
    const key = `${t.at[0].toFixed(3)},${t.at[1].toFixed(3)}`; // by place, so a traffic refresh doesn't repeat it
    if (spokenTraffic.current.has(key)) return;
    spokenTraffic.current.add(key);
    const mins = Math.max(1, Math.round(t.timeS / 60));
    speak(
      `${jamWord(t.level)} ahead${t.inM > 100 ? ` in ${spokenDistance(t.inM)}` : ''}. ` +
        `About ${mins} ${mins === 1 ? 'minute' : 'minutes'} to get through.`,
    );
  }, [nav, muted]);

  // ---- Off the route: recalculate from where the car is (like every nav app) ----
  const [rerouting, setRerouting] = useState(false);
  const lastReroute = useRef(0);
  const replaceRoute = useCallback(
    async (reason: 'reroute' | 'refresh') => {
      const here = (drive === 'sim' ? null : gpsRef.current)?.lngLat ?? positionRef.current?.lngLat;
      if (!here || !destination) return;
      lastReroute.current = Date.now();
      if (reason === 'reroute') setRerouting(true);
      try {
        const before = navRef.current?.remainingS ?? null;
        const rs = await getRoutes(here, destination.lngLat, MAPBOX_TOKEN);
        if (!rs.length) return;
        if (reason === 'refresh' && before != null && rs[0].duration < before - 120) {
          setToast(`Faster route found: saves ${Math.round((before - rs[0].duration) / 60)} min`);
          if (!muted) speak('Faster route found');
        }
        setRoutes(rs.slice(0, 1));
        setSelected(0);
        if (reason === 'reroute' && !muted) speak(sentence(rs[0].steps[1] ?? rs[0].steps[0]));
      } catch {
        if (reason === 'reroute') setToast('Could not reroute. Check your connection.');
      } finally {
        setRerouting(false);
      }
    },
    [drive, destination, muted],
  );

  useEffect(() => {
    if (drive !== 'gps' || !nav?.offRoute || rerouting || Date.now() - lastReroute.current < 10000) return;
    if (!muted) speak('Rerouting');
    replaceRoute('reroute');
  }, [drive, nav?.offRoute, rerouting, muted, replaceRoute]);

  // ---- Traffic changes: re-check the route every 3 minutes while driving ----
  useEffect(() => {
    if (!driving || !MAPBOX_TOKEN) return;
    const id = setInterval(() => replaceRoute('refresh'), 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [driving, replaceRoute]);

  // ---- Arrival ----
  useEffect(() => {
    if (!nav?.arrived || drive === 'off') return;
    setDrive('off');
    setToast(`You have arrived at ${shortLabel(destination?.label ?? 'your destination')}`);
    if (!muted) speak('You have arrived');
  }, [nav?.arrived, drive, destination, muted]);

  // ---- Keep the screen on while navigating ----
  useEffect(() => {
    if (!driving || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let stopped = false;
    const acquire = () =>
      (navigator as any).wakeLock
        .request('screen')
        .then((l: any) => (stopped ? l.release() : (lock = l)))
        .catch(() => {});
    // The browser drops the lock whenever the app goes to the background: take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [driving]);

  // ---- After panning away mid-drive, snap back to the car after 8 seconds ----
  const [panTick, setPanTick] = useState(0);
  useEffect(() => {
    if (!driving || follow) return;
    const t = setTimeout(() => setFollow(true), 8000);
    return () => clearTimeout(t);
  }, [driving, follow, panTick]);

  // Speak each alert once per pass (again if we come back more than 5 minutes later).
  const announced = useRef(new Map<string, number>());
  useEffect(() => {
    const now = Date.now();
    for (const a of alerts) {
      const last = announced.current.get(a.feature.id);
      announced.current.set(a.feature.id, now);
      if (last && now - last < 5 * 60 * 1000) continue;
      if (!muted) speak(spokenAlert(a.feature));
    }
  }, [alerts, muted]);

  // Entering a city where police confirm TraffiTech cameras operate: say so once.
  const toldCities = useRef(new Set<string>());
  useEffect(() => {
    if (!position || !layers.camera || (!driving && (position.speedKmh ?? 0) < 5)) return;
    const city = cityAt(cameras, position.lngLat);
    if (!city || toldCities.current.has(city.id)) return;
    toldCities.current.add(city.id);
    setToast(`Police speed cameras operate in ${city.name}. Watch your speed.`);
    if (!muted) speak(`Police speed cameras operate in ${city.name}. Watch your speed.`);
  }, [position, cameras, driving, layers.camera, muted]);

  // Speeding warning while over the limit. Recorded limits: every 15 s at +5 km/h.
  // Estimated limits (no posted limit on record): gentler, every 40 s at +10 km/h.
  const speed = position?.speedKmh ?? null;
  const limit = limitInfo?.limit ?? null;
  const limitEstimated = limitInfo?.estimated ?? false;
  const over = speed != null && limit != null && speed > limit + (limitEstimated ? SPEED_TOLERANCE_ESTIMATE : SPEED_TOLERANCE);
  const lastWarn = useRef(0);
  useEffect(() => {
    if (!over || muted || Date.now() - lastWarn.current < (limitEstimated ? 40000 : 15000)) return;
    lastWarn.current = Date.now();
    beep();
    speak(limitEstimated ? `Slow down. The usual limit on this kind of road is ${limit}` : `Slow down. The speed limit is ${limit}`);
  }, [over, muted, limit, limitEstimated, position]);

  const onViewChange = useCallback(
    (bbox: BBox, z: number) => {
      view.current = { bbox, zoom: z };
      const c: LngLat = [Math.round(((bbox[0] + bbox[2]) / 2) * 50) / 50, Math.round(((bbox[1] + bbox[3]) / 2) * 50) / 50];
      setMapCenter((prev) => (prev && prev[0] === c[0] && prev[1] === c[1] ? prev : c));
      // While driving the camera moves constantly; hazards along the route are already loaded,
      // so don't hit the map-data servers on every camera move.
      if (!drivingRef.current) loadInView(bbox, z);
    },
    [loadInView],
  );

  const dropPin = useCallback(
    async (p: LngLat) => {
      setPicking(false);
      setSearching(false);
      setDestination({ label: 'Dropped pin', lngLat: p });
      const label = await reverseGeocode(p);
      setDestination((d) => (d && d.lngLat === p ? { label, lngLat: p } : d));
    },
    [],
  );

  const onMapClick = useCallback((p: LngLat) => {
    if (pickingRef.current) dropPin(p);
  }, [dropPin]);
  const pickingRef = useRef(picking);
  pickingRef.current = picking;

  const report = (kind: ReportKind, label: string) => {
    const [w, s, e, n] = view.current.bbox;
    const at: LngLat = position?.lngLat ?? [(w + e) / 2, (s + n) / 2];
    setReports((r) => [...r, makeReport(kind, at)]);
    setReportOpen(false);
    setToast(`${label} reported. Thanks!`);
  };

  const startDrive = (mode: DriveMode) => {
    if (mode === 'gps' && !gps.position) {
      if (gps.status === 'insecure' || gps.status === 'unsupported') {
        setToast(GPS_HELP[gps.status]);
        return;
      }
      // Wait for the first fix and start automatically (like other nav apps), instead of refusing.
      if (gps.status === 'denied') gps.retry();
      setPendingStart(true);
      setToast(gps.status === 'denied' ? GPS_HELP.denied : 'Getting your GPS fix… navigation will start automatically.');
      return;
    }
    setPendingStart(false);
    setDrive(mode);
    setFollow(true);
    announced.current.clear();
    spokenSteps.current.clear();
    lastReroute.current = Date.now();
    // Keep only the chosen route on screen, like other apps once you press Start.
    if (route) {
      setRoutes([route]);
      setSelected(0);
    }
    const firstIdx = route ? route.steps.findIndex((s) => s.type !== 'depart') : -1;
    const first = route?.steps[firstIdx];
    if (route && first) {
      // The start announcement already names the first manoeuvre; if it's close, don't repeat it.
      const along = cumulative(route.geometry)[Math.min(first.startIndex, route.geometry.length - 1)];
      const skip = along < 200 ? ['far', 'near', 'now'] : along < 700 ? ['far'] : [];
      skip.forEach((b) => spokenSteps.current.add(stepKey(route, first.startIndex, b)));
    }
    if (!muted) speak(`${mode === 'sim' ? 'Starting test drive.' : 'Starting route.'} ${first ? sentence(first) : ''}`);
  };

  // Start pressed before GPS was ready: begin as soon as the first fix arrives.
  const [pendingStart, setPendingStart] = useState(false);
  const startRef = useRef(startDrive);
  startRef.current = startDrive;
  useEffect(() => {
    if (pendingStart && gps.position && routes.length) startRef.current('gps');
  }, [pendingStart, gps.position, routes.length]);
  useEffect(() => {
    if (!destination) setPendingStart(false);
  }, [destination]);

  const clearTrip = () => {
    setDestination(null);
    setOrigin(null);
    setRoutes([]);
  };

  const fastest = routes.length ? Math.min(...routes.map((r) => r.duration)) : 0;
  // Search favours places near the driver, or near what the map is showing.
  const near = position?.lngLat ?? mapCenter ?? REGION.center;
  const camCities = useMemo(() => citiesOnRoute(cameras, routeLine), [cameras, routeLine]);
  const roadName = limitInfo?.roadName ?? null;

  const status =
    toast ??
    (featuresError && !driving ? featuresError : null) ??
    (featuresLoading && !driving ? 'Loading road data…' : null);

  return (
    <div className={`app ${driving ? 'is-driving' : ''} ${searching ? 'is-searching' : ''}`}>
      <MapView
        features={mapFeatures}
        cameras={cameras}
        jams={routeJams}
        reports={reports}
        routes={driving && route ? [route] : routes}
        selectedRoute={driving ? 0 : selected}
        position={position}
        origin={driving ? null : origin?.lngLat ?? route?.geometry[0] ?? null}
        destination={destination?.lngLat ?? null}
        follow={follow}
        driving={driving}
        layers={layers}
        mapboxToken={MAPBOX_TOKEN}
        onViewChange={onViewChange}
        onContextMenu={dropPin}
        onMapClick={onMapClick}
        onSelectRoute={setSelected}
        onUserPan={() => {
          setFollow(false);
          setPanTick((n) => n + 1);
        }}
        onRemoveReport={(id) => setReports((r) => r.filter((x) => x.id !== id))}
      />

      {/* Top: guidance while driving (or a hazard ahead), otherwise a pick-on-map hint */}
      {picking ? (
        <div className="pick-banner">
          <span>Tap the map to set your destination</span>
          <button onClick={() => setPicking(false)}>Cancel</button>
        </div>
      ) : (
        <>
          {driving && (nav || rerouting) && <NavBanner nav={nav!} rerouting={rerouting} />}
          <AlertBanner alerts={alerts} over={over} limit={limit} estimated={limitEstimated} belowBanner={driving} />
        </>
      )}

      {/* Right-side buttons */}
      <div className="fabs-top">
        <LayersMenu layers={layers} onChange={setLayers} hasTraffic={!!MAPBOX_TOKEN} />
        <button className={`fab ${muted ? '' : 'fab-on'}`} onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute voice' : 'Mute voice'}>
          <Icon name={muted ? 'mute' : 'sound'} />
        </button>
      </div>

      <div className="bottom">
      <div className="above-sheet">
        <Speedometer speed={speed} info={limitInfo} simulated={drive === 'sim'} large={driving} showLimit={driving || (speed ?? 0) >= 5} />
        <div className="fabs-bottom">
          <div className="report">
            <button className="fab fab-report" onClick={() => setReportOpen((o) => !o)} aria-label="Report a hazard" aria-expanded={reportOpen}>
              <Icon name="plus" />
            </button>
            {reportOpen && (
              <div className="popover report-menu">
                <h3>Report on the road</h3>
                <div className="report-grid">
                  {REPORTS.map((r) => (
                    <button key={r.kind} onClick={() => report(r.kind, r.label)}>
                      <img src={iconUrl(r.icon)} alt="" />
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {!follow && (
            <button className="fab" onClick={() => setFollow(true)} aria-label="Re-centre">
              <Icon name="locate" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom sheet (side panel on desktop) */}
      {driving && destination && nav ? (
        <TripBar
          destination={destination.label}
          roadName={roadName}
          traffic={nav.trafficAhead}
          trafficDelay={route?.trafficDelay ?? null}
          liveTraffic={route?.source === 'mapbox'}
          remainingM={nav.remainingM}
          remainingS={nav.remainingS}
          simulated={drive === 'sim'}
          simSpeed={simSpeed}
          onSimSpeed={setSimSpeed}
          onEnd={() => setDrive('off')}
        />
      ) : searching ? (
        <div className="sheet sheet-full">
          <PlaceSearch
            origin={origin}
            destination={destination}
            hasGps={!!gps.position}
            near={near}
            recents={recents}
            onOrigin={setOrigin}
            onDestination={chooseDestination}
            onPickOnMap={() => {
              setSearching(false);
              setPicking(true);
            }}
            onClose={() => setSearching(false)}
          />
        </div>
      ) : destination ? (
        <div className="sheet">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <button className="icon-btn" onClick={clearTrip} aria-label="Back">
              <Icon name="back" />
            </button>
            <button className="trip-summary" onClick={() => setSearching(true)}>
              <span className="ts-row"><span className="mk-origin sm" />{origin ? shortLabel(origin.label) : gps.position ? 'Current location' : 'Choose a starting point'}</span>
              <span className="ts-row"><span className="mk-dest sm" /><strong>{shortLabel(destination.label)}</strong></span>
            </button>
          </div>

          {routing && !origin && !hasFix && <p className="route-note">Getting your location to plan the route…</p>}
          {routing && (
            <div className="route-list">
              <div className="route-row skeleton" />
              <div className="route-row skeleton" />
            </div>
          )}
          {routeError && <p className="sheet-error">{routeError}</p>}
          {!routing && routes.length > 0 && (
            <>
              <div className="route-list" role="radiogroup" aria-label="Route options">
                {routes.map((r, i) => (
                  <button key={r.id} role="radio" aria-checked={i === selected} className={`route-row ${i === selected ? 'route-on' : ''}`} onClick={() => setSelected(i)}>
                    <span className="route-ic"><Icon name="car" size={26} /></span>
                    <span className="route-main">
                      <span className="route-title">
                        {(() => {
                          // Compare rounded minutes so the label matches the times shown.
                          const extra = Math.round(r.duration / 60) - Math.round(fastest / 60);
                          return r.duration === fastest ? 'Fastest' : extra <= 0 ? 'Similar time' : `${extra} min slower`;
                        })()}
                      </span>
                      <span className="route-meta">
                        {formatDistance(r.distance)} · arrive {clock(r.duration)}
                      </span>
                      {r.summary && <span className="route-via">via {r.summary}</span>}
                      {(() => {
                        if (r.source !== 'mapbox') return null;
                        const js = jams.get(r.id) ?? [];
                        const inJam = js.reduce((a, j) => a + j.timeS, 0);
                        const lost = routeDelay(r, ffFactor).delayS;
                        if (lost < 60) return <span className="route-jam route-jam-clear">Traffic is light</span>;
                        return (
                          <span className="route-jam">
                            +{Math.round(lost / 60)} min from traffic
                            {inJam >= 60 ? ` · ~${Math.round(inJam / 60)} min in jams` : ''}
                          </span>
                        );
                      })()}
                    </span>
                    <span className="route-time">{formatDuration(r.duration)}</span>
                  </button>
                ))}
              </div>
              {route?.source === 'mapbox' ? (
                <TrafficSummary route={route} jams={routeJams} scenarios={selected === 0 ? scenarios : null} />
              ) : (
                <p className="route-note">Typical times, without live traffic.</p>
              )}
              {camCities.length > 0 && layers.camera && (
                <p className="cam-note">
                  <img src={iconUrl('rw-camera')} alt="" />
                  <span>
                    Police speed cameras operate in <strong>{camCities.map((c) => c.name).join(', ')}</strong> on this trip.
                  </span>
                </p>
              )}
              <div className="sheet-actions">
                <button className="btn btn-black" onClick={() => startDrive('gps')} disabled={pendingStart && !hasFix}>
                  {pendingStart && !hasFix ? (
                    <>
                      <span className="spinner spinner-light" /> Waiting for GPS…
                    </>
                  ) : (
                    <>
                      <Icon name="nav" size={18} /> Start
                    </>
                  )}
                </button>
                <button className="btn btn-grey" onClick={() => startDrive('sim')}>Test drive</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="sheet">
          <div className="sheet-handle" />
          <p className="greeting">Hello! Drive safe today.</p>
          <button className="where-to" onClick={() => setSearching(true)}>
            <Icon name="search" />
            <span>Where to?</span>
          </button>
          {!hasFix && gps.status !== 'waiting' && (
            <div className="loc-card">
              <span className="place-ic place-ic-blue"><Icon name="locate" size={18} /></span>
              <div className="loc-txt">
                <strong>Location is off</strong>
                <span>{gps.error}</span>
              </div>
              {gps.status !== 'insecure' && gps.status !== 'unsupported' && (
                <button className="btn btn-black loc-btn" onClick={() => gps.retry()}>
                  Turn on
                </button>
              )}
            </div>
          )}
          {recents.length > 0 ? (
            <ul className="home-list">
              {recents.slice(0, 3).map((r) => (
                <li key={r.label}>
                  <button onClick={() => chooseDestination(r)}>
                    <span className="place-ic"><Icon name="clock" size={18} /></span>
                    <span className="place-txt">
                      <strong>{shortLabel(r.label)}</strong>
                      <span>{r.label.split(',').slice(2).join(',').trim() || 'Ghana'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="home-hint">Search a place, or long-press / right-click the map.</p>
          )}
        </div>
      )}
      </div>

      {status && <div className="toast">{status}</div>}
    </div>
  );
}
