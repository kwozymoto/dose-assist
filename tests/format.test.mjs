import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime, formatWhen, formatDuration, formatAgo, formatInterval, formatAgeDays,
  formatMg, formatAmount, formatStrength, toLocalInput, fromLocalInput, formatDate, parseAmount, formatClock, formatGap,
} from '../js/format.js';
import { cardStatus } from '../js/status.js';
import { checkIngredient } from '../js/engine/checkDose.js';
import { planGap } from '../js/engine/gap.js';
import { RULES, NOW, MIN, HOUR, TZ, CHILD, dose } from './engine/fixtures.mjs';

const at = (iso) => Date.parse(iso);

describe('formatTime', () => {
  test('12-hour, lower-case, no space', () => {
    assert.equal(formatTime(at('2026-10-14T01:15:00Z'), TZ), '2:15pm');
    assert.equal(formatTime(at('2026-10-13T23:00:00Z'), TZ), '12:00pm');
    assert.equal(formatTime(at('2026-10-13T11:05:00Z'), TZ), '12:05am');
    assert.equal(formatTime(at('2026-10-13T20:09:00Z'), TZ), '9:09am');
  });

  test('across spring forward, wall-clock times are right', () => {
    const given = at('2026-09-26T13:30:00Z');
    assert.equal(formatTime(given, TZ), '1:30am');
    assert.equal(formatTime(given + 4 * HOUR, TZ), '6:30am');
  });

  test('across fall back, wall-clock times are right', () => {
    const given = at('2027-04-03T12:30:00Z');
    assert.equal(formatTime(given, TZ), '1:30am');
    assert.equal(formatTime(given + 4 * HOUR, TZ), '4:30am');
  });
});

describe('formatWhen', () => {
  test('today, tomorrow, yesterday, otherwise a date', () => {
    assert.equal(formatWhen(NOW + 2 * HOUR, NOW, TZ), '2:00pm');
    assert.equal(formatWhen(NOW + 21.7 * HOUR, NOW, TZ), '9:42am tomorrow');
    assert.equal(formatWhen(NOW - 13 * HOUR, NOW, TZ), '11:00pm yesterday');
    assert.equal(formatWhen(NOW - 3 * 24 * HOUR, NOW, TZ), 'Sun 11 Oct, 12:00pm');
  });

  test('tomorrow is by local calendar, across a DST night', () => {
    const now = at('2026-09-26T10:00:00Z'); // 10pm NZST Sat
    assert.equal(formatWhen(at('2026-09-26T17:30:00Z'), now, TZ), '6:30am tomorrow');
  });

  test('formatDate', () => {
    assert.equal(formatDate(NOW, TZ), 'Wed 14 Oct');
  });
});

describe('durations', () => {
  test('formatDuration', () => {
    assert.equal(formatDuration(65 * MIN), '1 h 5 m');
    assert.equal(formatDuration(45 * MIN), '45 m');
    assert.equal(formatDuration(2 * HOUR), '2 h');
    assert.equal(formatDuration(51 * HOUR), '2 d 3 h');
    assert.equal(formatDuration(48 * HOUR), '2 d');
    assert.equal(formatDuration(20 * 1000), 'less than a minute');
  });

  test('countdowns round up and never show zero', () => {
    assert.equal(formatDuration(64 * MIN + 1, { up: true }), '1 h 5 m');
    assert.equal(formatDuration(1, { up: true }), '1 m');
    assert.equal(formatDuration(0, { up: true }), '1 m');
  });

  test('formatAgo', () => {
    assert.equal(formatAgo(NOW - 260 * MIN, NOW), '4 h 20 m ago');
    assert.equal(formatAgo(NOW - 10 * 1000, NOW), 'just now');
    assert.equal(formatAgo(NOW + 5 * MIN, NOW), 'in 5 m');
  });

  test('rule values to words', () => {
    assert.equal(formatInterval(240), '4 hours');
    assert.equal(formatInterval(60), '1 hour');
    assert.equal(formatInterval(90), '1 h 30 m');
    assert.equal(formatAgeDays(90), '3 months');
    assert.equal(formatAgeDays(14), '14 days');
    assert.equal(formatAgeDays(1), '1 day');
  });
});

