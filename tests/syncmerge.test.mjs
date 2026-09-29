/* Merging records between linked phones. Pure: no storage, no network.

   The claims: a record one phone has and the other lacks is added; where
   both changed it, the later change wins (ties broken by phone id, so both
   phones agree); merging is idempotent and order-independent; the
   reminder's phone-only fields never travel. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { newer, mergeRecord, outgoing, forWire, chunk, SYNCED_STORES } from '../js/syncmerge.js';

const rec = (id, u, d, extra = {}) => ({ id, _u: u, _d: d, ...extra });

describe('newer', () => {
  test('the later change wins', () => {
    assert.equal(newer(rec('a', 2, 'x'), rec('a', 1, 'y')), true);
    assert.equal(newer(rec('a', 1, 'x'), rec('a', 2, 'y')), false);
  });
  test('the same moment: the higher phone id wins, so both phones agree', () => {
    assert.equal(newer(rec('a', 5, 'b'), rec('a', 5, 'a')), true);
    assert.equal(newer(rec('a', 5, 'a'), rec('a', 5, 'b')), false);
  });
  test('an unstamped record (from before sync) loses to any stamped one', () => {
    assert.equal(newer(rec('a', 1, 'x'), { id: 'a' }), true);
    assert.equal(newer({ id: 'a' }, rec('a', 1, 'x')), false);
  });
  test('identical is not newer', () => {
    assert.equal(newer(rec('a', 5, 'a'), rec('a', 5, 'a')), false);
  });
});

describe('mergeRecord', () => {
  test('missing here: take it', () => {
    assert.deepEqual(mergeRecord('doses', undefined, rec('d', 1, 'x', { amount: 5 })), rec('d', 1, 'x', { amount: 5 }));
  });
  test('ours is newer: keep ours (nothing to write)', () => {
    assert.equal(mergeRecord('doses', rec('d', 3, 'me'), rec('d', 2, 'x')), null);
  });
  test('theirs is newer: take theirs', () => {
    assert.deepEqual(mergeRecord('doses', rec('d', 1, 'me', { amount: 5 }), rec('d', 2, 'x', { amount: 4 })), rec('d', 2, 'x', { amount: 4 }));
  });
  test('a reminder keeps this phone\'s own planned time', () => {
    const local = rec('r', 1, 'me', { planned: { fireAt: 9, rev: 'abc' } });
    const remote = rec('r', 2, 'x', { cancelledAt: 7 });
    assert.deepEqual(mergeRecord('reminders', local, remote), rec('r', 2, 'x', { cancelledAt: 7, planned: { fireAt: 9, rev: 'abc' } }));
  });
  test('a deleted dose stays deleted against an older edit', () => {
    const local = rec('d', 5, 'me', { deletedAt: 5 });
    assert.equal(mergeRecord('doses', local, rec('d', 4, 'x', { amount: 9 })), null);
  });
  test('a later restore undoes a delete', () => {
    const local = rec('d', 5, 'me', { deletedAt: 5 });
    assert.deepEqual(mergeRecord('doses', local, rec('d', 6, 'x', { deletedAt: null, restoredAt: 6 })), rec('d', 6, 'x', { deletedAt: null, restoredAt: 6 }));
  });

  test('property: two phones end up the same, whatever the order they merge in', () => {
    // One phone's change at one moment is one version, so the content follows from (u, d).
    const version = fc.record({ u: fc.integer({ min: 0, max: 20 }), d: fc.constantFrom('a', 'b', 'c') }).map((x) => ({ ...x, v: `${x.u}${x.d}` }));
    fc.assert(fc.property(fc.array(version, { minLength: 1, maxLength: 6 }), fc.array(version, { minLength: 1, maxLength: 6 }), (xs, ys) => {
      const apply = (start, list) => list.reduce((cur, x) => mergeRecord('doses', cur, rec('d', x.u, x.d, { v: x.v })) ?? cur, start);
      const a = apply(apply(undefined, xs), ys);
      const b = apply(apply(undefined, ys), xs);
      return a._u === b._u && a._d === b._d && a.v === b.v;
    }), { numRuns: 500 });
  });
});

describe('outgoing', () => {
  test('only this phone\'s changes since the last push, in every synced store', () => {
    const data = {
      doses: [rec('d1', 5, 'me'), rec('d2', 9, 'me'), rec('d3', 9, 'other'), { id: 'd4' }],
      children: [rec('c1', 12, 'me')],
      meta: [{ key: 'theme', value: 'dark' }],
    };
    const out = outgoing(data, 'me', { seq: 0, time: 6 });
    assert.deepEqual(out.map((c) => `${c.s}:${c.r.id}`).sort(), ['children:c1', 'doses:d2']);
    assert.equal(Math.max(...out.map((c) => c.r._u)), 12);
  });
  test('a new pairing sends everything once, whichever phone made it', () => {
    const data = { doses: [rec('d1', 5, 'me'), rec('d3', 9, 'other'), { id: 'd4' }] };
    assert.deepEqual(outgoing(data, 'me', { seq: 0, time: 0 }, { all: true }).map((c) => c.r.id), ['d1', 'd3']);
  });
  test('meta and photos never sync', () => {
    assert.ok(!SYNCED_STORES.includes('meta'));
    assert.ok(!SYNCED_STORES.includes('photos'));
  });
});

describe('forWire', () => {
  test('a reminder\'s planned time stays on the phone', () => {
    assert.deepEqual(forWire('reminders', rec('r', 1, 'me', { planned: { fireAt: 1, rev: 'x' }, kind: 'next_allowed' })), rec('r', 1, 'me', { kind: 'next_allowed' }));
  });
  test('other records go as they are', () => {
    const d = rec('d', 1, 'me', { amount: 5 });
    assert.deepEqual(forWire('doses', d), d);
  });
});

describe('chunk', () => {
  test('splits so no piece is over the limit, keeping every change once', () => {
    const changes = Array.from({ length: 50 }, (_, i) => ({ s: 'doses', r: rec(`d${i}`, i, 'me', { note: 'x'.repeat(100) }) }));
    const parts = chunk(changes, 1500);
    assert.ok(parts.length > 1);
    for (const p of parts) assert.ok(JSON.stringify(p).length <= 1500);
    assert.deepEqual(parts.flat().map((c) => c.r.id), changes.map((c) => c.r.id));
  });
  test('a single change bigger than the limit still goes, alone', () => {
    const big = { s: 'doses', r: rec('big', 1, 'me', { note: 'x'.repeat(5000) }) };
    assert.deepEqual(chunk([big], 1000), [[big]]);
  });
  test('nothing to send: no pieces', () => {
    assert.deepEqual(chunk([], 1000), []);
  });
});
