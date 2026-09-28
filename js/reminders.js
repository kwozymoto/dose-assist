// @ts-check
/* The reminder runtime.

   Two ways a reminder reaches the parent:
   - While the app is open, a timer fires it here: a system notification if
     allowed, otherwise an alert inside the app.
   - While it is closed, the push server sends the encrypted copy and sw.js
     shows it. Both carry the same tag, so if both arrive they collapse into
     one notification.

   Everything is recomputed from the database on every change: log, edit,
   delete, undo, a new reminder, the app coming back to the front. */

import * as db from './db.js';
import { planNotices, triage } from './schedule.js';
import { state } from './state.js';
import { now, timeZone } from './clock.js';
import { STALE_GRACE_MS } from './config.js';
import { syncPush } from './push.js';
import { h, icon, buzz } from './dom.js';

/** @typedef {import('./schedule.js').Notice} Notice */

/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
/** @type {() => void} */
let onFire = () => {};
let running = false;
let again = false;

/** @param {{onFire: () => void}} opts */
export function startReminders(opts) {
  onFire = opts.onFire;
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'reminder-shown') { refreshReminders(); onFire(); }
  });
  refreshReminders();
}

/** Recompute and reschedule. Safe to call as often as you like. */
export async function refreshReminders() {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      await cycle();
    } while (again);
  } finally {
    running = false;
  }
}

async function cycle() {
  if (!state.rules) return;
  const [active, children, doses] = await Promise.all([db.reminders.active(), db.children.list(), db.doses.all()]);
  const notices = planNotices({ reminders: active, children, doses, rules: state.rules, timeZone: timeZone() });

  // Record each reminder's planned time. sw.js compares a pushed message
  // against this, so a push planned before an edit cannot pass itself off
  // as current.
  for (const r of active) {
    const n = notices.find((x) => x.reminderId === r.id);
    const planned = n ? { fireAt: n.fireAt } : null;
    if (JSON.stringify(r.planned ?? null) !== JSON.stringify(planned)) {
      await db.reminders.setPlanned(r.id, planned);
    }
  }

  const t = now();
  const { due, stale, upcoming } = triage(notices, t, STALE_GRACE_MS);
  for (const n of stale) await db.reminders.markFired(n.reminderId, t);
  for (const n of due) {
    await show(n);
    await db.reminders.markFired(n.reminderId, t);
  }

  clearTimeout(timer);
  if (upcoming.length > 0) {
    // setTimeout drifts while a phone sleeps; wake at least hourly to re-check.
    const wait = Math.min(Math.max(upcoming[0].fireAt - now(), 0) + 250, 60 * 60 * 1000);
    timer = setTimeout(async () => { await refreshReminders(); onFire(); }, wait);
  }

  try { await syncPush(upcoming); } catch (err) { console.warn('push sync failed; will retry', err); }
  if (due.length > 0) onFire();
}

/** @param {Notice} n */
async function show(n) {
  buzz(200);
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg && 'Notification' in window && Notification.permission === 'granted') {
    const opts = /** @type {NotificationOptions & {actions?: {action: string, title: string}[], renotify?: boolean}} */ ({
      body: n.body,
      tag: n.tag,
      renotify: true,
      requireInteraction: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      data: { url: n.url, logUrl: n.logUrl, reminderId: n.reminderId },
      actions: [{ action: 'log', title: 'Log dose' }],
    });
    await reg.showNotification(n.title, opts);
  }
  // Always show it inside the app too; a notification can be missed.
  inAppAlert(n);
}

/** @param {Notice} n */
function inAppAlert(n) {
  const box = document.getElementById('alerts');
  if (!box) return;
  const el = h('div', { class: 'alert', role: 'alert' },
    icon('bell'),
    h('div', { class: 'alert-text' }, h('strong', null, n.title), h('p', null, n.body)),
    h('div', { class: 'alert-actions' },
      h('a', { class: 'btn btn-primary', href: n.logUrl, onclick: () => el.remove() }, 'Log a dose'),
      h('button', { class: 'btn btn-secondary', onclick: () => el.remove() }, 'OK'),
    ),
  );
  box.appendChild(el);
}
