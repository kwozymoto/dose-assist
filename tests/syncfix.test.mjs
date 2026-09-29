/* Fixes from the audit: what to send, deletions against edits, doses given
   twice by two people, the same child entered on both phones. Pure. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecord, outgoing, forWire, pushedMark } from '../js/syncmerge.js';
import { doubleDoses, duplicateChildren } from '../js/syncchecks.js';
import { RULES, NOW, MIN, HOUR } from './engine/fixtures.mjs';

const rec = (id, u, d, extra = {}) => ({ id, _u: u, _d: d, ...extra });

describe('what to send: by this phone\'s own change counter, not the clock', () => {
  test('a change with a higher counter goes, whatever its clock time', () => {
    const data = { doses: [rec('old', 100, 'me', { _s: 5 }), rec('back', 1, 'me', { _s: 9 })] };
    assert.deepEqual(outgoing(data, 'me', { seq: 6, time: 500 }).map((c) => c.r.id), ['back']);
  });
  test('records from before the counter still go by time, once', () => {
    const data = { doses: [rec('legacy', 900, 'me'), rec('legacy-old', 100, 'me')] };
    assert.deepEqual(outgoing(data, 'me', { seq: 0, time: 500 }).map((c) => c.r.id), ['legacy']);
  });
  test('the counter never travels', () => {
    assert.equal('_s' in forWire('doses', rec('d', 1, 'me', { _s: 3 })), false);
  });
  test('the mark only moves past changes old enough to be safely stored', () => {
    const out = [{ s: 'doses', r: rec('a', 1000, 'me', { _s: 4 }) }, { s: 'doses', r: rec('b', 9990, 'me', { _s: 7 }) }, { s: 'doses', r: rec('c', 2000, 'me', { _s: 5 }) }];
    // started at 10000: b is too recent (inside 5 s), so the mark stays below it and b goes again next time.
    assert.equal(pushedMark(out, 3, 10000, 5000), 6);
    assert.equal(pushedMark(out.filter((c) => c.r.id !== 'b'), 3, 10000, 5000), 5);
    assert.equal(pushedMark([], 3, 10000, 5000), 3);
  });
});

describe('deleting a dose against an edit on the other phone', () => {
  test('a delete is not undone by a later edit from the other phone', () => {
    const local = rec('d', 5, 'dad', { amount: 5, deletedAt: 5 });
    const remote = rec('d', 6, 'mum', { amount: 4, deletedAt: null });
    const m = mergeRecord('doses', local, remote);
    assert.equal(m.amount, 4);
    assert.equal(m.deletedAt, 5);
  });
  test('an edit arriving at a phone that already deleted it keeps it deleted too', () => {
    const local = rec('d', 6, 'mum', { amount: 4, deletedAt: null });
    const remote = rec('d', 5, 'dad', { amount: 5, deletedAt: 5 });
    const m = mergeRecord('doses', local, remote);
    assert.equal(m?.deletedAt ?? local.deletedAt, 5);
  });
  test('an explicit restore after the delete does undo it', () => {
    const local = rec('d', 5, 'dad', { deletedAt: 5 });
    const remote = rec('d', 7, 'mum', { deletedAt: null, restoredAt: 7 });
    assert.equal(mergeRecord('doses', local, remote).deletedAt, null);
  });
  test('a delete after a restore wins again', () => {
    const local = rec('d', 7, 'mum', { deletedAt: null, restoredAt: 7 });
    const remote = rec('d', 9, 'dad', { deletedAt: 9, restoredAt: 7 });
    assert.equal(mergeRecord('doses', local, remote).deletedAt, 9);
  });
});

describe('doses given twice by two people', () => {
  const dose = (id, ago, by, dev, ing = 'alpha', over = {}) => ({ id, childId: 'c', givenAt: NOW - ago, givenBy: by, _d: dev, components: [{ ingredient: ing, mg: 100 }], ...over });

  test('two people, same medicine, inside the minimum gap: flagged once, with both', () => {
    const found = doubleDoses([dose('a', 30 * MIN, 'Mum', 'p1'), dose('b', 25 * MIN, 'Dad', 'p2')], RULES, NOW);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].ids, ['a', 'b']);
    assert.equal(found[0].ingredient, 'alpha');
    assert.equal(found[0].gapMs, 5 * MIN);
  });
  test('the same person (one phone) is not flagged: the stop screens already handled it', () => {
    assert.equal(doubleDoses([dose('a', 30 * MIN, 'Mum', 'p1'), dose('b', 25 * MIN, 'Mum', 'p1')], RULES, NOW).length, 0);
  });
  test('outside the minimum gap, older than 24 hours, deleted, or different medicines: not flagged', () => {
    assert.equal(doubleDoses([dose('a', 5 * HOUR, 'Mum', 'p1'), dose('b', 30 * MIN, 'Dad', 'p2')], RULES, NOW).length, 0);
    assert.equal(doubleDoses([dose('a', 26 * HOUR, 'Mum', 'p1'), dose('b', 25.5 * HOUR, 'Dad', 'p2')], RULES, NOW).length, 0);
    assert.equal(doubleDoses([dose('a', 30 * MIN, 'Mum', 'p1'), dose('b', 25 * MIN, 'Dad', 'p2', 'alpha', { deletedAt: NOW })], RULES, NOW).length, 0);
    assert.equal(doubleDoses([dose('a', 30 * MIN, 'Mum', 'p1'), dose('b', 25 * MIN, 'Dad', 'p2', 'beta')], RULES, NOW).length, 0);
  });
  test('different children are never paired', () => {
    assert.equal(doubleDoses([dose('a', 30 * MIN, 'Mum', 'p1'), dose('b', 25 * MIN, 'Dad', 'p2', 'alpha', { childId: 'other' })], RULES, NOW).length, 0);
  });
});

describe('the same child on both phones', () => {
  const kid = (id, name, dob, over = {}) => ({ id, name, dateOfBirth: dob, createdAt: 1, ...over });
  test('same name (any case or spacing) and date of birth: grouped, keeping the lowest id on both phones', () => {
    const groups = duplicateChildren([kid('b2', 'Elyse ', '2023-05-10'), kid('a1', 'elyse', '2023-05-10'), kid('c3', 'Mia', '2023-05-10')]);
    assert.deepEqual(groups, [{ keep: 'a1', merge: ['b2'] }]);
  });
  test('twins (same birth date, different names) and namesakes (different dates) are not merged', () => {
    assert.deepEqual(duplicateChildren([kid('a', 'Ari', '2023-05-10'), kid('b', 'Mia', '2023-05-10')]), []);
    assert.deepEqual(duplicateChildren([kid('a', 'Ari', '2023-05-10'), kid('b', 'Ari', '2021-01-01')]), []);
  });
  test('archived children are left alone', () => {
    assert.deepEqual(duplicateChildren([kid('a', 'Ari', '2023-05-10'), kid('b', 'Ari', '2023-05-10', { archivedAt: 5 })]), []);
  });
});
