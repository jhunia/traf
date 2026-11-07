import { useEffect, useRef, useState } from 'react';
import type { LngLat } from '../lib/geo';
import { searchPlaces, shortLabel, type Place } from '../lib/search';
import { Icon } from './Icon';

type Field = 'origin' | 'destination';

interface Props {
  origin: Place | null;
  destination: Place | null;
  hasGps: boolean;
  near: LngLat;
  recents: Place[];
  onOrigin: (p: Place | null) => void;
  onDestination: (p: Place) => void;
  onPickOnMap: () => void;
  onClose: () => void;
}

/** Full-height search: start and destination fields with one shared results list. */
export function PlaceSearch({ origin, destination, hasGps, near, recents, onOrigin, onDestination, onPickOnMap, onClose }: Props) {
  const [active, setActive] = useState<Field>('destination');
  const [text, setText] = useState<Record<Field, string>>({
    origin: origin ? shortLabel(origin.label) : '',
    destination: destination ? shortLabel(destination.label) : '',
  });
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const destRef = useRef<HTMLInputElement>(null);

  useEffect(() => destRef.current?.focus(), []);

  const q = text[active].trim();
  useEffect(() => {
    if (q.length < 3) {
      setResults([]);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setResults(await searchPlaces(q, near, ctrl.signal));
        setError(null);
      } catch {
        if (!ctrl.signal.aborted) setError('Search is busy. Try again in a moment.');
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, active]);

  const choose = (p: Place | null) => {
    if (active === 'origin') {
      onOrigin(p);
      setText((t) => ({ ...t, origin: p ? shortLabel(p.label) : '' }));
      // Trip already has a destination: go straight back to the routes.
      if (destination) return onClose();
      setActive('destination');
      destRef.current?.focus();
    } else if (p) {
      onDestination(p);
    }
  };

  const field = (f: Field, placeholder: string, ref?: React.Ref<HTMLInputElement>) => (
    <div className={`field ${active === f ? 'field-on' : ''}`}>
      <input
        ref={ref}
        value={text[f]}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={(e) => {
          setActive(f);
          e.target.select();
        }}
        onChange={(e) => setText((t) => ({ ...t, [f]: e.target.value }))}
      />
      {busy && active === f ? (
        <span className="spinner" />
      ) : text[f] ? (
        <button className="field-clear" aria-label="Clear" onClick={() => setText((t) => ({ ...t, [f]: '' }))}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );

  const showRecents = q.length < 3;

  return (
    <div className="search-screen">
      <div className="search-head">
        <button className="icon-btn" onClick={onClose} aria-label="Back">
          <Icon name="back" />
        </button>
        <h2>Plan your trip</h2>
      </div>

      <div className="trip-fields">
        <div className="trip-markers" aria-hidden="true">
          <span className="mk-origin" />
          <span className="mk-line" />
          <span className="mk-dest" />
        </div>
        <div className="trip-inputs">
          {field('origin', hasGps ? 'Current location' : 'Starting point')}
          {field('destination', 'Where to?', destRef)}
        </div>
      </div>

      <ul className="place-list">
        {active === 'origin' && hasGps && (
          <li>
            <button onClick={() => choose(null)}>
              <span className="place-ic place-ic-blue"><Icon name="locate" size={18} /></span>
              <span className="place-txt"><strong>Current location</strong><span>Use GPS</span></span>
            </button>
          </li>
        )}
        {active === 'destination' && (
          <li>
            <button onClick={onPickOnMap}>
              <span className="place-ic"><Icon name="pin" size={18} /></span>
              <span className="place-txt"><strong>Set location on map</strong><span>Tap anywhere on the map</span></span>
            </button>
          </li>
        )}
        {error && <li className="place-note">{error}</li>}
        {showRecents && recents.length > 0 && <li className="place-section">Recent</li>}
        {(showRecents ? recents : results).map((r) => (
          <li key={`${r.lngLat.join()}-${r.label}`}>
            <button onClick={() => choose(r)}>
              <span className="place-ic"><Icon name={showRecents ? 'clock' : 'pin'} size={18} /></span>
              <span className="place-txt">
                <strong>{shortLabel(r.label)}</strong>
                <span>{r.label.split(',').slice(2).join(',').trim() || 'Ghana'}</span>
              </span>
            </button>
          </li>
        ))}
        {!showRecents && !busy && !error && results.length === 0 && <li className="place-note">No places found in Ghana for “{q}”.</li>}
      </ul>
    </div>
  );
}
