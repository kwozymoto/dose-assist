import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkIngredient } from '../../js/engine/checkDose.js';
import { RULES, NOW, MIN, HOUR, DAY, dose, input } from './fixtures.mjs';

describe('no history', () => {
  test('OK with nothing to wait for', () => {
    const r = checkIngredient(input());
    assert.equal(r.status, 'OK');
    assert.equal(r.nextAllowedAt, null);
    assert.equal(r.dosesInLast24h, 0);
    assert.equal(r.mgInLast24h, 0);
    assert.equal(r.remainingMgIn24h, 4000);
    assert.equal(r.lastDose, undefined);
  });
});

describe('minimum interval', () => {
  test('one minute before the interval is TOO_SOON', () => {
    const d = dose('alpha', 250, 4 * HOUR - MIN);
    const r = checkIngredient(input({ history: [d] }));
    assert.equal(r.status, 'TOO_SOON');
    assert.equal(r.nextAllowedAt, d.givenAt + 4 * HOUR);
    assert.equal(r.nextAllowedAt - NOW, MIN);
  });

  test('exactly at the interval is OK', () => {
    const r = checkIngredient(input({ history: [dose('alpha', 250, 4 * HOUR)] }));
    assert.equal(r.status, 'OK');
    assert.equal(r.nextAllowedAt, null);
  });

  test('one ms before the interval is still TOO_SOON', () => {
    const r = checkIngredient(input({ history: [dose('alpha', 250, 4 * HOUR - 1)] }));
    assert.equal(r.status, 'TOO_SOON');
  });

  test('interval is measured from the latest dose, not the first', () => {
    const early = dose('alpha', 250, 10 * HOUR);
    const late = dose('alpha', 250, 1 * HOUR);
    const r = checkIngredient(input({ history: [late, early] }));
    assert.equal(r.status, 'TOO_SOON');
    assert.equal(r.nextAllowedAt, late.givenAt + 4 * HOUR);
    assert.equal(r.lastDose.doseId, late.id);
  });

  test('each ingredient has its own interval', () => {
    const d = dose('beta', 100, 5 * HOUR);
    assert.equal(checkIngredient(input({ ingredient: 'beta', history: [d] })).status, 'TOO_SOON');
    assert.equal(checkIngredient(input({ ingredient: 'alpha', history: [d] })).status, 'OK');
  });
});

describe('rolling 24-hour dose count', () => {
  const four = () => [
    dose('alpha', 100, 20 * HOUR),
    dose('alpha', 100, 15 * HOUR),
    dose('alpha', 100, 10 * HOUR),
    dose('alpha', 100, 5 * HOUR),
  ];

  test('at the maximum count, DAILY_LIMIT_REACHED until the oldest drops out', () => {
    const h = four();
    const r = checkIngredient(input({ history: h }));
    assert.equal(r.status, 'DAILY_LIMIT_REACHED');
    assert.equal(r.dosesInLast24h, 4);
    assert.equal(r.nextAllowedAt, h[0].givenAt + DAY);
    assert.equal(r.nextAllowedAt - NOW, 4 * HOUR);
  });

  test('a dose exactly 24 h ago has dropped out of the window', () => {
    const h = [
      dose('alpha', 100, 24 * HOUR),
      dose('alpha', 100, 18 * HOUR),
      dose('alpha', 100, 12 * HOUR),
      dose('alpha', 100, 6 * HOUR),
    ];
    const r = checkIngredient(input({ history: h }));
    assert.equal(r.dosesInLast24h, 3);
    assert.equal(r.status, 'OK');
  });

  test('a dose 24 h minus one minute ago still counts', () => {
    const h = [
      dose('alpha', 100, 24 * HOUR - MIN),
      dose('alpha', 100, 18 * HOUR),
      dose('alpha', 100, 12 * HOUR),
      dose('alpha', 100, 6 * HOUR),
    ];
    const r = checkIngredient(input({ history: h }));
    assert.equal(r.dosesInLast24h, 4);
    assert.equal(r.status, 'DAILY_LIMIT_REACHED');
    assert.equal(r.nextAllowedAt - NOW, MIN);
  });

  test('over the maximum (e.g. an override), waits for enough doses to drop out', () => {
    const h = [
      dose('alpha', 100, 23 * HOUR),
      dose('alpha', 100, 22 * HOUR),
      dose('alpha', 100, 12 * HOUR),
      dose('alpha', 100, 8 * HOUR),
      dose('alpha', 100, 5 * HOUR),
    ];
    const r = checkIngredient(input({ history: h }));
    assert.equal(r.dosesInLast24h, 5);
    // Two must drop out to get below 4: the second-oldest leaves at 22 h + 24 h.
    assert.equal(r.nextAllowedAt, h[1].givenAt + DAY);
  });

  test('never uses calendar days: doses either side of local midnight all count', () => {
    // NOW is 12:00 local. Doses from 13:00 yesterday to 07:00 today.
    const h = [
      dose('alpha', 100, 23 * HOUR),
      dose('alpha', 100, 18 * HOUR),
      dose('alpha', 100, 13 * HOUR),
      dose('alpha', 100, 5 * HOUR),
    ];
    assert.equal(checkIngredient(input({ history: h })).status, 'DAILY_LIMIT_REACHED');
  });
});

