/* The parent's own gap between doses, and the count-up after it.

   Fixture numbers only (alpha: 4 h minimum, 6 h top of the usual range),
   never the shipped rules, so these tests keep their meaning when a
   reviewer changes data/rules.json. The claim they hold: a chosen gap can
   only ever be LONGER than the rules' minimum, and it never turns a stop
   into a go. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { checkIngredient } from '../../js/engine/checkDose.js';
import { gapChoices, clampGap, planGap, pickHero, GAP_STEP_MINUTES } from '../../js/engine/gap.js';
import { RULES, NOW, MIN, HOUR, DAY, CHILD, TZ, dose } from './fixtures.mjs';

const ALPHA = { ...RULES.ingredients.alpha, usualIntervalMaxMinutes: 360 };
const RANGED = { ...RULES, ingredients: { ...RULES.ingredients, alpha: ALPHA } };

const check = (history, over = {}) =>
  checkIngredient({ ingredient: 'alpha', rules: RANGED, history, now: NOW, child: CHILD, timeZone: TZ, ...over });
const plan = (history, gapMinutes, over = {}) => {
  const now = over.now ?? NOW;
  return planGap({ check: check(history, over), rule: ALPHA, gapMinutes, now });
};

describe('gapChoices', () => {
  test('runs from the minimum to the top of the usual range in half-hour steps', () => {
    assert.equal(GAP_STEP_MINUTES, 30);
    assert.deepEqual(gapChoices(ALPHA), [240, 270, 300, 330, 360]);
  });

  test('a rule with no range offers only the minimum', () => {
    assert.deepEqual(gapChoices(RULES.ingredients.alpha), [240]);
  });

  test('the top of the range is always offered, even off the step', () => {
    assert.deepEqual(gapChoices({ ...ALPHA, usualIntervalMaxMinutes: 350 }), [240, 270, 300, 330, 350]);
  });

  test('a range below the minimum is ignored, never offered', () => {
    assert.deepEqual(gapChoices({ ...ALPHA, usualIntervalMaxMinutes: 100 }), [240]);
  });
});

describe('clampGap', () => {
  test('nothing chosen means the minimum', () => {
    for (const v of [undefined, null, NaN, Infinity, 'x']) assert.equal(clampGap(ALPHA, v), 240);
  });

  test('never below the minimum, never above the top of the range', () => {
    assert.equal(clampGap(ALPHA, 30), 240);
    assert.equal(clampGap(ALPHA, 239), 240);
    assert.equal(clampGap(ALPHA, 361), 360);
    assert.equal(clampGap(ALPHA, 9999), 360);
  });

  test('a value inside the range is kept', () => {
    assert.equal(clampGap(ALPHA, 300), 300);
    assert.equal(clampGap(ALPHA, 240), 240);
    assert.equal(clampGap(ALPHA, 360), 360);
  });

  test('a rule with no range always gives the minimum', () => {
    assert.equal(clampGap(RULES.ingredients.alpha, 300), 240);
  });

  test('property: the result is always within [minimum, max(minimum, top)]', () => {
    fc.assert(fc.property(fc.oneof(fc.integer({ min: -1000, max: 2000 }), fc.double({ noNaN: false })), (v) => {
      const g = clampGap(ALPHA, v);
      return g >= 240 && g <= 360;
    }), { numRuns: 500 });
  });
});

describe('planGap: phases', () => {
  test('no doses in the last 24 hours is idle: nothing to count from', () => {
    const p = plan([], 240);
    assert.equal(p.phase, 'idle');
    assert.equal(p.targetAt, null);
    assert.equal(p.readySince, null);
  });

  test('a dose from two days ago is idle too', () => {
    const p = plan([dose('alpha', 100, 2 * DAY)], 240);
    assert.equal(p.phase, 'idle');
  });

  test('an ingredient with no rules has no plan', () => {
    const c = checkIngredient({ ingredient: 'zeta', rules: RANGED, history: [], now: NOW, child: CHILD, timeZone: TZ });
    const p = planGap({ check: c, rule: undefined, gapMinutes: 300, now: NOW });
    assert.equal(p.phase, 'none');
    assert.equal(p.targetAt, null);
  });

  test('under the minimum age is blocked', () => {
    const p = plan([], 240, { child: { id: 'b', dateOfBirth: '2026-09-01' } });
    assert.equal(p.phase, 'blocked');
    assert.equal(p.targetAt, null);
  });

  test('before the rules allow it: wait, counting to the rules time when the gap is the minimum', () => {
    const last = NOW - HOUR;
    const p = plan([dose('alpha', 100, HOUR)], 240);
    assert.equal(p.phase, 'wait');
    assert.equal(p.ruleAt, last + 240 * MIN);
    assert.equal(p.targetAt, last + 240 * MIN);
    assert.equal(p.gapMinutes, 240);
  });

  test('before the rules allow it, with a longer gap: the countdown runs to the parent\'s time', () => {
    const last = NOW - HOUR;
    const p = plan([dose('alpha', 100, HOUR)], 330);
    assert.equal(p.phase, 'wait');
    assert.equal(p.ruleAt, last + 240 * MIN);
    assert.equal(p.targetAt, last + 330 * MIN);
  });

  test('past the rules\' time but before the parent\'s: early, and the rules already allow it', () => {
    const last = NOW - 270 * MIN;
    const p = plan([dose('alpha', 100, 270 * MIN)], 300);
    assert.equal(p.phase, 'early');
    assert.equal(p.targetAt, last + 300 * MIN);
    assert.equal(p.ruleAt, null);
    assert.equal(p.readySince, null);
    assert.equal(check([dose('alpha', 100, 270 * MIN)]).status, 'OK');
  });

  test('after the parent\'s time: ready, counting up from the moment the countdown ended', () => {
    const last = NOW - 330 * MIN;
    const p = plan([dose('alpha', 100, 330 * MIN)], 300);
    assert.equal(p.phase, 'ready');
    assert.equal(p.readySince, last + 300 * MIN);
    assert.equal(p.targetAt, last + 300 * MIN);
  });

  test('exactly at the parent\'s time is ready, with zero elapsed', () => {
    const p = plan([dose('alpha', 100, 300 * MIN)], 300);
    assert.equal(p.phase, 'ready');
    assert.equal(p.readySince, NOW);
  });

  test('with the default gap, ready counts up from when the rules allowed it', () => {
    const last = NOW - 5 * HOUR;
    const p = plan([dose('alpha', 100, 5 * HOUR)], 240);
    assert.equal(p.phase, 'ready');
    assert.equal(p.readySince, last + 240 * MIN);
  });

  test('the 24-hour limit reached: limit, and the time is the later of the limit and the gap', () => {
    const history = [dose('alpha', 100, 23 * HOUR), dose('alpha', 100, 17 * HOUR), dose('alpha', 100, 11 * HOUR), dose('alpha', 100, 5 * HOUR)];
    const c = check(history);
    assert.equal(c.status, 'DAILY_LIMIT_REACHED');
    const p = planGap({ check: c, rule: ALPHA, gapMinutes: 240, now: NOW });
    assert.equal(p.phase, 'limit');
    assert.equal(p.targetAt, c.nextAllowedAt);
    // a gap longer than the limit wait pushes the target out
    const long = planGap({ check: c, rule: ALPHA, gapMinutes: 360, now: NOW });
    assert.equal(long.targetAt, Math.max(c.nextAllowedAt, NOW - 5 * HOUR + 360 * MIN));
  });

  test('ready after a limit clears later than the gap: the count-up starts when the limit cleared', () => {
    // Four doses; the oldest leaves the 24 h window ten minutes after NOW.
    const history = [dose('alpha', 100, 23 * HOUR + 50 * MIN), dose('alpha', 100, 18 * HOUR), dose('alpha', 100, 12 * HOUR), dose('alpha', 100, 5 * HOUR)];
    const later = NOW + 30 * MIN;
    const c = check(history, { now: later });
    assert.equal(c.status, 'OK');
    const p = planGap({ check: c, rule: ALPHA, gapMinutes: 240, now: later });
    assert.equal(p.phase, 'ready');
    assert.equal(p.readySince, NOW + 10 * MIN);
  });

  test('a gap outside the range is clamped before it is used', () => {
    const p = plan([dose('alpha', 100, HOUR)], 9999);
    assert.equal(p.gapMinutes, 360);
    const q = plan([dose('alpha', 100, HOUR)], 5);
    assert.equal(q.gapMinutes, 240);
  });

  test('property: the plan never allows earlier than the rules do', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ ago: fc.integer({ min: 0, max: 40 * HOUR }), mg: fc.integer({ min: 1, max: 900 }) }), { maxLength: 8 }),
      fc.integer({ min: 0, max: 500 }),
      (raw, gap) => {
        const history = raw.map((r, i) => ({ id: `p${i}`, givenAt: NOW - r.ago, components: [{ ingredient: 'alpha', mg: r.mg }] }));
        const c = check(history);
        const p = planGap({ check: c, rule: ALPHA, gapMinutes: gap, now: NOW });
        if (c.nextAllowedAt !== null && p.targetAt !== null && p.targetAt < c.nextAllowedAt) return false;
        if (p.phase === 'ready' && c.status !== 'OK') return false;
        if (p.phase === 'ready' && p.readySince !== null && p.readySince > NOW) return false;
        if (p.targetAt !== null && c.lastDose && p.targetAt < c.lastDose.givenAt + 240 * MIN) return false;
        return true;
      },
    ), { numRuns: 800 });
  });
});

describe('pickHero: which medicine drives the big button', () => {
  const e = (ingredient, over) => ({ ingredient, plan: { phase: 'idle', ruleAt: null, targetAt: null, readySince: null, gapMinutes: 240, ...over } });

  test('nothing to show gives null', () => {
    assert.equal(pickHero([]), null);
  });

  test('a medicine in use leads over one not given in the last 24 hours', () => {
    const hero = pickHero([e('a', { phase: 'idle' }), e('b', { phase: 'wait', targetAt: NOW + HOUR })]);
    assert.equal(hero.ingredient, 'b');
  });

  test('ready beats every other state', () => {
    const hero = pickHero([e('a', { phase: 'wait', targetAt: NOW + HOUR }), e('b', { phase: 'ready', readySince: NOW - MIN }), e('c', { phase: 'idle' })]);
    assert.equal(hero.state, 'ready');
    assert.equal(hero.ingredient, 'b');
  });

  test('of two ready, the one allowed for longest', () => {
    const hero = pickHero([e('a', { phase: 'ready', readySince: NOW - MIN }), e('b', { phase: 'ready', readySince: NOW - 3 * HOUR })]);
    assert.equal(hero.ingredient, 'b');
  });

  test('order after ready: early, wait, limit, blocked, then idle (not in use), none', () => {
    const order = ['early', 'wait', 'limit', 'blocked', 'idle', 'none'];
    for (let i = 0; i < order.length - 1; i += 1) {
      const hero = pickHero([e('z', { phase: order[i + 1] }), e('a', { phase: order[i] })]);
      assert.equal(hero.state, order[i], `${order[i]} should beat ${order[i + 1]}`);
    }
  });

  test('of two waiting, the one that ends soonest', () => {
    const hero = pickHero([e('a', { phase: 'wait', targetAt: NOW + 3 * HOUR }), e('b', { phase: 'wait', targetAt: NOW + HOUR })]);
    assert.equal(hero.ingredient, 'b');
  });

  test('a limit with no end time sorts after one with an end time', () => {
    const hero = pickHero([e('a', { phase: 'limit', targetAt: null }), e('b', { phase: 'limit', targetAt: NOW + HOUR })]);
    assert.equal(hero.ingredient, 'b');
  });

  test('ties fall back to the ingredient name, so the answer is stable', () => {
    assert.equal(pickHero([e('b', { phase: 'idle' }), e('a', { phase: 'idle' })]).ingredient, 'a');
  });
});

describe('the rules file refuses a range that could shorten the minimum', () => {
  test('a top below the minimum, or not a number, stops the app loading the rule', async () => {
    const { assertRule } = await import('../../js/engine/checkDose.js');
    const rule = RULES.ingredients.alpha;
    assert.doesNotThrow(() => assertRule('alpha', { ...rule, usualIntervalMaxMinutes: 360 }));
    assert.doesNotThrow(() => assertRule('alpha', { ...rule, usualIntervalMaxMinutes: rule.minIntervalMinutes }));
    assert.throws(() => assertRule('alpha', { ...rule, usualIntervalMaxMinutes: rule.minIntervalMinutes - 1 }), /usualIntervalMaxMinutes/);
    assert.throws(() => assertRule('alpha', { ...rule, usualIntervalMaxMinutes: 'six' }), /usualIntervalMaxMinutes/);
    assert.throws(() => assertRule('alpha', { ...rule, usualIntervalMaxMinutes: NaN }), /usualIntervalMaxMinutes/);
  });
});

describe('planGap: unusual answers from the engine are handled, not trusted', () => {
  const synth = (over) => ({ status: 'OK', nextAllowedAt: null, dosesInLast24h: 1, mgInLast24h: 100, remainingMgIn24h: 0, warnings: [], lastDose: { doseId: 'x', givenAt: NOW - HOUR, mg: 100 }, ...over });
  const go = (c) => planGap({ check: c, rule: ALPHA, gapMinutes: 240, now: NOW });

  test('an exceeds-limit answer is a limit', () => {
    assert.equal(go(synth({ status: 'EXCEEDS_LIMIT', exceedReason: 'WOULD_EXCEED_24H', nextAllowedAt: NOW + HOUR })).phase, 'limit');
  });

  test('not allowed and no time given: there is no target to count to', () => {
    const p = go(synth({ status: 'TOO_SOON', nextAllowedAt: null }));
    assert.equal(p.phase, 'wait');
    assert.equal(p.targetAt, null);
  });

  test('not allowed, a time given, no last dose: the rules\' time stands', () => {
    const { lastDose: _l, ...noLast } = synth({ status: 'DAILY_LIMIT_REACHED', nextAllowedAt: NOW + HOUR });
    assert.equal(go(noLast).targetAt, NOW + HOUR);
  });

  test('ready with no allowedSince (an age boundary crossed): counts up from the parent\'s time', () => {
    const p = go(synth({ lastDose: { doseId: 'x', givenAt: NOW - 6 * HOUR, mg: 100 } }));
    assert.equal(p.phase, 'ready');
    assert.equal(p.readySince, NOW - 6 * HOUR + 240 * MIN);
  });

  test('a ready hero with no start time sorts last among ready', () => {
    const e = (ingredient, readySince) => ({ ingredient, plan: { phase: 'ready', ruleAt: null, targetAt: null, readySince, gapMinutes: 240 } });
    assert.equal(pickHero([e('a', null), e('b', NOW - HOUR)]).ingredient, 'b');
  });
});
