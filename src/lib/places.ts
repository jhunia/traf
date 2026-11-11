// Where Ghana's cities, towns and villages are (public/data/ghana-places.json, from
// `node scripts/fetch-osm.mjs places`). Used to tell when a road is in a built-up area,
// so the 50 km/h default applies instead of the 90 km/h highway default.
import { distance, type LngLat } from './geo';

// How far a settlement's built-up area is assumed to reach from its centre, by type.
const RADIUS = [6000, 2000, 700]; // city, town, village (metres)
const CELL = 0.1; // degrees (~11 km): must be larger than the biggest radius

export interface Places {
  cells: Map<string, [number, number, number][]>;
  count: number;
}

const key = (x: number, y: number) => `${x},${y}`;

export async function loadPlaces(): Promise<Places | null> {
  try {
    const res = await fetch('/data/ghana-places.json');
    if (!res.ok) return null;
    const data = (await res.json()) as { places: [number, number, number][] };
    const cells: Places['cells'] = new Map();
    for (const p of data.places) {
      const k = key(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL));
      const list = cells.get(k);
      if (list) list.push(p);
      else cells.set(k, [p]);
    }
    return { cells, count: data.places.length };
  } catch {
    return null;
  }
}

/** True when the point is inside a city, town or village. */
export function isBuiltUp(places: Places | null, p: LngLat): boolean {
  if (!places) return false;
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const [lon, lat, type] of places.cells.get(key(cx + dx, cy + dy)) ?? []) {
        if (distance(p, [lon, lat]) <= (RADIUS[type] ?? 700)) return true;
      }
    }
  }
  return false;
}
