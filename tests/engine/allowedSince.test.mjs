/* allowedSince: the moment a dose became allowed, for the count-up.

   The claim: when the engine says OK, allowedSince is the first instant
   from which every rule was satisfied, so a check one millisecond earlier
   says it was not. Fixture numbers only. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { checkIngredient, checkDose } from '../../js/engine/checkDose.js';
import { RULES, NOW, MIN, HOUR, DAY, CHILD, TZ, dose } from './fixtures.mjs';

const one = (history, over = {}) => checkIngredient({ ingredient: 'alpha', rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, ...over });

describe('allowedSince', () => {
  test('after the interval alone: the moment the interval ended', () => {
    const r = one([dose('alpha', 100, 5 * HOUR)]);
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince, NOW - 5 * HOUR + 240 * MIN);
  });

  test('exactly on the interval it is now', () => {
    const r = one([dose('alpha', 100, 240 * MIN)]);
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince, NOW);
  });

  test('when a 24-hour limit cleared later than the interval, that is the moment', () => {
    const history = [dose('alpha', 100, 23 * HOUR + 50 * MIN), dose('alpha', 100, 18 * HOUR), dose('alpha', 100, 12 * HOUR), dose('alpha', 100, 5 * HOUR)];
    const r = one(history, { now: NOW + 30 * MIN });
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince, NOW + 10 * MIN);
  });

  test('when the mg total cleared later than the interval, that is the moment', () => {
    const history = [dose('alpha', 3950, 23 * HOUR + 50 * MIN), dose('alpha', 50, 5 * HOUR)];
    const r = one(history, { now: NOW + 30 * MIN });
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince, NOW + 10 * MIN);
  });

  test('no doses at all: nothing to count from', () => {
    const r = one([]);
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince ?? null, null);
  });

  test('a dose from long ago: still the moment its interval ended', () => {
    const r = one([dose('alpha', 100, 3 * DAY)]);
    assert.equal(r.allowedSince, NOW - 3 * DAY + 240 * MIN);
  });

  test('only OK results carry it', () => {
    for (const history of [[dose('alpha', 100, HOUR)], [dose('alpha', 3999, HOUR)]]) {
      const r = one(history);
      assert.notEqual(r.status, 'OK');
      assert.equal(r.allowedSince ?? null, null);
    }
    assert.equal(one([], { child: { id: 'b', dateOfBirth: '2026-09-01' } }).allowedSince ?? null, null);
  });

  test('deleted doses are ignored', () => {
    const r = one([dose('alpha', 100, 5 * HOUR), dose('alpha', 100, HOUR, { deletedAt: NOW })]);
    assert.equal(r.allowedSince, NOW - 5 * HOUR + 240 * MIN);
  });

  test('a dose logged in the future gives no answer rather than a wrong one', () => {
    const r = one([dose('alpha', 100, -HOUR)]);
    assert.equal(r.allowedSince ?? null, null);
  });

  test('a whole product is allowed since the last of its ingredients was', () => {
    const history = [dose('alpha', 100, 5 * HOUR), dose('beta', 100, 7 * HOUR)];
    const r = checkDose({ components: [{ ingredient: 'alpha' }, { ingredient: 'beta' }], rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ });
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince, Math.max(NOW - 5 * HOUR + 240 * MIN, NOW - 7 * HOUR + 360 * MIN));
  });

  test('a product with one ingredient never given uses the other', () => {
    const history = [dose('alpha', 100, 5 * HOUR)];
    const r = checkDose({ components: [{ ingredient: 'alpha' }, { ingredient: 'beta' }], rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ });
    assert.equal(r.allowedSince, NOW - 5 * HOUR + 240 * MIN);
  });

  test('property: one millisecond earlier the same history was not OK', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ ago: fc.integer({ min: 0, max: 60 * HOUR }), mg: fc.integer({ min: 1, max: 1200 }) }), { minLength: 1, maxLength: 9 }),
      (raw) => {
        const history = raw.map((r, i) => ({ id: `p${i}`, givenAt: NOW - r.ago, components: [{ ingredient: 'alpha', mg: r.mg }] }));
        const r = one(history);
        if (r.status !== 'OK' || r.allowedSince == null) return true;
        if (r.allowedSince > NOW) return false;
        const before = one(history, { now: r.allowedSince - 1 });
        const at = one(history, { now: r.allowedSince });
        return before.status !== 'OK' && at.status === 'OK';
      },
    ), { numRuns: 1500 });
  });
});

describe('allowedSince: no rules', () => {
  test('an ingredient with no rules has a last dose but no allowed-since', () => {
    const r = checkIngredient({ ingredient: 'zeta', rules: RULES, history: [{ id: 'z', givenAt: NOW - 5 * HOUR, components: [{ ingredient: 'zeta', mg: 5 }] }], now: NOW, child: CHILD, timeZone: TZ });
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince ?? null, null);
  });
});

describe('allowedSince: an age boundary', () => {
  test('a child who reached the minimum age after the last dose: allowed, but no moment to count from', () => {
    // Last dose 19:00 NZ the evening before day 90; day 90 begins at NZ midnight; checked at 00:30.
    const dose1 = { id: 'y', givenAt: Date.UTC(2026, 9, 13, 6, 0), components: [{ ingredient: 'alpha', mg: 100 }] };
    const now = Date.UTC(2026, 9, 13, 11, 30);
    const child = { id: 'young', dateOfBirth: '2026-07-16' };
    assert.equal(one([dose1], { now, child: { ...child, dateOfBirth: '2026-07-17' } }).status, 'BLOCKED');
    const r = one([dose1], { now, child });
    assert.equal(r.status, 'OK');
    assert.equal(r.allowedSince ?? null, null);
  });
});
