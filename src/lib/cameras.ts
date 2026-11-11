// TraffiTech-GH camera reports (police statements, news and driver apps), built by scripts/build-cameras.mjs.
// Four precisions: an exact point, a stretch of road, a neighbourhood zone, or a whole city
// where police confirm cameras operate.
import { bboxOf, distance, nearestOnLine, type BBox, type LngLat } from './geo';
import type { RoadFeature } from './osm';

export interface CameraSource {
  title: string;
  url: string;
}

interface Base {
  id: string;
  name: string;
  confidence: 'police' | 'news' | 'crowd';
  limit: number | null;
  note: string | null;
  sources: string[];
}
export type CameraSite =
  | (Base & { kind: 'point'; lngLat: LngLat })
  | (Base & { kind: 'road'; lines: LngLat[][] })
  | (Base & { kind: 'zone'; lngLat: LngLat; radius: number })
  | (Base & { kind: 'city'; lngLat: LngLat; radius: number });

export type CameraCity = Extract<CameraSite, { kind: 'city' }>;

export interface CameraData {
  builtAt: string;
  sources: Record<string, CameraSource>;
  sites: CameraSite[];
}

export async function loadCameras(): Promise<CameraData | null> {
  try {
    const res = await fetch('/data/cameras-gh.json');
    return res.ok ? ((await res.json()) as CameraData) : null;
  } catch {
    return null;
  }
}

export const confidenceText = (c: CameraSite['confidence']) =>
  c === 'police'
    ? 'Police (MTTD) say cameras operate in this city, many in patrol vehicles and on tripods'
    : c === 'news'
      ? 'Named in news reports on police enforcement'
      : 'Reported by drivers (Glydr / Waze), unofficial';

export function siteLabel(s: CameraSite): string {
  if (s.kind === 'point') return `Speed camera reported: ${s.name}`;
  if (s.kind === 'road') return `Speed cameras reported on ${s.name}`;
  if (s.kind === 'city') return `Speed cameras operate in ${s.name}`;
  return `Speed cameras reported around ${s.name}`;
}

const asFeature = (s: CameraSite, at: LngLat, idPrefix = 'tt-'): RoadFeature => ({
  id: `${idPrefix}${s.id}`,
  kind: 'camera',
  subtype: 'speed',
  label: siteLabel(s),
  icon: 'rw-camera',
  lngLat: at,
  source: 'osm',
});

/** Exact-point sites as ordinary map/alert features. */
export function pointFeatures(data: CameraData | null): RoadFeature[] {
  return (data?.sites ?? []).filter((s): s is Extract<CameraSite, { kind: 'point' }> => s.kind === 'point').map((s) => asFeature(s, s.lngLat));
}

function siteBox(s: Exclude<CameraSite, { kind: 'point' }>): BBox {
  if (s.kind === 'road') {
    const [w, so, e, n] = bboxOf(s.lines.flat());
    return [w - 0.0005, so - 0.0005, e + 0.0005, n + 0.0005];
  }
  const d = s.radius / 100000; // generous degrees
  return [s.lngLat[0] - d, s.lngLat[1] - d, s.lngLat[0] + d, s.lngLat[1] + d];
}

const inBox = (p: LngLat, [w, s, e, n]: BBox) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;

function inside(s: Exclude<CameraSite, { kind: 'point' }>, p: LngLat): boolean {
  return s.kind === 'road' ? s.lines.some((l) => nearestOnLine(p, l).dist <= 25) : distance(p, s.lngLat) <= s.radius;
}

/**
 * Where the route first enters each camera road or zone, as alert features.
 * That way "Speed cameras reported on Cantonments Road" counts down along the route like any camera.
 */
export function routeEntryFeatures(data: CameraData | null, route: LngLat[] | null): RoadFeature[] {
  if (!data || !route) return [];
  const out: RoadFeature[] = [];
  for (const s of data.sites) {
    if (s.kind === 'point' || s.kind === 'city') continue;
    const box = siteBox(s);
    const entry = route.find((p) => inBox(p, box) && inside(s, p)); // box check first keeps long routes fast
    if (entry) out.push(asFeature(s, entry));
  }
  return out;
}

/** Camera roads/zones the car is inside right now (for driving without a route). */
export function sitesHere(data: CameraData | null, p: LngLat): CameraSite[] {
  if (!data) return [];
  return data.sites.filter((s) => (s.kind === 'road' || s.kind === 'zone') && inBox(p, siteBox(s)) && inside(s, p));
}

/** The city (with police-confirmed cameras) the point is in, if any. */
export function cityAt(data: CameraData | null, p: LngLat): CameraCity | null {
  return (data?.sites.find((s) => s.kind === 'city' && distance(p, s.lngLat) <= s.radius) as CameraCity | undefined) ?? null;
}

/** Cities with police-confirmed cameras that a route passes through, in driving order. */
export function citiesOnRoute(data: CameraData | null, route: LngLat[] | null): CameraCity[] {
  if (!data || !route) return [];
  const cities = data.sites.filter((s): s is CameraCity => s.kind === 'city');
  const found: CameraCity[] = [];
  const step = Math.max(1, Math.floor(route.length / 800));
  for (let i = 0; i < route.length; i += step) {
    for (const c of cities) {
      if (!found.includes(c) && distance(route[i], c.lngLat) <= c.radius) found.push(c);
    }
  }
  return found;
}

/** A circle polygon for drawing a zone on the map. */
export function circle(center: LngLat, radiusM: number, steps = 48): LngLat[] {
  const out: LngLat[] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((center[1] * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push([center[0] + dLng * Math.cos(a), center[1] + dLat * Math.sin(a)]);
  }
  return out;
}
