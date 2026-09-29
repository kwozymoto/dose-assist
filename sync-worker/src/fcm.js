/* Firebase Cloud Messaging for the sync server: a nudge to the other linked
   phones when one sends changes. The nudge carries only a type ("sync") and,
   optionally, a batch the phone sealed with the family key (the new reminder
   times). This server cannot read it.

   Auth is a Google service account (secret FCM_SERVICE_ACCOUNT, the JSON key
   file): a signed JWT is swapped for an access token, cached for its hour. */

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** @param {Uint8Array | ArrayBuffer} bytes */
export function b64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The DER bytes of a PEM private key. @param {string} pem */
export function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A signed JWT asking Google for an FCM access token.
 * @param {{client_email: string, private_key: string}} sa @param {number} nowSec
 */
export async function signedJwt(sa, nowSec) {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** The FCM v1 message for one phone. @param {string} token @param {string} nudge */
export function nudgeMessage(token, nudge) {
  return {
    message: {
      token,
      data: nudge ? { t: 'sync', n: nudge } : { t: 'sync' },
      android: { priority: 'HIGH', ttl: '3600s' },
    },
  };
}

/** Largest sealed nudge that fits in an FCM data message (4 KB) with room to spare. */
export const MAX_NUDGE_CHARS = 3400;

let cached = { token: '', until: 0 };

/**
 * @param {string} serviceAccountJson
 * @param {typeof fetch} [f]
 * @returns {Promise<{token: string, projectId: string}>}
 */
export async function accessToken(serviceAccountJson, f = fetch) {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.until > now + 60) return { token: cached.token, projectId: sa.project_id };
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${await signedJwt(sa, now)}`,
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const body = await res.json();
  cached = { token: body.access_token, until: now + Number(body.expires_in ?? 3600) };
  return { token: cached.token, projectId: sa.project_id };
}

/**
 * Nudge one phone. Returns 'gone' when FCM says the token is dead.
 * @param {string} serviceAccountJson @param {string} fcmToken @param {string} nudge @param {typeof fetch} [f]
 * @returns {Promise<'sent' | 'gone' | 'failed'>}
 */
export async function sendNudge(serviceAccountJson, fcmToken, nudge, f = fetch) {
  const { token, projectId } = await accessToken(serviceAccountJson, f);
  const res = await f(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(nudgeMessage(fcmToken, nudge)),
  });
  if (res.ok) return 'sent';
  return res.status === 404 || res.status === 400 ? 'gone' : 'failed';
}
