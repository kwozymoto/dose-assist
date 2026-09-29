import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';

const NOW = Date.UTC(2026, 9, 13, 23, 0);
/** A record without its sync stamps (tested on their own below). */
const unstamped = (r) => { if (!r) return r; const { _u: _a, _d: _b, ...rest } = r; return rest; };

/** A fresh, empty database for every test. */
beforeEach(async () => {
  await db.closeDb();
  globalThis.indexedDB = new IDBFactory();
});

const child = (over = {}) => ({ id: db.uid(), name: 'Mia', colour: 'teal', dateOfBirth: '2022-03-01', createdAt: NOW, ...over });
const bottle = (over = {}) => ({
  id: db.uid(), productId: 'paracetamol-250-5', name: 'Paracetamol liquid', form: 'liquid',
  components: [{ ingredient: 'paracetamol', strengthMg: 250, strengthPer: 5 }], addedAt: NOW, ...over,
});
const doseRecord = (childId, over = {}) => ({
  id: db.uid(), childId, bottleId: 'b1',
  bottle: { name: 'Paracetamol liquid', form: 'liquid', productId: 'paracetamol-250-5', components: [{ ingredient: 'paracetamol', strengthMg: 250, strengthPer: 5 }] },
  amount: 5, components: [{ ingredient: 'paracetamol', mg: 250 }],
  givenAt: NOW, loggedAt: NOW, givenBy: 'Mum', weightKgUsed: null, rulesVersion: '2026.10.0', overrideReason: null, ...over,
});

describe('schema', () => {
  test('opens at the current version with every store', async () => {
    const conn = await db.openDb();
    assert.equal(conn.version, db.DB_VERSION);
    assert.deepEqual([...conn.objectStoreNames].sort(), [...db.STORES].sort());
  });
});

describe('children', () => {
  test('save, list, archive, unarchive', async () => {
    const a = child({ name: 'Mia', createdAt: NOW });
    const b = child({ name: 'Leo', createdAt: NOW + 1 });
    await db.children.save(b);
    await db.children.save(a);
    assert.deepEqual((await db.children.list()).map((c) => c.name), ['Mia', 'Leo']);
    await db.children.archive(a.id, NOW + 5);
    assert.deepEqual((await db.children.list()).map((c) => c.name), ['Leo']);
    assert.equal((await db.children.list({ includeArchived: true })).length, 2);
    await db.children.unarchive(a.id);
    assert.equal((await db.children.list()).length, 2);
  });
});

describe('weights', () => {
  test('latest is the most recently recorded, not the most recently added', async () => {
    const c = child();
    await db.weights.add({ id: 'w1', childId: c.id, kg: 14, recordedAt: NOW });
    await db.weights.add({ id: 'w2', childId: c.id, kg: 12, recordedAt: NOW - 1e9 });
    assert.equal((await db.weights.latest(c.id)).kg, 14);
    assert.equal((await db.weights.forChild(c.id)).length, 2);
  });
});

describe('bottles', () => {
  test('save, list, archive', async () => {
    const b = bottle();
    await db.bottles.save(b);
    assert.equal((await db.bottles.list()).length, 1);
    await db.bottles.archive(b.id, NOW);
    assert.equal((await db.bottles.list()).length, 0);
    assert.equal((await db.bottles.get(b.id)).archivedAt, NOW);
  });
});

