/* data/rules.json, exercised through the engine. Every number is read from
   the file, never restated here, so this suite keeps meaning what it says
   when a reviewer changes a value. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkIngredient } from '../../js/engine/checkDose.js';
import { gapChoices, clampGap, planGap } from '../../js/engine/gap.js';
import { NOW, MIN, DAY, TZ } from './fixtures.mjs';

const choices = gapChoices;

const RULES = JSON.parse(readFileSync(new URL('../../data/rules.json', import.meta.url), 'utf8'));
const CHILD = { id: 'c', dateOfBirth: '2020-01-01' };

for (const [name, rule] of Object.entries(RULES.ingredients)) {
  describe(`${name} (rules ${RULES.rulesVersion})`, () => {
    const interval = rule.minIntervalMinutes * MIN;
    const base = (history, extra = {}) =>
      checkIngredient({ ingredient: name, rules: RULES, history, now: NOW, child: CHILD, timeZone: TZ, ...extra });
    const at = (t, mg = 1) => ({ id: `${name}-${t}`, givenAt: t, components: [{ ingredient: name, mg }] });

    test('minimum interval: one minute before is too soon, exactly on is fine', () => {
      assert.equal(base([at(NOW - interval + MIN)]).status, 'TOO_SOON');
      assert.equal(base([at(NOW - interval)]).status, 'OK');
    });

    test('maximum doses in 24 h', () => {
      // Space the maximum number of doses exactly one interval apart, ending one interval ago.
      const h = [];
      for (let i = 0; i < rule.maxDosesPer24h; i += 1) h.push(at(NOW - interval * (i + 1)));
      const inWindow = h.filter((d) => d.givenAt > NOW - DAY).length;
      const r = base(h);
      if (inWindow >= rule.maxDosesPer24h) assert.equal(r.status, 'DAILY_LIMIT_REACHED');
      else assert.equal(r.status, 'OK');
    });

    test('maximum single dose', () => {
      assert.equal(base([], { enteredMg: rule.maxSingleMg }).status, 'OK');
      const over = base([], { enteredMg: rule.maxSingleMg + 1 });
      assert.equal(over.status, 'EXCEEDS_LIMIT');
    });

    test('maximum mg in 24 h', () => {
      const r = base([at(NOW - DAY + MIN, rule.maxMgPer24h)]);
      assert.equal(r.status, 'DAILY_LIMIT_REACHED');
      assert.equal(r.nextAllowedAt, NOW + MIN);
    });

    test('minimum age: one day under is blocked, on the day is fine', () => {
      const today = Date.UTC(2026, 9, 14); // NOW's local date
      const dob = (days) => new Date(today - days * DAY).toISOString().slice(0, 10);
      assert.equal(base([], { child: { id: 'b', dateOfBirth: dob(rule.minAgeDays - 1) } }).status, 'BLOCKED');
      assert.equal(base([], { child: { id: 'b', dateOfBirth: dob(rule.minAgeDays) } }).status, 'OK');
    });

    test('the range a parent picks from never starts below the minimum, and the top is a real choice', () => {
      const choices = gapChoices(rule);
      assert.equal(choices[0], rule.minIntervalMinutes);
      assert.equal(choices.at(-1), Math.max(rule.minIntervalMinutes, rule.usualIntervalMaxMinutes ?? 0));
      for (const c of choices) assert.ok(c >= rule.minIntervalMinutes);
      assert.equal(clampGap(rule, 1), rule.minIntervalMinutes);
      assert.equal(clampGap(rule, 1e9), choices.at(-1));
    });

    test('a chosen gap never lets a dose through before the minimum interval', () => {
      const longest = choices(rule).at(-1);
      const p = planGap({ check: base([at(NOW - interval + MIN)]), rule, gapMinutes: longest, now: NOW });
      assert.equal(p.phase, 'wait');
      assert.ok(p.targetAt >= NOW - interval + MIN + interval);
    });

    test('unreviewed rules say so', () => {
      if (RULES.reviewedBy === null) assert.ok(base([]).warnings.includes('RULES_NOT_REVIEWED'));
    });
  });
}
