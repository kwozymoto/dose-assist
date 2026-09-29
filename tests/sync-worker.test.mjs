import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validFid, validDev, validToken, validBlobs, bearer, sameHex, pageOf, MAX_BLOBS_PER_PUSH, MAX_BLOB_CHARS, MAX_PULL_ROWS } from '../sync-worker/src/lib.js';

describe('sync server checks', () => {
  test('ids and tokens', () => {
    assert.ok(validFid('AAAAAAAAAAAAAAAAAAAAAA'));
    for (const bad of ['', 'short', 'AAAAAAAAAAAAAAAAAAAAAA/', '../../etc', 42, null]) assert.equal(validFid(bad), false, String(bad));
    assert.ok(validDev('de67e891-8d9e-49f1-8bba-9cc27dd7398c'));
    assert.equal(validDev('not-a-uuid'), false);
    assert.ok(validToken('a'.repeat(43)));
    assert.equal(validToken('a'.repeat(44)), false);
  });

  test('bearer tokens are read only in the exact form', () => {
    const t = 'A'.repeat(43);
    assert.equal(bearer(`Bearer ${t}`), t);
    for (const bad of [null, '', t, `bearer ${t}`, `Bearer ${t}x`, `Bearer  ${t}`]) assert.equal(bearer(bad), null, String(bad));
  });

  test('blobs: base64url strings, within the limits', () => {
    assert.deepEqual(validBlobs(['abc_-D']), { blobs: ['abc_-D'] });
    assert.ok('error' in validBlobs([]));
    assert.ok('error' in validBlobs('abc'));
    assert.ok('error' in validBlobs(['not base64!']));
    assert.ok('error' in validBlobs([1]));
    assert.ok('error' in validBlobs(['a'.repeat(MAX_BLOB_CHARS + 1)]));
    assert.ok('error' in validBlobs(Array(MAX_BLOBS_PER_PUSH + 1).fill('a')));
  });

  test('hashes compare fully', () => {
    assert.ok(sameHex('abcd', 'abcd'));
    assert.equal(sameHex('abcd', 'abce'), false);
    assert.equal(sameHex('abcd', 'abc'), false);
  });

  test('a pull page stops at the row limit and says there is more', () => {
    const rows = Array.from({ length: MAX_PULL_ROWS + 3 }, (_, i) => ({ seq: i + 1, dev: 'd', blob: 'x' }));
    const p = pageOf(rows);
    assert.equal(p.items.length, MAX_PULL_ROWS);
    assert.equal(p.more, true);
    assert.deepEqual(pageOf(rows.slice(0, 2)), { items: rows.slice(0, 2), more: false });
  });

  test('a single row bigger than a page still goes, alone', () => {
    const big = { seq: 1, dev: 'd', blob: 'x'.repeat(5 * 1024 * 1024) };
    const p = pageOf([big, { seq: 2, dev: 'd', blob: 'y' }]);
    assert.deepEqual(p.items.map((r) => r.seq), [1]);
    assert.equal(p.more, true);
  });
});
