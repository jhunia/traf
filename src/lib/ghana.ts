import type { LngLat } from './geo';

/** Launch-region settings. Swap this file to launch in another country. */
export const REGION = {
  name: 'Ghana',
  countryCode: 'gh',
  center: [-0.187, 5.6037] as LngLat, // Accra
  zoom: 13,
  // Areas downloaded by scripts/fetch-osm.mjs; missing ones are skipped.
  dataRegions: ['accra', 'kumasi', 'takoradi'],
};

/**
 * Fallback speed limits (km/h) by OpenStreetMap road type, used only when a road
 * has no `maxspeed` tag. These are ESTIMATES and are always shown with "est.".
 * TODO: verify against Ghana's Road Traffic Regulations before launch.
 */
export const DEFAULT_LIMITS: Record<string, number> = {
  motorway: 100,
  motorway_link: 60,
  trunk: 80,
  trunk_link: 50,
  primary: 50,
  primary_link: 50,
  secondary: 50,
  secondary_link: 50,
  tertiary: 50,
  tertiary_link: 50,
  unclassified: 50,
  road: 50,
  residential: 30,
  living_street: 20,
  service: 20,
};

/** How far over the limit (km/h) before we warn. */
export const SPEED_TOLERANCE = 5;
