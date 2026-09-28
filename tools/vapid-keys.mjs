/* Make a VAPID key pair for the reminder worker.

    node tools/vapid-keys.mjs

   Prints the public key (paste into js/config.js VAPID_PUBLIC_KEY) and the
   private key as a JWK (paste into `npx wrangler secret put
   VAPID_PRIVATE_JWK`, run in reminder-worker/). The private key is printed
   once and never written to disk; do not commit it. */

import { webcrypto as crypto } from 'node:crypto';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const b64url = (b) => Buffer.from(b).toString('base64url');

console.log('Public key, for js/config.js VAPID_PUBLIC_KEY:\n');
console.log(`  ${b64url(raw)}\n`);
console.log('Private key, for `npx wrangler secret put VAPID_PRIVATE_JWK` (paste the one line):\n');
console.log(`  ${JSON.stringify({ kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x, y: jwk.y })}\n`);
