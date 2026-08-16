# Auth + API Proxy Worker

Two jobs, both server-side:
1. Validates PINs and issues signed session cookies (the login gate)
2. Proxies every call to the Bexar County Scanner API — the real API key
   lives only here, never in the site's JavaScript. The browser only ever
   talks to this Worker, authorized by its session cookie.

Deployed separately from the site — `git push` to the main repo does
**not** deploy this.

## Setup

```bash
npm install -g wrangler
cd worker
wrangler login
```

Create the KV namespace used to track who's signed in (needed for the
admin panel):

```bash
wrangler kv namespace create SESSIONS
```

This prints an `id` — paste it into `wrangler.toml` under
`[[kv_namespaces]]`, replacing `PASTE_KV_NAMESPACE_ID_HERE`.

Edit `wrangler.toml`: set `ALLOWED_ORIGIN` to your real site URL, and
`ADMIN_NAMES` to a comma-separated list of exactly whose name(s) (as they
appear in `pins.json`) should be allowed to view the admin panel.

The admin panel (`admin.html`) has two sections: who's currently signed
in (disappears when their session expires) and a longer-retained login
history log. `LOG_RETENTION_DAYS` in `wrangler.toml` controls how long
history entries stick around before auto-expiring (default 90 days).

## Set secrets (never committed to the repo)

```bash
wrangler secret put SESSION_SECRET
# paste any long random string when prompted, e.g. output of:
# openssl rand -hex 32

wrangler secret put PINS_JSON
# paste a JSON object mapping each person's PIN to their name, e.g.:
# {"4471":"Ryan","9302":"Dana","1188":"Guest"}

wrangler secret put SCANNER_API_KEY
# paste your real Bexar County Scanner API key — this never appears
# anywhere in the site's code from this point on
```

Whenever you want to add/remove a person or change a PIN, just re-run
`wrangler secret put PINS_JSON` with the updated JSON — no code changes.

## Deploy

```bash
wrangler deploy
```

This prints the Worker's URL, something like:
```
https://p25-scanner-auth.<your-cloudflare-subdomain>.workers.dev
```

Put that URL into `AUTH_BASE` near the top of `index.html`'s `<script>`
block back in the repo root. `API_BASE` is derived from it automatically —
no separate API key needed in the site's code anymore.

## Updating

Any time you edit `worker.js`, redeploy with `wrangler deploy`. The site
itself doesn't need to change unless the Worker's URL changes.
