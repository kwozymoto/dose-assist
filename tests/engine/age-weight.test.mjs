import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightLooksOdd, MAX_AGE_DAYS } from '../../js/engine/age.js';

const Y = 365.25;
test('usual weights pass', () => {
  for (const [kg, days] of [[3.4, 0], [7.5, 180], [10, Y], [14, 3 * Y], [20, 6 * Y], [32, 11 * Y], [60, 17 * Y]]) assert.equal(weightLooksOdd(kg, days), false, `${kg} kg at ${days} d`);
});
test('slips are caught: 145 for 14.5, grams, a toddler weight typed for a baby', () => {
  assert.equal(weightLooksOdd(145, 3 * Y), true);
  assert.equal(weightLooksOdd(1.4, 3 * Y), true);
  assert.equal(weightLooksOdd(25, 120), true);
});
test('18 years is the upper age', () => {
  assert.ok(MAX_AGE_DAYS >= 18 * 365 && MAX_AGE_DAYS < 18 * 365 + 6);
});
