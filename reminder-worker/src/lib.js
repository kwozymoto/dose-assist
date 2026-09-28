/* Pure parts of the reminder worker: request validation and VAPID signing.
   Tested in tests/worker.test.mjs. Runs on Cloudflare Workers and in Node
   (both have WebCrypto). */

/* Only real browser push services, so the worker cannot be used to send
   requests anywhere else. */
export const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
];

export const MAX_ITEMS = 50;
export const MAX_BODY_CHARS = 5600; // 4096 bytes of ciphertext, base64url
const DAY = 86400000;

/** @param {string} endpoint */
export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

/**
 * Check a schedule. Returns the cleaned items, or an error string.
 * @param {unknown} items @param {number} now
 * @returns {{items: {id: string, fireAt: number, body: string}[]} | {error: string}}
 */
export function validItems(items, now) {
  if (!Array.isArray(items)) return { error: 'items must be an array' };
  if (items.length > MAX_ITEMS) return { error: `at most ${MAX_ITEMS} items` };
  const out = [];
  const seen = new Set();
  for (const it of items) {
    if (!it || typeof it !== 'object') return { error: 'bad item' };
    const { id, fireAt, body } = /** @type {any} */ (it);
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return { error: 'bad id' };
    if (seen.has(id)) return { error: 'duplicate id' };
    seen.add(id);
    if (typeof fireAt !== 'number' || !Number.isFinite(fireAt) || fireAt < now - DAY || fireAt > now + 60 * DAY) return { error: 'bad fireAt' };
    if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY_CHARS || !/^[A-Za-z0-9_-]+$/.test(body)) return { error: 'bad body' };
    out.push({ id, fireAt, body });
  }
  return { items: out };
}

/** @param {Uint8Array} bytes */
export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s */
export function unb64url(s) {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** SHA-256 hex, for keying a device by its endpoint without storing it as the key. @param {string} s */
export async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The Authorization header for a push request (RFC 8292, VAPID).
 * @param {string} endpoint
 * @param {JsonWebKey} privateJwk  P-256 ECDSA key with d, x, y
 * @param {string} subject  mailto: or https: contact for the push service
 * @param {number} now  ms
 */
export async function vapidAuth(endpoint, privateJwk, subject, now) {
  const aud = new URL(endpoint).origin;
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...privateJwk, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto gives r||s (IEEE P1363), which is exactly what JWS ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  const pub = new Uint8Array([4, ...unb64url(/** @type {string} */ (privateJwk.x)), ...unb64url(/** @type {string} */ (privateJwk.y))]);
  return `vapid t=${jwt}, k=${b64url(pub)}`;
}

/**
 * What to do with each item when the alarm fires.
 * @param {{id: string, fireAt: number, body: string, attempts?: number}[]} items
 * @param {number} now
 */
export function dueItems(items, now) {
  const due = [];
  const later = [];
  const expired = [];
  for (const it of items) {
    if (it.fireAt > now + 1000) later.push(it);
    else if (now - it.fireAt > 60 * 60 * 1000) expired.push(it); // an hour late is too late to be useful
    else due.push(it);
  }
  return { due, later, expired };
}
