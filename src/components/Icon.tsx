// Small inline icon set (stroke icons, 24px grid).
const PATHS: Record<string, JSX.Element> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  back: <path d="M15 18 9 12l6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  pin: <><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  locate: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /><circle cx="12" cy="12" r="8" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  sound: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  mute: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="m16 9 5 6m0-6-5 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  car: <><path d="M5 16h14v-4l-2-5H7l-2 5v4Z" /><path d="M5 12h14" /><circle cx="8" cy="16.5" r="1.5" /><circle cx="16" cy="16.5" r="1.5" /></>,
  arrowUp: <path d="M12 20V5m0 0-6 6m6-6 6 6" />,
  nav: <path d="M12 2 4.5 20.5 12 17l7.5 3.5L12 2Z" />,
  swap: <path d="M7 4v13m0 0-3-3m3 3 3-3M17 20V7m0 0-3 3m3-3 3 3" />,
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
