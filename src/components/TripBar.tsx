import { formatDistance, formatDuration } from '../lib/geo';
import { shortLabel } from '../lib/search';
import { Icon } from './Icon';

interface Props {
  destination: string;
  roadName: string | null;
  traffic: { level: string; inM: number; lengthM: number; timeS: number; delayS: number } | null;
  trafficDelay: number | null; // seconds, null = no live data
  liveTraffic: boolean;
  remainingM: number;
  remainingS: number;
  simulated: boolean;
  simSpeed: number;
  onSimSpeed: (v: number) => void;
  onEnd: () => void;
}

/** Compact bottom sheet while driving. */
export function TripBar({ destination, roadName, traffic, trafficDelay, liveTraffic, remainingM, remainingS, simulated, simSpeed, onSimSpeed, onEnd }: Props) {
  const arrival = new Date(Date.now() + remainingS * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const levelWord = traffic ? (traffic.level === 'moderate' ? 'Slow traffic' : traffic.level === 'heavy' ? 'Heavy traffic' : 'Standstill traffic') : '';
  return (
    <div className="sheet sheet-trip">
      <div className="sheet-handle" />
      {liveTraffic && (
        <div className={`traffic-row ${traffic ? `traffic-${traffic.level}` : 'traffic-clear'}`}>
          <span className="traffic-dot" />
          {traffic ? (
            <span>
              <strong>{levelWord}</strong> {traffic.inM < 50 ? 'now' : `in ${formatDistance(traffic.inM)}`} · ~{Math.max(1, Math.round(traffic.timeS / 60))} min to get through
            </span>
          ) : (
            <span><strong>No major jams</strong> ahead</span>
          )}
          {traffic && traffic.delayS >= 30 ? (
            <span className="traffic-delay">+{Math.max(1, Math.round(traffic.delayS / 60))} min</span>
          ) : (
            !traffic && trafficDelay != null && trafficDelay >= 60 && <span className="traffic-delay">+{Math.round(trafficDelay / 60)} min vs usual</span>
          )}
          <span className="live-badge">LIVE</span>
        </div>
      )}
      <div className="trip-row">
        <button className="round-btn round-danger" onClick={onEnd} aria-label="End trip">
          <Icon name="close" />
        </button>
        <div className="trip-center">
          <div className="trip-eta">
            <strong>{formatDuration(remainingS)}</strong>
          </div>
          <div className="trip-sub">
            {formatDistance(remainingM)} · {arrival}
          </div>
          {roadName && <div className="trip-road">on {roadName}</div>}
        </div>
        <div className="trip-dest" title={destination}>
          <Icon name="pin" size={16} />
          <span>{shortLabel(destination).split(',')[0]}</span>
        </div>
      </div>
      {simulated && (
        <label className="trip-sim">
          <span>
            Test drive speed <strong>{simSpeed} km/h</strong>
          </span>
          <input type="range" min={10} max={130} step={5} value={simSpeed} onChange={(e) => onSimSpeed(Number(e.target.value))} />
        </label>
      )}
    </div>
  );
}
