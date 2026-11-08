import { useCallback, useEffect, useRef, useState } from 'react';
import { bearing, distance, type LngLat } from '../lib/geo';
import type { Position } from '../lib/alerts';

/**
 * - waiting:     asking for permission / waiting for the first fix
 * - ok:          we have a position
 * - insecure:    the page isn't on HTTPS (or localhost), so the browser refuses location
 * - denied:      the user (or browser settings) blocked location for this site
 * - unavailable: no fix yet (indoors, GPS off); keeps trying
 * - unsupported: browser has no location API
 */
export type GpsStatus = 'waiting' | 'ok' | 'insecure' | 'denied' | 'unavailable' | 'unsupported';

export const GPS_HELP: Record<Exclude<GpsStatus, 'ok'>, string> = {
  waiting: 'Getting your location…',
  insecure: 'Location only works on a secure (https) link. Open the hosted app link, or type a starting point.',
  denied: 'Location is blocked for this site. Allow it in your browser settings (tap the lock icon by the address), or type a starting point.',
  unavailable: 'No GPS signal yet. Make sure location is on and you have a clear view of the sky.',
  unsupported: 'This browser cannot share your location. Type a starting point instead.',
};

/** Live phone/browser GPS with speed (km/h) and heading. */
export function useGps(enabled: boolean) {
  const [position, setPosition] = useState<Position | null>(null);
  const [status, setStatus] = useState<GpsStatus>('waiting');
  const [attempt, setAttempt] = useState(0);
  const prev = useRef<Position | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!window.isSecureContext) {
      setStatus('insecure');
      return;
    }
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus((s) => (s === 'ok' ? s : 'waiting'));
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
        const pos: Position = { lngLat, speedKmh: speed, heading, accuracy: p.coords.accuracy, simulated: false, time: p.timestamp };
        prev.current = pos;
        setPosition(pos);
        setStatus('ok');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStatus('denied');
        // Timeouts / no signal: keep the watch running, it will deliver when a fix arrives.
        else setStatus((s) => (s === 'ok' ? s : 'unavailable'));
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, attempt]);

  /** Ask again (e.g. after the user allowed location in settings). */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const error = status === 'ok' || status === 'waiting' ? null : GPS_HELP[status];
  return { position, status, error, retry };
}
