import type { BBox, LngLat } from './geo';

/** Country settings. Swap this file to launch in another country. */
export const REGION = {
  name: 'Ghana',
  countryCode: 'gh',
  /** Whole country: the map opens here until we know where the driver is. */
  bounds: [-3.3, 4.6, 1.25, 11.2] as BBox,
  center: [-0.187, 5.6037] as LngLat, // Accra, only used as a last resort
  /**
   * Cities with a downloaded road file (`public/data/<id>-roads.json`, from `node scripts/fetch-osm.mjs <id>`).
   * The file is only loaded when the driver or the map is inside the box. Missing files are skipped.
   */
  cities: [
    { id: 'accra', name: 'Accra', bbox: [-0.5, 5.45, 0.15, 5.9] as BBox },
    { id: 'kumasi', name: 'Kumasi', bbox: [-1.75, 6.55, -1.5, 6.8] as BBox },
    { id: 'takoradi', name: 'Takoradi', bbox: [-1.85, 4.85, -1.65, 5.0] as BBox },
    { id: 'tamale', name: 'Tamale', bbox: [-0.95, 9.3, -0.75, 9.5] as BBox },
  ],
};

/** Quick picks in search, so the whole country is one tap away. Coordinates from OpenStreetMap. */
export const MAJOR_PLACES: { name: string; region: string; lngLat: LngLat }[] = [
  { name: 'Accra', region: 'Greater Accra', lngLat: [-0.2012, 5.5571] },
  { name: 'Kumasi', region: 'Ashanti', lngLat: [-1.6233, 6.6986] },
  { name: 'Tamale', region: 'Northern', lngLat: [-0.8424, 9.4052] },
  { name: 'Takoradi', region: 'Western', lngLat: [-1.7519, 4.8874] },
  { name: 'Cape Coast', region: 'Central', lngLat: [-1.2417, 5.1081] },
  { name: 'Tema', region: 'Greater Accra', lngLat: [-0.0097, 5.6596] },
  { name: 'Koforidua', region: 'Eastern', lngLat: [-0.2615, 6.1003] },
  { name: 'Ho', region: 'Volta', lngLat: [0.4689, 6.6127] },
  { name: 'Sunyani', region: 'Bono', lngLat: [-2.3309, 7.3384] },
  { name: 'Techiman', region: 'Bono East', lngLat: [-1.9364, 7.585] },
  { name: 'Bolgatanga', region: 'Upper East', lngLat: [-0.8487, 10.7854] },
  { name: 'Wa', region: 'Upper West', lngLat: [-2.5054, 10.0623] },
];

/**
 * Ghana's default speed limits where no sign is posted, as stated by the Ghana Police Service
 * (TraffiTech-GH FAQ): 50 km/h in built-up areas, 90 km/h on highways outside them, 100 km/h on motorways.
 * (30 km/h applies near schools, markets, hospitals and places of worship; we can't detect those yet.)
 */
export const DEFAULT_LIMIT = { motorway: 100, highway: 90, builtUp: 50 };

const MAIN_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const LOCAL_STREETS: Record<string, number> = { residential: 30, street: 30, street_limited: 30, living_street: 20, service: 20 };

/**
 * Estimated limit for a road with no recorded limit, from its type and whether it's in a built-up area.
 * Always shown as an estimate ("est"). Works with OpenStreetMap and Mapbox road types.
 */
export function estimateLimit(roadClass: string | null | undefined, builtUp: boolean): number {
  const cls = (roadClass ?? '').replace(/_link$/, '');
  const isLink = /_link$/.test(roadClass ?? '');
  if (cls === 'motorway') return isLink ? 60 : DEFAULT_LIMIT.motorway;
  if (cls in LOCAL_STREETS) return LOCAL_STREETS[cls];
  if (builtUp || isLink) return DEFAULT_LIMIT.builtUp;
  return MAIN_ROADS.has(cls) ? DEFAULT_LIMIT.highway : DEFAULT_LIMIT.builtUp;
}

/** How far over the limit (km/h) before we warn: tighter for recorded limits than for estimates. */
export const SPEED_TOLERANCE = 5;
export const SPEED_TOLERANCE_ESTIMATE = 10;
