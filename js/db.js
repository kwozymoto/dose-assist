// @ts-check
/* Local storage: IndexedDB, on this device only. No account, no server.

   Rules this module enforces (CLAUDE.md):
   - Dose records are never hard-deleted. remove() sets deletedAt and writes
     a DoseAudit entry; edit() writes one with before and after.
   - Every dose write and its audit entry commit in one transaction, so
     there is never a dose without its history or a history without its dose.
   - The only hard delete is deleteEverything(), the user's own "delete all
     data" in Settings.

   sw.js reads the `reminders` store directly. It opens the database without
   a version and aborts if it would create it, so it can never race the app
   into an empty schema. Keep DB_NAME and the store name in step with it. */

export const DB_NAME = 'dose-assist';

/* Append-only. Each entry upgrades from the version before it. Never edit a
   shipped step: a device that already ran it will not run it again. */
const MIGRATIONS = [
  /* v1 */ (/** @type {IDBDatabase} */ db) => {
    db.createObjectStore('children', { keyPath: 'id' });
    const w = db.createObjectStore('weights', { keyPath: 'id' });
    w.createIndex('childId', 'childId');
    db.createObjectStore('bottles', { keyPath: 'id' });
    db.createObjectStore('photos', { keyPath: 'id' });
    const d = db.createObjectStore('doses', { keyPath: 'id' });
    d.createIndex('childId', 'childId');
    d.createIndex('givenAt', 'givenAt');
    const a = db.createObjectStore('audit', { keyPath: 'id' });
    a.createIndex('doseId', 'doseId');
    const r = db.createObjectStore('reminders', { keyPath: 'id' });
    r.createIndex('childId', 'childId');
    const s = db.createObjectStore('symptoms', { keyPath: 'id' });
    s.createIndex('childId', 'childId');
    db.createObjectStore('meta', { keyPath: 'key' });
  },
];
export const DB_VERSION = MIGRATIONS.length;
export const STORES = ['children', 'weights', 'bottles', 'photos', 'doses', 'audit', 'reminders', 'symptoms', 'meta'];

/**
 * @typedef {object} Child
 * @property {string} id
 * @property {string} name
 * @property {string} colour
 * @property {string | null} dateOfBirth  YYYY-MM-DD
 * @property {string} [notes]
 * @property {number} createdAt
 * @property {number | null} [archivedAt]
 *
 * @typedef {object} WeightRecord
 * @property {string} id
 * @property {string} childId
 * @property {number} kg
 * @property {number} recordedAt
 *
 * @typedef {object} BottleComponent
 * @property {string} ingredient
 * @property {number} strengthMg
 * @property {number} strengthPer
 *
 * @typedef {object} Bottle
 * @property {string} id
 * @property {string | null} productId  from data/products.json, or null for custom
 * @property {string} name
 * @property {'liquid' | 'tablet' | 'chewable'} form
 * @property {BottleComponent[]} components
 * @property {string | null} [photoId]
 * @property {string} [notes]
 * @property {number} addedAt
 * @property {number | null} [archivedAt]
 *
 * @typedef {object} DoseRecord
 * @property {string} id
 * @property {string} childId
 * @property {string} bottleId
 * @property {{name: string, form: string, components: BottleComponent[], productId: string | null}} bottle  snapshot at the time
 * @property {number} amount
 * @property {import('./engine/types.js').Component[]} components  mg per ingredient
 * @property {number} givenAt
 * @property {number} loggedAt
 * @property {string} givenBy
 * @property {number | null} weightKgUsed
 * @property {string} rulesVersion
 * @property {'DOCTOR_ADVISED' | 'ALREADY_GIVEN' | null} overrideReason
 * @property {string} [statusAtLog]   the engine's status when it was logged
 * @property {string} [note]
 * @property {number | null} [deletedAt]
 *
 * @typedef {object} DoseAudit
 * @property {string} id
 * @property {string} doseId
 * @property {'create' | 'edit' | 'delete' | 'restore'} action
 * @property {Partial<DoseRecord> | null} before
 * @property {Partial<DoseRecord> | null} after
 * @property {number} at
 * @property {string} by
 * @property {string} [reason]
 *
 * A reminder is an intent, not a time. 'next_allowed' fires when the rules
 * next allow a dose, recomputed whenever doses change; 'scheduled' fires at
 * a time the parent chose.
 * @typedef {object} Reminder
 * @property {string} id
 * @property {string} childId
 * @property {'next_allowed' | 'scheduled'} kind
 * @property {string[]} ingredients
 * @property {string} [bottleId]
 * @property {number | null} [fireAt]     scheduled only
 * @property {string} [label]            scheduled only, e.g. "Doctor's schedule"
 * @property {number} createdAt
 * @property {number | null} [firedAt]
 * @property {number | null} [cancelledAt]
 * @property {{fireAt: number} | null} [planned]  written by reminders.js, read by sw.js
 *
 * @typedef {object} SymptomEntry
 * @property {string} id
 * @property {string} childId
 * @property {number} at
 * @property {number | null} temperatureC
 * @property {string[]} flags
 * @property {string} [notes]
 * @property {string} by
 * @property {number | null} [deletedAt]
 */

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/** @returns {Promise<IDBDatabase>} */
export function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion; v < DB_VERSION; v += 1) MIGRATIONS[v](db);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opening a newer version: step aside so it can upgrade.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => { opening = null; reject(req.error); };
    req.onblocked = () => { /* waits for the other tab to close; onsuccess follows */ };
  });
  return opening;
}

