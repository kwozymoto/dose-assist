import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planNotices, triage, listNames } from '../js/schedule.js';
import { RULES, NOW, HOUR, MIN, TZ } from './engine/fixtures.mjs';

const child = { id: 'c1', name: 'Mia', colour: 'teal', dateOfBirth: '2022-03-01', createdAt: 0 };
const dose = (ingredient, ago, over = {}) => ({
  id: `d${ago}${ingredient}`, childId: 'c1', bottleId: 'b', bottle: {}, amount: 5,
  components: [{ ingredient, mg: 100 }], givenAt: NOW - ago, loggedAt: NOW - ago, givenBy: 'Mum',
  weightKgUsed: null, rulesVersion: 't', overrideReason: null, ...over,
});
const rem = (over = {}) => ({ id: 'r1', childId: 'c1', kind: 'next_allowed', ingredients: ['alpha'], createdAt: NOW, ...over });
const plan = (reminders, doses, extra = {}) => planNotices({ reminders, children: [child], doses, rules: RULES, timeZone: TZ, ...extra });

describe('next_allowed', () => {
  test('fires when the rules next allow a dose, with allowed-not-instructed wording', () => {
    const [n] = plan([rem()], [dose('alpha', HOUR)]);
    assert.equal(n.fireAt, NOW - HOUR + 4 * HOUR);
    assert.equal(n.title, 'Mia: next alpha allowed from now');
    assert.equal(n.body, 'Last given 11:00am. Open Dose Assist to check before giving.');
    assert.doesNotMatch(n.title + n.body, /\bgive (mia|her|him|them)\b/i);
    assert.equal(n.tag, 'r1');
    assert.equal(n.logUrl, './#/give?child=c1&ingredients=alpha');
  });

  test('moves when a dose is edited to a later time', () => {
    const [a] = plan([rem()], [dose('alpha', 2 * HOUR)]);
    const [b] = plan([rem()], [dose('alpha', HOUR)]);
    assert.equal(b.fireAt - a.fireAt, HOUR);
  });

  test('moves back when the latest dose is deleted', () => {
    const doses = [dose('alpha', 5 * HOUR), dose('alpha', HOUR, { deletedAt: NOW })];
    const [n] = plan([rem()], doses);
    assert.equal(n.fireAt, NOW - 5 * HOUR + 4 * HOUR);
  });

  test('waits for the 24 h limit, not just the interval', () => {
    const doses = [dose('alpha', 20 * HOUR), dose('alpha', 15 * HOUR), dose('alpha', 10 * HOUR), dose('alpha', 5 * HOUR)];
    const [n] = plan([rem()], doses);
    assert.equal(n.fireAt, NOW - 20 * HOUR + 24 * HOUR);
  });

  test('does not depend on when it is planned', () => {
    // planNotices takes no clock at all; the same doses give the same time.
    const a = plan([rem()], [dose('alpha', HOUR)]);
    const b = plan([rem()], [dose('alpha', HOUR)]);
    assert.deepEqual(a, b);
  });

  test('no doses, nothing to remind about', () => {
    assert.deepEqual(plan([rem()], []), []);
  });

  test('a combination reminder waits for its slowest ingredient', () => {
    const [n] = plan([rem({ ingredients: ['alpha', 'beta'] })], [dose('alpha', HOUR), dose('beta', HOUR)]);
    assert.equal(n.fireAt, NOW - HOUR + 6 * HOUR);
    assert.equal(n.title, 'Mia: next alpha and beta allowed from now');
  });

  test('archived children and other children are skipped', () => {
    const notices = planNotices({ reminders: [rem()], children: [{ ...child, archivedAt: NOW }], doses: [dose('alpha', HOUR)], rules: RULES, timeZone: TZ });
    assert.deepEqual(notices, []);
  });

  test('an ingredient with no rules gets no next_allowed time', () => {
    assert.deepEqual(plan([rem({ ingredients: ['gamma'] })], [dose('gamma', HOUR)]), []);
  });
});

describe('scheduled', () => {
  test('when the rules allow it, says it is time, as the parent set', () => {
    const [n] = plan([rem({ kind: 'scheduled', fireAt: NOW + 4 * HOUR, label: "doctor's schedule" })], [dose('alpha', HOUR)]);
    assert.equal(n.fireAt, NOW + 4 * HOUR);
    assert.equal(n.body, "Time for Mia's alpha, as you set (doctor's schedule). Last given 11:00am.");
  });

  test('when the rules would not allow it yet, says so and defers to the doctor', () => {
    const [n] = plan([rem({ kind: 'scheduled', fireAt: NOW + HOUR, label: "doctor's schedule" })], [dose('alpha', HOUR)]);
    assert.match(n.body, /usual limits allow the next dose from 3:00pm/);
    assert.match(n.body, /Follow your doctor's instructions/);
    assert.doesNotMatch(n.body, /^Time for/);
  });
});

describe('follow-ups and ordering', () => {
  test('follow-up notices come after, when switched on', () => {
    const notices = plan([rem()], [dose('alpha', HOUR)], { followUpMinutes: 15 });
    assert.equal(notices.length, 2);
    assert.equal(notices[1].kind, 'follow_up');
    assert.equal(notices[1].fireAt - notices[0].fireAt, 15 * MIN);
    assert.equal(notices[1].tag, notices[0].tag);
  });

  test('soonest first', () => {
    const notices = plan(
      [rem({ id: 'a', ingredients: ['beta'] }), rem({ id: 'b', ingredients: ['alpha'] })],
      [dose('alpha', HOUR), dose('beta', HOUR)],
    );
    assert.deepEqual(notices.map((n) => n.reminderId), ['b', 'a']);
  });

  test('fired and cancelled reminders are ignored', () => {
    assert.deepEqual(plan([rem({ firedAt: NOW }), rem({ id: 'x', cancelledAt: NOW })], [dose('alpha', HOUR)]), []);
  });
});

describe('triage', () => {
  test('due within grace, stale beyond it, upcoming in future', () => {
    const n = (fireAt) => ({ fireAt });
    const t = triage([n(NOW - 20 * MIN), n(NOW - 5 * MIN), n(NOW), n(NOW + 1)], NOW, 10 * MIN);
    assert.equal(t.stale.length, 1);
    assert.equal(t.due.length, 2);
    assert.equal(t.upcoming.length, 1);
  });
});

test('listNames', () => {
  assert.equal(listNames(['a']), 'a');
  assert.equal(listNames(['a', 'b']), 'a and b');
  assert.equal(listNames(['a', 'b', 'c']), 'a, b and c');
});
