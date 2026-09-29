// @ts-check
/* Merging records between linked phones. Pure; tested in tests/syncmerge.test.mjs.

   Every shared record carries `_u` (when it last changed, UTC ms) and `_d`
   (the id of the phone that changed it), written by db.js. The later change
   wins; on the same millisecond the higher phone id wins, so both phones
   always pick the same one. Records are never hard-deleted (doses carry
   deletedAt, children archivedAt), so "last change wins" never loses a dose:
   a deletion is just a newer version, and the audit trail keeps every step. */

/** The stores both phones share. Settings (meta) stay per phone, and label photos stay where they were taken. */
export const SYNCED_STORES = /** @type {const} */ (['children', 'weights', 'bottles', 'doses', 'audit', 'reminders', 'symptoms']);

/** Fields that belong to one phone only. `planned` is when this phone's reminder is next due; each phone works it out itself. */
const LOCAL_FIELDS = /** @type {Record<string, string[]>} */ ({ reminders: ['planned'] });
/** `_s` is this phone's own change counter (db.js); it means nothing on another phone. */
const NEVER_SENT = ['_s'];

/**
 * @typedef {{id: string, _u?: number, _d?: string, [k: string]: unknown}} Rec
 * @typedef {{s: string, r: Rec, seq?: number, at?: number}} Change
 */

/** Is `a` a later change than `b`? @param {Rec} a @param {Rec | undefined} b */
export function newer(a, b) {
  if (!b) return true;
  const au = a._u ?? 0;
  const bu = b._u ?? 0;
  if (au !== bu) return au > bu;
  return (a._d ?? '') > (b._d ?? '');
}

/**
 * What to write for a record that arrived from another phone, or null to keep ours.
 * @param {string} store @param {Rec | undefined} local @param {Rec} remote
 * @returns {Rec | null}
 */
export function mergeRecord(store, local, remote) {
  if (store === 'doses' && local && (local.deletedAt || remote.deletedAt || local.restoredAt || remote.restoredAt)) {
    // A deletion is not undone by an edit made on the other phone at about
    // the same time; only an explicit restore (restoredAt) after it undoes it.
    const del = deletionOf(local, remote);
    if (!newer(remote, local)) {
      return (local.deletedAt ?? null) === del.deletedAt ? null : { ...local, deletedAt: del.deletedAt, restoredAt: del.restoredAt };
    }
    const out = keepLocal(store, local, { ...remote });
    out.deletedAt = del.deletedAt;
    if (del.restoredAt !== null) out.restoredAt = del.restoredAt;
    return out;
  }
  if (local && !newer(remote, local)) return null;
  return local ? keepLocal(store, local, { ...remote }) : { ...remote };
}

/** @param {string} store @param {Rec} local @param {Rec} out */
function keepLocal(store, local, out) {
  for (const k of LOCAL_FIELDS[store] ?? []) {
    if (k in local) out[k] = local[k];
    else delete out[k];
  }
  return out;
}

/** The latest of the two phones' deletes and restores decides. @param {Rec} a @param {Rec} b */
function deletionOf(a, b) {
  const d = Math.max(Number(a.deletedAt ?? 0), Number(b.deletedAt ?? 0));
  const r = Math.max(Number(a.restoredAt ?? 0), Number(b.restoredAt ?? 0));
  return { deletedAt: d > r ? d : null, restoredAt: r > 0 ? r : null };
}

/**
 * A record as it travels: without this phone's own fields.
 * @param {string} store @param {Rec} r @returns {Rec}
 */
export function forWire(store, r) {
  const drop = [...(LOCAL_FIELDS[store] ?? []), ...NEVER_SENT].filter((k) => k in r);
  if (drop.length === 0) return r;
  const out = { ...r };
  for (const k of drop) delete out[k];
  return out;
}

/**
 * This phone's changes not yet sent, from every shared store: by its own
 * change counter (`_s`), so a phone clock set back or forward cannot hide a
 * change. Records stamped before the counter existed go by time, once.
 * @param {Record<string, Rec[]>} data  store name -> all its records
 * @param {string} me  this phone's id
 * @param {{seq: number, time: number}} since  the counter and time already sent up to
 * @param {{all?: boolean}} [opts]  all: every stamped record, whichever phone made it (a new pairing)
 * @returns {Change[]}
 */
export function outgoing(data, me, since, opts = {}) {
  /** @type {Change[]} */
  const out = [];
  for (const s of SYNCED_STORES) {
    for (const r of data[s] ?? []) {
      if (typeof r._u !== 'number') continue;
      const fresh = typeof r._s === 'number' ? r._s > since.seq : r._u > since.time;
      if (opts.all || (r._d === me && fresh)) out.push({ s, r: forWire(s, r), seq: typeof r._s === 'number' ? r._s : undefined, at: r._u });
    }
  }
  return out;
}

/**
 * How far the counter can be marked as sent: past everything sent, except
 * changes stamped in the last `guardMs` (one of those could have been
 * written while the list was being read); those go again next time.
 * @param {Array<{seq?: number, at?: number, r: Rec}>} sent @param {number} prev @param {number} started @param {number} guardMs
 */
export function pushedMark(sent, prev, started, guardMs) {
  const counted = sent.filter((c) => typeof (c.seq ?? c.r._s) === 'number');
  if (!counted.length) return prev;
  const recent = counted.filter((c) => Number(c.at ?? c.r._u) > started - guardMs).map((c) => Number(c.seq ?? c.r._s));
  if (recent.length) return Math.max(prev, Math.min(...recent) - 1);
  return Math.max(prev, ...counted.map((c) => Number(c.seq ?? c.r._s)));
}

/**
 * Split changes into pieces of at most `maxChars` of JSON each (one change
 * bigger than that goes alone), keeping their order.
 * @param {Change[]} changes @param {number} maxChars @returns {Change[][]}
 */
export function chunk(changes, maxChars) {
  /** @type {Change[][]} */
  const parts = [];
  /** @type {Change[]} */
  let cur = [];
  let size = 2;
  for (const c of changes) {
    const n = JSON.stringify(c).length + 1;
    if (cur.length && size + n > maxChars) { parts.push(cur); cur = []; size = 2; }
    cur.push(c);
    size += n;
  }
  if (cur.length) parts.push(cur);
  return parts;
}