/** For tests: forget the cached connection. */
export async function closeDb() {
  if (!opening) return;
  const db = await opening;
  db.close();
  opening = null;
}

/** @param {IDBRequest} req @returns {Promise<any>} */
const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Run `fn` in one transaction; resolves after it commits.
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function tx(stores, mode, fn) {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const committed = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(undefined);
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    t.onerror = () => reject(t.error);
  });
  /** @type {T} */
  let result;
  try {
    result = await fn(t);
  } catch (err) {
    try { t.abort(); } catch { /* already finished */ }
    await committed.catch(() => {});
    throw err;
  }
  await committed;
  return result;
}

/** @param {string} store @returns {Promise<any[]>} */
const all = (store) => tx([store], 'readonly', (t) => done(t.objectStore(store).getAll()));
/** @param {string} store @param {string} id */
const get = (store, id) => tx([store], 'readonly', (t) => done(t.objectStore(store).get(id)));
/** @param {string} store @param {object} value */
const put = (store, value) => tx([store], 'readwrite', (t) => done(t.objectStore(store).put(value)));
/** @param {string} store @param {string} index @param {string} key @returns {Promise<any[]>} */
const byIndex = (store, index, key) => tx([store], 'readonly', (t) => done(t.objectStore(store).index(index).getAll(key)));

export const uid = () => crypto.randomUUID();

/* ---------------- children ---------------- */

export const children = {
  /** @returns {Promise<Child[]>} active children, oldest first by createdAt */
  async list({ includeArchived = false } = {}) {
    /** @type {Child[]} */
    const rows = await all('children');
    return rows.filter((c) => includeArchived || !c.archivedAt).sort((a, b) => a.createdAt - b.createdAt);
  },
  /** @param {string} id @returns {Promise<Child | undefined>} */
  get: (id) => get('children', id),
  /** @param {Child} child */
  save: (child) => put('children', child),
  /** @param {string} id @param {number} at */
  async archive(id, at) {
    const c = await get('children', id);
    if (c) await put('children', { ...c, archivedAt: at });
  },
  /** @param {string} id */
  async unarchive(id) {
    const c = await get('children', id);
    if (c) await put('children', { ...c, archivedAt: null });
  },
};

/* ---------------- weights ---------------- */

export const weights = {
  /** @param {WeightRecord} w */
  add: (w) => put('weights', w),
  /** @param {string} childId @returns {Promise<WeightRecord[]>} newest first */
  async forChild(childId) {
    /** @type {WeightRecord[]} */
    const rows = await byIndex('weights', 'childId', childId);
    return rows.sort((a, b) => b.recordedAt - a.recordedAt);
  },
  /** @param {string} childId @returns {Promise<WeightRecord | undefined>} */
  async latest(childId) {
    return (await weights.forChild(childId))[0];
  },
};

/* ---------------- bottles ---------------- */

export const bottles = {
  /** @returns {Promise<Bottle[]>} */
  async list({ includeArchived = false } = {}) {
    /** @type {Bottle[]} */
    const rows = await all('bottles');
    return rows.filter((b) => includeArchived || !b.archivedAt).sort((a, b) => a.addedAt - b.addedAt);
  },
  /** @param {string} id @returns {Promise<Bottle | undefined>} */
  get: (id) => get('bottles', id),
  /** @param {Bottle} b */
  save: (b) => put('bottles', b),
  /** @param {string} id @param {number} at */
  async archive(id, at) {
    const b = await get('bottles', id);
    if (b) await put('bottles', { ...b, archivedAt: at });
  },
};

export const photos = {
  /** @param {{id: string, dataUrl: string, at: number}} p */
  save: (p) => put('photos', p),
  /** @param {string} id @returns {Promise<{id: string, dataUrl: string, at: number} | undefined>} */
  get: (id) => get('photos', id),
};

/* ---------------- doses ---------------- */

