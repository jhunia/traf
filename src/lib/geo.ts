// Small geometry helpers. Coordinates are [longitude, latitude] everywhere.
export type LngLat = [number, number];
export type BBox = [west: number, south: number, east: number, north: number];

const R = 6371000; // Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distance(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Compass bearing from a to b, 0–360 degrees. */
export function bearing(a: LngLat, b: LngLat): number {
  const dLon = rad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest difference between two bearings, 0–180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Flat projection in metres around an origin; accurate enough at street scale.
function toXY(p: LngLat, o: LngLat): [number, number] {
  return [rad(p[0] - o[0]) * R * Math.cos(rad(o[1])), rad(p[1] - o[1]) * R];
}

export function pointToSegment(p: LngLat, a: LngLat, b: LngLat): { dist: number; t: number } {
  const [px, py] = toXY(p, a);
  const [bx, by] = toXY(b, a);
  const len2 = bx * bx + by * by;
  let t = len2 === 0 ? 0 : (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(px - t * bx, py - t * by), t };
}

export function cumulative(line: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + distance(line[i - 1], line[i]));
  return out;
}

export interface LineMatch {
  dist: number; // metres from the line
  index: number; // segment start index
  along: number; // metres from the start of the line
}

export function nearestOnLine(p: LngLat, line: LngLat[], cum?: number[]): LineMatch {
  let best: LineMatch = { dist: Infinity, index: 0, along: 0 };
  if (line.length === 1) return { dist: distance(p, line[0]), index: 0, along: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const { dist, t } = pointToSegment(p, line[i], line[i + 1]);
    if (dist < best.dist) {
      const segLen = cum ? cum[i + 1] - cum[i] : distance(line[i], line[i + 1]);
      best = { dist, index: i, along: (cum ? cum[i] : 0) + t * segLen };
    }
  }
  return best;
}

/** Position and heading at a given distance along a line. */
export function pointAlong(line: LngLat[], cum: number[], d: number): { pos: LngLat; heading: number } {
  if (line.length < 2) return { pos: line[0], heading: 0 };
  if (d <= 0) return { pos: line[0], heading: bearing(line[0], line[1]) };
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  const segLen = cum[i + 1] - cum[i] || 1;
  const t = Math.min(1, (d - cum[i]) / segLen);
  const a = line[i];
  const b = line[i + 1];
  return {
    pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    heading: bearing(a, b),
  };
}

/** Keeps at most maxPoints, evenly spaced, always including both ends. */
export function simplify(line: LngLat[], maxPoints: number): LngLat[] {
  if (line.length <= maxPoints) return line;
  const step = (line.length - 1) / (maxPoints - 1);
  const out: LngLat[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(line[Math.round(i * step)]);
  return out;
}

export function bboxOf(line: LngLat[]): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of line) {
    w = Math.min(w, x); e = Math.max(e, x);
    s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

export function padBBox([w, s, e, n]: BBox, ratio: number): BBox {
  const dx = (e - w) * ratio;
  const dy = (n - s) * ratio;
  return [w - dx, s - dy, e + dx, n + dy];
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
