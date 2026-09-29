/* A dose recorded at an earlier time than doses already on record: the
   look-back check cannot see the later ones, so laterConflict does. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { laterConflict, pastOnly } from '../../js/engine/later.js';
import { checkDose } from '../../js/engine/checkDose.js';
import { RULES, NOW, MIN, HOUR, TZ } from './fixtures.mjs';

const dose = (id, at, mg = 100, ing = 'alpha', over = {}) => ({ id, givenAt: at, components: [{ ingredient: ing, mg }], ...over });
const comps = (mg = 100, ing = 'alpha') => [{ ingredient: ing, mg }];

test('pastOnly keeps what came at or before the time', () => {
  assert.deepEqual(pastOnly([dose('a', 5), dose('b', 10), dose('c', 11)], 10).map((d) => d.id), ['a', 'b']);
});

test('the reported case: doses at 4:00 and 15:00, recording 10:00 fits (gaps of 6 h and 5 h)', () => {
  const at = NOW - 10 * HOUR;
  const history = [dose('early', at - 6 * HOUR), dose('late', at + 5 * HOUR)];
  assert.equal(laterConflict({ components: comps(), rules: RULES, history, at }), null);
  // and looking back only, it is OK too: the old way wrongly said too soon
  assert.equal(checkDose({ components: comps(), rules: RULES, history: pastOnly(history, at), now: at, child: { id: 'c', dateOfBirth: null }, timeZone: TZ }).status, 'OK');
});

test('a later dose closer than the minimum gap is a conflict, naming it', () => {
  const at = NOW - 10 * HOUR;
  const c = laterConflict({ components: comps(), rules: RULES, history: [dose('late', at + 3 * HOUR)], at });
  assert.deepEqual(c && { reason: c.reason, doseId: c.doseId, ingredient: c.ingredient }, { reason: 'TOO_CLOSE', doseId: 'late', ingredient: 'alpha' });
});

test('too many doses in a 24 hours that includes later doses', () => {
  const at = NOW - 20 * HOUR;
  // four later doses, 4 h apart, starting 4 h after: all inside 24 h of `at`
  const history = [1, 2, 3, 4].map((k) => dose(`l${k}`, at + k * 4 * HOUR + MIN));
  assert.equal(laterConflict({ components: comps(), rules: RULES, history, at })?.reason, 'COUNT');
});

test('too many mg in a 24 hours that includes later doses', () => {
  const at = NOW - 20 * HOUR;
  const history = [dose('l1', at + 5 * HOUR, 1000), dose('l2', at + 10 * HOUR, 1000), dose('l3', at + 15 * HOUR, 1100)];
  assert.equal(laterConflict({ components: comps(1000), rules: RULES, history, at })?.reason, 'MG');
  assert.equal(laterConflict({ components: comps(900), rules: RULES, history, at }), null);
});

test('deleted doses, other medicines, the dose being edited and doses over 24 h later do not count', () => {
  const at = NOW - 30 * HOUR;
  const history = [
    dose('del', at + HOUR, 100, 'alpha', { deletedAt: 1 }),
    dose('beta', at + HOUR, 100, 'beta'),
    dose('self', at + HOUR),
    dose('far', at + 25 * HOUR),
  ];
  assert.equal(laterConflict({ components: comps(), rules: RULES, history, at, excludeId: 'self' }), null);
});

test('an ingredient with no rules is never a conflict', () => {
  assert.equal(laterConflict({ components: comps(100, 'mystery'), rules: RULES, history: [dose('x', NOW + MIN, 100, 'mystery')], at: NOW }), null);
});

test('property: with no later doses, never a conflict', () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 48 * 60 }), { maxLength: 8 }), (agos) => {
    const history = agos.map((m, i) => dose(`d${i}`, NOW - m * MIN));
    return laterConflict({ components: comps(), rules: RULES, history, at: NOW }) === null;
  }));
});

test('property: agrees with checking the later dose as if the new one were already recorded', () => {
  // One later dose L. The new dose conflicts exactly when L, checked with the
  // new dose in its history, would not be OK (only interval matters here).
  fc.assert(fc.property(fc.integer({ min: 1, max: 23 * 60 }), (gapMin) => {
    const at = NOW - 24 * HOUR;
    const later = dose('L', at + gapMin * MIN);
    const c = laterConflict({ components: comps(), rules: RULES, history: [later], at });
    const back = checkDose({ components: comps(), rules: RULES, history: [dose('new', at)], now: later.givenAt, child: { id: 'c', dateOfBirth: null }, timeZone: TZ }).status;
    return (c !== null) === (back !== 'OK');
  }));
});
