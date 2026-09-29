// @ts-check
/* Encryption for sync between linked phones.

   A family is a random 128-bit id and a random 256-bit key, made on the
   first phone and passed to the second by QR code. The key never leaves
   the phones. Everything sent is sealed with AES-256-GCM under it. The
   server gets an access token derived from the key (HMAC), which lets it
   check that a request comes from a linked phone and tells it nothing
   about the key or the data. */

import { b64url, unb64url } from './webpush.js';

const PREFIX = 'whendose:link:1:';
const enc = new TextEncoder();
const dec = new TextDecoder();

/** @returns {Promise<{fid: string, key: string}>} */
export async function newFamily() {
  return { fid: b64url(crypto.getRandomValues(new Uint8Array(16))), key: b64url(crypto.getRandomValues(new Uint8Array(32))) };
}

/** What the QR code says. @param {{fid: string, key: string}} f */
export const linkText = (f) => `${PREFIX}${f.fid}:${f.key}`;

/** A scanned or pasted code, or null if it is not one of ours. @param {string} text */
export function readLink(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith(PREFIX)) return null;
  const [fid, key, ...rest] = t.slice(PREFIX.length).split(':');
  if (rest.length || !/^[A-Za-z0-9_-]{22}$/.test(fid ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(key ?? '')) return null;
  return { fid, key };
}

/** @param {string} key @param {KeyUsage[]} use @param {'AES-GCM' | 'HMAC'} alg */
const importKey = (key, use, alg) => crypto.subtle.importKey('raw', unb64url(key), alg === 'HMAC' ? { name: 'HMAC', hash: 'SHA-256' } : { name: 'AES-GCM' }, false, use);

/** The token the server checks. @param {string} key */
export async function authToken(key) {
  const k = await importKey(key, ['sign'], 'HMAC');
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('whendose-sync-auth-v1'))));
}

/** @param {string} key @param {unknown} value @returns {Promise<string>} iv + ciphertext, base64url */
export async function seal(key, value) {
  const k = await importKey(key, ['encrypt'], 'AES-GCM');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64url(out);
}

/** @param {string} key @param {string} sealed @returns {Promise<any>} throws if it is not ours or was changed */
export async function open(key, sealed) {
  const k = await importKey(key, ['decrypt'], 'AES-GCM');
  const bytes = unb64url(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, k, bytes.slice(12));
  return JSON.parse(dec.decode(pt));
}
