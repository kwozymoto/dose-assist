/* NZ daylight saving. The engine works in UTC milliseconds, so a change of
   clocks cannot move a dose time; these tests pin that, using the real
   2026 and 2027 transitions (confirmed against Intl on the build machine:
   2026-09-27 02:00 NZST -> 03:00 NZDT; 2027-04-04 03:00 NZDT -> 02:00 NZST). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIngredient } from '../../js/engine/checkDose.js';
import { RULES, HOUR, MIN, CHILD, TZ } from './fixtures.mjs';

const at = (iso) => Date.parse(iso);

test('spring forward: 1:30am dose allows the next exactly 4 real hours later', () => {
  const given = at('2026-09-26T13:30:00Z'); // 1:30am NZST, 27 Sep 2026
  const history = [{ id: 'a', givenAt: given, components: [{ ingredient: 'alpha', mg: 250 }] }];
  const nowish = at('2026-09-26T14:30:00Z'); // 3:30am NZDT, one real hour later
  const r = checkIngredient({ ingredient: 'alpha', rules: RULES, history, now: nowish, child: CHILD, timeZone: TZ });
  assert.equal(r.status, 'TOO_SOON');
  assert.equal(r.nextAllowedAt, given + 4 * HOUR);
  assert.equal(r.nextAllowedAt, at('2026-09-26T17:30:00Z')); // 6:30am NZDT on the wall clock
  const before = checkIngredient({ ingredient: 'alpha', rules: RULES, history, now: given + 4 * HOUR - MIN, child: CHILD, timeZone: TZ });
  assert.equal(before.status, 'TOO_SOON');
  const on = checkIngredient({ ingredient: 'alpha', rules: RULES, history, now: given + 4 * HOUR, child: CHILD, timeZone: TZ });
  assert.equal(on.status, 'OK');
});

test('fall back: 1:30am dose allows the next exactly 4 real hours later', () => {
  const given = at('2027-04-03T12:30:00Z'); // 1:30am NZDT, 4 Apr 2027
  const history = [{ id: 'a', givenAt: given, components: [{ ingredient: 'alpha', mg: 250 }] }];
  const r = checkIngredient({ ingredient: 'alpha', rules: RULES, history, now: given + HOUR, child: CHILD, timeZone: TZ });
  assert.equal(r.nextAllowedAt, at('2027-04-03T16:30:00Z')); // 4:30am NZST on the wall clock
});

test('the 24 h window across spring forward is 24 real hours (23 on the wall clock)', () => {
  const first = at('2026-09-26T10:00:00Z'); // 10pm NZST Sat
  const history = [0, 5, 10, 15].map((h, i) => ({ id: `d${i}`, givenAt: first + h * HOUR, components: [{ ingredient: 'alpha', mg: 100 }] }));
  const r = checkIngredient({ ingredient: 'alpha', rules: RULES, history, now: first + 16 * HOUR, child: CHILD, timeZone: TZ });
  assert.equal(r.status, 'DAILY_LIMIT_REACHED');
  assert.equal(r.nextAllowedAt, first + 24 * HOUR);
});

test('age across a DST change counts calendar days in NZ', () => {
  // Born 29 June 2026; 90 days later is 27 September 2026, the day clocks change.
  const child = { id: 'b', dateOfBirth: '2026-06-29' };
  const earlyMorning = at('2026-09-26T12:30:00Z'); // 00:30 NZST 27 Sep
  const r = checkIngredient({ ingredient: 'alpha', rules: RULES, history: [], now: earlyMorning, child, timeZone: TZ });
  assert.equal(r.status, 'OK');
  const dayBefore = checkIngredient({ ingredient: 'alpha', rules: RULES, history: [], now: earlyMorning - 2 * HOUR, child, timeZone: TZ });
  assert.equal(dayBefore.status, 'BLOCKED');
});
