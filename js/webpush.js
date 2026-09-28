// @ts-check
/* Web Push message encryption (RFC 8291, aes128gcm per RFC 8188), done on
   the phone.

   Why here and not on the server: the reminder server is handed only
   ciphertext and a time to send it. It never sees a child's name, a
   medicine or a dose; it cannot, because it does not hold the key. The
   phone encrypts to its own push subscription, and only the phone's
   browser can decrypt what arrives.

   Tested against the worked example in RFC 8291 section 5 and appendix A
   (tests/webpush.test.mjs), byte for byte. */

/** @typedef {Uint8Array<ArrayBuffer>} Bytes */

const enc = new TextEncoder();

/** @param {Bytes} bytes */
export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s */
export function unb64url(s) {
  const clean = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {...Bytes} parts */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** @param {Bytes} key @param {Bytes} data */
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/**
 * @typedef {object} EncryptOptions  for tests only: fix the random inputs
 * @property {Bytes} [salt]
 * @property {{privateJwk: JsonWebKey, publicRaw: Bytes}} [sender]
 */

/**
 * Encrypt `plaintext` for a push subscription.
 * @param {Bytes} plaintext  at most 3993 bytes
 * @param {{p256dh: Bytes, auth: Bytes}} to  the subscription's keys
 * @param {EncryptOptions} [opts]
 * @returns {Promise<Bytes>} the request body, header included
 */
export async function encryptPush(plaintext, to, opts = {}) {
  if (plaintext.length > 3993) throw new RangeError('push payload too large');
  if (to.p256dh.length !== 65 || to.p256dh[0] !== 4) throw new TypeError('p256dh must be an uncompressed P-256 point');
  if (to.auth.length !== 16) throw new TypeError('auth must be 16 bytes');

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  /** @type {CryptoKey} */
  let asPrivate;
  /** @type {Bytes} */
  let asPublic;
  if (opts.sender) {
    asPrivate = await crypto.subtle.importKey('jwk', opts.sender.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    asPublic = opts.sender.publicRaw;
  } else {
    const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  // importKey validates that the point is on the curve (RFC 8291 section 7).
  const uaKey = await crypto.subtle.importKey('raw', to.p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const prkKey = await hmac(to.auth, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), to.p256dh, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2]));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, padded));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, sealed);
}

/**
 * Raw public key and private JWK from base64url parts, as RFC 8291 prints them.
 * @param {string} privateB64 @param {string} publicB64
 */
export function senderFromRfc(privateB64, publicB64) {
  const pub = unb64url(publicB64);
  return {
    publicRaw: pub,
    privateJwk: /** @type {JsonWebKey} */ ({
      kty: 'EC', crv: 'P-256', d: privateB64, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true,
    }),
  };
}
