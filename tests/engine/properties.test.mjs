/* Property-based tests (fast-check).

   The claim the whole app rests on: whatever the history, if the engine says
   a dose is OK, then giving it breaks no rule; and if it gives a next-allowed
   time, then a dose at that time breaks no rule and a dose one minute
   earlier would have broken one.

   The rules are checked here by an independent, deliberately naive
   re-implementation (`violations`), not by calling back into the engine. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { checkIngredient } from '../../js/engine/checkDose.js';
import { RULES, NOW, MIN, HOUR, DAY, CHILD, TZ } from './fixtures.mjs';

const RUNS = 3000;

/** Independent oracle: every rule a dose of `mg` at time `t` would break. */
function violations(rule, history, t, mg) {
  const live = history.filter((d) => d.deletedAt == null);
  const out = [];
  if (mg > rule.maxSingleMg) out.push('single');
  let latest = -Infinity;
  let count = 0;
  let total = 0;
  for (const d of live) {
    latest = Math.max(latest, d.givenAt);
    if (d.givenAt > t - DAY) {
      count += 1;
      total += d.mg;
    }
  }
  if (t - latest < rule.minIntervalMinutes * MIN) out.push('interval');
  if (count + 1 > rule.maxDosesPer24h) out.push('count');
  if (Math.round((total + mg) * 1000) / 1000 > rule.maxMgPer24h) out.push('mg');
  return out;
}

const ingredientArb = fc.constantFrom('alpha', 'beta');

/** Histories of 0-12 doses over the last 60 hours, some deleted, some in the
    near future (clock skew between devices). Amounts include ones over the
    single cap, as a doctor's override would record. */
const historyArb = fc.array(
  fc.record({
    ago: fc.integer({ min: -30 * MIN, max: 60 * HOUR }),
    mg: fc.integer({ min: 1, max: 1500 }),
    deleted: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
  }),
  { maxLength: 12 },
);

function toHistory(ingredient, raw) {
  return raw.map((r, i) => ({
    id: `p${i}`,
    givenAt: NOW - r.ago,
    mg: r.mg,
    components: [{ ingredient, mg: r.mg }],
    deletedAt: r.deleted ? NOW : undefined,
  }));
}

test('OK means no rule is broken', () => {
  fc.assert(
    fc.property(ingredientArb, historyArb, fc.integer({ min: 1, max: 1500 }), (ing, raw, mg) => {
      const history = toHistory(ing, raw);
      const r = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, enteredMg: mg });
      if (r.status === 'OK') {
        assert.deepEqual(violations(RULES.ingredients[ing], history, NOW, mg), []);
      }
    }),
    { numRuns: RUNS },
  );
});

test('not OK means some rule would be broken now', () => {
  fc.assert(
    fc.property(ingredientArb, historyArb, fc.integer({ min: 1, max: 1500 }), (ing, raw, mg) => {
      const history = toHistory(ing, raw);
      const r = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, enteredMg: mg });
      if (r.status !== 'OK') {
        assert.notDeepEqual(violations(RULES.ingredients[ing], history, NOW, mg), []);
      }
    }),
    { numRuns: RUNS },
  );
});

test('at nextAllowedAt nothing is broken, and one minute earlier something is', () => {
  fc.assert(
    fc.property(ingredientArb, historyArb, fc.integer({ min: 1, max: 1500 }), (ing, raw, mg) => {
      const history = toHistory(ing, raw);
      const rule = RULES.ingredients[ing];
      const r = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, enteredMg: mg });
      if (r.nextAllowedAt === null) return;
      assert.ok(r.nextAllowedAt > NOW, 'a next time is always in the future');
      assert.deepEqual(violations(rule, history, r.nextAllowedAt, mg), []);
      assert.notDeepEqual(violations(rule, history, r.nextAllowedAt - MIN, mg), []);
      // And the engine agrees with itself when asked again at that time.
      const later = checkIngredient({ ingredient: ing, rules: RULES, history, now: r.nextAllowedAt, child: CHILD, timeZone: TZ, enteredMg: mg });
      assert.equal(later.status, 'OK');
    }),
    { numRuns: RUNS },
  );
});

test('null nextAllowedAt with a non-OK status only when the amount itself is over a limit', () => {
  fc.assert(
    fc.property(ingredientArb, historyArb, fc.integer({ min: 1, max: 1500 }), (ing, raw, mg) => {
      const history = toHistory(ing, raw);
      const r = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, enteredMg: mg });
      if (r.status !== 'OK' && r.nextAllowedAt === null) {
        assert.equal(r.status, 'EXCEEDS_LIMIT');
        assert.ok(['SINGLE_DOSE', 'OVER_DAILY_MAX'].includes(r.exceedReason));
      }
    }),
    { numRuns: RUNS },
  );
});

test('the status-only check (no amount) agrees with a minimal dose', () => {
  fc.assert(
    fc.property(ingredientArb, historyArb, (ing, raw) => {
      const history = toHistory(ing, raw);
      const plain = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ });
      if (plain.status === 'OK') {
        const tiny = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, enteredMg: 0.001 });
        assert.equal(tiny.status, 'OK');
      }
      if (plain.nextAllowedAt !== null) {
        assert.ok(plain.nextAllowedAt > NOW);
      }
    }),
    { numRuns: RUNS },
  );
});

test('weight has no effect in tracker mode, across 5 kg to 80 kg', () => {
  fc.assert(
    fc.property(ingredientArb, historyArb, fc.integer({ min: 1, max: 1500 }), fc.double({ min: 5, max: 80, noNaN: true }), (ing, raw, mg, kg) => {
      const history = toHistory(ing, raw);
      const a = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, enteredMg: mg });
      const b = checkIngredient({ ingredient: ing, rules: RULES, history, now: NOW, child: { ...CHILD, weightKg: kg }, timeZone: TZ, enteredMg: mg });
      assert.deepEqual(a, b);
    }),
    { numRuns: 500 },
  );
});
