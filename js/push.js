// @ts-check
/* Push reminders, for when the app is closed.

   The phone encrypts each notification to its own push subscription
   (webpush.js) and hands the reminder server only the ciphertext and the
   time to send it. The server never sees a name, a medicine or a dose.

   Until the server is deployed (config.PUSH_URL empty) this reports
   'not-configured' and reminders work only while the app is open. */

import * as db from './db.js';
import { PUSH_URL, VAPID_PUBLIC_KEY } from './config.js';
import { encryptPush, b64url, unb64url } from './webpush.js';
import { noticeRev } from './schedule.js';
import { isNative, nativePermission, requestNativePermission, syncNative } from './native.js';

/** @typedef {import('./schedule.js').Notice} Notice */

/* Push services accept payloads up to 4 KB and the server keeps at most this
   many per device; the soonest are sent, the rest go on the next sync. */
const MAX_ITEMS = 50;

export const pushConfigured = () => PUSH_URL !== '' && VAPID_PUBLIC_KEY !== '';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/* navigator.serviceWorker.ready never settles if registration failed, and
   nothing here may hang the app waiting for it. */
/** @returns {Promise<ServiceWorkerRegistration | null>} */
function swReady(ms = 4000) {
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), ms))]);
}

/**
 * Can this app show a notification? The installed Android app asks Android;
 * a browser has Notification.permission.
 * @returns {Promise<'granted' | 'denied' | 'default'>}
 */
export async function notifyPermission() {
  if (isNative()) {
    const p = await nativePermission();
    return p === 'prompt' ? 'default' : p;
  }
  return 'Notification' in window ? Notification.permission : 'denied';
}

/* In the installed app, "on" means alarms scheduled on the phone, which
   work with the app closed and no internet. The parent can switch them off. */
const nativeStatus = async () => {
  const p = await nativePermission();
  if (p === 'denied') return 'denied';
  if (p === 'prompt' || (await db.meta.get('nativeRemindersOff', false))) return 'off';
  return 'on';
};

/** @returns {Promise<'unsupported' | 'not-configured' | 'denied' | 'off' | 'on'>} */
export async function pushStatus() {
  if (isNative()) return nativeStatus();
  if (!supported()) return 'unsupported';
  if (!pushConfigured()) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await swReady();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Ask for permission and subscribe. Resolves to the new status. */
export async function enablePush() {
  if (isNative()) {
    await db.meta.set('nativeRemindersOff', false);
    await requestNativePermission();
    return nativeStatus();
  }
  if (!supported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  if (!pushConfigured()) return 'not-configured';
  const reg = await swReady();
  if (!reg) return 'unsupported';
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(VAPID_PUBLIC_KEY) }));
  await db.meta.set('pushSyncedHash', null);
  return sub ? 'on' : 'off';
}

export async function disablePush() {
  if (isNative()) {
    await db.meta.set('nativeRemindersOff', true);
    await syncNative([], { off: true });
    return;
  }
  if (!supported()) return;
  const reg = await swReady();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  if (pushConfigured()) {
    try {
      await fetch(`${PUSH_URL}/v1/schedule`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    } catch { /* offline: the server drops it when the subscription dies */ }
  }
  await sub.unsubscribe();
  await db.meta.set('pushSyncedHash', null);
}

/**
 * Send the upcoming notices to the server, replacing whatever it held.
 * Skips the request when nothing has changed since the last one that worked.
 * @param {Notice[]} upcoming  soonest first
 */
export async function syncPush(upcoming) {
  if (isNative()) {
    await syncNative(upcoming, { off: await db.meta.get('nativeRemindersOff', false) });
    return;
  }
  if (!supported() || !pushConfigured() || Notification.permission !== 'granted') return;
  const reg = await swReady();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  const list = upcoming.slice(0, MAX_ITEMS);
  const hash = await digest(JSON.stringify([sub.endpoint, list.map((n) => [n.reminderId, n.fireAt, n.title, n.body])]));
  if ((await db.meta.get('pushSyncedHash', null)) === hash) return;

  const p256dh = sub.getKey('p256dh');
  const auth = sub.getKey('auth');
  if (!p256dh || !auth) return;
  const to = { p256dh: new Uint8Array(p256dh), auth: new Uint8Array(auth) };
  const enc = new TextEncoder();
  const items = [];
  for (const n of list) {
    const payload = { v: 1, rid: n.reminderId, rev: noticeRev(n), title: n.title, body: n.body, tag: n.tag, url: n.url, logUrl: n.logUrl };
    const body = await encryptPush(enc.encode(JSON.stringify(payload)), to);
    items.push({ id: n.reminderId, fireAt: n.fireAt, body: b64url(body) });
  }
  const res = await fetch(`${PUSH_URL}/v1/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, items }),
  });
  if (res.ok) await db.meta.set('pushSyncedHash', hash);
}

/** @param {string} s */
async function digest(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return b64url(new Uint8Array(buf));
}
