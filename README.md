# P25 Scanner

Web-based scanner client for the SDR/P25 decode API — works on desktop and
mobile from a single codebase (no separate app builds).

## How it works

Channels are push-buttons: tap one ON and it opens a live WebSocket
connection that plays every new call for that channel as it arrives, until
you tap it OFF. Tap a channel's name (not the toggle) to just hear its
most recent call once, without turning on continuous monitoring.

## Backend

Wired to the Bexar County Scanner API (`api.bexarcountyscanner.com`), but
the site never talks to it directly — everything goes through the auth
Worker (`worker/worker.js`), which holds the real API key server-side and
proxies requests only for browsers with a valid login session. `index.html`
has no API key in it at all:

```js
const AUTH_BASE = 'https://auth.bexarcountyscanner.com';
const API_BASE = AUTH_BASE; // same Worker handles auth + API proxy
```

**Known limitations of this API:**
- No bulk history endpoint — only the single most-recent call per channel
  (used for preview) and live push. The main feed only shows what's
  accumulated client-side during the current session, not a real log.
- "Live" has a few seconds of delay — a call has to finish transmitting
  and get processed before it's available, not true mid-transmission audio.
- The Worker can't relay the live-push WebSocket itself (Cloudflare Workers
  can't proxy a WebSocket to another Cloudflare-proxied host), so instead
  it hands the browser a short-lived, authenticated URL to connect to
  directly for that one connection — see the comments in `worker.js` for
  details.

## Running locally

No build step — it's a single static HTML file.

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

## Access control

The site is PIN-gated: on load, an overlay asks for a PIN before showing
the dashboard. Each person can have their own PIN (see `worker/README.md`).
This is validated **server-side** by a small Cloudflare Worker — the PINs
never appear in the site's code, unlike a plain client-side check.

`admin.html` shows who's currently signed in — visible only to whoever's
name is listed in the Worker's `ADMIN_NAMES` setting. It doesn't support
forcing someone's session to end early (sessions are stateless signed
cookies, not individually revocable); it's read-only visibility.

## Deploy — two separate targets

- **The site** (`index.html`) → `git push` to this repo. GitHub Pages
  serves `main` directly, so pushing to `main` is what puts the dashboard
  in front of users.
- **The auth Worker** (`worker/worker.js`) → deployed separately to
  Cloudflare via `wrangler deploy`, run from inside the `worker/` folder.
  **A `git push` does not deploy the Worker.** See `worker/README.md` for
  setup, including how to add/remove people's PINs.

After deploying the Worker, put its URL into `AUTH_BASE` near the top of
`index.html`'s `<script>` block.

## Next steps

- Add overlapping audio playback if simultaneous calls across channels
  become a real annoyance in practice
- Consider push notifications as a lighter-weight alternative to true
  background audio (not achievable in a web app — see chat history for
  why)

## PWA / installability

The site is installable to a phone or desktop home screen (manifest +
service worker), same pattern as Aaron's dashboard. It uses a
network-first strategy: every load tries to fetch the freshest copy of
the app shell, and only falls back to a cached copy if you're actually
offline. Live data (API calls, audio, WebSocket) is never cached and
always goes straight to the network regardless.

This means a normal reload picks up any new deploy automatically — no
need to bump `CACHE_VERSION` or manually clear site data for routine
updates. That version number still exists mainly to force stale caches
to get cleaned out; bump it only if something seems stuck despite a
normal reload.
