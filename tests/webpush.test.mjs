/* RFC 8291 section 5 and appendix A, byte for byte. The values below were
   copied from the RFC text fetched from rfc-editor.org on 2026-09-28, not
   typed from memory. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPush, unb64url, b64url, senderFromRfc } from '../js/webpush.js';

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('matches the RFC 8291 worked example exactly', async () => {
  const body = await encryptPush(new TextEncoder().encode(RFC.plaintext), { p256dh: unb64url(RFC.uaPublic), auth: unb64url(RFC.auth) }, {
    salt: unb64url(RFC.salt),
    sender: senderFromRfc(RFC.asPrivate, RFC.asPublic),
  });
  assert.equal(b64url(body), RFC.body);
  // The example's header says Content-Length: 145, but its own body is 192
  // base64url characters = 144 bytes = 86 header + 41 plaintext + 1
  // delimiter + 16 tag. The body is what is checked above; 144 is right.
  assert.equal(body.length, 144);
});

test('with random salt and keys, the receiver can decrypt it', async () => {
  // Decrypt as the user agent would, using the RFC's receiver keys.
  const plain = new TextEncoder().encode('{"title":"Mia: next paracetamol allowed from now"}');
  const body = await encryptPush(plain, { p256dh: unb64url(RFC.uaPublic), auth: unb64url(RFC.auth) });
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);

  const recv = senderFromRfc(RFC.uaPrivate, RFC.uaPublic);
  const uaPriv = await crypto.subtle.importKey('jwk', recv.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPriv, 256));
  const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const te = new TextEncoder();
  const prkKey = await hmac(unb64url(RFC.auth), secret);
  const ikm = await hmac(prkKey, cat(te.encode('WebPush: info\0'), unb64url(RFC.uaPublic), asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  assert.equal(opened.at(-1), 2, 'padding delimiter');
  assert.deepEqual(opened.slice(0, -1), plain);
});

test('refuses bad keys and oversized payloads', async () => {
  const to = { p256dh: unb64url(RFC.uaPublic), auth: unb64url(RFC.auth) };
  await assert.rejects(() => encryptPush(new Uint8Array(4000), to), /too large/);
  await assert.rejects(() => encryptPush(new Uint8Array(1), { ...to, auth: new Uint8Array(8) }), /auth/);
  await assert.rejects(() => encryptPush(new Uint8Array(1), { ...to, p256dh: new Uint8Array(33) }), /p256dh/);
  const offCurve = new Uint8Array(65); offCurve[0] = 4; offCurve[1] = 1;
  await assert.rejects(() => encryptPush(new Uint8Array(1), { ...to, p256dh: offCurve }));
});
