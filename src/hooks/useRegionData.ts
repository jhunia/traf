import { useEffect, useRef, useState } from 'react';
import type { BBox, LngLat } from '../lib/geo';
import { REGION } from '../lib/ghana';
import { loadFeaturesFile, loadRoadsFile, type Road, type RoadFeature } from '../lib/osm';
import { loadPlaces, type Places } from '../lib/places';

const near = (p: LngLat, [w, s, e, n]: BBox, pad = 0.05) => p[0] >= w - pad && p[0] <= e + pad && p[1] >= s - pad && p[1] <= n + pad;

/**
 * Data downloaded ahead of time (see scripts/fetch-osm.mjs):
 * - hazards for the whole country (falls back to per-city files if the national file is missing)
 * - settlements, to know where roads are built-up
 * - city road files with recorded speed limits, loaded only when the driver or the map is in that city
 */
export function useRegionData(focus: LngLat | null) {
  const [features, setFeatures] = useState<RoadFeature[]>([]);
  const [covered, setCovered] = useState<BBox[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [places, setPlaces] = useState<Places | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const national = await loadFeaturesFile(REGION.countryCode === 'gh' ? 'ghana' : REGION.countryCode);
      if (cancelled) return;
      if (national) {
        setFeatures(national.features);
        setCovered([national.bbox]);
        return;
      }
      const cities = (await Promise.all(REGION.cities.map((c) => loadFeaturesFile(c.id)))).filter((c) => c !== null);
      if (cancelled) return;
      setFeatures(cities.flatMap((c) => c.features));
      setCovered(cities.map((c) => c.bbox));
    })();
    loadPlaces().then((p) => !cancelled && setPlaces(p));
    return () => {
      cancelled = true;
    };
  }, []);

  // Load a city's road file the first time the driver (or the map) gets there.
  const fx = focus ? Math.round(focus[0] * 50) / 50 : null;
  const fy = focus ? Math.round(focus[1] * 50) / 50 : null;
  useEffect(() => {
    if (fx == null || fy == null) return;
    for (const c of REGION.cities) {
      if (requested.current.has(c.id) || !near([fx, fy], c.bbox)) continue;
      requested.current.add(c.id);
      loadRoadsFile(c.id).then((r) => r && setRoads((prev) => [...prev, ...r]));
    }
  }, [fx, fy]);

  return { features, covered, roads, places };
}