describe('24-hour mg total', () => {
  test('already at the mg cap is DAILY_LIMIT_REACHED', () => {
    const h = [dose('alpha', 2000, 20 * HOUR), dose('alpha', 2000, 6 * HOUR)];
    const r = checkIngredient(input({ history: h }));
    assert.equal(r.mgInLast24h, 4000);
    assert.equal(r.remainingMgIn24h, 0);
    assert.equal(r.status, 'DAILY_LIMIT_REACHED');
    assert.equal(r.nextAllowedAt, h[0].givenAt + DAY);
  });

  test('a dose that would take the total over the cap is EXCEEDS_LIMIT with a time', () => {
    // Amounts over the single cap can be in history (a doctor's instruction).
    const h = [dose('alpha', 1500, 20 * HOUR), dose('alpha', 1000, 14 * HOUR), dose('alpha', 1000, 6 * HOUR)];
    const r = checkIngredient(input({ history: h, enteredMg: 500 }));
    assert.equal(r.status, 'OK', '3500 + 500 is exactly the cap, which is allowed');
    const r2 = checkIngredient(input({ history: h, enteredMg: 500.001 }));
    assert.equal(r2.status, 'EXCEEDS_LIMIT');
    assert.equal(r2.exceedReason, 'WOULD_EXCEED_24H');
    assert.equal(r2.nextAllowedAt, h[0].givenAt + DAY);
  });

  test('enough doses must drop out to fit the entered amount', () => {
    const h = [
      dose('alpha', 900, 23 * HOUR),
      dose('alpha', 900, 18 * HOUR),
      dose('alpha', 900, 12 * HOUR),
    ];
    // 2700 in window; entering 1000 over a 3000 cap... use beta-like numbers via enteredMg on alpha cap 4000:
    const r = checkIngredient(input({ history: h, enteredMg: 1000 }));
    assert.equal(r.status, 'OK'); // 3700 <= 4000
    const big = [...h, dose('alpha', 900, 6 * HOUR)]; // 3600, count 4 -> count limit too
    const r2 = checkIngredient(input({ history: big, enteredMg: 1000 }));
    assert.equal(r2.status, 'DAILY_LIMIT_REACHED');
    // count needs the oldest out (23 h ago -> +1 h). mg: 3600-900 = 2700 + 1000 fits then too.
    assert.equal(r2.nextAllowedAt, big[0].givenAt + DAY);
  });

  test('mg drop-out can be later than count drop-out', () => {
    // beta: cap 1200, max 3 doses. 600 + 500 already given (history can hold
    // amounts over the single cap, e.g. a doctor's instruction); 400 more is over.
    const h = [dose('beta', 600, 20 * HOUR), dose('beta', 500, 7 * HOUR)];
    const r = checkIngredient(input({ ingredient: 'beta', history: h, enteredMg: 400 }));
    assert.equal(r.status, 'EXCEEDS_LIMIT');
    assert.equal(r.exceedReason, 'WOULD_EXCEED_24H');
    // 1100 + 400 = 1500 > 1200. After the 600 drops out: 500 + 400 = 900. Needs 20 h ago + 24 h.
    assert.equal(r.nextAllowedAt, h[0].givenAt + DAY);
  });

  test('the next time is the latest of interval, count and mg', () => {
    // beta interval 6 h. Last dose 1 h ago; oldest 23.5 h ago.
    const h = [dose('beta', 400, 23.5 * HOUR), dose('beta', 400, 12 * HOUR), dose('beta', 400, 1 * HOUR)];
    const r = checkIngredient(input({ ingredient: 'beta', history: h, enteredMg: 400 }));
    assert.equal(r.status, 'DAILY_LIMIT_REACHED');
    assert.equal(r.nextAllowedAt, h[2].givenAt + 6 * HOUR);
  });

  test('floating-point totals do not trip the cap', () => {
    // 0.1 + 0.2 style drift: many small amounts summing to exactly the cap.
    const h = [];
    for (let i = 0; i < 3; i += 1) h.push(dose('alpha', 1333.333, (20 - i * 5) * HOUR));
    const r = checkIngredient(input({ history: h, enteredMg: 0.001 }));
    assert.equal(r.mgInLast24h, 3999.999);
    assert.equal(r.status, 'OK');
  });
});

