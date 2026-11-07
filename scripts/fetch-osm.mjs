// Downloads OpenStreetMap road data for a region into public/data/, so the app
// does not depend on slow public Overpass servers while driving.
//
//   node scripts/fetch-osm.mjs            (Greater Accra)
//   node scripts/fetch-osm.mjs kumasi
//
// Output: public/data/<region>-features.json  (cameras, bumps, signs, potholes)
//         public/data/<region>-roads.json     (roads with speed-limit info)
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CACHE = 'scripts/.cache';

const REGIONS = {
  // [south, west, north, east]
  accra: [5.45, -0.5, 5.9, 0.15],
  kumasi: [6.55, -1.75, 6.8, -1.5],
  takoradi: [4.85, -1.85, 5.0, -1.65],
};

const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const region = process.argv[2] ?? 'accra';
const bbox = REGIONS[region];
if (!bbox) {
  console.error(`Unknown region "${region}". Choose one of: ${Object.keys(REGIONS).join(', ')}`);
  process.exit(1);
}
const B = `(${bbox.join(',')})`;

let preferred = 0; // stick with the server that last worked

async function overpass(query, label) {
  for (let k = 0; k < ENDPOINTS.length; k++) {
    const idx = (preferred + k) % ENDPOINTS.length;
    const url = ENDPOINTS[idx];
    const t = Date.now();
    try {
      process.stdout.write(`  ${label}: ${new URL(url).host} … `);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'roadwise-dev-data-fetch' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log(`ok, ${json.elements.length} elements in ${((Date.now() - t) / 1000).toFixed(0)}s`);
      preferred = idx;
      return json;
    } catch (e) {
      console.log(`failed (${e.message ?? e})`);
    }
  }
  throw new Error(`All Overpass servers failed for ${label}`);
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;

console.log(`Region: ${region} ${B}`);
await mkdir('public/data', { recursive: true });
await mkdir(CACHE, { recursive: true });

const features = await overpass(
  `[out:json][timeout:180];
(
  node["highway"="speed_camera"]${B};
  node["man_made"="surveillance"]["surveillance"="traffic"]${B};
  node["traffic_calming"]${B};
  way["traffic_calming"]${B};
  node["highway"~"^(stop|give_way|traffic_signals|mini_roundabout)$"]${B};
  node["traffic_sign"]${B};
  node["hazard"]${B};
);
out center tags;`,
  'features',
);
const featureOut = features.elements
  .map((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    return lat == null ? null : { type: el.type, id: el.id, lon: r5(lon), lat: r5(lat), tags: el.tags ?? {} };
  })
  .filter(Boolean);
await writeFile(`public/data/${region}-features.json`, JSON.stringify({ region, bbox, fetchedAt: new Date().toISOString(), elements: featureOut }));

// Main roads everywhere, plus any smaller road that has a speed limit tagged.
// Fetched in a grid of tiles: one query for the whole region is too big for public servers.
const GRID = 3;
const [s0, w0, n0, e0] = bbox;
const byId = new Map();
for (let i = 0; i < GRID; i++) {
  for (let j = 0; j < GRID; j++) {
    const s = s0 + ((n0 - s0) * i) / GRID, n = s0 + ((n0 - s0) * (i + 1)) / GRID;
    const w = w0 + ((e0 - w0) * j) / GRID, e = w0 + ((e0 - w0) * (j + 1)) / GRID;
    const T = `(${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)})`;
    // Each tile is cached, so a re-run after a failure resumes where it stopped.
    const cacheFile = `${CACHE}/${region}-roads-${i}-${j}.json`;
    const cached = await readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => null);
    if (cached) {
      console.log(`  roads tile ${i * GRID + j + 1}/${GRID * GRID}: cached`);
      for (const el of cached.elements) byId.set(el.id, el);
      continue;
    }
    const part = await overpass(
      `[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]${T};
  way["highway"~"^(residential|living_street|service|road)$"]["maxspeed"]${T};
);
out tags geom;`,
      `roads tile ${i * GRID + j + 1}/${GRID * GRID}`,
    );
    await writeFile(cacheFile, JSON.stringify(part));
    for (const el of part.elements) byId.set(el.id, el);
  }
}
const roadOut = [...byId.values()]
  .filter((el) => el.geometry?.length > 1)
  .map((el) => ({
    id: el.id,
    h: el.tags?.highway,
    m: el.tags?.maxspeed,
    n: el.tags?.name ?? el.tags?.ref,
    g: el.geometry.flatMap((p) => [r5(p.lon), r5(p.lat)]),
  }));
await writeFile(`public/data/${region}-roads.json`, JSON.stringify({ region, bbox, fetchedAt: new Date().toISOString(), roads: roadOut }));

const tagged = roadOut.filter((r) => r.m).length;
const count = (pred) => featureOut.filter((f) => pred(f.tags)).length;
console.log(`\nSaved public/data/${region}-*.json`);
console.log(`  roads: ${roadOut.length} (${tagged} with a speed limit tagged)`);
console.log(`  cameras: ${count((t) => t.highway === 'speed_camera' || t.man_made === 'surveillance')}`);
console.log(`  speed bumps: ${count((t) => t.traffic_calming)}`);
console.log(`  traffic lights: ${count((t) => t.highway === 'traffic_signals')}`);
console.log(`  stop / give way: ${count((t) => t.highway === 'stop' || t.highway === 'give_way')}`);
console.log(`  other signs / hazards: ${count((t) => t.traffic_sign || t.hazard)}`);
