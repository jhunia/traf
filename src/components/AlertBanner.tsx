import { ALERT_DISTANCE, type Alert } from '../lib/alerts';
import { formatDistance } from '../lib/geo';
import { iconUrl } from '../lib/icons';

interface Props {
  alerts: Alert[];
  over: boolean;
  limit: number | null;
  belowBanner: boolean; // sits under the turn-by-turn banner while navigating
}

/** Hazard card: the next camera / bump / pothole / sign ahead, or a speeding warning. */
export function AlertBanner({ alerts, over, limit, belowBanner }: Props) {
  const first = alerts[0];
  const cls = `hazard ${belowBanner ? 'hazard-low' : ''}`;

  if (!first && over) {
    return (
      <div className={`${cls} hazard-over`} role="alert">
        <div className="hazard-limit">{limit}</div>
        <div className="hazard-txt">
          <strong>Slow down</strong>
          <span>Speed limit {limit} km/h</span>
        </div>
      </div>
    );
  }
  if (!first) return null;

  const progress = 1 - first.distance / ALERT_DISTANCE[first.feature.kind];
  return (
    <div className={`${cls} hazard-${first.feature.kind}`} role="alert">
      <img src={iconUrl(first.feature.icon)} alt="" className="hazard-img" />
      <div className="hazard-txt">
        <strong>{first.feature.label}</strong>
        <span>{first.distance === 0 ? "You're in it now: watch your speed" : `in ${formatDistance(first.distance)}`}</span>
      </div>
      {alerts.length > 1 && (
        <div className="hazard-more" title={alerts.slice(1).map((a) => a.feature.label).join(', ')}>
          +{alerts.length - 1}
        </div>
      )}
      <div className="hazard-bar" style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
    </div>
  );
}
