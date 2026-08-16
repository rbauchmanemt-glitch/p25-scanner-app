/**
 * Auth + API proxy Worker.
 *
 * Auth routes:
 *   POST /auth/login   { pin: "1234" }  -> sets session cookie, returns { ok, name }
 *   GET  /auth/verify                    -> checks cookie, returns { ok, name }
 *   POST /auth/logout                    -> clears cookie
 *
 * Admin routes (require being logged in AND your name being in ADMIN_NAMES):
 *   GET /admin/sessions -> who's currently signed in
 *   GET /admin/log      -> login history (longer retention than sessions)
 *
 * Proxy routes (all require a valid session cookie — i.e. the browser
 * must be logged in via /auth/login first). These forward to the Bexar
 * County Scanner API with the real API key attached server-side, so the
 * key never ships to the browser at all:
 *   GET /api/units/:unit/live   -> proxies GET {SCANNER_API_BASE}/api/units/:unit/live
 *   GET /api/audio/:callId      -> proxies GET {SCANNER_API_BASE}/api/audio/:callId
 *   WS  /ws?unit=<unit>         -> proxies wss://{SCANNER_API_BASE host}/ws?apiKey=...&unit=...
 *
 * Required secrets (set via `wrangler secret put <name>`, never in the repo):
 *   PINS_JSON      JSON map of pin -> display name, e.g. {"4471":"Ryan","9302":"Dana"}
 *   SESSION_SECRET random string used to sign session tokens
 *   SCANNER_API_KEY the real Bexar County Scanner API key
 *
 * Required vars (in wrangler.toml, not secret):
 *   ALLOWED_ORIGIN   e.g. "https://scanner.yourdomain.com"
 *   SESSION_HOURS    how long a login lasts, e.g. "168" (7 days)
 *   SCANNER_API_BASE e.g. "https://api.bexarcountyscanner.com"
 *   ADMIN_NAMES      comma-separated names allowed to view /admin/sessions,
 *                    e.g. "Ryan Bauchman,Aaron Sanchez"
 *
 * Required KV binding (in wrangler.toml):
 *   SESSIONS  -> tracks who's currently signed in, for the admin panel
 */

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
  if (origin === allowedOrigin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

async function hmac(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeToken(name, secret, hours) {
  const payload = JSON.stringify({ name, exp: Date.now() + hours * 3600 * 1000 });
  const b64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = await hmac(secret, b64);
  return `${b64}.${sig}`;
}

async function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expected = await hmac(secret, b64);
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Date.now()) return null;
    return payload.name;
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function requireSession(request, env) {
  const token = getCookie(request, 'session');
  return verifyToken(token, env.SESSION_SECRET);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const hours = parseInt(env.SESSION_HOURS || '168', 10);

    if (url.pathname === '/auth/login' && request.method === 'POST') {
      const { pin } = await request.json().catch(() => ({}));
      const pins = JSON.parse(env.PINS_JSON || '{}');
      const name = pins[pin];

      if (!name) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid pin' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }

      const token = await makeToken(name, env.SESSION_SECRET, hours);
      const cookie = `session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${hours * 3600}`;

      // Record this login for the admin "who's signed in" panel. Stored
      // as KV metadata (not the value) so the admin panel can list
      // everyone with a single call instead of one lookup per person.
      // expirationTtl matches the session length, so entries clean
      // themselves up automatically as sessions expire — no separate
      // logout bookkeeping needed for that part.
      if (env.SESSIONS) {
        const now = Date.now();
        await env.SESSIONS.put(`session:${name}`, '', {
          expirationTtl: hours * 3600,
          metadata: { name, loginTime: now, expiresAt: now + hours * 3600 * 1000 },
        });

        // Separate, longer-retained log entry — the "currently signed in"
        // record above disappears when a session expires, so this is
        // what preserves history. Timestamp-prefixed key keeps entries in
        // chronological order when listed.
        const logDays = parseInt(env.LOG_RETENTION_DAYS || '90', 10);
        await env.SESSIONS.put(`log:${new Date(now).toISOString()}:${name}`, '', {
          expirationTtl: logDays * 86400,
          metadata: { name, loginTime: now },
        });
      }

      return new Response(JSON.stringify({ ok: true, name }), {
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, ...cors },
      });
    }

    if (url.pathname === '/auth/verify' && request.method === 'GET') {
      const token = getCookie(request, 'session');
      const name = await verifyToken(token, env.SESSION_SECRET);
      return new Response(JSON.stringify({ ok: !!name, name: name || null }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      const token = getCookie(request, 'session');
      const name = await verifyToken(token, env.SESSION_SECRET);
      if (name && env.SESSIONS) {
        await env.SESSIONS.delete(`session:${name}`);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0',
          ...cors,
        },
      });
    }

    // ---- Admin: who's currently signed in ----
    if (url.pathname === '/admin/sessions' && request.method === 'GET') {
      const name = await requireSession(request, env);
      if (!name) {
        return new Response(JSON.stringify({ error: 'not_authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      const adminNames = (env.ADMIN_NAMES || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!adminNames.includes(name)) {
        return new Response(JSON.stringify({ error: 'not_authorized' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      if (!env.SESSIONS) {
        return new Response(JSON.stringify({ ok: true, sessions: [] }), {
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      const list = await env.SESSIONS.list({ prefix: 'session:' });
      const sessions = list.keys
        .map(k => k.metadata)
        .filter(Boolean)
        .sort((a, b) => b.loginTime - a.loginTime);
      return new Response(JSON.stringify({ ok: true, sessions }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // ---- Admin: login history log ----
    if (url.pathname === '/admin/log' && request.method === 'GET') {
      const name = await requireSession(request, env);
      if (!name) {
        return new Response(JSON.stringify({ error: 'not_authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      const adminNames = (env.ADMIN_NAMES || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!adminNames.includes(name)) {
        return new Response(JSON.stringify({ error: 'not_authorized' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      if (!env.SESSIONS) {
        return new Response(JSON.stringify({ ok: true, log: [] }), {
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      const list = await env.SESSIONS.list({ prefix: 'log:' });
      const log = list.keys
        .map(k => k.metadata)
        .filter(Boolean)
        .sort((a, b) => b.loginTime - a.loginTime)
        .slice(0, 200); // cap the response size — this can grow large over time
      return new Response(JSON.stringify({ ok: true, log }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // ---- Proxy: most-recent call for a unit ----
    // /api/units/<unit>/live
    const liveMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/live$/);
    if (liveMatch && request.method === 'GET') {
      const name = await requireSession(request, env);
      if (!name) {
        return new Response(JSON.stringify({ error: 'not_authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      const unit = liveMatch[1]; // already URL-encoded by the client
      const upstream = await fetch(`${env.SCANNER_API_BASE}/api/units/${unit}/live`, {
        headers: { 'X-API-Key': env.SCANNER_API_KEY },
      });
      const data = await upstream.json().catch(() => null);

      // The upstream API returns a full external audio_url — rewrite it to
      // point back through this Worker's own /api/audio proxy instead, so
      // the browser never needs (or sees) the real API key.
      if (data && data.status === 'found' && data.call_id) {
        data.audio_url = `${url.origin}/api/audio/${data.call_id}`;
      }

      return new Response(JSON.stringify(data), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // ---- Proxy: audio file ----
    // /api/audio/<callId>
    const audioMatch = url.pathname.match(/^\/api\/audio\/([^/]+)$/);
    if (audioMatch && request.method === 'GET') {
      const name = await requireSession(request, env);
      if (!name) {
        return new Response('not authenticated', { status: 401, headers: cors });
      }
      const callId = audioMatch[1];
      const upstream = await fetch(`${env.SCANNER_API_BASE}/api/audio/${callId}`, {
        headers: { 'X-API-Key': env.SCANNER_API_KEY },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'audio/mpeg',
          ...cors,
        },
      });
    }

    // ---- Live push WebSocket: hand back a short-lived direct URL ----
    // Cloudflare Workers can't relay a WebSocket to another
    // Cloudflare-proxied hostname (which the Tunnel-backed scanner API
    // is) — that hop gets dropped by Cloudflare's own network. So instead
    // of proxying the socket itself, we authenticate the request here and
    // hand back the real wss:// URL (with the key attached) for the
    // browser to connect to directly. The key is never in the page's
    // static source — it only exists transiently, fetched after login.
    // /ws-auth?unit=<unit>
    if (url.pathname === '/ws-auth' && request.method === 'GET') {
      const name = await requireSession(request, env);
      if (!name) {
        return new Response(JSON.stringify({ error: 'not_authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...cors },
        });
      }
      const unit = url.searchParams.get('unit') || '';
      const scannerHost = env.SCANNER_API_BASE.replace(/^https?:\/\//, '');
      const wsUrl = `wss://${scannerHost}/ws?apiKey=${encodeURIComponent(env.SCANNER_API_KEY)}&unit=${encodeURIComponent(unit)}`;
      return new Response(JSON.stringify({ ok: true, wsUrl }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
