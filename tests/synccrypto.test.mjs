import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newFamily, linkText, readLink, authToken, seal, open } from '../js/synccrypto.js';

describe('sync encryption', () => {
  test('a new family has a 128-bit id and a 256-bit key', async () => {
    const f = await newFamily();
    assert.match(f.fid, /^[A-Za-z0-9_-]{22}$/);
    assert.match(f.key, /^[A-Za-z0-9_-]{43}$/);
    const g = await newFamily();
    assert.notEqual(f.fid, g.fid);
    assert.notEqual(f.key, g.key);
  });

  test('the pairing code is a link: the family id and key only after the #, which is never sent to a server', async () => {
    const f = await newFamily();
    const text = linkText(f, 'https://sync.example.dev');
    assert.equal(text, `https://sync.example.dev/link#1:${f.fid}:${f.key}`);
    assert.equal(new URL(text).pathname, '/link');
    assert.equal(new URL(text).search, '');
    assert.deepEqual(readLink(text), f);
    assert.deepEqual(readLink(`  ${text}\n`), f);
    assert.deepEqual(readLink(`whendose://link#1:${f.fid}:${f.key}`), f);
  });

  test('the older whendose:link: form still reads, and anything else is refused', async () => {
    const f = await newFamily();
    assert.deepEqual(readLink(`whendose:link:1:${f.fid}:${f.key}`), f);
    for (const bad of ['', 'hello', 'whendose:link:2:a:b', `whendose:link:1:${f.fid}`, `whendose:link:1:${f.fid}:short`, 'https://evil.example/', `https://x.dev/other#1:${f.fid}:${f.key}`, `https://x.dev/link#2:${f.fid}:${f.key}`, `https://x.dev/link?q=1#1:${f.fid}:${f.key}`]) {
      assert.equal(readLink(bad), null, bad);
    }
  });

  test('the access token is stable for a key, differs between keys, and is not the key', async () => {
    const f = await newFamily();
    const g = await newFamily();
    assert.equal(await authToken(f.key), await authToken(f.key));
    assert.notEqual(await authToken(f.key), await authToken(g.key));
    assert.notEqual(await authToken(f.key), f.key);
  });

  test('seal and open round-trip; the sealed text shows nothing of the content', async () => {
    const f = await newFamily();
    const payload = { v: 1, changes: [{ s: 'children', r: { id: 'c1', name: 'Elyse' } }] };
    const sealed = await seal(f.key, payload);
    assert.equal(sealed.includes('Elyse'), false);
    assert.deepEqual(await open(f.key, sealed), payload);
  });

  test('the same content seals differently each time (a fresh IV)', async () => {
    const f = await newFamily();
    assert.notEqual(await seal(f.key, { a: 1 }), await seal(f.key, { a: 1 }));
  });

  test('another family\'s key, or a changed byte, cannot open it', async () => {
    const f = await newFamily();
    const g = await newFamily();
    const sealed = await seal(f.key, { a: 1 });
    await assert.rejects(() => open(g.key, sealed));
    const tampered = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.at(-1);
    await assert.rejects(() => open(f.key, tampered));
  });
});
