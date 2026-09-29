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
import { outgoing, chunk } from './syncmerge.js';
import { isNative, setNativeSyncKey, registerPush, nudgePayload } from './native.js';
import { upcomingNotices } from './reminders.js';

/**
 * @typedef {{fid: string, key: string, pushed: number, cursor: number, linkedAt: number, sendAll?: boolean}} SyncConfig
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
  if (existing) return linkText(existing);
  const f = await newFamily();
  await db.syncData.stampAll();
  await db.meta.set('sync', /** @type {SyncConfig} */ ({ ...f, pushed: 0, cursor: 0, linkedAt: Date.now(), sendAll: true }));
  await setNativeSyncKey(f.key);
  startPush();
  syncSoon(0);
  return linkText(f);
}

/** The code to show another phone, if this one is linked. */
export async function currentLink() {
  const c = await syncConfig();
  return c ? linkText(c) : null;
}

/**
 * Join the family in a scanned or pasted code.
 * @param {string} text
 * @param {{replace: boolean}} opts  replace: drop this phone's records first and take the family's
 */
export async function joinFamily(text, opts) {
  const f = readLink(text);
  if (!f) throw new Error('That is not a WhenDose link code.');
  if (opts.replace) await db.syncData.clear();
  else await db.syncData.stampAll();
  await db.meta.set('sync', /** @type {SyncConfig} */ ({ ...f, pushed: 0, cursor: 0, linkedAt: Date.now(), sendAll: true }));
  await setNativeSyncKey(f.key);
  startPush();
  return syncNow();
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
    const out = outgoing(await db.syncData.snapshot(), me, cfg.pushed, { all: cfg.sendAll === true });
    let pushed = cfg.pushed;
    if (out.length) {
      const blobs = [];
      for (const part of chunk(out, BATCH_CHARS)) blobs.push(await seal(cfg.key, { v: 1, changes: part }));
      const nudge = await sealedNudge(cfg.key);
      for (let i = 0; i < blobs.length; i += PUSH_BLOBS) {
        const last = i + PUSH_BLOBS >= blobs.length;
        const res = await fetch(`${base}/push`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ dev: me, blobs: blobs.slice(i, i + PUSH_BLOBS), ...(last && nudge ? { nudge } : {}) }) });
        if (!res.ok) throw new Error(`send failed (${res.status})`);
      }
      pushed = Math.min(Math.max(...out.map((c) => /** @type {number} */ (c.r._u))), started - OVERLAP_MS);
    }

    let cursor = cfg.cursor;
    let merged = 0;
    for (let more = true; more;) {
      const res = await fetch(`${base}/pull?after=${cursor}`, { headers: auth });
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const body = await res.json();
      for (const it of body.items ?? []) {
        if (it.dev === me) continue;
        /** @type {any} */
        let payload;
        try { payload = await open(cfg.key, it.blob); } catch { continue; } // not ours, or damaged: skip it
        if (payload?.v === 1 && Array.isArray(payload.changes)) merged += await db.syncData.apply(payload.changes);
      }
      cursor = Number(body.last ?? cursor);
      more = body.more === true;
    }

    const now = await syncConfig();
    if (now && now.fid === cfg.fid) await db.meta.set('sync', { ...now, pushed: Math.max(now.pushed, pushed), cursor, sendAll: false });
    await db.meta.set('syncStatus', /** @type {SyncStatus} */ ({ okAt: Date.now() }));
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
