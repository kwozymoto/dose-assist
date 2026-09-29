/* The weight check: an amount compared with the child's recorded weight.

   Fixture numbers only (a 15 mg/kg usual dose, 60 mg/kg in 24 hours), never
   the shipped rules. What it holds: going over the 24-hour mg per kg is a
   stop only when that number is source-verified and the weight is recent;
   everything else is a caution; no weight means no opinion. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { checkWeight } from '../../js/engine/weight.js';
import { RULES, NOW, DAY } from './fixtures.mjs';

const RULE = { ...RULES.ingredients.alpha, mgPerKg: 15, maxMgPerKgPer24h: 60 };
const FRESH = 180 * DAY;
const go = (over) => checkWeight({ rule: RULE, weightKg: 12, weighedAt: NOW - DAY, doseMg: 120, windowMg: 0, at: NOW, freshMs: FRESH, ...over });

describe('checkWeight', () => {
  test('no weight on record: nothing to say', () => {
    const r = go({ weightKg: null, weighedAt: null });
    assert.equal(r.known, false);
    assert.equal(r.perDose, null);
    assert.equal(r.perDay, null);
    assert.equal(r.stop, false);
  });

  test('a dose at or under the usual mg per kg is fine', () => {
    const r = go({ doseMg: 180 }); // 15 mg/kg for 12 kg
    assert.equal(r.known, true);
    assert.equal(r.perDose, null);
    assert.equal(r.stop, false);
  });

  test('a dose over the usual mg per kg is a caution, never a stop', () => {
    const r = go({ doseMg: 250 });
    assert.deepEqual(r.perDose, { mg: 250, perKg: 250 / 12, maxPerKg: 15, maxMg: 180 });
    assert.equal(r.stop, false);
  });

  test('over the 24-hour mg per kg with a recent weight and a verified number: stop', () => {
    const r = go({ doseMg: 180, windowMg: 600 }); // 780 mg, 65 mg/kg; the most is 720 mg
    assert.deepEqual(r.perDay, { totalMg: 780, perKg: 65, maxPerKg: 60, maxMg: 720, verified: true });
    assert.equal(r.stop, true);
  });

  test('exactly at the 24-hour mg per kg is allowed', () => {
    const r = go({ doseMg: 180, windowMg: 540 });
    assert.equal(r.perDay, null);
    assert.equal(r.stop, false);
  });

  test('a weight older than the fresh window turns the stop into a caution', () => {
    const r = go({ doseMg: 180, windowMg: 600, weighedAt: NOW - FRESH - 1 });
    assert.equal(r.stale, true);
    assert.notEqual(r.perDay, null);
    assert.equal(r.stop, false);
  });

  test('a 24-hour mg per kg listed as unverified is a caution, not a stop', () => {
    const r = checkWeight({ rule: { ...RULE, unverified: ['maxMgPerKgPer24h'] }, weightKg: 12, weighedAt: NOW - DAY, doseMg: 180, windowMg: 600, at: NOW, freshMs: FRESH });
    assert.equal(r.perDay?.verified, false);
    assert.equal(r.stop, false);
  });

  test('a rule without the mg per kg fields checks nothing', () => {
    const r = checkWeight({ rule: RULES.ingredients.alpha, weightKg: 12, weighedAt: NOW, doseMg: 5000, windowMg: 5000, at: NOW, freshMs: FRESH });
    assert.equal(r.perDose, null);
    assert.equal(r.perDay, null);
    assert.equal(r.stop, false);
  });

  test('nonsense weights are ignored rather than trusted', () => {
    for (const w of [0, -3, NaN, Infinity]) {
      const r = go({ weightKg: w, doseMg: 999, windowMg: 9999 });
      assert.equal(r.known, false, String(w));
      assert.equal(r.stop, false);
    }
  });

  test('a weight recorded after the dose time still counts (it was weighed the same day)', () => {
    const r = go({ weighedAt: NOW + 60000, doseMg: 180, windowMg: 600 });
    assert.equal(r.stale, false);
    assert.equal(r.stop, true);
  });

  test('property: a stop only ever comes with a recent weight and a verified 24-hour excess or a 1.5 times single dose', () => {
    fc.assert(fc.property(
      fc.double({ min: 2, max: 80, noNaN: true }), fc.integer({ min: 1, max: 1500 }), fc.integer({ min: 0, max: 4000 }), fc.integer({ min: 0, max: 400 }),
      (kg, dose, win, ageDays) => {
        const r = go({ weightKg: kg, doseMg: dose, windowMg: win, weighedAt: NOW - ageDays * DAY });
        if (!r.stop) return true;
        if (r.stale) return false;
        return (r.perDay !== null && r.perDay.verified && dose + win > 60 * kg) || (r.bigDose && dose >= 1.5 * 15 * kg - 0.01);
      },
    ), { numRuns: 1000 });
  });
});

describe('one dose far over the usual mg per kg', () => {
  test('1.5 times the usual dose or more, with a recent weight: a stop', () => {
    const usual = RULE.mgPerKg * 12;
    assert.equal(go({ doseMg: usual * 1.5 }).bigDose, true);
    assert.equal(go({ doseMg: usual * 1.5 }).stop, true);
    assert.equal(go({ doseMg: usual * 1.4 }).bigDose, false);
  });
  test('an old weight never stops it', () => {
    const usual = RULE.mgPerKg * 12;
    const r = go({ doseMg: usual * 2, weighedAt: NOW - FRESH - DAY });
    assert.equal(r.bigDose, false);
  });
});