/** Fields a person may change on a logged dose. Everything else is history. */
export const EDITABLE = /** @type {const} */ (['givenAt', 'amount', 'components', 'givenBy', 'note']);

export const doses = {
  /**
   * Log a dose and its 'create' audit entry, together.
   * @param {DoseRecord} dose @param {string} by
   */
  async add(dose, by) {
    await tx(['doses', 'audit'], 'readwrite', async (t) => {
      const existing = await done(t.objectStore('doses').get(dose.id));
      if (existing) throw new Error(`dose ${dose.id} already exists`);
      t.objectStore('doses').put(dose);
      t.objectStore('audit').put(/** @type {DoseAudit} */ ({ id: uid(), doseId: dose.id, action: 'create', before: null, after: dose, at: dose.loggedAt, by }));
    });
    return dose;
  },

  /**
   * Change the editable fields of a dose, writing before and after.
   * @param {string} id
   * @param {Partial<Pick<DoseRecord, 'givenAt' | 'amount' | 'components' | 'givenBy' | 'note'>>} changes
   * @param {{by: string, at: number, reason?: string}} who
   * @returns {Promise<DoseRecord>}
   */
  async edit(id, changes, who) {
    for (const k of Object.keys(changes)) {
      if (!(/** @type {readonly string[]} */ (EDITABLE)).includes(k)) throw new Error(`cannot edit ${k}`);
    }
    return tx(['doses', 'audit'], 'readwrite', async (t) => {
      /** @type {DoseRecord | undefined} */
      const before = await done(t.objectStore('doses').get(id));
      if (!before) throw new Error(`no dose ${id}`);
      if (before.deletedAt) throw new Error('cannot edit a deleted dose');
      const after = { ...before, ...changes };
      /** @type {Record<string, unknown>} */
      const b = {};
      /** @type {Record<string, unknown>} */
      const a = {};
      for (const k of Object.keys(changes)) {
        b[k] = /** @type {any} */ (before)[k];
        a[k] = /** @type {any} */ (after)[k];
      }
      t.objectStore('doses').put(after);
      t.objectStore('audit').put(/** @type {DoseAudit} */ ({ id: uid(), doseId: id, action: 'edit', before: b, after: a, at: who.at, by: who.by, ...(who.reason ? { reason: who.reason } : {}) }));
      return after;
    });
  },

  /**
   * Soft delete. The record stays, marked, with an audit entry saying who and why.
   * @param {string} id @param {{by: string, at: number, reason?: string}} who
   */
  async remove(id, who) {
    return tx(['doses', 'audit'], 'readwrite', async (t) => {
      /** @type {DoseRecord | undefined} */
      const before = await done(t.objectStore('doses').get(id));
      if (!before) throw new Error(`no dose ${id}`);
      if (before.deletedAt) return before;
      const after = { ...before, deletedAt: who.at };
      t.objectStore('doses').put(after);
      t.objectStore('audit').put(/** @type {DoseAudit} */ ({ id: uid(), doseId: id, action: 'delete', before: { deletedAt: null }, after: { deletedAt: who.at }, at: who.at, by: who.by, ...(who.reason ? { reason: who.reason } : {}) }));
      return after;
    });
  },

  /** Undo a soft delete. @param {string} id @param {{by: string, at: number, reason?: string}} who */
  async restore(id, who) {
    return tx(['doses', 'audit'], 'readwrite', async (t) => {
      /** @type {DoseRecord | undefined} */
      const before = await done(t.objectStore('doses').get(id));
      if (!before) throw new Error(`no dose ${id}`);
      if (!before.deletedAt) return before;
      const after = { ...before, deletedAt: null };
      t.objectStore('doses').put(after);
      t.objectStore('audit').put(/** @type {DoseAudit} */ ({ id: uid(), doseId: id, action: 'restore', before: { deletedAt: before.deletedAt }, after: { deletedAt: null }, at: who.at, by: who.by, ...(who.reason ? { reason: who.reason } : {}) }));
      return after;
    });
  },

  /** @param {string} id @returns {Promise<DoseRecord | undefined>} */
  get: (id) => get('doses', id),

  /**
   * A child's doses, newest first. Deleted ones only when asked.
   * @param {string} childId @returns {Promise<DoseRecord[]>}
   */
  async forChild(childId, { includeDeleted = false } = {}) {
    /** @type {DoseRecord[]} */
    const rows = await byIndex('doses', 'childId', childId);
    return rows.filter((d) => includeDeleted || !d.deletedAt).sort((a, b) => b.givenAt - a.givenAt);
  },

  /** @returns {Promise<DoseRecord[]>} every dose, including deleted */
  all: () => all('doses'),

  /** @param {string} doseId @returns {Promise<DoseAudit[]>} oldest first */
  async audit(doseId) {
    /** @type {DoseAudit[]} */
    const rows = await byIndex('audit', 'doseId', doseId);
    return rows.sort((a, b) => a.at - b.at);
  },
};