describe('doses', () => {
  test('add writes the dose and a create audit entry', async () => {
    const d = doseRecord('c1');
    await db.doses.add(d, 'Mum');
    assert.deepEqual(unstamped(await db.doses.get(d.id)), d);
    const audit = await db.doses.audit(d.id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'create');
    assert.equal(audit[0].by, 'Mum');
    assert.deepEqual(audit[0].after, d);
  });

  test('adding the same id twice fails and changes nothing', async () => {
    const d = doseRecord('c1');
    await db.doses.add(d, 'Mum');
    await assert.rejects(() => db.doses.add({ ...d, amount: 10 }, 'Dad'), /already exists/);
    assert.equal((await db.doses.get(d.id)).amount, 5);
    assert.equal((await db.doses.audit(d.id)).length, 1);
  });

  test('edit records before and after of only what changed', async () => {
    const d = doseRecord('c1');
    await db.doses.add(d, 'Mum');
    const after = await db.doses.edit(d.id, { givenAt: NOW - 600000, note: 'wrong time' }, { by: 'Dad', at: NOW + 1, reason: 'fix time' });
    assert.equal(after.givenAt, NOW - 600000);
    const audit = await db.doses.audit(d.id);
    assert.equal(audit[1].action, 'edit');
    assert.deepEqual(audit[1].before, { givenAt: NOW, note: undefined });
    assert.deepEqual(audit[1].after, { givenAt: NOW - 600000, note: 'wrong time' });
    assert.equal(audit[1].reason, 'fix time');
  });

  test('edit refuses fields that are history', async () => {
    const d = doseRecord('c1');
    await db.doses.add(d, 'Mum');
    for (const k of ['childId', 'loggedAt', 'rulesVersion', 'deletedAt', 'bottle', 'overrideReason']) {
      await assert.rejects(() => db.doses.edit(d.id, { [k]: 'x' }, { by: 'x', at: NOW }), /cannot edit/);
    }
  });

  test('remove is a soft delete with an audit entry, never a hard delete', async () => {
    const c = 'c1';
    const d = doseRecord(c);
    await db.doses.add(d, 'Mum');
    await db.doses.remove(d.id, { by: 'Dad', at: NOW + 5, reason: 'logged twice' });
    const kept = await db.doses.get(d.id);
    assert.ok(kept, 'the record is still there');
    assert.equal(kept.deletedAt, NOW + 5);
    assert.equal((await db.doses.forChild(c)).length, 0);
    assert.equal((await db.doses.forChild(c, { includeDeleted: true })).length, 1);
    const audit = await db.doses.audit(d.id);
    assert.equal(audit.at(-1).action, 'delete');
    assert.equal(audit.at(-1).reason, 'logged twice');
  });

  test('a deleted dose cannot be edited; it can be restored, with audit', async () => {
    const d = doseRecord('c1');
    await db.doses.add(d, 'Mum');
    await db.doses.remove(d.id, { by: 'Mum', at: NOW + 1, reason: 'undo' });
    await assert.rejects(() => db.doses.edit(d.id, { amount: 2 }, { by: 'x', at: NOW }), /deleted/);
    await db.doses.restore(d.id, { by: 'Mum', at: NOW + 2 });
    assert.equal((await db.doses.get(d.id)).deletedAt, null);
    assert.deepEqual((await db.doses.audit(d.id)).map((a) => a.action), ['create', 'delete', 'restore']);
  });

  test('forChild is newest first and scoped to the child', async () => {
    await db.doses.add(doseRecord('c1', { givenAt: NOW - 2 }), 'x');
    await db.doses.add(doseRecord('c1', { givenAt: NOW }), 'x');
    await db.doses.add(doseRecord('c2', { givenAt: NOW - 1 }), 'x');
    const rows = await db.doses.forChild('c1');
    assert.deepEqual(rows.map((r) => r.givenAt), [NOW, NOW - 2]);
  });
});

describe('reminders', () => {
  const base = (over = {}) => ({ id: db.uid(), childId: 'c1', kind: 'next_allowed', ingredients: ['paracetamol'], createdAt: NOW, ...over });

  test('a new reminder supersedes the old one for the same child and ingredient', async () => {
    const a = base();
    await db.reminders.add(a);
    const b = base({ createdAt: NOW + 10 });
    await db.reminders.add(b);
    const active = await db.reminders.active();
    assert.deepEqual(active.map((r) => r.id), [b.id]);
    assert.equal((await db.reminders.get(a.id)).cancelledAt, NOW + 10);
  });

  test('different ingredients, or different children, do not supersede', async () => {
    await db.reminders.add(base());
    await db.reminders.add(base({ ingredients: ['ibuprofen'] }));
    await db.reminders.add(base({ childId: 'c2' }));
    assert.equal((await db.reminders.active()).length, 3);
  });

  test('fired and cancelled reminders are not active', async () => {
    const a = base();
    const b = base({ ingredients: ['ibuprofen'] });
    await db.reminders.add(a);
    await db.reminders.add(b);
    await db.reminders.markFired(a.id, NOW);
    await db.reminders.cancel(b.id, NOW);
    assert.equal((await db.reminders.active()).length, 0);
  });
});

describe('meta', () => {
  test('get with fallback, set, get', async () => {
    assert.equal(await db.meta.get('caregiverName', 'Someone'), 'Someone');
    await db.meta.set('caregiverName', 'Mum');
    assert.equal(await db.meta.get('caregiverName', 'Someone'), 'Mum');
  });
});

