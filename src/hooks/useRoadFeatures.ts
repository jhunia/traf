import { useCallback, useMemo, useRef, useState } from 'react';
import { bboxContains, bboxOf, padBBox, simplify, type BBox, type LngLat } from '../lib/geo';
import { fetchFeatures, type RoadFeature } from '../lib/osm';

export const MIN_FEATURE_ZOOM = 12;

/**
 * Cameras, bumps, signs and potholes from OpenStreetMap.
 * `base` is the downloaded data (the whole country) and `covered` the areas it covers; only outside
 * those areas do we ask the live Overpass servers, which are slow and sometimes unreachable.
 */
export function useRoadFeatures(base: RoadFeature[], covered: BBox[]) {
  const [live, setLive] = useState<Map<string, RoadFeature>>(new Map());
  const [loading, setLoading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadedBoxes = useRef<BBox[]>([]);
  const timer = useRef<number>();
  const coveredRef = useRef(covered);
  coveredRef.current = covered;

  const run = useCallback(async (job: () => Promise<RoadFeature[]>) => {
    setLoading((n) => n + 1);
    try {
      const list = await job();
      setLive((prev) => {
        const next = new Map(prev);
        list.forEach((f) => next.set(f.id, f));
        return next;
      });
      setError(null);
      return true;
    } catch (e) {
      setError('Live road data for this area is slow or unreachable right now.');
      console.warn(e);
      return false;
    } finally {
      setLoading((n) => n - 1);
    }
  }, []);

  const isCovered = (b: BBox) => [...coveredRef.current, ...loadedBoxes.current].some((x) => bboxContains(x, b));

  const loadInView = useCallback(
    (bbox: BBox, zoom: number) => {
      if (zoom < MIN_FEATURE_ZOOM + 1 || isCovered(bbox)) return;
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
      if (isCovered(bboxOf(line))) return;
      run(() => fetchFeatures({ type: 'around', points: simplify(line, 150), radius: 40 }));
    },
    [run],
  );

  const features = useMemo(() => {
    if (!live.size) return base;
    const ids = new Set(base.map((f) => f.id));
    return [...base, ...[...live.values()].filter((f) => !ids.has(f.id))];
  }, [base, live]);

  return { features, loading: loading > 0, error, loadInView, loadAlongRoute };
}
