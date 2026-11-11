// Routes: Mapbox (live traffic, congestion, speed limits, turn-by-turn) when a token is set,
// otherwise OSRM on OpenStreetMap with typical travel times.
import type { LngLat } from './geo';

export type Congestion = 'unknown' | 'low' | 'moderate' | 'heavy' | 'severe';

export interface Step {
  type: string; // turn, depart, arrive, roundabout, merge, fork, …
  modifier: string | null; // left, right, slight left, straight, uturn, …
  exit: number | null; // roundabout exit number
  name: string | null; // street the step continues onto
  instruction: string | null; // ready-made sentence from the provider, if any
  startIndex: number; // index into Route.geometry where this manoeuvre happens
}

export interface Route {
  id: string;
  geometry: LngLat[];
  distance: number; // metres
  duration: number; // seconds, with live traffic when available
  typicalDuration: number | null; // seconds in usual traffic for this time
  trafficDelay: number | null; // seconds; null = no live traffic data
  congestion: Congestion[] | null; // one per segment (geometry.length - 1)
  maxspeeds: (number | null)[] | null; // km/h per segment
  durations: number[] | null; // seconds per segment (live traffic)
  distances: number[] | null; // metres per segment
  names: (string | null)[] | null; // street name per segment
  roadClass: (string | null)[] | null; // road type per segment (motorway, trunk, primary, street, …)
  urban: boolean[] | null; // per segment: the routing provider says it's in a built-up area
  summary: string | null; // main roads used, e.g. "N6, Kumasi Road"
  steps: Step[];
  controls: RoadControl[]; // traffic lights, stop/give-way signs, rail crossings at junctions on the route
  source: 'mapbox' | 'osrm';
}

/** A junction control the routing provider knows about (fills gaps in OpenStreetMap). */
export interface RoadControl {
  type: 'traffic_signals' | 'stop' | 'give_way' | 'railway_crossing';
  lngLat: LngLat;
}

/** Turn-by-turn steps, each tied to where it happens on the route geometry. */
function parseSteps(leg: any): {
  steps: Step[];
  names: (string | null)[];
  controls: RoadControl[];
  roadClass: (string | null)[] | null;
  urban: boolean[] | null;
} {
  const steps: Step[] = [];
  const names: (string | null)[] = [];
  const controls: RoadControl[] = [];
  // Road type + built-up flag change at junctions; each junction says where on the geometry it is.
  const marks: { index: number; cls: string | null; urban: boolean }[] = [];
  let offset = 0;
  for (const s of leg?.steps ?? []) {
    const m = s.maneuver ?? {};
    const name = s.name || s.ref || null;
    steps.push({
      type: m.type ?? 'turn',
      modifier: m.modifier ?? null,
      exit: typeof m.exit === 'number' ? m.exit : null,
      name,
      instruction: m.instruction ?? null,
      startIndex: offset,
    });
    for (const x of s.intersections ?? []) {
      if (typeof x.geometry_index === 'number' && x.mapbox_streets_v8?.class) {
        marks.push({ index: x.geometry_index, cls: x.mapbox_streets_v8.class, urban: x.is_urban === true });
      }
      const at = x.location as LngLat | undefined;
      if (!at) continue;
      if (x.traffic_signal) controls.push({ type: 'traffic_signals', lngLat: at });
      else if (x.stop_sign) controls.push({ type: 'stop', lngLat: at });
      else if (x.yield_sign) controls.push({ type: 'give_way', lngLat: at });
      else if (x.railway_crossing) controls.push({ type: 'railway_crossing', lngLat: at });
    }
    const n = Math.max(0, (s.geometry?.coordinates?.length ?? 1) - 1);
    for (let k = 0; k < n; k++) names.push(name);
    offset += n;
  }
  let roadClass: (string | null)[] | null = null;
  let urban: boolean[] | null = null;
  if (marks.length) {
    marks.sort((a, b) => a.index - b.index);
    roadClass = new Array(offset).fill(null);
    urban = new Array(offset).fill(false);
    for (let m = 0; m < marks.length; m++) {
      const end = marks[m + 1]?.index ?? offset;
      for (let k = Math.max(0, marks[m].index); k < Math.min(end, offset); k++) {
        roadClass[k] = marks[m].cls;
        urban[k] = marks[m].urban;
      }
    }
  }
  return { steps, names, controls, roadClass, urban };
}

async function osrmRoutes(from: LngLat, to: LngLat): Promise<Route[]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?alternatives=3&overview=full&geometries=geojson&steps=true&annotations=duration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found between these points');
  return data.routes.map((r: any, i: number) => {
    const { steps, names, controls, roadClass, urban } = parseSteps(r.legs?.[0]);
    return {
      id: `osrm-${i}`,
      geometry: r.geometry.coordinates as LngLat[],
      distance: r.distance,
      duration: r.duration,
      typicalDuration: null,
      trafficDelay: null,
      congestion: null,
      maxspeeds: null,
      durations: r.legs?.[0]?.annotation?.duration ?? null,
      distances: null,
      names,
      roadClass,
      urban,
      summary: (r.legs?.[0]?.summary as string) || null,
      steps,
      controls,
      source: 'osrm' as const,
    };
  });
}

export function toKmh(m: any): number | null {
  if (!m || m.unknown || m.none || typeof m.speed !== 'number') return null;
  return m.unit === 'mph' ? Math.round(m.speed * 1.609) : m.speed;
}

async function mapboxRoutes(from: LngLat, to: LngLat, token: string): Promise<Route[]> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?alternatives=true&geometries=geojson&overview=full&steps=true&annotations=congestion,maxspeed,duration,distance,speed` +
    `&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox routing failed (${res.status})`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found between these points');
  return data.routes.map((r: any, i: number) => {
    const leg = r.legs?.[0];
    const ann = leg?.annotation ?? {};
    const typical = typeof r.duration_typical === 'number' ? r.duration_typical : null;
    const { steps, names, controls, roadClass, urban } = parseSteps(leg);
    return {
      id: `mapbox-${i}-${Date.now()}`,
      geometry: r.geometry.coordinates as LngLat[],
      distance: r.distance,
      duration: r.duration,
      typicalDuration: typical,
      trafficDelay: typical != null ? Math.max(0, r.duration - typical) : null,
      congestion: Array.isArray(ann.congestion) ? (ann.congestion as Congestion[]) : null,
      maxspeeds: Array.isArray(ann.maxspeed) ? ann.maxspeed.map(toKmh) : null,
      durations: Array.isArray(ann.duration) ? ann.duration : null,
      distances: Array.isArray(ann.distance) ? ann.distance : null,
      names,
      roadClass,
      urban,
      summary: (leg?.summary as string) || null,
      steps,
      controls,
      source: 'mapbox' as const,
    };
  });
}

export async function getRoutes(from: LngLat, to: LngLat, mapboxToken?: string): Promise<Route[]> {
  if (mapboxToken) {
    try {
      return await mapboxRoutes(from, to, mapboxToken);
    } catch (e) {
      console.warn('Mapbox routing failed, falling back to OSRM', e);
    }
  }
  return osrmRoutes(from, to);
}