describe('amounts', () => {
  test('mg, mL, tablets, strengths', () => {
    assert.equal(formatMg(1000), '1,000 mg');
    assert.equal(formatMg(37.5), '37.5 mg');
    assert.equal(formatAmount(5, 'liquid'), '5 mL');
    assert.equal(formatAmount(7.5, 'liquid'), '7.5 mL');
    assert.equal(formatAmount(1, 'tablet'), '1 tablet');
    assert.equal(formatAmount(0.5, 'tablet'), '0.5 tablets');
    assert.equal(formatStrength({ strengthMg: 250, strengthPer: 5 }, 'liquid'), '250 mg / 5 mL');
    assert.equal(formatStrength({ strengthMg: 500, strengthPer: 1 }, 'tablet'), '500 mg tablet');
  });
});

describe('parseAmount', () => {
  test('every amount to two decimals from 0.01 to 20 is accepted exactly', () => {
    for (let i = 1; i <= 2000; i += 1) {
      const text = (i / 100).toFixed(2).replace(/\.?0+$/, '');
      assert.equal(parseAmount(text), Number(text), text);
    }
  });
  test('4.4 and friends (float traps) are accepted', () => {
    for (const t of ['4.4', '4.6', '8.2', '1.1', '2.2', '2.3', '0.1']) assert.equal(parseAmount(t), Number(t));
  });
  test('comma decimals, spaces', () => {
    assert.equal(parseAmount(' 7,5 '), 7.5);
  });
  test('rubbish is refused', () => {
    for (const t of ['', '0', '0.0', '-1', '1.234', '5ml', 'abc', '1e2', '.5', '5.', 'NaN']) assert.equal(parseAmount(t), null, t);
  });
});

describe('datetime-local round trip', () => {
  test('ordinary times round-trip', () => {
    const v = toLocalInput(NOW, TZ);
    assert.equal(v, '2026-10-14T12:00');
    assert.equal(fromLocalInput(v, TZ), NOW);
  });

  test('a time skipped by spring forward reads as the later instant', () => {
    // 2:30am on 27 Sep 2026 never happened in NZ.
    assert.equal(fromLocalInput('2026-09-27T02:30', TZ), at('2026-09-26T14:30:00Z'));
  });

  test('a time repeated at fall back reads as the later instant', () => {
    // 2:30am on 4 Apr 2027 happened twice: 13:30Z (NZDT) and 14:30Z (NZST).
    assert.equal(fromLocalInput('2027-04-04T02:30', TZ), at('2027-04-03T14:30:00Z'));
  });

  test('garbage is null', () => {
    assert.equal(fromLocalInput('14/10/2026 2pm', TZ), null);
  });
});

describe('cardStatus', () => {
  const rule = RULES.ingredients.alpha;
  const status = (history, child = CHILD) =>
    cardStatus(checkIngredient({ ingredient: 'alpha', rules: RULES, history, now: NOW, child, timeZone: TZ }), 'alpha', rule, NOW, TZ);

  test('none', () => {
    const s = status([]);
    assert.equal(s.kind, 'none');
    assert.equal(s.title, 'No alpha in the last 24 hours');
  });

  test('ok', () => {
    const s = status([dose('alpha', 100, 260 * MIN)]);
    assert.equal(s.kind, 'ok');
    assert.equal(s.icon, 'tick');
    assert.equal(s.title, 'Alpha is allowed now');
    assert.equal(s.detail, 'Last: 7:40am (4 h 20 m ago)');
  });

  test('soon', () => {
    const s = status([dose('alpha', 100, 175 * MIN)]);
    assert.equal(s.kind, 'soon');
    assert.equal(s.icon, 'clock');
    assert.equal(s.title, 'Next alpha from 1:05pm');
    assert.ok(s.detail.startsWith('in 1 h 5 m'));
    assert.ok(s.progress > 0.7 && s.progress < 0.75);
  });

  test('limit, by count, names the count and the time', () => {
    const s = status([dose('alpha', 100, 22 * HOUR), dose('alpha', 100, 16 * HOUR), dose('alpha', 100, 10 * HOUR), dose('alpha', 100, 5 * HOUR)]);
    assert.equal(s.kind, 'limit');
    assert.equal(s.icon, 'stop');
    assert.equal(s.title, '24-hour limit reached (4 doses)');
    assert.equal(s.detail, 'Next alpha from 2:00pm');
  });

  test('limit, by mg, names the mg', () => {
    const s = status([dose('alpha', 4000, 20 * HOUR)]);
    assert.equal(s.title, '24-hour limit reached (4,000 mg)');
    assert.equal(s.detail, 'Next alpha from 4:00pm');
  });

  test('blocked by age uses the rule, in words', () => {
    const s = status([], { id: 'b', dateOfBirth: '2026-09-01' });
    assert.equal(s.kind, 'blocked');
    assert.equal(s.title, 'Under 3 months: please see a doctor');
  });

  test('an ingredient with no rules never claims it can be given', () => {
    const check = checkIngredient({ ingredient: 'gamma', rules: RULES, history: [dose('gamma', 5, HOUR)], now: NOW, child: CHILD, timeZone: TZ });
    const s = cardStatus(check, 'gamma', undefined, NOW, TZ);
    assert.equal(s.kind, 'none');
    assert.match(s.title, /follow the label/);
  });
});

