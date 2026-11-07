// TraffiTech-GH camera reports (news + driver apps), built by scripts/build-cameras.mjs.
// Three precisions: an exact point, a stretch of road, or a neighbourhood zone.
import { distance, nearestOnLine, type LngLat } from './geo';
import type { RoadFeature } from './osm';

export interface CameraSource {
  title: string;
  url: string;
}

interface Base {
  id: string;
  name: string;
  confidence: 'news' | 'crowd';
  limit: number | null;
  note: string | null;
  sources: string[];
}
export type CameraSite =
  | (Base & { kind: 'point'; lngLat: LngLat })
  | (Base & { kind: 'road'; lines: LngLat[][] })
  | (Base & { kind: 'zone'; lngLat: LngLat; radius: number });

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
  c === 'news' ? 'Named in news reports on police enforcement' : 'Reported by drivers (Glydr / Waze), unofficial';

function label(s: CameraSite): string {
  if (s.kind === 'point') return `Speed camera reported: ${s.name}`;
  if (s.kind === 'road') return `Speed cameras reported on ${s.name}`;
  return `Speed cameras reported around ${s.name}`;
}

/** Exact-point sites as ordinary map/alert features. */
export function pointFeatures(data: CameraData | null): RoadFeature[] {
  return (data?.sites ?? [])
    .filter((s): s is Extract<CameraSite, { kind: 'point' }> => s.kind === 'point')
    .map((s) => ({ id: `tt-${s.id}`, kind: 'camera', subtype: 'speed', label: label(s), icon: 'rw-camera', lngLat: s.lngLat, source: 'osm' }));
}

/**
 * Where the route first enters each camera road or zone, as alert features.
 * That way "Speed cameras reported on Cantonments Road" counts down along the route like any camera.
 */
export function routeEntryFeatures(data: CameraData | null, route: LngLat[] | null): RoadFeature[] {
  if (!data || !route) return [];
  const out: RoadFeature[] = [];
  for (const s of data.sites) {
    if (s.kind === 'point') continue;
    const inside = (p: LngLat) =>
      s.kind === 'zone' ? distance(p, s.lngLat) <= s.radius : s.lines.some((l) => nearestOnLine(p, l).dist <= 25);
    // Quick reject: skip sites nowhere near the route.
    const anchor = s.kind === 'zone' ? s.lngLat : s.lines[0][0];
    if (!route.some((p, i) => i % 5 === 0 && distance(p, anchor) < (s.kind === 'zone' ? s.radius : 0) + 8000)) continue;
    const entry = route.find(inside);
    if (entry) {
      out.push({ id: `tt-${s.id}`, kind: 'camera', subtype: 'speed', label: label(s), icon: 'rw-camera', lngLat: entry, source: 'osm' });
    }
  }
  return out;
}

/** Camera roads/zones the car is inside right now (for driving without a route). */
export function sitesHere(data: CameraData | null, p: LngLat): CameraSite[] {
  if (!data) return [];
  return data.sites.filter((s) =>
    s.kind === 'zone' ? distance(p, s.lngLat) <= s.radius : s.kind === 'road' ? s.lines.some((l) => nearestOnLine(p, l).dist <= 25) : false,
  );
}

export const siteLabel = label;

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
