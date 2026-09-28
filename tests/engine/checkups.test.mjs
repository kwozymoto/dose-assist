/* When to ask "have you weighed your child lately?", "is this still the right
   dose?" and "still the same bottle?". None of these ever blocks a dose;
   they only decide when a prompt shows. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { weightCheckup, savedDoseCheckup, bottleCheckup, WEIGHT_EVERY_DAYS, SAVED_DOSE_EVERY_DAYS, BOTTLE_IDLE_DAYS } from '../../js/engine/checkups.js';
import { NOW, DAY, TZ } from './fixtures.mjs';

const dobDaysAgo = (d) => new Date(Date.UTC(2026, 9, 14) - d * DAY).toISOString().slice(0, 10);

describe('weightCheckup', () => {
  test('the intervals: monthly under 1, every 3 months to 5, every 6 months after', () => {
    assert.deepEqual(WEIGHT_EVERY_DAYS, { underOne: 30, underFive: 91, older: 182 });
  });

  test('no weight on record: ask for one', () => {
    assert.deepEqual(weightCheckup({ dateOfBirth: dobDaysAgo(800), weighedAt: null, confirmedAt: null, now: NOW, timeZone: TZ }), { due: true, reason: 'none' });
  });

  test('a baby: due after a month', () => {
    const dob = dobDaysAgo(200);
    assert.equal(weightCheckup({ dateOfBirth: dob, weighedAt: NOW - 29 * DAY, confirmedAt: null, now: NOW, timeZone: TZ }).due, false);
    assert.deepEqual(weightCheckup({ dateOfBirth: dob, weighedAt: NOW - 31 * DAY, confirmedAt: null, now: NOW, timeZone: TZ }), { due: true, reason: 'old', since: NOW - 31 * DAY });
  });

  test('a toddler: due after 3 months', () => {
    const dob = dobDaysAgo(3 * 365);
    assert.equal(weightCheckup({ dateOfBirth: dob, weighedAt: NOW - 90 * DAY, confirmedAt: null, now: NOW, timeZone: TZ }).due, false);
    assert.equal(weightCheckup({ dateOfBirth: dob, weighedAt: NOW - 92 * DAY, confirmedAt: null, now: NOW, timeZone: TZ }).due, true);
  });

  test('over 5: due after 6 months', () => {
    const dob = dobDaysAgo(7 * 365);
    assert.equal(weightCheckup({ dateOfBirth: dob, weighedAt: NOW - 181 * DAY, confirmedAt: null, now: NOW, timeZone: TZ }).due, false);
    assert.equal(weightCheckup({ dateOfBirth: dob, weighedAt: NOW - 183 * DAY, confirmedAt: null, now: NOW, timeZone: TZ }).due, true);
  });

  test('"still right" counts as a fresh check', () => {
    const dob = dobDaysAgo(3 * 365);
    assert.equal(weightCheckup({ dateOfBirth: dob, weighedAt: NOW - 400 * DAY, confirmedAt: NOW - 10 * DAY, now: NOW, timeZone: TZ }).due, false);
  });

  test('no date of birth: the most careful interval', () => {
    assert.equal(weightCheckup({ dateOfBirth: null, weighedAt: NOW - 31 * DAY, confirmedAt: null, now: NOW, timeZone: TZ }).due, true);
  });
});

describe('savedDoseCheckup', () => {
  test('the interval is 3 months', () => {
    assert.equal(SAVED_DOSE_EVERY_DAYS, 91);
  });

  test('no saved dose: nothing to ask', () => {
    assert.deepEqual(savedDoseCheckup({ saved: undefined, weighedAt: NOW, now: NOW }), { due: false });
  });

  test('a weight recorded after the dose was saved: ask', () => {
    assert.deepEqual(savedDoseCheckup({ saved: { amount: 5, setAt: NOW - 10 * DAY }, weighedAt: NOW - DAY, now: NOW }), { due: true, reason: 'weight' });
  });

  test('a weight recorded before: no need', () => {
    assert.equal(savedDoseCheckup({ saved: { amount: 5, setAt: NOW - 10 * DAY }, weighedAt: NOW - 20 * DAY, now: NOW }).due, false);
  });

  test('saved more than 3 months ago: ask, even with no new weight', () => {
    assert.deepEqual(savedDoseCheckup({ saved: { amount: 5, setAt: NOW - 92 * DAY }, weighedAt: null, now: NOW }), { due: true, reason: 'age' });
  });

  test('"still right" resets both', () => {
    assert.equal(savedDoseCheckup({ saved: { amount: 5, setAt: NOW - 200 * DAY, reviewedAt: NOW - DAY }, weighedAt: NOW - 2 * DAY, now: NOW }).due, false);
  });
});

describe('bottleCheckup', () => {
  test('the idle time is 30 days', () => {
    assert.equal(BOTTLE_IDLE_DAYS, 30);
  });

  test('never used: nothing to ask (it was just checked when added)', () => {
    assert.equal(bottleCheckup({ lastUsedAt: null, confirmedAt: null, now: NOW }).due, false);
  });

  test('used recently: no', () => {
    assert.equal(bottleCheckup({ lastUsedAt: NOW - 29 * DAY, confirmedAt: null, now: NOW }).due, false);
  });

  test('not used for 30 days or more: ask', () => {
    assert.deepEqual(bottleCheckup({ lastUsedAt: NOW - 31 * DAY, confirmedAt: null, now: NOW }), { due: true, since: NOW - 31 * DAY });
  });

  test('confirmed since the last use: no', () => {
    assert.equal(bottleCheckup({ lastUsedAt: NOW - 60 * DAY, confirmedAt: NOW - DAY, now: NOW }).due, false);
  });
});
