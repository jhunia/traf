// Live OpenStreetMap data through the Overpass API: cameras, speed bumps,
// road signs, potholes, and roads with their speed limits.
import { bboxOf, type BBox, type LngLat } from './geo';

// Public Overpass servers are often slow or unreachable from some networks, so we
// try several, remember the one that worked, and send one query at a time.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
let preferred = 0;
let queue: Promise<unknown> = Promise.resolve();

export type FeatureKind = 'camera' | 'bump' | 'sign' | 'pothole';

export interface RoadFeature {
  id: string;
  kind: FeatureKind;
  subtype: string;
  label: string;
  icon: string; // map icon name, see icons.ts
  lngLat: LngLat;
  source: 'osm' | 'user';
  createdAt?: number;
}

export interface Road {
  id: number;
  name?: string;
  ref?: string;
  highway: string;
  maxspeed?: number; // km/h from OSM
  geometry: LngLat[];
  bbox: BBox; // for fast "is this road near me" checks
}

export type Area =
  | { type: 'bbox'; bbox: BBox }
  | { type: 'around'; points: LngLat[]; radius: number };

function areaFilter(a: Area): string {
  if (a.type === 'bbox') {
    const [w, s, e, n] = a.bbox;
    return `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
  }
  const pts = a.points.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join(',');
  return `(around:${a.radius},${pts})`;
}

async function overpassNow(query: string): Promise<any> {
  let lastError: unknown;
  for (let k = 0; k < ENDPOINTS.length; k++) {
    const i = (preferred + k) % ENDPOINTS.length;
    try {
      const res = await fetch(ENDPOINTS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(35_000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      preferred = i;
      return json;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass unavailable');
}

function overpass(query: string): Promise<any> {
  const run = queue.then(() => overpassNow(query));
  queue = run.catch(() => undefined);
  return run;
}

const BUMP_TYPES: Record<string, string> = {
  bump: 'Speed bump',
  hump: 'Speed hump',
  table: 'Raised table',
  cushion: 'Speed cushion',
  rumble_strip: 'Rumble strips',
  dip: 'Dip',
  yes: 'Speed bump',
};

const titleCase = (s: string) => s.replace(/[_;]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function classify(tags: Record<string, string>): Omit<RoadFeature, 'id' | 'lngLat' | 'source'> | null {
  const limit = tags.maxspeed ? ` (${tags.maxspeed} km/h)` : '';
  if (tags.highway === 'speed_camera') {
    return { kind: 'camera', subtype: 'speed', label: `Speed camera${limit}`, icon: 'rw-camera' };
  }
  if (tags.man_made === 'surveillance' && tags.surveillance === 'traffic') {
    return { kind: 'camera', subtype: 'traffic', label: 'Traffic camera', icon: 'rw-camera' };
  }
  if (tags.traffic_calming && BUMP_TYPES[tags.traffic_calming]) {
    return { kind: 'bump', subtype: tags.traffic_calming, label: BUMP_TYPES[tags.traffic_calming], icon: 'rw-bump' };
  }
  if (tags.hazard === 'pothole' || tags.hazard === 'potholes') {
    return { kind: 'pothole', subtype: 'osm', label: 'Pothole', icon: 'rw-pothole' };
  }
  switch (tags.highway) {
    case 'stop':
      return { kind: 'sign', subtype: 'stop', label: 'Stop sign', icon: 'rw-stop' };
    case 'give_way':
      return { kind: 'sign', subtype: 'give_way', label: 'Give way', icon: 'rw-give-way' };
    case 'traffic_signals':
      return { kind: 'sign', subtype: 'traffic_signals', label: 'Traffic lights', icon: 'rw-signals' };
    case 'mini_roundabout':
      return { kind: 'sign', subtype: 'roundabout', label: 'Roundabout', icon: 'rw-roundabout' };
  }
  if (tags.hazard) {
    return { kind: 'sign', subtype: 'hazard', label: `Hazard: ${titleCase(tags.hazard)}`, icon: 'rw-sign' };
  }
  if (tags.traffic_sign) {
    return { kind: 'sign', subtype: 'traffic_sign', label: `Road sign: ${titleCase(tags.traffic_sign)}`, icon: 'rw-sign' };
  }
  return null;
}

export async function fetchFeatures(area: Area): Promise<RoadFeature[]> {
  const f = areaFilter(area);
  const query = `[out:json][timeout:25];
(
  node["highway"="speed_camera"]${f};
  node["man_made"="surveillance"]["surveillance"="traffic"]${f};
  node["traffic_calming"]${f};
  way["traffic_calming"]${f};
  node["highway"~"^(stop|give_way|traffic_signals|mini_roundabout)$"]${f};
  node["traffic_sign"]${f};
  node["hazard"]${f};
);
out center tags;`;
  const data = await overpass(query);
  return elementsToFeatures(data.elements ?? []);
}

function elementsToFeatures(elements: any[]): RoadFeature[] {
  const out: RoadFeature[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const c = classify(el.tags ?? {});
    if (!c) continue;
    out.push({ ...c, id: `osm-${el.type}-${el.id}`, lngLat: [lon, lat], source: 'osm' });
  }
  return out;
}

/** A downloaded hazards file: the area it covers and its features. Null if it has not been downloaded. */
export async function loadFeaturesFile(name: string): Promise<{ bbox: BBox; features: RoadFeature[] } | null> {
  try {
    const res = await fetch(`/data/${name}-features.json`);
    if (!res.ok) return null;
    const f = await res.json();
    const [s, w, n, e] = f.bbox as number[]; // stored as south, west, north, east
    return { bbox: [w, s, e, n], features: elementsToFeatures(f.elements) };
  } catch {
    return null;
  }
}

/** A downloaded city road file (roads with their recorded speed limits). Null if it has not been downloaded. */
export async function loadRoadsFile(name: string): Promise<Road[] | null> {
  try {
    const res = await fetch(`/data/${name}-roads.json`);
    if (!res.ok) return null;
    const r = await res.json();
    return r.roads.map((x: any) => {
      const geometry: LngLat[] = [];
      for (let i = 0; i < x.g.length; i += 2) geometry.push([x.g[i], x.g[i + 1]]);
      return { id: x.id, name: x.n, highway: x.h, maxspeed: parseMaxspeed(x.m), geometry, bbox: bboxOf(geometry) };
    });
  } catch {
    return null;
  }
}

export function parseMaxspeed(v?: string): number | undefined {
  if (!v) return undefined;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return m[2]?.toLowerCase() === 'mph' ? Math.round(n * 1.609) : n;
}