describe('formatClock', () => {
  test('hours, minutes, seconds', () => {
    assert.equal(formatClock(0), '0:00:00');
    assert.equal(formatClock(((1 * 60 + 20) * 60 + 14) * 1000), '1:20:14');
    assert.equal(formatClock(23 * 60 * 1000 + 10 * 1000), '0:23:10');
    assert.equal(formatClock(26 * 3600 * 1000), '26:00:00');
  });

  test('a countdown rounds up so a running wait never reads zero', () => {
    assert.equal(formatClock(400, { up: true }), '0:00:01');
    assert.equal(formatClock(400), '0:00:00');
    assert.equal(formatClock(-5, { up: true }), '0:00:00');
  });
});

describe('formatGap', () => {
  test('whole hours, half hours, and anything else in words', () => {
    assert.equal(formatGap(240), '4 h');
    assert.equal(formatGap(270), '4½ h');
    assert.equal(formatGap(480), '8 h');
    assert.equal(formatGap(250), '4 h 10 m');
    assert.equal(formatGap(30), '0½ h');
  });
});

describe('cardStatus with the parent\'s gap', () => {
  const ALPHA = { ...RULES.ingredients.alpha, usualIntervalMaxMinutes: 360 };
  const RANGED = { ...RULES, ingredients: { ...RULES.ingredients, alpha: ALPHA } };
  const row = (ago, gapMinutes, now = NOW) => {
    const check = checkIngredient({ ingredient: 'alpha', rules: RANGED, history: [dose('alpha', 100, ago)], now, child: CHILD, timeZone: TZ });
    const plan = planGap({ check, rule: ALPHA, gapMinutes, now });
    return cardStatus(check, 'alpha', ALPHA, now, TZ, plan);
  };

  test('past the minimum but before the parent\'s gap: yellow, says it can be given if needed', () => {
    const c = row(270 * MIN, 330);
    assert.equal(c.kind, 'soon');
    assert.equal(c.title, 'Alpha: your 5½ h gap ends in 1 h');
    assert.match(c.detail, /^Allowed now if needed · Last: /);
    assert.ok(c.progress > 0 && c.progress < 1);
  });

  test('after the parent\'s gap: green, and says how long it has been allowed', () => {
    const c = row(5 * HOUR, 270);
    assert.equal(c.kind, 'ok');
    assert.equal(c.title, 'Alpha is allowed now');
    assert.match(c.detail, /^Allowed since 11:30am \(30 m ago\) · Last: /);
  });

  test('with no gap given the wording is unchanged', () => {
    const check = checkIngredient({ ingredient: 'alpha', rules: RANGED, history: [dose('alpha', 100, 5 * HOUR)], now: NOW, child: CHILD, timeZone: TZ });
    assert.equal(cardStatus(check, 'alpha', ALPHA, NOW, TZ).detail.startsWith('Last: '), true);
  });
});
