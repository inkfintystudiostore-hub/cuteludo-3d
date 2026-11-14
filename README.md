# Chibi Ludo 3D

Pastel 3D animal Ludo built with React Three Fiber, Three.js, Zustand, and live multiplayer rooms powered by **Cloudflare Workers + SQLite Durable Objects (WebSocket Hibernation API)**.

## Features

- **4 Cute 3D Animal Squads**: Kittens (`PINK`), Puppies (`CYAN`), Bunnies (`GREEN`), and Bear Cubs (`YELLOW`) with turn animations and 5-second home celebrations.
- **Game Modes**: `2P Couples`, `4P Friends`, and `2v2 Teams` across Solo vs Smart AI, Pass & Play, Live Friend Rooms, and Bot Sim.
- **9-Digit Friend Rooms (`XXX-XXX-XXX`)**: Server-authoritative turns, WebSocket Hibernation (`LudoRoomDO`), shareable `?room=` invite URLs, vacant-seat AI fill, reconnect seat recovery, and live emotes.

---

## Local Development

Run both the Vite frontend (`5173`) and the local Wrangler Durable Object server (`8787`):

```bash
npm install
npm run build
npm run worker:dev   # Terminal 1 — Cloudflare Worker + LudoRoomDO on :8787
npm run dev          # Terminal 2 — Vite frontend on :5173 (proxies /ws and /api)
```

Verify unit tests and strict TypeScript + Worker builds:

```bash
npm test
npm run build
```

---

## Auto-Deploy Setup (GitHub -> Cloudflare Workers)

Every push to `main` runs `npm test` + `npm run build` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) and deploys cleanly to Cloudflare Workers. You can enable the live deploy step in **either** of two ways:

### Option A — Cloudflare Workers Builds (Recommended, zero secrets)
1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Workers & Pages** -> **Create** -> **Continue with GitHub**.
2. Select your GitHub repository (`chibi-ludo-3d` or your chosen name).
3. Configure:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
4. Click **Save and Deploy**. Every `git push` to `main` automatically builds and publishes live.

### Option B — GitHub Actions (`cloudflare/wrangler-action@v4`)
1. In GitHub repo **Settings -> Secrets and variables -> Actions**, add:
   - `CLOUDFLARE_API_TOKEN`: API token using Cloudflare's **Edit Cloudflare Workers** template.
   - `CLOUDFLARE_ACCOUNT_ID`: optional (defaults to `4bbab9d072b7d3ca099ba18858f7abe3`).
2. Push to `main` — GitHub Actions runs tests, builds `./dist` + `worker/index.ts`, and runs `wrangler deploy`.

---

## Integrating into Inkfinity Studio (`infinitystudio.store`)

Because this game runs real-time stateful **WebSockets + Durable Objects**, the cleanest way to include it on `infinitystudio.store` (at `$0/mo` with zero bloat to your main storefront bundle) is:

### 1. Attach a Subdomain in Cloudflare (Recommended)
1. In Cloudflare Dashboard -> Worker `chibi-ludo-3d` -> **Settings -> Domains & Routes -> Add -> Custom Domain**: add `ludo.infinitystudio.store` (or `ludo.inkfintystudio.store`).
2. Link to it directly from your Inkfinity Studio navigation bar, **or** embed it inside an `/ludo` page on your site:

```html
<iframe
  src="https://ludo.infinitystudio.store/"
  title="Inkfinity Studio — Chibi Ludo 3D"
  style="width: 100%; height: 100dvh; border: 0; border-radius: 16px;"
  allow="clipboard-write"
></iframe>
```

### 2. Optional Invite-Link Forwarding Inside Inkfinity Studio
If you embed Ludo inside `https://infinitystudio.store/ludo` and want copied friend invite links to point to `https://infinitystudio.store/ludo?room=XXXXXXXXX`:
1. Set `VITE_PUBLIC_APP_URL=https://infinitystudio.store/ludo` during build (in `.env` or CI variables).
2. On your `/ludo` wrapper page, forward `?room=` from `window.location.search` into the iframe `src`:

```js
const params = new URLSearchParams(window.location.search);
const room = params.get('room');
iframe.src = room
  ? `https://ludo.infinitystudio.store/?room=${encodeURIComponent(room)}`
  : 'https://ludo.infinitystudio.store/';
```
