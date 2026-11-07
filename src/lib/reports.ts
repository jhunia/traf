// Driver reports. Phase 1 keeps them on this device; phase 2 moves them to the backend.
import type { LngLat } from './geo';
import type { RoadFeature } from './osm';

const KEY = 'roadwise.reports.v1';

export type ReportKind = 'pothole' | 'bump' | 'camera';

const TEMPLATES: Record<ReportKind, Pick<RoadFeature, 'kind' | 'subtype' | 'label' | 'icon'>> = {
  pothole: { kind: 'pothole', subtype: 'user', label: 'Pothole', icon: 'rw-pothole' },
  bump: { kind: 'bump', subtype: 'user', label: 'Speed bump', icon: 'rw-bump' },
  camera: { kind: 'camera', subtype: 'speed', label: 'Speed camera', icon: 'rw-camera' },
};

export function loadReports(): RoadFeature[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RoadFeature[]) : [];
  } catch {
    return [];
  }
}

export function saveReports(list: RoadFeature[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked */
  }
}

export function makeReport(kind: ReportKind, lngLat: LngLat): RoadFeature {
  return {
    ...TEMPLATES[kind],
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    lngLat,
    source: 'user',
    createdAt: Date.now(),
  };
}