/* ---------------- reminders ---------------- */

export const reminders = {
  /** @returns {Promise<Reminder[]>} not fired, not cancelled */
  async active() {
    /** @type {Reminder[]} */
    const rows = await all('reminders');
    return rows.filter((r) => !r.firedAt && !r.cancelledAt);
  },
  /** @returns {Promise<Reminder[]>} */
  all: () => all('reminders'),
  /** @param {string} id @returns {Promise<Reminder | undefined>} */
  get: (id) => get('reminders', id),
  /**
   * Add a reminder. Any earlier active reminder for the same child that
   * shares an ingredient is superseded: one reminder per child per
   * ingredient, so the newest instruction always wins.
   * @param {Reminder} r
   */
  async add(r) {
    await tx(['reminders'], 'readwrite', async (t) => {
      const store = t.objectStore('reminders');
      /** @type {Reminder[]} */
      const existing = await done(store.index('childId').getAll(r.childId));
      for (const e of existing) {
        if (!e.firedAt && !e.cancelledAt && e.ingredients.some((i) => r.ingredients.includes(i))) {
          store.put({ ...e, cancelledAt: r.createdAt });
        }
      }
      store.put(r);
    });
    return r;
  },
  /** @param {string} id @param {number} at */
  async cancel(id, at) {
    const r = await get('reminders', id);
    if (r && !r.cancelledAt) await put('reminders', { ...r, cancelledAt: at });
  },
  /** @param {string} id @param {number} at */
  async markFired(id, at) {
    const r = await get('reminders', id);
    if (r && !r.firedAt) await put('reminders', { ...r, firedAt: at });
  },
  /**
   * The time this reminder is currently planned for. sw.js checks a pushed
   * message against it and refuses to present a superseded one as current.
   * @param {string} id @param {{fireAt: number} | null} planned
   */
  async setPlanned(id, planned) {
    const r = await get('reminders', id);
    if (r) await put('reminders', { ...r, planned });
  },
};

/* ---------------- symptoms ---------------- */

export const symptoms = {
  /** @param {SymptomEntry} s */
  save: (s) => put('symptoms', s),
  /** @param {string} childId @returns {Promise<SymptomEntry[]>} newest first */
  async forChild(childId) {
    /** @type {SymptomEntry[]} */
    const rows = await byIndex('symptoms', 'childId', childId);
    return rows.filter((s) => !s.deletedAt).sort((a, b) => b.at - a.at);
  },
  /** @param {string} id @param {number} at */
  async remove(id, at) {
    const s = await get('symptoms', id);
    if (s) await put('symptoms', { ...s, deletedAt: at });
  },
};

/* ---------------- meta (settings) ---------------- */

export const meta = {
  /** @template T @param {string} key @param {T} [fallback] @returns {Promise<T>} */
  async get(key, fallback) {
    const row = await get('meta', key);
    return row === undefined ? /** @type {T} */ (fallback) : row.value;
  },
  /** @param {string} key @param {unknown} value */
  set: (key, value) => put('meta', { key, value }),
};

/* ---------------- whole-database ---------------- */

export const EXPORT_FORMAT = 'dose-assist-export';

/** Everything, for a backup file. @param {number} at */
export async function exportAll(at) {
  /** @type {Record<string, any[]>} */
  const data = {};
  await tx(STORES, 'readonly', async (t) => {
    for (const s of STORES) data[s] = await done(t.objectStore(s).getAll());
  });
  return { format: EXPORT_FORMAT, version: DB_VERSION, exportedAt: at, data };
}

/**
 * Replace everything with a backup file's contents, in one transaction: if
 * any row fails, nothing changes.
 * @param {any} file
 */
export async function importAll(file) {
  if (!file || file.format !== EXPORT_FORMAT || typeof file.data !== 'object') throw new Error('This is not a Dose Assist backup file.');
  if (typeof file.version !== 'number' || file.version > DB_VERSION) throw new Error('This backup is from a newer version of the app. Update the app first.');
  await tx(STORES, 'readwrite', async (t) => {
    for (const s of STORES) {
      const store = t.objectStore(s);
      store.clear();
      for (const row of file.data[s] ?? []) store.put(row);
    }
  });
}

/** The user's "delete all data". The only hard delete there is. */
export async function deleteEverything() {
  await tx(STORES, 'readwrite', (t) => {
    for (const s of STORES) t.objectStore(s).clear();
  });
}
