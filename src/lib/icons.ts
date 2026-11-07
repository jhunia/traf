// Map icons drawn on a canvas at runtime, so there are no image files to manage.
import type { Map as MLMap } from 'maplibre-gl';

const S = 64;
type Ctx = CanvasRenderingContext2D;

function disc(ctx: Ctx, fill: string) {
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 26, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

function label(ctx: Ctx, t: string, size: number, color = '#fff') {
  ctx.font = `bold ${size}px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(t, S / 2, S / 2 + 2);
}

function polygon(ctx: Ctx, pts: [number, number][], fill: string, stroke: string, width: number) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

const DRAW: Record<string, (ctx: Ctx) => void> = {
  'rw-camera': (ctx) => {
    disc(ctx, '#d93025');
    ctx.fillStyle = '#fff';
    ctx.fillRect(17, 25, 30, 20);
    ctx.fillRect(25, 20, 12, 6);
    ctx.beginPath();
    ctx.arc(32, 35, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#d93025';
    ctx.fill();
  },
  'rw-bump': (ctx) => {
    disc(ctx, '#f29900');
    ctx.beginPath();
    ctx.moveTo(13, 42);
    ctx.quadraticCurveTo(32, 12, 51, 42);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  'rw-pothole': (ctx) => {
    disc(ctx, '#795548');
    ctx.beginPath();
    ctx.ellipse(32, 34, 17, 10, -0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1d1d1d';
    ctx.fill();
  },
  'rw-stop': (ctx) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      pts.push([S / 2 + 28 * Math.cos(a), S / 2 + 28 * Math.sin(a)]);
    }
    polygon(ctx, pts, '#c62828', '#fff', 3);
    label(ctx, 'STOP', 15);
  },
  'rw-give-way': (ctx) => {
    polygon(ctx, [[6, 10], [58, 10], [32, 56]], '#ffffff', '#c62828', 7);
  },
  'rw-signals': (ctx) => {
    ctx.fillStyle = '#263238';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(20, 4, 24, 56, 8);
    ctx.fill();
    ctx.stroke();
    ['#e53935', '#fbc02d', '#43a047'].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(32, 17 + i * 15, 6, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });
  },
  'rw-roundabout': (ctx) => {
    disc(ctx, '#1565c0');
    label(ctx, '↻', 34);
  },
  'rw-sign': (ctx) => {
    polygon(ctx, [[32, 4], [60, 32], [32, 60], [4, 32]], '#fdd835', '#222', 3);
    label(ctx, '!', 28, '#222');
  },
  // Trip pins: round = start, square = destination.
  'rw-origin': (ctx) => {
    ctx.beginPath();
    ctx.arc(32, 32, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(32, 32, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  'rw-dest': (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(14, 14, 36, 36);
    ctx.fillStyle = '#fff';
    ctx.fillRect(26, 26, 12, 12);
  },
  // Your position: a dot when stationary, an arrow when moving (points up = heading).
  'rw-puck': (ctx) => {
    ctx.beginPath();
    ctx.arc(32, 32, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#1a73e8';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  },
  'rw-puck-heading': (ctx) => {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    polygon(ctx, [[32, 6], [54, 56], [32, 44], [10, 56]], '#1a73e8', '#fff', 4);
  },
};

function render(name: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  (DRAW[name] ?? DRAW['rw-sign'])(ctx);
  return canvas;
}

export function addIcons(map: MLMap) {
  for (const name of Object.keys(DRAW)) {
    if (map.hasImage(name)) continue;
    map.addImage(name, render(name).getContext('2d')!.getImageData(0, 0, S, S), { pixelRatio: 2 });
  }
}

const urlCache = new Map<string, string>();

/** The same icon as on the map, as an image URL for the UI. */
export function iconUrl(name: string): string {
  let url = urlCache.get(name);
  if (!url) {
    url = render(name).toDataURL();
    urlCache.set(name, url);
  }
  return url;
}