describe('per-dose limits on an entered amount', () => {
  test('over the single-dose maximum is EXCEEDS_LIMIT and never allowed', () => {
    const r = checkIngredient(input({ enteredMg: 1000.001 }));
    assert.equal(r.status, 'EXCEEDS_LIMIT');
    assert.equal(r.exceedReason, 'SINGLE_DOSE');
    assert.equal(r.nextAllowedAt, null);
  });

  test('exactly the single-dose maximum is allowed', () => {
    assert.equal(checkIngredient(input({ enteredMg: 1000 })).status, 'OK');
  });

  test('single-dose excess outranks a too-soon interval', () => {
    const r = checkIngredient(input({ history: [dose('alpha', 100, HOUR)], enteredMg: 5000 }));
    assert.equal(r.status, 'EXCEEDS_LIMIT');
    assert.equal(r.exceedReason, 'SINGLE_DOSE');
  });

  test('an amount over the whole 24 h cap is never allowed even when single cap is higher', () => {
    const rules = structuredClone(RULES);
    rules.ingredients.alpha.maxSingleMg = 9000;
    const r = checkIngredient(input({ rules, enteredMg: 4500 }));
    assert.equal(r.status, 'EXCEEDS_LIMIT');
    assert.equal(r.exceedReason, 'OVER_DAILY_MAX');
    assert.equal(r.nextAllowedAt, null);
  });

  test('rejects nonsense amounts', () => {
    for (const bad of [0, -5, NaN, Infinity, '250']) {
      assert.throws(() => checkIngredient(input({ enteredMg: bad })), /enteredMg/);
    }
  });
});

