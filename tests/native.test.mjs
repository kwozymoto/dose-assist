import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nativeId, toNative, hashOf, isNative, CHANNEL_ID } from '../js/native.js';

const notice = { reminderId: 'r-123', childId: 'c1', fireAt: Date.UTC(2026, 9, 14, 1, 15), title: 'Mia: next paracetamol allowed from now', body: 'Last given 9:15pm. Open Dose Assist to check before giving.', tag: 'r-123', url: './#/child/c1', logUrl: './#/give?child=c1&ingredients=paracetamol', kind: 'next_allowed' };

describe('native reminders', () => {
  test('not native in node or a browser', () => {
    assert.equal(isNative(), false);
  });

  test('ids are stable, positive 31-bit ints, and differ between reminders', () => {
    assert.equal(nativeId('r-123'), nativeId('r-123'));
    for (const s of ['a', 'r-123', 'x'.repeat(200), '']) {
      const id = nativeId(s);
      assert.ok(Number.isInteger(id) && id > 0 && id <= 0x7fffffff, s);
    }
    assert.notEqual(nativeId('r-1'), nativeId('r-2'));
  });

  test('a notice maps to an exact, idle-allowed alarm on the reminders channel', () => {
    const n = toNative(notice);
    assert.equal(n.id, nativeId('r-123'));
    assert.equal(n.title, notice.title);
    assert.equal(n.body, notice.body);
    assert.equal(n.schedule.at.getTime(), notice.fireAt);
    assert.equal(n.schedule.allowWhileIdle, true);
    assert.equal(n.channelId, CHANNEL_ID);
    assert.deepEqual(n.extra, { da: 1, reminderId: 'r-123', url: notice.url, logUrl: notice.logUrl, fireAt: notice.fireAt });
  });

  test('a tap opens a screen by its hash only, never anything else', () => {
    assert.equal(hashOf('./#/give?child=c1&ingredients=paracetamol'), '#/give?child=c1&ingredients=paracetamol');
    assert.equal(hashOf('./#/child/c1'), '#/child/c1');
    assert.equal(hashOf('https://evil.example/'), '#/');
    assert.equal(hashOf(undefined), '#/');
    assert.equal(hashOf(42), '#/');
  });
});
