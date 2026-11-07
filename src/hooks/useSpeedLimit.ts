import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { angleDiff, bearing, distance, nearestOnLine, simplify, type LngLat } from '../lib/geo';
import { fetchRoads, limitFor, type RegionData, type Road } from '../lib/osm';
import type { Position } from '../lib/alerts';
import type { Route } from '../lib/routing';

const MATCH_RADIUS = 40; // metres: farther than this from any road = not on a known road
const MARGIN = 0.0005; // ~55 m in degrees, for the quick bounding-box check

function matchRoad(pos: Position, roads: Road[]): { road: Road; dist: number } | null {
  const [x, y] = pos.lngLat;
  let best: { road: Road; dist: number; score: number } | null = null;
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
    if (!best || score < best.score) best = { road, dist: m.dist, score };
  }
  return best;
}

export interface SpeedLimitInfo {
  roadName: string | null;
  highway: string | null;
  limit: number | null;
  estimated: boolean;
  source: 'mapbox' | 'osm' | 'estimate';
}

/**
 * The speed limit where the car is. On a Mapbox route we use Mapbox's per-segment limit;
 * otherwise we match the car to an OpenStreetMap road (tagged limit, or an estimate by road type).
 */
export function useSpeedLimit(
  position: Position | null,
  route: Route | null,
  regions: RegionData[],
): SpeedLimitInfo | null {
  const routeLine = route?.geometry ?? null;
  const [roads, setRoads] = useState<Map<number, Road>>(new Map());
  const fetchedAt = useRef<LngLat | null>(null);
  const loading = useRef(false);

  const merge = useCallback((list: Road[]) => {
    setRoads((prev) => {
      const next = new Map(prev);
      list.forEach((r) => next.set(r.id, r));
      return next;
    });
  }, []);

  useEffect(() => {
    regions.forEach((r) => merge(r.roads));
  }, [regions, merge]);

  // Pre-load all roads along a chosen route (incl. small streets), so limits work with a weak signal.
  // Not needed when the route already carries speed limits (Mapbox).
  const needRoads = !!routeLine && !route?.maxspeeds;
  useEffect(() => {
    if (!routeLine || !needRoads) return;
    let cancelled = false;
    fetchRoads({ type: 'around', points: simplify(routeLine, 120), radius: 30 })
      .then((r) => !cancelled && merge(r))
      .catch((e) => console.warn('Could not load roads along route', e));
    return () => {
      cancelled = true;
    };
  }, [routeLine, needRoads, merge]);

  const roadList = useMemo(() => [...roads.values()], [roads]);
  const match = useMemo(() => (position ? matchRoad(position, roadList) : null), [position, roadList]);

  // Not on any known road: fetch the roads around the car.
  useEffect(() => {
    if (!position || loading.current || match) return;
    if (fetchedAt.current && distance(fetchedAt.current, position.lngLat) < 250) return;
    loading.current = true;
    fetchedAt.current = position.lngLat;
    fetchRoads({ type: 'around', points: [position.lngLat], radius: 400 })
      .then(merge)
      .catch((e) => console.warn('Could not load nearby roads', e))
      .finally(() => (loading.current = false));
  }, [position, match, merge]);

  // Speed limit from the route itself (Mapbox), when the car is on it.
  const fromRoute = useMemo(() => {
    if (!position || !route || (!route.maxspeeds && !route.names)) return null;
    const m = nearestOnLine(position.lngLat, route.geometry);
    if (m.dist > 30) return null;
    return { limit: route.maxspeeds?.[m.index] ?? null, name: route.names?.[m.index] ?? null };
  }, [position, route]);

  const roadName = fromRoute?.name ?? (match ? match.road.name ?? null : null);
  if (fromRoute?.limit != null) {
    return { roadName, highway: match?.road.highway ?? null, limit: fromRoute.limit, estimated: false, source: 'mapbox' };
  }
  if (!match && roadName) return { roadName, highway: null, limit: null, estimated: false, source: 'osm' };
  if (!match) return null;
  const osm = limitFor(match.road);
  return { roadName, highway: match.road.highway, ...osm, source: osm.estimated ? 'estimate' : 'osm' };
}
