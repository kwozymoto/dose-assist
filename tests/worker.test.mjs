import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validEndpoint, validItems, vapidAuth, dueItems, b64url, unb64url, MAX_ITEMS } from '../reminder-worker/src/lib.js';

const NOW = Date.UTC(2026, 9, 14);

describe('endpoints', () => {
  test('real push services are accepted', () => {
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://web.push.apple.com/QGuQyavXutnMH',
      'https://wns2-par02p.notify.windows.com/w/?token=AQE',
    ]) assert.ok(validEndpoint(e), e);
  });

  test('anything else is refused, so the worker cannot be pointed elsewhere', () => {
    for (const e of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://evil.example/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://localhost/x',
      'not a url',
      42,
      null,
    ]) assert.equal(validEndpoint(/** @type {any} */ (e)), false, String(e));
  });
});

describe('items', () => {
  const item = (over = {}) => ({ id: 'r1', fireAt: NOW + 3600e3, body: 'QUJD', ...over });

  test('a good schedule passes, stripped to the known fields', () => {
    const r = validItems([{ ...item(), extra: 'dropped' }], NOW);
    assert.deepEqual(r, { items: [item()] });
  });

  test('bad schedules are refused', () => {
    const bad = [
      'x', [null], [item({ id: '' })], [item({ id: 'a b' })], [item(), item()],
      [item({ fireAt: NOW - 2 * 86400e3 })], [item({ fireAt: NOW + 61 * 86400e3 })], [item({ fireAt: NaN })],
      [item({ body: '' })], [item({ body: 'not base64!' })], [item({ body: 'A'.repeat(6000) })],
      Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item({ id: `r${i}` })),
    ];
    for (const b of bad) assert.ok('error' in validItems(b, NOW), JSON.stringify(b).slice(0, 60));
  });
});

describe('VAPID', () => {
  test('the Authorization header carries a valid ES256 JWT for the endpoint origin', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const auth = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', jwk, 'mailto:test@example.org', NOW);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
    assert.ok(m);
    const [h, c, s] = m[1].split('.');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64url(h))), { typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(new TextDecoder().decode(unb64url(c)));
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.sub, 'mailto:test@example.org');
    assert.equal(claims.exp, NOW / 1000 + 12 * 3600);
    const pub = await crypto.subtle.importKey('raw', unb64url(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(s), new TextEncoder().encode(`${h}.${c}`));
    assert.ok(ok, 'signature verifies with the advertised public key');
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    assert.equal(m[2], b64url(raw));
  });
});

describe('alarm triage', () => {
  test('due now, later, and too late to be useful', () => {
    const r = dueItems([
      { id: 'a', fireAt: NOW - 30 * 60e3, body: 'x' },
      { id: 'b', fireAt: NOW, body: 'x' },
      { id: 'c', fireAt: NOW + 60e3, body: 'x' },
      { id: 'd', fireAt: NOW - 2 * 3600e3, body: 'x' },
    ], NOW);
    assert.deepEqual(r.due.map((i) => i.id), ['a', 'b']);
    assert.deepEqual(r.later.map((i) => i.id), ['c']);
    assert.deepEqual(r.expired.map((i) => i.id), ['d']);
  });
});
