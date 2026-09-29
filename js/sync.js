// @ts-check
/* Sync between linked phones (Settings > Linked phones).

   Each run sends this phone's changes since the last send, sealed with the
   family key (synccrypto.js), then fetches every sealed batch it has not
   seen, opens it, and merges it (db.syncData.apply, syncmerge.js). The
   server only ever holds sealed blobs. Runs on open, after any change, every
   couple of minutes while open, when the app comes to the front, and right
   before a dose is logged (the confirm screen).

   If the network is down nothing is lost: changes stay stamped on the phone
   and go on the next run. */

import * as db from './db.js';
import { SYNC_URL } from './config.js';
import { newFamily, linkText, readLink, authToken, seal, open } from './synccrypto.js';
import { outgoing, chunk, pushedMark } from './syncmerge.js';
import { duplicateChildren, duplicateBottles } from './syncchecks.js';
import { isNative, setNativeSyncKey, registerPush, nudgePayload } from './native.js';
import { upcomingNotices } from './reminders.js';

/**
 * @typedef {{fid: string, key: string, pushed: number, pushedSeq?: number, cursor: number, linkedAt: number, sendAll?: boolean, otherAt?: number, otherName?: string, sentName?: string}} SyncConfig
 *   otherName: the name the other phone's user gave (Settings → Your name), sent sealed with each batch
 *   otherAt: when a change from another phone last arrived (never: the other phone has not linked yet)
 * @typedef {{okAt?: number, errorAt?: number, error?: string}} SyncStatus
 */

const BATCH_CHARS = 150000;
/** Largest sealed nudge the server passes on (it must fit in a Firebase message). */
const MAX_NUDGE_CHARS = 3400;
const PUSH_BLOBS = 20;
/* A record stamped just before a send can commit just after it read the
   database. Sending from a little earlier than the last send means such a
   record is sent next time; sending one twice is harmless. */
const OVERLAP_MS = 5000;

export const syncConfigured = () => SYNC_URL !== '';
/** @returns {Promise<SyncConfig | null>} */
export const syncConfig = () => db.meta.get('sync', null);
/** @returns {Promise<SyncStatus>} */
export const syncStatus = () => db.meta.get('syncStatus', {});