describe('age', () => {
  const at = (days) => {
    // DOB such that the child is `days` old on NOW's local date (2026-10-14 NZ).
    const d = new Date(Date.UTC(2026, 9, 14) - days * DAY);
    return d.toISOString().slice(0, 10);
  };

  test('under the minimum age (3 months minus one day) is BLOCKED', () => {
    const r = checkIngredient(input({ child: { id: 'b', dateOfBirth: at(89) } }));
    assert.equal(r.status, 'BLOCKED');
    assert.equal(r.blockReason, 'UNDER_MIN_AGE');
    assert.equal(r.nextAllowedAt, null);
  });

  test('exactly the minimum age is allowed', () => {
    assert.equal(checkIngredient(input({ child: { id: 'b', dateOfBirth: at(90) } })).status, 'OK');
  });

  test('age uses the local date, not the UTC date', () => {
    // 2026-10-14 00:30 NZDT is still 2026-10-13 in UTC.
    const now = Date.UTC(2026, 9, 13, 11, 30);
    const r = checkIngredient(input({ now, child: { id: 'b', dateOfBirth: '2026-07-16' } }));
    // 2026-07-16 -> 2026-10-14 is 90 days.
    assert.equal(r.status, 'OK');
  });

  test('a date of birth in the future is BLOCKED', () => {
    const r = checkIngredient(input({ child: { id: 'b', dateOfBirth: '2027-01-01' } }));
    assert.equal(r.status, 'BLOCKED');
  });

  test('blocked outranks everything else', () => {
    const r = checkIngredient(input({ child: { id: 'b', dateOfBirth: at(10) }, enteredMg: 99999 }));
    assert.equal(r.status, 'BLOCKED');
  });

  test('missing date of birth warns and does not block', () => {
    const r = checkIngredient(input({ child: { id: 'b' } }));
    assert.equal(r.status, 'OK');
    assert.ok(r.warnings.includes('AGE_UNKNOWN'));
  });

  test('malformed date of birth throws', () => {
    assert.throws(() => checkIngredient(input({ child: { id: 'b', dateOfBirth: '14/10/2026' } })), /dateOfBirth/);
  });
});

describe('history handling', () => {
  test('soft-deleted doses do not count', () => {
    const d = dose('alpha', 250, HOUR, { deletedAt: NOW - 30 * MIN });
    const r = checkIngredient(input({ history: [d] }));
    assert.equal(r.status, 'OK');
    assert.equal(r.dosesInLast24h, 0);
  });

  test('two caregivers logging within minutes are both counted', () => {
    const a = dose('alpha', 250, 12 * MIN, { givenBy: 'Mum' });
    const b = dose('alpha', 250, 10 * MIN, { givenBy: 'Dad' });
    const r = checkIngredient(input({ history: [a, b] }));
    assert.equal(r.dosesInLast24h, 2);
    assert.equal(r.mgInLast24h, 500);
    assert.equal(r.nextAllowedAt, b.givenAt + 4 * HOUR);
  });

  test('combination products count toward each ingredient', () => {
    const combo = {
      id: 'combo', givenAt: NOW - HOUR,
      components: [{ ingredient: 'alpha', mg: 500 }, { ingredient: 'beta', mg: 200 }],
    };
    const a = checkIngredient(input({ ingredient: 'alpha', history: [combo] }));
    const b = checkIngredient(input({ ingredient: 'beta', history: [combo] }));
    assert.equal(a.mgInLast24h, 500);
    assert.equal(a.status, 'TOO_SOON');
    assert.equal(b.mgInLast24h, 200);
    assert.equal(b.status, 'TOO_SOON');
  });

  test('one dose record with the same ingredient twice counts once as a dose, both mg', () => {
    const d = { id: 'x', givenAt: NOW - HOUR, components: [{ ingredient: 'alpha', mg: 200 }, { ingredient: 'alpha', mg: 300 }] };
    const r = checkIngredient(input({ history: [d] }));
    assert.equal(r.dosesInLast24h, 1);
    assert.equal(r.mgInLast24h, 500);
  });

  test('history order does not matter', () => {
    const h = [dose('alpha', 100, 5 * HOUR), dose('alpha', 100, 20 * HOUR), dose('alpha', 100, 10 * HOUR), dose('alpha', 100, 15 * HOUR)];
    const r1 = checkIngredient(input({ history: h }));
    const r2 = checkIngredient(input({ history: [...h].reverse() }));
    assert.deepEqual(r1, r2);
  });

  test('a dose recorded in the future (clock skew) counts and warns', () => {
    const d = dose('alpha', 250, -10 * MIN);
    const r = checkIngredient(input({ history: [d] }));
    assert.equal(r.status, 'TOO_SOON');
    assert.equal(r.nextAllowedAt, d.givenAt + 4 * HOUR);
    assert.ok(r.warnings.includes('DOSE_IN_FUTURE'));
  });

  test('does not mutate its inputs', () => {
    const h = [dose('alpha', 100, 5 * HOUR), dose('alpha', 100, 20 * HOUR)];
    const copy = structuredClone(h);
    const rules = structuredClone(RULES);
    checkIngredient(input({ history: h, rules }));
    assert.deepEqual(h, copy);
    assert.deepEqual(rules, RULES);
  });
});

