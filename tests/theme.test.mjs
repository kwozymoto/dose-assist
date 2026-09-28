import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../js/theme.js';

const at = (h) => new Date(2026, 9, 14, h, 30).getTime(); // local time

test('auto goes by the clock only: dark 7pm to 7am, light by day, whatever the phone says', () => {
  for (const dark of [false, true]) {
    assert.equal(resolveTheme('auto', at(12), dark), 'light');
    assert.equal(resolveTheme('auto', at(6), dark), 'dark');
    assert.equal(resolveTheme('auto', at(7), dark), 'light');
    assert.equal(resolveTheme('auto', at(18), dark), 'light');
    assert.equal(resolveTheme('auto', at(19), dark), 'dark');
    assert.equal(resolveTheme('auto', at(3), dark), 'dark');
  }
});

test('same as my phone, and the fixed choices', () => {
  assert.equal(resolveTheme('system', at(12), true), 'dark');
  assert.equal(resolveTheme('system', at(3), false), 'light');
  assert.equal(resolveTheme('light', at(3), true), 'light');
  assert.equal(resolveTheme('dark', at(12), false), 'dark');
});
