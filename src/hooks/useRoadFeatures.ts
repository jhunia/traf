import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bboxContains, bboxOf, padBBox, simplify, type BBox, type LngLat } from '../lib/geo';
import { fetchFeatures, type RegionData, type RoadFeature } from '../lib/osm';

export const MIN_FEATURE_ZOOM = 13;

/**
 * Cameras, bumps, signs and potholes from OpenStreetMap. Downloaded regions load
 * instantly; outside them we query Overpass live for what is on screen and along the route.
 */
export function useRoadFeatures(regions: RegionData[]) {
  const [features, setFeatures] = useState<Map<string, RoadFeature>>(new Map());
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadedBoxes = useRef<BBox[]>([]);
  const timer = useRef<number>();

  const merge = useCallback((list: RoadFeature[]) => {
    setFeatures((prev) => {
      const next = new Map(prev);
      list.forEach((f) => next.set(f.id, f));
      return next;
    });
  }, []);

  useEffect(() => {
    for (const r of regions) {
      merge(r.features);
      loadedBoxes.current.push(r.bbox);
    }
  }, [regions, merge]);

  const run = useCallback(
    async (job: () => Promise<RoadFeature[]>) => {
      setLoading((n) => n + 1);
      try {
        merge(await job());
        setError(null);
        return true;
      } catch (e) {
        setError('Live OpenStreetMap data is slow or unreachable right now.');
        console.warn(e);
        return false;
      } finally {
        setLoading((n) => n - 1);
      }
    },
    [merge],
  );

  const covered = (b: BBox) => loadedBoxes.current.some((x) => bboxContains(x, b));

  const loadInView = useCallback(
    (bbox: BBox, zoom: number) => {
      if (zoom < MIN_FEATURE_ZOOM || covered(bbox)) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        const padded = padBBox(bbox, 0.3);
        if (await run(() => fetchFeatures({ type: 'bbox', bbox: padded }))) loadedBoxes.current.push(padded);
      }, 900);
    },
    [run],
  );

  const loadAlongRoute = useCallback(
    (line: LngLat[]) => {
      if (covered(bboxOf(line))) return;
      run(() => fetchFeatures({ type: 'around', points: simplify(line, 150), radius: 40 }));
    },
    [run],
  );

  const list = useMemo(() => [...features.values()], [features]);
  return { features: list, loading: loading > 0, error, loadInView, loadAlongRoute };
}