describe('warnings', () => {
  test('unreviewed rules are flagged', () => {
    const rules = { ...RULES, reviewedBy: null, reviewedAt: null };
    assert.ok(checkIngredient(input({ rules })).warnings.includes('RULES_NOT_REVIEWED'));
    assert.ok(!checkIngredient(input()).warnings.includes('RULES_NOT_REVIEWED'));
  });

  test('unverified rule values are flagged', () => {
    const rules = structuredClone(RULES);
    rules.ingredients.alpha.unverified = ['minIntervalMinutes'];
    assert.ok(checkIngredient(input({ rules })).warnings.includes('RULE_UNVERIFIED'));
  });

  test('an ingredient with no rules is OK with a warning and no times', () => {
    const d = dose('gamma', 5, 10 * MIN);
    const r = checkIngredient(input({ ingredient: 'gamma', history: [d], enteredMg: 5 }));
    assert.equal(r.status, 'OK');
    assert.equal(r.nextAllowedAt, null);
    assert.ok(r.warnings.includes('NO_RULES_FOR_INGREDIENT'));
    assert.equal(r.dosesInLast24h, 1);
    assert.equal(r.remainingMgIn24h, null);
  });

  test('LONG_USE once a continuous course passes the advice threshold', () => {
    const h = [];
    for (let t = 50; t >= 2; t -= 6) h.push(dose('alpha', 100, t * HOUR));
    assert.ok(checkIngredient(input({ history: h })).warnings.includes('LONG_USE'));
  });

  test('no LONG_USE when there was a gap of more than 24 h in the course', () => {
    const h = [dose('alpha', 100, 60 * HOUR), dose('alpha', 100, 30 * HOUR), dose('alpha', 100, 5 * HOUR)];
    // Both gaps are over 24 h, so the current course began with the last dose.
    assert.ok(!checkIngredient(input({ history: h })).warnings.includes('LONG_USE'));
  });

  test('no LONG_USE when the course ended more than 24 h ago', () => {
    const h = [];
    for (let t = 90; t >= 30; t -= 6) h.push(dose('alpha', 100, t * HOUR));
    assert.ok(!checkIngredient(input({ history: h })).warnings.includes('LONG_USE'));
  });

  test('no LONG_USE for an ingredient without the threshold', () => {
    const h = [];
    for (let t = 60; t >= 2; t -= 7) h.push(dose('beta', 100, t * HOUR));
    assert.ok(!checkIngredient(input({ ingredient: 'beta', history: h })).warnings.includes('LONG_USE'));
  });
});

describe('input validation', () => {
  test('now must be a finite number', () => {
    assert.throws(() => checkIngredient(input({ now: undefined })), /now/);
    assert.throws(() => checkIngredient(input({ now: new Date() })), /now/);
  });

  test('timeZone is required', () => {
    assert.throws(() => checkIngredient(input({ timeZone: undefined })), /timeZone/);
  });

  test('a dose with a non-finite time throws', () => {
    assert.throws(() => checkIngredient(input({ history: [{ id: 'x', givenAt: NaN, components: [] }] })), /givenAt/);
  });

  test('a component with bad mg throws', () => {
    assert.throws(() => checkIngredient(input({ history: [{ id: 'x', givenAt: NOW, components: [{ ingredient: 'alpha', mg: -1 }] }] })), /mg/);
  });
});
