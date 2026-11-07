import { useEffect, useState } from 'react';
import { loadRegionData, type RegionData } from '../lib/osm';
import { REGION } from '../lib/ghana';

/** Road data downloaded ahead of time with `npm run fetch-data`. */
export function useRegionData() {
  const [regions, setRegions] = useState<RegionData[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    Promise.all(REGION.dataRegions.map(loadRegionData)).then((list) => {
      setRegions(list.filter((r): r is RegionData => r !== null));
      setLoaded(true);
    });
  }, []);
  return { regions, loaded };
}
