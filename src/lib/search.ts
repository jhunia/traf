// Place search through OpenStreetMap Nominatim, limited to the launch country.
// The public server allows about 1 request per second, so calls are spaced out.
import type { LngLat } from './geo';
import { REGION } from './ghana';

export interface Place {
  label: string;
  lngLat: LngLat;
}

const BASE = 'https://nominatim.openstreetmap.org';
let lastCall = 0;

async function throttle() {
  const wait = Math.max(0, 1100 - (Date.now() - lastCall));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function searchPlaces(q: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
  await throttle();
  if (signal?.aborted) return [];
  const url = new URL(`${BASE}/search`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', q);
  url.searchParams.set('countrycodes', REGION.countryCode);
  url.searchParams.set('limit', '6');
  url.searchParams.set('accept-language', 'en');
  if (near) {
    const d = 0.4; // bias results towards what is on screen
    url.searchParams.set('viewbox', [near[0] - d, near[1] + d, near[0] + d, near[1] - d].join(','));
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  return data.map((d: any) => ({ label: d.display_name, lngLat: [Number(d.lon), Number(d.lat)] as LngLat }));
}

export async function reverseGeocode(p: LngLat): Promise<string> {
  await throttle();
  try {
    const url = `${BASE}/reverse?format=jsonv2&lat=${p[1]}&lon=${p[0]}&zoom=17&accept-language=en`;
    const res = await fetch(url);
    const data = await res.json();
    return data.display_name ?? 'Dropped pin';
  } catch {
    return 'Dropped pin';
  }
}

export const shortLabel = (label: string) => label.split(',').slice(0, 2).join(',');