describe('export, import, delete', () => {
  test('export then import into an empty database restores everything', async () => {
    const c = child();
    await db.children.save(c);
    const d = doseRecord(c.id);
    await db.doses.add(d, 'Mum');
    await db.meta.set('caregiverName', 'Mum');
    const file = JSON.parse(JSON.stringify(await db.exportAll(NOW)));

    await db.closeDb();
    globalThis.indexedDB = new IDBFactory();
    await db.importAll(file);
    assert.deepEqual(unstamped(await db.children.get(c.id)), c);
    assert.deepEqual(unstamped(await db.doses.get(d.id)), d);
    assert.equal((await db.doses.audit(d.id)).length, 1);
    assert.equal(await db.meta.get('caregiverName'), 'Mum');
  });

  test('import rejects files that are not backups, and leaves data alone', async () => {
    const c = child();
    await db.children.save(c);
    await assert.rejects(() => db.importAll({ hello: 1 }), /not a WhenDose backup/);
    await assert.rejects(() => db.importAll({ format: db.EXPORT_FORMAT, version: 999, data: {} }), /newer version/);
    assert.ok(await db.children.get(c.id));
  });

  test('a bad row aborts the whole import', async () => {
    const c = child();
    await db.children.save(c);
    const file = { format: db.EXPORT_FORMAT, version: 1, data: { children: [{ name: 'no id' }] } };
    await assert.rejects(() => db.importAll(file));
    assert.ok(await db.children.get(c.id), 'the old data survived');
  });

  test('deleteEverything empties every store', async () => {
    await db.children.save(child());
    await db.doses.add(doseRecord('c1'), 'x');
    await db.deleteEverything();
    const file = await db.exportAll(NOW);
    for (const s of db.STORES) assert.equal(file.data[s].length, 0, s);
  });
});

describe('persistence', () => {
  test('data survives closing and reopening the database (an app restart)', async () => {
    const c = child();
    await db.children.save(c);
    await db.doses.add(doseRecord(c.id), 'Mum');
    await db.closeDb();
    assert.equal((await db.children.list()).length, 1);
    assert.equal((await db.doses.forChild(c.id)).length, 1);
  });
});

describe('sync stamps', () => {
  test('every write to a shared store is stamped with the time and this phone; settings are not', async () => {
    const c = child();
    await db.children.save(c);
    const got = await db.children.get(c.id);
    assert.equal(typeof got._u, 'number');
    assert.equal(got._d, db.deviceId());
    await db.meta.set('theme', 'dark');
    const all = await db.exportAll(NOW);
    assert.equal(all.data.meta.find((m) => m.key === 'theme')._u, undefined);
  });

  test('a dose and its audit entry are both stamped, and an edit restamps the dose', async () => {
    const c = child();
    await db.children.save(c);
    const d = doseRecord(c.id);
    await db.doses.add(d, 'Mum');
    const first = await db.doses.get(d.id);
    assert.equal(first._d, db.deviceId());
    const audit = await db.doses.audit(d.id);
    assert.equal(audit[0]._d, db.deviceId());
    await new Promise((r) => setTimeout(r, 2));
    await db.doses.edit(d.id, { amount: 4 }, { by: 'Mum', at: NOW });
    assert.ok((await db.doses.get(d.id))._u > first._u);
  });

  test('a reminder\'s own bookkeeping (planned, fired) does not restamp it', async () => {
    const r = { id: 'r1', childId: 'c', kind: 'next_allowed', ingredients: ['paracetamol'], createdAt: NOW };
    await db.reminders.add(r);
    const before = (await db.reminders.get('r1'))._u;
    await new Promise((res) => setTimeout(res, 2));
    await db.reminders.setPlanned('r1', { fireAt: NOW, rev: 'x' });
    await db.reminders.markFired('r1', NOW);
    assert.equal((await db.reminders.get('r1'))._u, before);
  });

  test('applying another phone\'s changes: new records added, newer versions win, older ignored, not restamped', async () => {
    const c = child();
    await db.children.save(c);
    const mine = await db.children.get(c.id);
    const theirs = { ...mine, name: 'Mia R', _u: mine._u + 1000, _d: 'other' };
    const stale = { ...mine, name: 'Old', _u: 1, _d: 'other' };
    const extra = { ...child(), _u: 5, _d: 'other' };
    const n = await db.syncData.apply([{ s: 'children', r: theirs }, { s: 'children', r: stale }, { s: 'children', r: extra }]);
    assert.equal(n, 2);
    assert.equal((await db.children.get(c.id)).name, 'Mia R');
    assert.equal((await db.children.get(c.id))._d, 'other');
    assert.equal((await db.children.get(extra.id))._u, 5);
  });

  test('changes for stores that do not sync are refused', async () => {
    const n = await db.syncData.apply([{ s: 'meta', r: { id: 'x', key: 'caregiverName', value: 'Evil' } }]);
    assert.equal(n, 0);
    assert.equal(await db.meta.get('caregiverName', ''), '');
  });

  test('stampAll gives records from before sync a stamp, so they can be sent', async () => {
    const conn = await db.openDb();
    await new Promise((res) => { const t = conn.transaction(['children'], 'readwrite'); t.objectStore('children').put({ id: 'legacy', name: 'Old', createdAt: NOW }); t.oncomplete = res; });
    await db.syncData.stampAll();
    const got = await db.children.get('legacy');
    assert.equal(got._d, db.deviceId());
    const snap = await db.syncData.snapshot();
    assert.ok(snap.children.some((x) => x.id === 'legacy'));
  });
});
