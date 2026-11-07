import { useEffect, useMemo, useRef, useState } from 'react';
import { cumulative, pointAlong, type LngLat } from '../lib/geo';
import type { Position } from '../lib/alerts';

const TICK_MS = 500;

/** Fake GPS that drives along a route, for testing alerts without leaving the desk. */
export function useSimulation(line: LngLat[] | null, speedKmh: number, running: boolean, onFinish: () => void) {
  const [pos, setPos] = useState<Position | null>(null);
  const along = useRef(0);
  const speedRef = useRef(speedKmh);
  speedRef.current = speedKmh;
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const cum = useMemo(() => (line ? cumulative(line) : null), [line]);

  useEffect(() => {
    along.current = 0;
  }, [line]);

  useEffect(() => {
    if (!running || !line || !cum) {
      setPos(null);
      return;
    }
    const total = cum[cum.length - 1];
    if (along.current >= total) along.current = 0;
    const tick = () => {
      const v = Math.max(0, speedRef.current + (Math.random() - 0.5) * 4); // a little jitter, like real driving
      along.current = Math.min(total, along.current + (v / 3.6) * (TICK_MS / 1000));
      const { pos: p, heading } = pointAlong(line, cum, along.current);
      setPos({ lngLat: p, speedKmh: v, heading, accuracy: 5, simulated: true, time: Date.now() });
      if (along.current >= total) finishRef.current();
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [running, line, cum]);

  return running ? pos : null;
}
