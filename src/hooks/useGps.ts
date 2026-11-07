import { useEffect, useRef, useState } from 'react';
import { bearing, distance, type LngLat } from '../lib/geo';
import type { Position } from '../lib/alerts';

/** Live phone/browser GPS with speed (km/h) and heading. */
export function useGps(enabled: boolean) {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<Position | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setError('This browser cannot access location');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const lngLat: LngLat = [p.coords.longitude, p.coords.latitude];
        const valid = (v: number | null) => (v != null && !Number.isNaN(v) ? v : null);
        let speed = valid(p.coords.speed) != null ? p.coords.speed! * 3.6 : null;
        let heading = valid(p.coords.heading);
        const last = prev.current;
        if (last) {
          const d = distance(last.lngLat, lngLat);
          const dt = (p.timestamp - last.time) / 1000;
          // Only derive speed from position changes when the fix is precise (real GPS, not Wi-Fi/IP).
          if (speed == null && dt > 0.5 && p.coords.accuracy <= 30) speed = (d / dt) * 3.6;
          if (heading == null && d > 5 && p.coords.accuracy <= 30) heading = bearing(last.lngLat, lngLat);
          heading ??= last.heading;
          if (speed != null && last.speedKmh != null) speed = last.speedKmh * 0.3 + speed * 0.7;
        }
        const pos: Position = {
          lngLat,
          speedKmh: speed,
          heading,
          accuracy: p.coords.accuracy,
          simulated: false,
          time: p.timestamp,
        };
        prev.current = pos;
        setPosition(pos);
        setError(null);
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Location unavailable'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { position, error };
}
