import { useMemo, useRef } from 'react';
import { cumulative, distance, nearestOnLine } from '../lib/geo';
import type { Position } from '../lib/alerts';
import type { Route, Step } from '../lib/routing';
import type { JamLevel, TrafficStretch } from '../lib/traffic';

export interface NavState {
  along: number; // metres travelled along the route
  segIndex: number; // route segment the car is on
  // Next jam: how far away, how long, how long to get through it, and the extra time it costs.
  trafficAhead: { level: JamLevel; inM: number; lengthM: number; timeS: number; delayS: number; road: string | null } | null;
  offRouteBy: number; // metres from the route line
  offRoute: boolean; // confirmed off the route (several fixes in a row)
  step: Step | null; // next manoeuvre
  stepIndex: number;
  distToStep: number; // metres to the next manoeuvre
  afterStep: Step | null; // the one after, for "then …"
  remainingM: number;
  remainingS: number; // using per-segment travel times (live traffic when available)
  arrived: boolean;
}

const OFF_ROUTE_M = 45;
const OFF_ROUTE_FIXES = 3;

/** Tracks progress along the active route: next turn, time left, off-route, arrival. */
export function useNavigation(
  route: Route | null,
  position: Position | null,
  active: boolean,
  stretches: TrafficStretch[],
): NavState | null {
  const prepared = useMemo(() => {
    if (!route) return null;
    const cum = cumulative(route.geometry);
    const total = cum[cum.length - 1];
    // Seconds left from the start of each segment to the end of the route.
    const segs = route.geometry.length - 1;
    const secs = route.durations && route.durations.length === segs
      ? route.durations
      : Array.from({ length: segs }, (_, k) => ((cum[k + 1] - cum[k]) / Math.max(1, total)) * route.duration);
    const suffix = new Array(segs + 1).fill(0);
    for (let k = segs - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + secs[k];
    const stepAlong = route.steps.map((s) => cum[Math.min(s.startIndex, cum.length - 1)]);
    return { cum, total, secs, suffix, stepAlong };
  }, [route]);

  const misses = useRef(0);
  const lastRoute = useRef<Route | null>(null);
  if (lastRoute.current !== route) {
    lastRoute.current = route;
    misses.current = 0;
  }

  return useMemo(() => {
    if (!active || !route || !prepared || !position) return null;
    const { cum, total, secs, suffix, stepAlong } = prepared;
    const m = nearestOnLine(position.lngLat, route.geometry, cum);
    const segLen = Math.max(1, cum[m.index + 1] - cum[m.index]);
    const frac = (m.along - cum[m.index]) / segLen;

    // Off-route only after several bad fixes, and only if GPS is accurate enough to tell.
    const accurate = (position.accuracy ?? 0) <= 40;
    if (m.dist > OFF_ROUTE_M && accurate) misses.current++;
    else misses.current = 0;

    let stepIndex = route.steps.findIndex((_, k) => stepAlong[k] > m.along + 5);
    if (stepIndex < 0) stepIndex = route.steps.length - 1;
    const step = route.steps[stepIndex] ?? null;
    const remainingM = Math.max(0, total - m.along);
    const dest = route.geometry[route.geometry.length - 1];

    // Next slow stretch on the route (live traffic), like "Heavy traffic in 1.2 km".
    // If we're already inside a jam, only the part still ahead counts.
    let trafficAhead: NavState['trafficAhead'] = null;
    for (const s of stretches) {
      const endAlong = s.startAlong + s.lengthM;
      if (endAlong <= m.along + 10) continue;
      const left = Math.min(1, (endAlong - m.along) / s.lengthM);
      trafficAhead = {
        level: s.level,
        inM: Math.max(0, s.startAlong - m.along),
        lengthM: s.lengthM * left,
        timeS: s.timeS * left,
        delayS: s.delayS * left,
        road: s.road,
      };
      break;
    }

    return {
      along: m.along,
      segIndex: m.index,
      trafficAhead,
      offRouteBy: m.dist,
      offRoute: misses.current >= OFF_ROUTE_FIXES,
      step,
      stepIndex,
      distToStep: step ? Math.max(0, (stepAlong[stepIndex] ?? total) - m.along) : remainingM,
      afterStep: route.steps[stepIndex + 1] ?? null,
      remainingM,
      remainingS: Math.max(0, suffix[m.index + 1] + (secs[m.index] ?? 0) * (1 - frac)),
      arrived: remainingM < 25 || distance(position.lngLat, dest) < 25,
    };
  }, [active, route, prepared, position, stretches]);
}
