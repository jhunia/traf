// Turns a route step into what the driver sees and hears.
import type { Step } from './routing';

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** Short action for the banner, e.g. "Turn left", "Take the 2nd exit". */
export function action(step: Step): string {
  const mod = step.modifier ?? 'straight';
  const dir = mod.replace('slight ', '').replace('sharp ', '');
  switch (step.type) {
    case 'arrive':
      return 'Arrive at your destination';
    case 'depart':
      return 'Head out';
    case 'roundabout':
    case 'rotary':
      return step.exit ? `Take the ${ORDINAL[step.exit - 1] ?? step.exit + 'th'} exit` : 'Enter the roundabout';
    case 'exit roundabout':
    case 'exit rotary':
      return 'Exit the roundabout';
    case 'merge':
      return `Merge ${dir === 'straight' ? '' : dir}`.trim();
    case 'on ramp':
      return 'Take the ramp';
    case 'off ramp':
      return `Take the exit${dir === 'straight' ? '' : ' on the ' + dir}`;
    case 'fork':
      return `Keep ${dir === 'straight' ? 'straight' : dir}`;
    case 'end of road':
      return `Turn ${dir}`;
  }
  if (mod === 'uturn') return 'Make a U-turn';
  if (mod === 'straight') return 'Continue straight';
  if (mod.startsWith('slight')) return `Bear ${dir}`;
  if (mod.startsWith('sharp')) return `Turn sharp ${dir}`;
  return `Turn ${dir}`;
}

/** The full spoken sentence, e.g. "Turn left onto Ring Road Central". */
export function sentence(step: Step): string {
  if (step.instruction) return step.instruction;
  const a = action(step);
  if (step.type === 'arrive' || !step.name) return a;
  return `${a} onto ${step.name}`;
}

/** Which arrow to draw. */
export function arrowKind(step: Step): string {
  if (step.type === 'arrive') return 'arrive';
  if (step.type === 'roundabout' || step.type === 'rotary' || step.type === 'roundabout turn') return 'roundabout';
  const m = step.modifier ?? 'straight';
  return m.replace(' ', '-'); // straight, left, right, slight-left, sharp-right, uturn
}

/** Spoken distance, rounded the way people say it. */
export function spokenDistance(m: number): string {
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toString()} kilometres`;
  if (m >= 100) return `${Math.round(m / 50) * 50} metres`;
  return `${Math.round(m / 10) * 10} metres`;
}
