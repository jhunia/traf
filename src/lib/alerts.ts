import { angleDiff, bearing, distance, nearestOnLine, type LngLat } from './geo';
import type { FeatureKind, RoadFeature } from './osm';

export interface Position {
  lngLat: LngLat;
  speedKmh: number | null;
  heading: number | null;
  accuracy: number | null;
  simulated: boolean;
  time: number;
}

/** Warn this many metres before reaching each kind of feature. */
export const ALERT_DISTANCE: Record<FeatureKind, number> = {
  camera: 500,
  bump: 200,
  pothole: 200,
  sign: 200,
};

// Like other navigation apps, we don't announce every traffic light.
const SILENT_SUBTYPES = new Set(['traffic_signals']);

export interface Alert {
  feature: RoadFeature;
  distance: number; // metres ahead (along the route when navigating)
}

/**
 * Hazards ahead of the driver.
 * - Navigating: measured along the route, so bends don't hide them and parallel streets don't trigger them.
 * - Free driving: straight-line distance within ±45° of the direction of travel.
 */
export function upcomingAlerts(
  pos: Position,
  features: RoadFeature[],
  route: { line: LngLat[]; cum: number[]; along: number } | null,
): Alert[] {
  const moving = (pos.speedKmh ?? 0) >= 5;
  if (!route && (pos.heading == null || !moving)) return [];
  const out: Alert[] = [];
  for (const f of features) {
    if (SILENT_SUBTYPES.has(f.subtype)) continue;
    const limit = ALERT_DISTANCE[f.kind];
    const straight = distance(pos.lngLat, f.lngLat);
    if (straight > limit + 50) continue; // cheap pre-filter
    if (route) {
      const m = nearestOnLine(f.lngLat, route.line, route.cum);
      if (m.dist > 25) continue; // not on our road
      const ahead = m.along - route.along;
      if (ahead < 5 || ahead > limit) continue;
      out.push({ feature: f, distance: ahead });
    } else {
      if (straight > limit || straight < 8) continue;
      if (angleDiff(bearing(pos.lngLat, f.lngLat), pos.heading!) > 45) continue;
      out.push({ feature: f, distance: straight });
    }
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, 3);
}

export function spokenAlert(f: RoadFeature): string {
  switch (f.kind) {
    case 'camera':
      // Researched TraffiTech reports carry their own wording ("Speed cameras reported on …").
      if (f.id.startsWith('tt-')) return `${f.label.replace('reported: ', 'reported at ')}. Watch your speed.`;
      return f.subtype === 'speed' ? 'Speed camera ahead' : 'Traffic camera ahead';
    case 'bump':
      return `${f.label} ahead`;
    case 'pothole':
      return 'Pothole ahead';
    case 'sign':
      return `${f.label.replace(/^Road sign: /, '')} ahead`;
  }
}
