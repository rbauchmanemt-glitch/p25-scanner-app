# P25 Scanner

Web-based scanner client for the SDR/P25 decode API — works on desktop and
mobile from a single codebase (no separate app builds).

## How it works

Units are push-buttons: tap one ON and it opens a live WebSocket connection
that plays every new call for that unit as it arrives, until you tap it
OFF. Tap a unit's name (not the toggle) to just hear its most recent call
once, without turning on continuous monitoring.

## Backend

Wired to the Bexar County Scanner API (`api.bexarcountyscanner.com`) — see
`DASHBOARD-INTEGRATION-HANDOFF.md` for the full API reference. Config lives
at the top of the `<script>` block in `index.html`:

```js
const API_BASE = 'https://api.bexarcountyscanner.com';
const API_KEY  = 'PASTE_KEY_HERE'; // ask Ryan for this
```

**Known limitations of this API:**
- No bulk history endpoint — only the single most-recent call per unit
  (used for preview) and live push. The "Recent" tab only shows what's
  accumulated client-side during the current session, not a real log.
- The API key ships in plain client-side JS. On a public GitHub Pages
  site that means anyone can view-source and grab it — that's how the
  API's own docs set it up (open CORS, no proxy). Worth checking with
  Ryan whether that's an acceptable risk or whether a proxy is needed
  down the line.
- "Live" has a few seconds of delay — a call has to finish transmitting
  and get processed before it's available, not true mid-transmission audio.

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

- Add your API key to `index.html`
- Persist monitored-unit selection (currently resets on page reload)
- Consider a small proxy if the exposed client-side API key is a concern

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
