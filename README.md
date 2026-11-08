# Roadwise — Ghana (Phase 1)

A driving map for Ghana. It shows live traffic and plans routes with traffic-aware arrival times. While you drive, it shows your speed against the road's limit and warns you about speed cameras, speed bumps, road signs and potholes ahead.

Phase 1 of the [project plan](https://claude.ai/artifact/EePbMjCNJwZFDqGRj2wCzC). It runs in the browser with no backend.

## Run it

```bash
npm install
cp .env.example .env   # then paste your Mapbox public token (pk.…)
npm run fetch-data     # one-off: downloads Greater Accra road data (5–20 min, resumable)
npm run dev            # open http://localhost:5173 (dev mode, slower)
npm run fast           # optimised build at http://localhost:4173 — smoother for test drives
```

Other cities: `node scripts/fetch-osm.mjs kumasi` or `node scripts/fetch-osm.mjs takoradi`.

## Host it on Vercel (needed to drive with real GPS on a phone)

Phones only share GPS with sites on **https**, so test real drives from the Vercel link, not `http://<your-PC>:5173`.

1. Go to [vercel.com](https://vercel.com), sign up with GitHub, then **Add New → Project** and import `jhunia/traf`.
2. Vercel detects **Vite**. Keep the defaults: build `npm run build`, output `dist`.
3. Under **Environment Variables**, add `VITE_MAPBOX_TOKEN` = your Mapbox `pk.` token, for all environments.
4. Click **Deploy**. You get a link like `https://traf-xxxx.vercel.app`. Every `git push` to `main` redeploys automatically.
5. In your Mapbox account, open the token's **URL restrictions** and add your Vercel domain, so nobody else can use the token.
6. Open the link on your phone and allow location when asked. On Android Chrome you can **Add to Home screen** for a full-screen app.

If you change `VITE_MAPBOX_TOKEN` later, redeploy (Deployments → ⋯ → Redeploy), because the token is baked in at build time.

## Using it

- **Plan a trip:** tap **Where to?**, then search, pick a recent place, or choose **Set location on map**. On desktop you can also right-click the map. You get up to 3 routes. The selected one is drawn black, turning amber or red where traffic is slow, and the extra time from traffic is shown in red.
- **Drive:** **Start** uses your GPS. **Test drive** fakes a drive along the route, and its slider sets the speed. In drive mode:
  - The map tilts and turns with your heading. If you pan away, it snaps back to the car after 8 seconds, and the screen stays on.
  - The green card shows the next turn ("320 m · Bear left onto Ring Road Central"), with a spoken prompt about 600 m before, 150 m before, and at the turn.
  - Leave the route and it reroutes from where you are. It re-checks traffic every 3 minutes and tells you if a faster route turns up. It announces when you arrive.
  - The trip sheet shows live traffic ahead ("Heavy traffic in 1.2 km"), time and distance left, and arrival time.
- **Speed:** the bubble at the bottom left shows your speed beside the road's limit sign. It turns amber just over the limit, and red with a beep and a voice warning when you're more than 5 km/h over.
- **Alerts:** cameras are announced 500 m ahead; speed bumps, potholes and signs 200 m ahead.
- **Report:** the black **+** button reports a pothole, speed bump or camera where you are. Reports stay on this device for now.
- **Layers** (top right): turn traffic, cameras, bumps, potholes and signs on or off.
- **Phone:** run `npm run dev -- --host` and open it on your phone. GPS only works over HTTPS, so for a real drive use a tunnel such as `npx localtunnel --port 5173`.

## Where the data comes from

| What | Source | Notes |
| --- | --- | --- |
| Map | OpenFreeMap "Positron" (OpenStreetMap) | Free, no key. Greyscale so routes and hazards stand out |
| Live traffic layer | Mapbox Traffic | Needs `VITE_MAPBOX_TOKEN`. Covers Accra |
| Routes, traffic delay, congestion | Mapbox Directions (`driving-traffic`) | Falls back to OSRM, with no traffic, if there's no token |
| Speed limits | Mapbox, along the route. Otherwise OpenStreetMap `maxspeed`, or an estimate by road type marked "est" | Estimates are in `src/lib/ghana.ts` and need checking against Ghana's road regulations |
| Cameras, bumps, signs | OpenStreetMap, downloaded to `public/data/`, with live Overpass queries outside downloaded areas | Ghana coverage is patchy. Driver reports fill the gaps |
| Search | OpenStreetMap Nominatim, Ghana only | About 1 request a second |

The Mapbox token is a public `pk.` token. It lives in `.env`, which git ignores. Before launch, restrict the token to your domain in the Mapbox account settings.

## Code map

- `src/App.tsx`: screens (home, search, routes, drive) and app state
- `src/components/`: map, place search, speed bubble, guidance banner, trip sheet, layers menu
- `src/hooks/`: GPS, test drive, speed-limit matching, road features, offline region data
- `src/lib/`: geometry, OpenStreetMap/Overpass, routing (Mapbox/OSRM), search, alerts, voice, icons
- `scripts/fetch-osm.mjs`: downloads a region's road data, resuming if interrupted
