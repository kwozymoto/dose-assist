import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, generateKeyPairSync } from 'node:crypto';
import { signedJwt, nudgeMessage, pemToDer, b64url, sendNudge } from '../sync-worker/src/fcm.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { client_email: 'test@whendose.iam.gserviceaccount.com', private_key: privateKey, project_id: 'whendose' };

const unb64 = (s) => Uint8Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

describe('FCM nudges', () => {
  test('the JWT is RS256, for the FCM scope, and verifies with the service account key', async () => {
    const jwt = await signedJwt(SA, 1790000000);
    const [h, c, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(unb64(h)).toString()), { alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(unb64(c)).toString());
    assert.equal(claims.iss, SA.client_email);
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
    assert.equal(claims.exp - claims.iat, 3600);
    const pub = await webcrypto.subtle.importKey('spki', pemToDer(publicKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    assert.ok(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, unb64(s), new TextEncoder().encode(`${h}.${c}`)));
  });

  test('a nudge is a high-priority data message that says only "sync" and carries a sealed batch', () => {
    assert.deepEqual(nudgeMessage('tok', 'SEALED'), { message: { token: 'tok', data: { t: 'sync', n: 'SEALED' }, android: { priority: 'HIGH', ttl: '3600s' } } });
    assert.deepEqual(nudgeMessage('tok', '').message.data, { t: 'sync' });
  });

  test('b64url has no padding or unsafe characters', () => {
    assert.equal(b64url(new Uint8Array([251, 255, 254])), '-__-');
  });

  test('sending: a token, then the message; a dead token is reported so it can be dropped', async () => {
    const calls = [];
    const fake = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ACCESS', expires_in: 3600 }), { status: 200 });
      return new Response('{}', { status: url.includes('dead') ? 404 : 200 });
    };
    assert.equal(await sendNudge(JSON.stringify(SA), 'phone-token', 'SEALED', fake), 'sent');
    const send = calls.find((c) => c.url.includes('fcm.googleapis.com'));
    assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/whendose/messages:send');
    assert.equal(send.init.headers.Authorization, 'Bearer ACCESS');
    assert.equal(JSON.parse(send.init.body).message.token, 'phone-token');
    const fakeDead = async (url) => (url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 'A', expires_in: 3600 })) : new Response('{}', { status: 404 }));
    assert.equal(await sendNudge(JSON.stringify(SA), 'x', '', fakeDead), 'gone');
  });
});
