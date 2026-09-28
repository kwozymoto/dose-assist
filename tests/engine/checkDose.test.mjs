import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkDose } from '../../js/engine/checkDose.js';
import { componentsForAmount } from '../../js/engine/amounts.js';
import { RULES, NOW, HOUR, DAY, CHILD, TZ, dose } from './fixtures.mjs';

const base = (over = {}) => ({ rules: RULES, history: [], now: NOW, child: CHILD, timeZone: TZ, ...over });

describe('checkDose over a product', () => {
  test('a single-ingredient product is the ingredient check', () => {
    const r = checkDose(base({ components: [{ ingredient: 'alpha', mg: 250 }] }));
    assert.equal(r.status, 'OK');
    assert.equal(r.nextAllowedAt, null);
    assert.deepEqual(Object.keys(r.perIngredient), ['alpha']);
  });

  test('a combination product takes the most severe status', () => {
    const history = [dose('beta', 200, 2 * HOUR)];
    const r = checkDose(base({ history, components: [{ ingredient: 'alpha', mg: 250 }, { ingredient: 'beta', mg: 100 }] }));
    assert.equal(r.perIngredient.alpha.status, 'OK');
    assert.equal(r.perIngredient.beta.status, 'TOO_SOON');
    assert.equal(r.status, 'TOO_SOON');
    assert.equal(r.nextAllowedAt, history[0].givenAt + 6 * HOUR);
  });

  test('the product time is the latest of its ingredients', () => {
    const history = [dose('alpha', 100, 1 * HOUR), dose('beta', 100, 1 * HOUR)];
    const r = checkDose(base({ history, components: [{ ingredient: 'alpha', mg: 100 }, { ingredient: 'beta', mg: 100 }] }));
    assert.equal(r.nextAllowedAt, NOW - HOUR + 6 * HOUR);
  });

  test('DAILY_LIMIT_REACHED on one ingredient outranks TOO_SOON on another', () => {
    const history = [
      dose('alpha', 100, 20 * HOUR), dose('alpha', 100, 15 * HOUR), dose('alpha', 100, 10 * HOUR), dose('alpha', 100, 5 * HOUR),
      dose('beta', 100, HOUR),
    ];
    const r = checkDose(base({ history, components: [{ ingredient: 'alpha', mg: 100 }, { ingredient: 'beta', mg: 100 }] }));
    assert.equal(r.status, 'DAILY_LIMIT_REACHED');
    assert.equal(r.nextAllowedAt, NOW - HOUR + 6 * HOUR);
  });

  test('a never-allowed ingredient makes the whole product never allowed', () => {
    const history = [dose('alpha', 100, HOUR)];
    const r = checkDose(base({ history, components: [{ ingredient: 'alpha', mg: 100 }, { ingredient: 'beta', mg: 500 }] }));
    assert.equal(r.status, 'EXCEEDS_LIMIT');
    assert.equal(r.nextAllowedAt, null);
  });

  test('blocked ingredient blocks the product', () => {
    const child = { id: 'b', dateOfBirth: '2026-09-01' };
    const r = checkDose(base({ child, components: [{ ingredient: 'alpha', mg: 100 }] }));
    assert.equal(r.status, 'BLOCKED');
    assert.equal(r.blockReason, 'UNDER_MIN_AGE');
  });

  test('the same ingredient listed twice is checked as one amount', () => {
    const r = checkDose(base({ components: [{ ingredient: 'beta', mg: 300 }, { ingredient: 'beta', mg: 200 }] }));
    assert.equal(r.perIngredient.beta.status, 'EXCEEDS_LIMIT');
    assert.equal(r.perIngredient.beta.exceedReason, 'SINGLE_DOSE');
  });

  test('warnings are the union, without repeats', () => {
    const rules = { ...RULES, reviewedBy: null, reviewedAt: null };
    const r = checkDose(base({ rules, components: [{ ingredient: 'alpha', mg: 1 }, { ingredient: 'beta', mg: 1 }] }));
    assert.deepEqual(r.warnings.filter((w) => w === 'RULES_NOT_REVIEWED'), ['RULES_NOT_REVIEWED']);
  });

  test('a product with no components throws', () => {
    assert.throws(() => checkDose(base({ components: [] })), /components/);
  });

  test('statusNow (no amount) uses DAILY_LIMIT_REACHED for mg at the cap', () => {
    const history = [dose('alpha', 4000, 23 * HOUR)];
    const r = checkDose(base({ history, components: [{ ingredient: 'alpha' }] }));
    assert.equal(r.status, 'DAILY_LIMIT_REACHED');
    assert.equal(r.nextAllowedAt, history[0].givenAt + DAY);
  });
});

describe('componentsForAmount', () => {
  const liquid = { form: 'liquid', components: [{ ingredient: 'paracetamol', strengthMg: 250, strengthPer: 5 }] };
  const tablet = { form: 'tablet', components: [{ ingredient: 'paracetamol', strengthMg: 500, strengthPer: 1 }] };
  const combo = {
    form: 'liquid',
    components: [
      { ingredient: 'paracetamol', strengthMg: 120, strengthPer: 5 },
      { ingredient: 'ibuprofen', strengthMg: 100, strengthPer: 5 },
    ],
  };

  test('mL of a liquid to mg', () => {
    assert.deepEqual(componentsForAmount(liquid, 5), [{ ingredient: 'paracetamol', mg: 250 }]);
    assert.deepEqual(componentsForAmount(liquid, 7.5), [{ ingredient: 'paracetamol', mg: 375 }]);
    assert.deepEqual(componentsForAmount(liquid, 0.1), [{ ingredient: 'paracetamol', mg: 5 }]);
  });

  test('120 mg / 5 mL at 2.5 mL', () => {
    const one = { form: 'liquid', components: [combo.components[0]] };
    assert.deepEqual(componentsForAmount(one, 2.5), [{ ingredient: 'paracetamol', mg: 60 }]);
  });

  test('tablets to mg', () => {
    assert.deepEqual(componentsForAmount(tablet, 0.5), [{ ingredient: 'paracetamol', mg: 250 }]);
    assert.deepEqual(componentsForAmount(tablet, 2), [{ ingredient: 'paracetamol', mg: 1000 }]);
  });

  test('a combination yields one component per ingredient', () => {
    assert.deepEqual(componentsForAmount(combo, 5), [
      { ingredient: 'paracetamol', mg: 120 },
      { ingredient: 'ibuprofen', mg: 100 },
    ]);
  });

  test('keeps three decimal places and does not drift', () => {
    const odd = { form: 'liquid', components: [{ ingredient: 'x', strengthMg: 100, strengthPer: 3 }] };
    assert.deepEqual(componentsForAmount(odd, 1), [{ ingredient: 'x', mg: 33.333 }]);
    assert.deepEqual(componentsForAmount(odd, 0.3), [{ ingredient: 'x', mg: 10 }]);
  });

  test('rejects bad amounts and bad strengths', () => {
    for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => componentsForAmount(liquid, bad), /amount/);
    const broken = { form: 'liquid', components: [{ ingredient: 'x', strengthMg: 0, strengthPer: 5 }] };
    assert.throws(() => componentsForAmount(broken, 5), /strength/);
    const noPer = { form: 'liquid', components: [{ ingredient: 'x', strengthMg: 10, strengthPer: 0 }] };
    assert.throws(() => componentsForAmount(noPer, 5), /strength/);
    assert.throws(() => componentsForAmount({ form: 'liquid', components: [] }, 5), /components/);
  });
});
