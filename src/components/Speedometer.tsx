import type { SpeedLimitInfo } from '../hooks/useSpeedLimit';
import { SPEED_TOLERANCE } from '../lib/ghana';

interface Props {
  speed: number | null;
  info: SpeedLimitInfo | null;
  simulated: boolean;
  large: boolean;
  showLimit: boolean; // hidden while parked, like other nav apps
}

/** Floating speed bubble with the road's speed-limit sign beside it. */
export function Speedometer({ speed, info: rawInfo, simulated, large, showLimit }: Props) {
  const info = showLimit ? rawInfo : null;
  const limit = info?.limit ?? null;
  const v = speed != null ? Math.round(speed) : null;
  const state = v == null || limit == null ? 'ok' : v > limit + SPEED_TOLERANCE ? 'over' : v > limit ? 'near' : 'ok';
  return (
    <div className={`speed ${large ? 'speed-lg' : ''} speed-${state}`} role="status" aria-label={`Speed ${v ?? 'unknown'} km/h, limit ${limit ?? 'unknown'}`}>
      <div className="speed-bubble">
        <strong>{v ?? '–'}</strong>
        <span>{simulated ? 'sim' : 'km/h'}</span>
      </div>
      {showLimit && <div
        className={`limit-sign ${limit == null ? 'limit-unknown' : ''} ${info?.estimated ? 'limit-est' : ''}`}
        title={
          limit == null
            ? 'No speed limit data for this road'
            : info?.source === 'mapbox'
              ? 'Speed limit from Mapbox'
              : info?.estimated
                ? 'Estimated from road type: no limit recorded for this road'
                : 'Speed limit from OpenStreetMap'
        }
      >
        {limit ?? '–'}
        {info?.estimated && limit != null && <em>est</em>}
      </div>}
    </div>
  );
}
