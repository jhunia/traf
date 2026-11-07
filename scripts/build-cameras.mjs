// Turns scripts/cameras-gh.sources.json (camera reports from news and driver apps)
// into map geometry: public/data/cameras-gh.json
//
//   node scripts/build-cameras.mjs
//
// - junction: the exact point where two named roads meet (from our OpenStreetMap road data)
// - road:     the whole named road (optionally only the part near a place)
// - stretch:  a named road between two places
// - place:    a looked-up point (optionally snapped onto a named road)
// - zone:     a neighbourhood-level report, drawn as a circle (default 700 m)
import { readFile, writeFile } from 'node:fs/promises';

const src = JSON.parse(await readFile('scripts/cameras-gh.sources.json', 'utf8'));
const roadsFile = JSON.parse(await readFile('public/data/accra-roads.json', 'utf8'));
const roads = roadsFile.roads.map((r) => {
  const g = [];
  for (let i = 0; i < r.g.length; i += 2) g.push([r.g[i], r.g[i + 1]]);
  return { name: r.n ?? '', geometry: g };
});

// ---- geometry helpers ----
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function nearestOnLine(p, line) {
  let best = { d: Infinity, pt: line[0], i: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const kx = Math.cos(rad(a[1]));
    const ax = 0, ay = 0, bx = (b[0] - a[0]) * kx, by = b[1] - a[1], px = (p[0] - a[0]) * kx, py = p[1] - a[1];
    const l2 = bx * bx + by * by;
    const t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
    const pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = dist(p, pt);
    if (d < best.d) best = { d, pt, i };
  }
  return best;
}
const r5 = (n) => Math.round(n * 1e5) / 1e5;

/** The point on road A that comes closest to road B. */
function closestPoint(nameA, nameB) {
  let best = { d: Infinity, pt: null };
  for (const ra of roadsNamed([nameA])) for (const p of ra.geometry) for (const rb of roadsNamed([nameB])) {
    const m = nearestOnLine(p, rb.geometry);
    if (m.d < best.d) best = { d: m.d, pt: p };
  }
  if (!best.pt) throw new Error(`${nameA} or ${nameB} not in road data`);
  return best.pt;
}

/** Where two named roads meet. */
function junction(nameA, nameB) {
  const [a, b] = [roadsNamed([nameA]), roadsNamed([nameB])];
  let best = { d: Infinity, pt: null };
  for (const ra of a) for (const p of ra.geometry) for (const rb of b) {
    const m = nearestOnLine(p, rb.geometry);
    if (m.d < best.d) best = { d: m.d, pt: p };
  }
  if (!best.pt || best.d > 40) throw new Error(`${nameA} and ${nameB} don't meet (closest ${Math.round(best.d)} m)`);
  return best.pt;
}

