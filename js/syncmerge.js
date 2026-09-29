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

/**
 * @typedef {{id: string, _u?: number, _d?: string, [k: string]: unknown}} Rec
 * @typedef {{s: string, r: Rec}} Change
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
  if (local && !newer(remote, local)) return null;
  const keep = LOCAL_FIELDS[store] ?? [];
  if (!local || keep.length === 0) return { ...remote };
  const out = { ...remote };
  for (const k of keep) {
    if (k in local) out[k] = local[k];
    else delete out[k];
  }
  return out;
}

/**
 * A record as it travels: without this phone's own fields.
 * @param {string} store @param {Rec} r @returns {Rec}
 */
export function forWire(store, r) {
  const keep = LOCAL_FIELDS[store] ?? [];
  if (keep.length === 0) return r;
  const out = { ...r };
  for (const k of keep) delete out[k];
  return out;
}

/**
 * This phone's changes since `since`, from every shared store.
 * @param {Record<string, Rec[]>} data  store name -> all its records
 * @param {string} me  this phone's id
 * @param {number} since
 * @param {{all?: boolean}} [opts]  all: every stamped record, whichever phone made it (a new pairing)
 * @returns {Change[]}
 */
export function outgoing(data, me, since, opts = {}) {
  /** @type {Change[]} */
  const out = [];
  for (const s of SYNCED_STORES) {
    for (const r of data[s] ?? []) {
      if (typeof r._u !== 'number') continue;
      if (opts.all || (r._d === me && r._u > since)) out.push({ s, r: forWire(s, r) });
    }
  }
  return out;
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
