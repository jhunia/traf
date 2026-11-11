import { formatDistance, formatDuration } from '../lib/geo';
import { jamWord, shortTime, type TrafficScenarios, type TrafficStretch } from '../lib/traffic';
import type { Route } from '../lib/routing';

interface Props {
  route: Route;
  jams: TrafficStretch[];
  scenarios: TrafficScenarios | null; // only for the fastest route (the predictions are for it)
}

const mins = (s: number) => Math.max(1, Math.round(s / 60));

/** Route-sheet panel: trip time range (light → rush hour) and each jam with its time and delay. */
export function TrafficSummary({ route, jams, scenarios }: Props) {
  const now = route.duration;
  const lo = scenarios ? Math.min(scenarios.lightS, now) : null;
  const hi = scenarios ? Math.max(scenarios.rushS, now) : null;
  const pos = lo != null && hi != null && hi > lo ? ((now - lo) / (hi - lo)) * 100 : 50;
  const shown = [...jams].sort((a, b) => b.delayS - a.delayS).slice(0, 3).sort((a, b) => a.startAlong - b.startAlong);

  return (
    <div className="traffic-summary">
      {scenarios && lo != null && hi != null && (
        <div className="range">
          <div className="range-head">
            <span>Trip time by traffic</span>
            <span className="live-badge">LIVE</span>
          </div>
          <div className="range-bar" role="img" aria-label={`Light traffic ${mins(lo)} minutes, now ${mins(now)} minutes, rush hour ${mins(hi)} minutes`}>
            <div className="range-fill" />
            <div className="range-now" style={{ left: `${Math.min(100, Math.max(0, pos))}%` }}>
              {/* Keep the label on screen when "now" sits at either end of the bar. */}
              <span className={pos < 18 ? 'at-start' : pos > 82 ? 'at-end' : ''}>Now {formatDuration(now)}</span>
            </div>
          </div>
          <div className="range-ends">
            <span><strong>{formatDuration(lo)}</strong> light traffic</span>
            <span><strong>{formatDuration(hi)}</strong> rush hour</span>
          </div>
          <p className="range-note">Light = Sunday early morning. Rush hour = {scenarios.rushLabel}. Predicted by Mapbox.</p>
        </div>
      )}

      {shown.length > 0 ? (
        <ul className="jam-list">
          {shown.map((j) => (
            <li key={j.startIndex} className={`jam jam-${j.level}`}>
              <span className="jam-dot" />
              <span className="jam-txt">
                <span>
                  <strong>{jamWord(j.level)}</strong> for {formatDistance(j.lengthM)}
                  {j.road ? ` on ${j.road}` : ''}
                </span>
                <small>starts in {formatDistance(j.startAlong)} · cars moving ~{Math.round(j.speedKmh)} km/h</small>
              </span>
              <span className="jam-time">
                {shortTime(j.timeS)}
                {j.delayS >= 10 && <em>+{shortTime(j.delayS)}</em>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="route-note">No jams on this route right now.</p>
      )}
    </div>
  );
}