/** Keeps only the runs of each line whose points pass the test. */
function clip(lines, keep) {
  const out = [];
  for (const l of lines) {
    let run = [];
    for (const p of l) {
      if (keep(p)) run.push(p);
      else {
        if (run.length > 1) out.push(run);
        run = [];
      }
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}
const roadsNamed = (names) => roads.filter((r) => names.some((n) => r.name.toLowerCase() === n.toLowerCase()));

// ---- OpenStreetMap search (Nominatim), politely spaced ----
let last = 0;
async function geocode(q, withShape = false) {
  const wait = Math.max(0, 1200 - (Date.now() - last));
  await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', q);
  url.searchParams.set('countrycodes', 'gh');
  url.searchParams.set('limit', '1');
  if (withShape) url.searchParams.set('polygon_geojson', '1');
  const res = await fetch(url, { headers: { 'User-Agent': 'roadwise-dev-camera-build (local development)' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const [hit] = await res.json();
  if (!hit) return null;
  return { lngLat: [Number(hit.lon), Number(hit.lat)], label: hit.display_name, geojson: hit.geojson };
}
async function geocodeAny(...qs) {
  for (const q of qs.filter(Boolean)) {
    const hit = await geocode(q);
    if (hit) return hit;
  }
  return null;
}

const out = [];
const problems = [];

for (const s of src.sites) {
  const base = {
    id: s.id, name: s.name, confidence: s.confidence, limit: s.limit ?? null, note: s.note ?? null,
    sources: [s.source, ...(s.also ?? [])],
  };
  try {
    if (s.type === 'junction') {
      out.push({ ...base, kind: 'point', lngLat: junction(s.roads[0], s.roads[1]).map(r5) });
    } else if (s.type === 'road' && s.roads) {
      let lines = roadsNamed(s.roads).map((r) => r.geometry);
      let centre = null;
      if (s.near) {
        const c = await geocode(s.near);
        if (!c) throw new Error(`can't find ${s.near}`);
        centre = c.lngLat;
      }
      if (s.nearJunction) centre = junction(s.nearJunction[0], s.nearJunction[1]);
      if (s.towards) centre = closestPoint(s.roads[0], s.towards); // "X Road towards Y Road"
      if (centre) {
        // Keep only the part of the road close to the reported place.
        const radius = s.nearRadius ?? 1000;
        lines = clip(lines, (p) => dist(p, centre) < radius);
      }
      if (!lines.length) throw new Error('road not found in road data');
      out.push({ ...base, kind: 'road', lines: lines.map((l) => l.map((p) => p.map(r5))) });
    } else if (s.type === 'road' && s.query) {
      const hit = await geocode(s.query, true);
      if (!hit) throw new Error('not found');
      const g = hit.geojson;
      const lines = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : null;
      if (lines) out.push({ ...base, kind: 'road', lines: lines.map((l) => l.map((p) => p.map(r5))) });
      else out.push({ ...base, kind: 'zone', lngLat: hit.lngLat.map(r5), radius: 600 });
    } else if (s.type === 'stretch') {
      const [a, b] = [await geocode(s.from), await geocode(s.to)];
      if (!a || !b) throw new Error(`can't find ${!a ? s.from : s.to}`);
      const span = dist(a.lngLat, b.lngLat);
      // Only the parts of the road lying between the two places.
      const lines = clip(roadsNamed([s.road]).map((r) => r.geometry), (p) => dist(p, a.lngLat) + dist(p, b.lngLat) < span * 1.08 + 200);
      if (!lines.length) throw new Error('no road pieces between the two places');
      out.push({ ...base, kind: 'road', lines: lines.map((l) => l.map((p) => p.map(r5))) });
    } else if (s.type === 'place') {
      const hit = await geocodeAny(s.query, s.fallback);
      if (!hit) throw new Error('not found');
      let pt = hit.lngLat;
      if (s.snapTo) {
        let best = { d: Infinity, pt };
        for (const r of roadsNamed([s.snapTo])) {
          const m = nearestOnLine(hit.lngLat, r.geometry);
          if (m.d < best.d) best = m;
        }
        if (best.d < 1500) pt = best.pt;
      }
      out.push({ ...base, kind: 'point', lngLat: pt.map(r5), located: hit.label });
    } else if (s.type === 'zone') {
      const hit = await geocodeAny(s.query, s.fallback);
      if (!hit) throw new Error('not found');
      out.push({ ...base, kind: 'zone', lngLat: hit.lngLat.map(r5), radius: s.radius ?? 700, located: hit.label });
    }
    const o = out.at(-1);
    console.log(`ok   ${s.id.padEnd(26)} ${o.kind}${o.located ? '  ← ' + o.located.split(',').slice(0, 3).join(',') : ''}`);
  } catch (e) {
    problems.push(`${s.id}: ${e.message}`);
    console.log(`MISS ${s.id.padEnd(26)} ${e.message}`);
  }
}

await writeFile(
  'public/data/cameras-gh.json',
  JSON.stringify({ builtAt: new Date().toISOString(), sources: src.sources, sites: out }, null, 1),
);
console.log(`\nSaved ${out.length} sites to public/data/cameras-gh.json (${problems.length} not placed)`);
