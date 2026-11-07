import { formatDistance } from '../lib/geo';
import { action, arrowKind } from '../lib/maneuvers';
import type { NavState } from '../hooks/useNavigation';

// Arrow drawings on a 48px grid.
const ARROWS: Record<string, JSX.Element> = {
  straight: <path d="M24 42V8m-11 11L24 8l11 11" />,
  right: <path d="M14 42V26a8 8 0 0 1 8-8h18m-9-9 9 9-9 9" />,
  left: <path d="M34 42V26a8 8 0 0 0-8-8H8m9-9-9 9 9 9" />,
  'slight-right': <path d="M18 42V26l14-14m-11 0h11v11" />,
  'slight-left': <path d="M30 42V26L16 12m11 0H16v11" />,
  'sharp-right': <path d="M14 8v18a8 8 0 0 0 8 8h0l14 6m-1-11 1 11-11 2" />,
  'sharp-left': <path d="M34 8v18a8 8 0 0 1-8 8h0l-14 6m1-11-1 11 11 2" />,
  uturn: <path d="M32 42V18a8 8 0 0 0-16 0v14m-8-8 8 8 8-8" />,
  roundabout: <><circle cx="24" cy="20" r="8" /><path d="M24 42V28m8-8h8m-4-4 4 4-4 4" /></>,
  arrive: <><path d="M24 44s12-11 12-22a12 12 0 0 0-24 0c0 11 12 22 12 22Z" /><circle cx="24" cy="22" r="4" /></>,
};

export function ManeuverArrow({ kind, size = 44 }: { kind: string; size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ARROWS[kind] ?? ARROWS.straight}
    </svg>
  );
}

/** Black guidance card: distance to the next manoeuvre, what to do, and onto which street. */
export function NavBanner({ nav, rerouting }: { nav: NavState; rerouting: boolean }) {
  if (rerouting) {
    return (
      <div className="nav-banner" role="status">
        <div className="nav-ic"><span className="spinner spinner-light" /></div>
        <div className="nav-txt">
          <strong>Rerouting…</strong>
          <span>Finding a new route from here</span>
        </div>
      </div>
    );
  }
  const step = nav.step;
  if (!step) return null;
  const onto = step.type === 'arrive' ? null : step.name;
  return (
    <div className="nav-banner" role="status" aria-live="polite">
      <div className="nav-ic"><ManeuverArrow kind={arrowKind(step)} /></div>
      <div className="nav-txt">
        <strong className="nav-dist">{formatDistance(nav.distToStep)}</strong>
        <span className="nav-action">{action(step)}</span>
        {onto && <span className="nav-street">onto {onto}</span>}
      </div>
      {nav.afterStep && nav.afterStep.type !== 'arrive' && nav.distToStep < 400 && (
        <div className="nav-then">
          <span>then</span>
          <ManeuverArrow kind={arrowKind(nav.afterStep)} size={24} />
        </div>
      )}
    </div>
  );
}
