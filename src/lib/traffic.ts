// How long a driver will spend in traffic.
//
// Mapbox gives, for every small segment of the route, the live travel time and a congestion level.
//  - Time in a jam   = sum of the live travel times of its segments.
//  - Clear-road time = the same distance driven at free-flow speed. We estimate free flow from each
//    segment's speed limit, then calibrate it so the whole trip matches Mapbox's own prediction for an
//    empty-road time (Sunday early morning). That keeps "clear road" grounded in real data for Accra.
//  - Delay           = time in the jam − clear-road time.
// Trip-level range: Mapbox's predicted trip time for a light-traffic departure vs weekday rush hours.
import { cumulative, type LngLat } from './geo';
import type { Route } from './routing';

export type JamLevel = 'moderate' | 'heavy' | 'severe';

export interface TrafficStretch {
  level: JamLevel;
  startIndex: number; // first segment
  endIndex: number; // last segment (inclusive)
  startAlong: number; // metres from route start
  lengthM: number;
  timeS: number; // time to drive through it now
  freeS: number; // time on a clear road
  delayS: number; // extra time caused by the jam
  speedKmh: number; // average speed inside it
  road: string | null;
}

export interface TrafficScenarios {
  lightS: number; // trip time with light traffic (Sunday early morning)
  rushS: number; // trip time at the worst weekday rush hour
  rushLabel: string;
}

const RANK: Record<string, number> = { moderate: 1, heavy: 2, severe: 3 };
const isSlow = (c: string | undefined) => c === 'moderate' || c === 'heavy' || c === 'severe';
const MAX_GAP_M = 60; // short clear gaps inside a jam don't split it
const MIN_JAM_M = 80; // ignore tiny slow bits (junction queues)

/** Seconds per segment at free-flow speed (≈85% of the speed limit), before calibration. */
export function rawFreeFlow(route: Route): number[] {
  const cum = cumulative(route.geometry);
  return Array.from({ length: route.geometry.length - 1 }, (_, k) => {
    const d = route.distances?.[k] ?? cum[k + 1] - cum[k];
    const kmh = Math.max(20, (route.maxspeeds?.[k] ?? 50) * 0.85);
    return d / (kmh / 3.6);
  });
}

/** Calibration factor so free-flow time over the best route equals Mapbox's light-traffic trip time. */
export function freeFlowFactor(bestRoute: Route, lightS: number | null): number {
  if (!lightS) return 1;
  const sum = rawFreeFlow(bestRoute).reduce((a, b) => a + b, 0);
  return sum > 0 ? lightS / sum : 1;
}

/** Whole-route clear-road time and how much traffic adds to it right now. */
export function routeDelay(route: Route, factor: number): { freeS: number; delayS: number } {
  const freeS = rawFreeFlow(route).reduce((a, b) => a + b, 0) * factor;
  return { freeS, delayS: Math.max(0, route.duration - freeS) };
}

/** "45 s" under a minute, otherwise "4 min". */
export const shortTime = (s: number) => (s < 60 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : `${Math.round(s / 60)} min`);

/** Finds the slow stretches on a route and how long each one takes. */
export function analyzeTraffic(route: Route, factor: number): TrafficStretch[] {
  const c = route.congestion;
  const live = route.durations;
  if (!c || !live || live.length !== c.length) return [];
  const cum = cumulative(route.geometry);
  const ff = rawFreeFlow(route).map((s) => s * factor);
  const out: TrafficStretch[] = [];

  let k = 0;
  while (k < c.length) {
    if (!isSlow(c[k])) {
      k++;
      continue;
    }
    let end = k;
    let worst = c[k];
    for (let j = k + 1; j < c.length; j++) {
      if (isSlow(c[j])) {
        end = j;
        if (RANK[c[j]] > RANK[worst]) worst = c[j];
      } else if (cum[j + 1] - cum[end + 1] > MAX_GAP_M) {
        break;
      }
    }
    const lengthM = cum[end + 1] - cum[k];
    if (lengthM >= MIN_JAM_M) {
      let timeS = 0;
      let freeS = 0;
      for (let s = k; s <= end; s++) {
        timeS += live[s];
        freeS += Math.min(ff[s], live[s]); // a segment can't be "faster than free flow"
      }
      out.push({
        level: worst as JamLevel,
        startIndex: k,
        endIndex: end,
        startAlong: cum[k],
        lengthM,
        timeS,
        freeS,
        delayS: Math.max(0, timeS - freeS),
        speedKmh: (lengthM / Math.max(1, timeS)) * 3.6,
        road: route.names?.[k] ?? null,
      });
    }
    k = end + 1;
  }
  return out;
}

// ---- Light vs rush-hour trip time (Mapbox predictive traffic) ----
// Ghana is on GMT all year, so UTC clock times are local times.

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16); // YYYY-MM-DDThh:mm
}

/** Next date (at least 30 min from now) matching one of the weekdays, at hh:mm local Ghana time. */
function next(days: number[], hh: number, mm: number): string {
  const now = Date.now();
  const base = new Date(now);
  for (let i = 0; i < 9; i++) {
    const t = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + i, hh, mm);
    if (t > now + 30 * 60 * 1000 && days.includes(new Date(t).getUTCDay())) return fmt(t);
  }
  return fmt(now + 24 * 3600 * 1000);
}

async function predicted(from: LngLat, to: LngLat, departAt: string, token: string): Promise<number> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?overview=false&depart_at=${departAt}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox ${res.status}`);
  const data = await res.json();
  return data.routes?.[0]?.duration ?? Promise.reject(new Error('no route'));
}

export async function fetchScenarios(from: LngLat, to: LngLat, token: string): Promise<TrafficScenarios | null> {
  try {
    const weekdays = [1, 2, 3, 4, 5];
    const [light, am, pm] = await Promise.all([
      predicted(from, to, next([0], 5, 30), token), // Sunday 5:30 am: roads at their emptiest
      predicted(from, to, next(weekdays, 7, 30), token), // morning rush
      predicted(from, to, next(weekdays, 17, 30), token), // evening rush
    ]);
    return {
      lightS: light,
      rushS: Math.max(am, pm),
      rushLabel: am > pm ? 'weekday 7:30 am' : 'weekday 5:30 pm',
    };
  } catch (e) {
    console.warn('Could not get traffic predictions', e);
    return null;
  }
}

export const jamWord = (l: JamLevel) => (l === 'moderate' ? 'Slow traffic' : l === 'heavy' ? 'Heavy traffic' : 'Standstill');
