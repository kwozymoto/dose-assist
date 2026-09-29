/* Pure parts of the sync server: request checks. Tested in
   tests/sync-worker.test.mjs. Runs on Cloudflare Workers and in Node. */

export const MAX_BLOB_CHARS = 262144; // one sealed batch, base64url
export const MAX_BLOBS_PER_PUSH = 20;
export const MAX_FAMILY_CHARS = 50 * 1024 * 1024; // everything one family has stored
export const MAX_PULL_CHARS = 4 * 1024 * 1024; // one pull response
export const MAX_PULL_ROWS = 500;

/** A family id: 16 random bytes, base64url. @param {unknown} s */
export const validFid = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
/** A phone id: a UUID. @param {unknown} s */
export const validDev = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
/** An access token: an HMAC-SHA256, base64url. @param {unknown} s */
export const validToken = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);

/**
 * @param {unknown} blobs
 * @returns {{blobs: string[]} | {error: string}}
 */
export function validBlobs(blobs) {
  if (!Array.isArray(blobs)) return { error: 'blobs must be an array' };
  if (blobs.length === 0) return { error: 'nothing to store' };
  if (blobs.length > MAX_BLOBS_PER_PUSH) return { error: `at most ${MAX_BLOBS_PER_PUSH} blobs` };
  for (const b of blobs) {
    if (typeof b !== 'string' || !/^[A-Za-z0-9_-]+$/.test(b)) return { error: 'a blob is not base64url' };
    if (b.length > MAX_BLOB_CHARS) return { error: 'a blob is too large' };
  }
  return { blobs };
}

/** The bearer token from a request header, or null. @param {string | null} header */
export function bearer(header) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  return m ? m[1] : null;
}

/** @param {string} s */
export async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare two hex strings in time that does not depend on where they differ. @param {string} a @param {string} b */
export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i += 1) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/**
 * Rows for one pull: in order, stopping at the row or size limit.
 * @param {{seq: number, dev: string, blob: string}[]} rows  already ordered by seq, after the cursor
 * @returns {{items: {seq: number, dev: string, blob: string}[], more: boolean}}
 */
export function pageOf(rows) {
  const items = [];
  let size = 0;
  for (const r of rows) {
    if (items.length >= MAX_PULL_ROWS || (items.length && size + r.blob.length > MAX_PULL_CHARS)) return { items, more: true };
    items.push(r);
    size += r.blob.length;
  }
  return { items, more: false };
}
