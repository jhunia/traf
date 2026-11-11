import { useEffect, useMemo, useRef, useState } from 'react';
import { angleDiff, bearing, distance, nearestOnLine, type LngLat } from '../lib/geo';
import { estimateLimit } from '../lib/ghana';
import type { Road } from '../lib/osm';
import { isBuiltUp, type Places } from '../lib/places';
import type { Position } from '../lib/alerts';
import { toKmh, type Route } from '../lib/routing';

export interface SpeedLimitInfo {
  roadName: string | null;
  limit: number | null;
  /** True when no posted limit is recorded and we applied Ghana's default for this kind of road. */
  estimated: boolean;
  source: 'mapbox' | 'osm' | 'estimate';
}

const MATCH_RADIUS = 40; // metres: farther than this from any road = not on a known road
const MARGIN = 0.0005; // ~55 m in degrees, for the quick bounding-box check

function matchRoad(pos: Position, roads: Road[]): Road | null {
  const [x, y] = pos.lngLat;
  let best: { road: Road; score: number } | null = null;
  for (const road of roads) {
    const [w, s, e, n] = road.bbox;
    if (x < w - MARGIN || x > e + MARGIN || y < s - MARGIN || y > n + MARGIN) continue;
    const m = nearestOnLine(pos.lngLat, road.geometry);
    if (m.dist > MATCH_RADIUS) continue;
    let score = m.dist;
    if (pos.heading != null) {
      // Prefer roads running the same way we are driving (either direction).
      const seg = bearing(road.geometry[m.index], road.geometry[m.index + 1] ?? road.geometry[m.index]);
      const diff = angleDiff(seg, pos.heading);
      if (Math.min(diff, 180 - diff) > 40) score += 25;
    }
    if (!best || score < best.score) best = { road, score };
  }
  return best?.road ?? null;
}

// ---- Driving without a route: ask Mapbox which road the last few GPS points are on ----

interface Matched {
  at: LngLat;
  time: number;
  limit: number | null;
  cls: string | null;
  urban: boolean;
  name: string | null;
}

async function matchTrace(pts: LngLat[], token: string): Promise<Omit<Matched, 'at' | 'time'> | null> {
  const coords = pts.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';');
  const url =
    `https://api.mapbox.com/matching/v5/mapbox/driving/${coords}` +
    `?annotations=maxspeed&overview=full&geometries=geojson&steps=true&tidy=true&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const m = data.matchings?.[data.matchings.length - 1];
  const leg = m?.legs?.[m.legs.length - 1];
  if (!leg) return null;
  const speeds: unknown[] = leg.annotation?.maxspeed ?? [];
  const junctions = (leg.steps ?? []).flatMap((s: any) => s.intersections ?? []).filter((x: any) => x.mapbox_streets_v8?.class);
  const lastJ = junctions[junctions.length - 1];
  const names = (leg.steps ?? []).map((s: any) => s.name).filter(Boolean);
  return {
    limit: toKmh(speeds[speeds.length - 1]),
    cls: lastJ?.mapbox_streets_v8.class ?? null,
    urban: lastJ?.is_urban === true,
    name: names[names.length - 1] ?? null,
  };
}

/** Throttled: at most one request every 12 s and 150 m, only while moving. */
function useMapMatch(position: Position | null, enabled: boolean, token?: string): Matched | null {
  const [matched, setMatched] = useState<Matched | null>(null);
  const trace = useRef<LngLat[]>([]);
  const last = useRef<{ at: LngLat; time: number } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!position || position.simulated) return;
    const t = trace.current;
    const prev = t[t.length - 1];
    if (prev && distance(prev, position.lngLat) > 500) t.length = 0; // GPS jumped: start a new trace
    if (!prev || distance(prev, position.lngLat) >= 25) {
      t.push(position.lngLat);
      if (t.length > 6) t.shift();
    }
    if (!enabled || !token || busy.current || t.length < 3 || (position.speedKmh ?? 0) < 10) return;
    const now = Date.now();
    if (last.current && (now - last.current.time < 12000 || distance(last.current.at, position.lngLat) < 150)) return;
    busy.current = true;
    last.current = { at: position.lngLat, time: now };
    const at = position.lngLat;
    matchTrace(t.slice(), token)
      .then((r) => r && setMatched({ ...r, at, time: Date.now() }))
      .catch(() => undefined)
      .finally(() => (busy.current = false));
  }, [position, enabled, token]);

  return matched;
}

/**
 * The speed limit where the car is, anywhere in Ghana. In order of trust:
 * 1. the limit Mapbox records for this stretch of the route
 * 2. the limit OpenStreetMap records for this road (downloaded cities)
 * 3. off-route: the limit Mapbox records for the road the GPS trace matches
 * 4. an estimate: Ghana's default for this kind of road, built-up or not (shown as "est")
 */
export function useSpeedLimit(
  position: Position | null,
  route: Route | null,
  roads: Road[],
  places: Places | null,
  mapboxToken?: string,
): SpeedLimitInfo | null {
  const onRoute = useMemo(() => {
    if (!position || !route) return null;
    const m = nearestOnLine(position.lngLat, route.geometry);
    return m.dist <= 30 ? m.index : null;
  }, [position, route]);

  const road = useMemo(() => (position ? matchRoad(position, roads) : null), [position, roads]);
  const matched = useMapMatch(position, onRoute == null && !road?.maxspeed, mapboxToken);

  return useMemo<SpeedLimitInfo | null>(() => {
    if (!position) return null;
    const here = position.lngLat;

    if (onRoute != null && route) {
      const roadName = route.names?.[onRoute] ?? road?.name ?? null;
      const recorded = route.maxspeeds?.[onRoute] ?? null;
      if (recorded != null) return { roadName, limit: recorded, estimated: false, source: 'mapbox' };
      if (road?.maxspeed) return { roadName, limit: road.maxspeed, estimated: false, source: 'osm' };
      const cls = route.roadClass?.[onRoute] ?? road?.highway ?? null;
      if (!cls) return roadName ? { roadName, limit: null, estimated: true, source: 'estimate' } : null;
      const builtUp = route.urban?.[onRoute] === true || !!road || isBuiltUp(places, here);
      return { roadName, limit: estimateLimit(cls, builtUp), estimated: true, source: 'estimate' };
    }

    if (road?.maxspeed) return { roadName: road.name ?? null, limit: road.maxspeed, estimated: false, source: 'osm' };
    const fresh = matched && Date.now() - matched.time < 45000 && distance(matched.at, here) < 400 ? matched : null;
    if (fresh?.limit != null) return { roadName: fresh.name ?? road?.name ?? null, limit: fresh.limit, estimated: false, source: 'mapbox' };
    const cls = road?.highway ?? fresh?.cls ?? null;
    if (!cls) return null;
    const builtUp = !!road || fresh?.urban === true || isBuiltUp(places, here);
    return { roadName: road?.name ?? fresh?.name ?? null, limit: estimateLimit(cls, builtUp), estimated: true, source: 'estimate' };
  }, [position, route, onRoute, road, matched, places]);
}
