import type { Place } from './search';

const KEY = 'roadwise.recents.v1';
const MAX = 5;

export function loadRecents(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Place[];
  } catch {
    return [];
  }
}

export function addRecent(list: Place[], p: Place): Place[] {
  const next = [p, ...list.filter((x) => x.label !== p.label)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  return next;
}