/** Start a family on this phone. Returns the text for the QR code. */
export async function startFamily() {
  const existing = await syncConfig();
  if (existing) return linkText(existing, SYNC_URL);
  const f = await newFamily();
  await db.syncData.stampAll();
  await db.meta.set('sync', /** @type {SyncConfig} */ ({ ...f, pushed: 0, cursor: 0, linkedAt: Date.now(), sendAll: true }));
  await setNativeSyncKey(f.key);
  startPush();
  // Even a phone with no records yet puts one sealed "hello" on the server, so
  // a phone joining with this code can tell the code is real.
  try {
    await fetch(`${SYNC_URL}/v1/sync/${f.fid}/push`, { method: 'POST', headers: { Authorization: `Bearer ${await authToken(f.key)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ dev: db.deviceId(), blobs: [await seal(f.key, { v: 1, changes: [], from: await myName() })] }) });
  } catch { /* the first real sync will create it */ }
  syncSoon(0);
  return linkText(f, SYNC_URL);
}

/** The code to show another phone, if this one is linked. */
export async function currentLink() {
  const c = await syncConfig();
  return c ? linkText(c, SYNC_URL) : null;
}

/**
 * Join the family in a scanned or pasted code.
 * @param {string} text
 * @param {{replace: boolean}} opts  replace: drop this phone's records first and take the family's
 */
export async function joinFamily(text, opts) {
  const f = readLink(text);
  if (!f) throw new Error('That is not a WhenDose link code.');
  // Check first, before anything on this phone changes: a code with a typo
  // (or one never shown) finds no other phone, and must not "link" to nothing.
  const found = await probe(f);
  if (found !== 'ok') return { status: found };
  if (opts.replace) await db.syncData.clear();
  else await db.syncData.stampAll();
  await db.meta.set('sync', /** @type {SyncConfig} */ ({ ...f, pushed: 0, pushedSeq: 0, cursor: 0, linkedAt: Date.now(), sendAll: true }));
  await setNativeSyncKey(f.key);
  startPush();
  const r = await syncNow();
  // The same child set up on both phones before linking: make them one.
  let merged = 0;
  if (!opts.replace) {
    for (const g of duplicateChildren(await db.children.list())) {
      for (const from of g.merge) { await db.syncData.moveChild(from, g.keep, { by: (await db.meta.get('caregiverName', '')) || 'WhenDose', at: Date.now() }); merged += 1; }
    }
    if (merged) await syncNow();
  }
  return { ...r, mergedChildren: merged };
}

/** This phone's user, as they named themselves; sent sealed so the other phone can say who it is linked with. */
async function myName() {
  return String(await db.meta.get('caregiverName', '')).trim().slice(0, 40);
}

/**
 * Does this code open a family another phone has already started?
 * @param {{fid: string, key: string}} f
 * @returns {Promise<'ok' | 'not-found' | 'wrong-key' | 'offline'>}
 */
async function probe(f) {
  try {
    const res = await fetch(`${SYNC_URL}/v1/sync/${f.fid}/pull?after=0`, { headers: { Authorization: `Bearer ${await authToken(f.key)}` } });
    if (res.status === 403) return 'wrong-key';
    if (!res.ok) return 'offline';
    const body = await res.json();
    const me = db.deviceId();
    for (const it of body.items ?? []) {
      if (it.dev === me) continue;
      try { await open(f.key, it.blob); return 'ok'; } catch { /* not sealed with this key */ }
    }
    return 'not-found';
  } catch {
    return 'offline';
  }
}

/** Stop syncing on this phone. Its records stay; the other phone keeps its own. */
export async function unlink() {
  await db.meta.set('sync', null);
  await db.meta.set('syncStatus', {});
  await db.meta.set('pushSentFor', null);
  await setNativeSyncKey(null);
}

/** @type {Promise<{status: 'off' | 'ok' | 'error', merged?: number}> | null} */
let running = null;
let again = false;

/** Run a sync now (or join the one already running). */
export function syncNow() {
  if (running) { again = true; return running; }
  running = (async () => {
    let r;
    do {
      again = false;
      r = await run();
    } while (again);
    return r;
  })().finally(() => { running = null; });
  return running;
}

/**
 * Sync, but give up waiting after `ms` (the sync carries on in the background).
 * @param {number} ms @returns {Promise<'ok' | 'error' | 'off' | 'timeout'>}
 */
export async function syncWithin(ms) {
  if (!syncConfigured() || !(await syncConfig())) return 'off';
  const r = await Promise.race([syncNow(), new Promise((res) => setTimeout(() => res(null), ms))]);
  return r === null ? 'timeout' : /** @type {{status: 'off' | 'ok' | 'error'}} */ (r).status;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let soonTimer;
/** Sync shortly: after a change, many changes in a row become one run. @param {number} [ms] */
export function syncSoon(ms = 1500) {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => { syncNow(); }, ms);
}

/** @returns {Promise<{status: 'off' | 'ok' | 'error', merged?: number}>} */
async function run() {
  const cfg = await syncConfig();
  if (!cfg || !syncConfigured()) return { status: 'off' };
  const me = db.deviceId();
  const auth = { Authorization: `Bearer ${await authToken(cfg.key)}` };
  const base = `${SYNC_URL}/v1/sync/${cfg.fid}`;
  try {
    const started = Date.now();
    // A new pairing sends everything this phone has, once, including what it got from another phone before.
    const out = outgoing(await db.syncData.snapshot(), me, { seq: cfg.pushedSeq ?? 0, time: cfg.pushed }, { all: cfg.sendAll === true });
    let pushed = cfg.pushed;
    let pushedSeq = cfg.pushedSeq ?? 0;
    const from = await myName();
    // Nothing to send, but this phone's name is new to the other phone: say hello.
    if (!out.length && from && cfg.sentName !== from) {
      const res = await fetch(`${base}/push`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ dev: me, blobs: [await seal(cfg.key, { v: 1, changes: [], from })] }) });
      if (!res.ok) throw new Error(`send failed (${res.status})`);
    }
    if (out.length) {
      const blobs = [];
      for (const part of chunk(out, BATCH_CHARS)) blobs.push(await seal(cfg.key, { v: 1, changes: part, from }));
      const nudge = await sealedNudge(cfg.key);
      for (let i = 0; i < blobs.length; i += PUSH_BLOBS) {
        const last = i + PUSH_BLOBS >= blobs.length;
        const res = await fetch(`${base}/push`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ dev: me, blobs: blobs.slice(i, i + PUSH_BLOBS), ...(last && nudge ? { nudge } : {}) }) });
        if (!res.ok) throw new Error(`send failed (${res.status})`);
      }
      pushed = Math.min(Math.max(...out.map((c) => /** @type {number} */ (c.r._u))), started - OVERLAP_MS);
      pushedSeq = pushedMark(out.filter((c) => c.r._d === me), pushedSeq, started, OVERLAP_MS);
    }

    let cursor = cfg.cursor;
    let merged = 0;
    let otherAt = cfg.otherAt;
    let otherName = cfg.otherName;
    for (let more = true; more;) {
      const res = await fetch(`${base}/pull?after=${cursor}`, { headers: auth });
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const body = await res.json();
      for (const it of body.items ?? []) {
        // This phone's own earlier changes come back too: after "use the
        // other phone's records" or deleting all data, they are not here any
        // more. Merging a record this phone already has changes nothing.
        /** @type {any} */
        let payload;
        try { payload = await open(cfg.key, it.blob); } catch { continue; } // not ours, or damaged: skip it
        if (it.dev !== me) {
          otherAt = Date.now();
          if (typeof payload?.from === 'string' && payload.from.trim()) otherName = payload.from.trim().slice(0, 40);
        }
        if (payload?.v === 1 && Array.isArray(payload.changes)) merged += await db.syncData.apply(payload.changes);
      }
      cursor = Number(body.last ?? cursor);
      more = body.more === true;
    }

    const now = await syncConfig();
    if (now && now.fid === cfg.fid) await db.meta.set('sync', { ...now, pushed: Math.max(now.pushed, pushed), pushedSeq: Math.max(now.pushedSeq ?? 0, pushedSeq), cursor, sendAll: false, ...(otherAt ? { otherAt } : {}), ...(otherName ? { otherName } : {}), ...(from ? { sentName: from } : {}) });
    await db.meta.set('syncStatus', /** @type {SyncStatus} */ ({ okAt: Date.now() }));
    // The same medicine on both phones (added before linking): make it one.
    // Both phones choose the same one to keep, so they agree.
    for (const g of duplicateBottles(await db.bottles.list())) for (const from of g.merge) { await db.syncData.mergeBottle(from, g.keep, Date.now()); merged += 1; }
    if (merged > 0) globalThis.dispatchEvent?.(new CustomEvent('whendose:synced', { detail: { merged } }));
    return { status: 'ok', merged };
  } catch (err) {
    const prev = await syncStatus();
    await db.meta.set('syncStatus', /** @type {SyncStatus} */ ({ ...prev, errorAt: Date.now(), error: err instanceof Error ? err.message : String(err) }));
    return { status: 'error' };
  }
}

/**
 * The new reminder times, sealed for the other phones, so a closed app can
 * move its alarms (NudgeService). As many as fit; '' if none.
 * @param {string} key
 */
async function sealedNudge(key) {
  const upcoming = await upcomingNotices();
  for (let n = upcoming.length; n >= 0; n -= 1) {
    const sealed = await seal(key, nudgePayload(upcoming, n));
    if (sealed.length <= MAX_NUDGE_CHARS) return sealed;
  }
  return '';
}

/** Android app: register this phone's push token with the family, once per token. */
function startPush() {
  if (!isNative()) return;
  registerPush(async (token) => {
    const cfg = await syncConfig();
    if (!cfg) return;
    const sentFor = await db.meta.get('pushSentFor', null);
    if (sentFor === `${cfg.fid}:${token}`) return;
    try {
      const res = await fetch(`${SYNC_URL}/v1/sync/${cfg.fid}/device`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await authToken(cfg.key)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dev: db.deviceId(), fcm: token }),
      });
      if (res.ok) await db.meta.set('pushSentFor', `${cfg.fid}:${token}`);
    } catch { /* tried again next launch */ }
  }, () => syncNow());
}

/** Start the background rhythm: on open, every couple of minutes while open, and on returning to the front. */
export function startSync() {
  db.setOnWrite(() => syncSoon());
  syncConfig().then(async (cfg) => { if (cfg) { await setNativeSyncKey(cfg.key); startPush(); } });
  syncSoon(500);
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  addEventListener('online', () => syncNow());
}
