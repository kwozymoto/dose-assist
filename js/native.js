// @ts-check
/* The installed Android app (Capacitor). When the app runs there, reminders
   are scheduled on the phone itself with Android alarms, so they fire with
   no internet and with the app closed, and come back after a restart.

   The same plan the web uses (schedule.js planNotices) is handed over; this
   file only translates it. A tap opens the app at the right screen; it
   never logs a dose (CLAUDE.md 8). Nothing leaves the phone.

   The plugin is reached through the global Capacitor bridge, so the web
   app needs no build step and simply skips all of this in a browser. */

/** @typedef {import('./schedule.js').Notice} Notice */

/* Android keeps a limited number of alarms per app; the soonest go first
   and the rest are scheduled on the next refresh. */
export const MAX_NATIVE = 50;
export const CHANNEL_ID = 'reminders';
const ACTION_TYPE = 'dose';

/** @returns {any} */
const cap = () => /** @type {any} */ (globalThis).Capacitor;
export const isNative = () => cap()?.isNativePlatform?.() === true;
/** @returns {any} */
const plugin = () => cap()?.Plugins?.LocalNotifications;

/** A stable 31-bit id for a reminder (Android needs an int). FNV-1a. @param {string} s */
export function nativeId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0x7fffffff) || 1;
}

/**
 * One notice as the plugin wants it. Pure, so it is tested.
 * @param {Notice} n
 */
export function toNative(n) {
  return {
    id: nativeId(n.reminderId),
    title: n.title,
    body: n.body,
    schedule: { at: new Date(n.fireAt), allowWhileIdle: true },
    channelId: CHANNEL_ID,
    actionTypeId: ACTION_TYPE,
    autoCancel: true,
    extra: { da: 1, reminderId: n.reminderId, url: n.url, logUrl: n.logUrl, fireAt: n.fireAt },
  };
}

/** The hash part of a notice URL ("./#/give?child=x" -> "#/give?child=x"). @param {unknown} url */
export function hashOf(url) {
  if (typeof url !== 'string') return '#/';
  const i = url.indexOf('#');
  return i === -1 ? '#/' : url.slice(i);
}

let ready = false;
/** Channel, the "Log dose" action and the tap handler. Once per launch. */
async function setUp() {
  if (ready) return;
  ready = true;
  const ln = plugin();
  await ln.createChannel({
    id: CHANNEL_ID, name: 'Dose reminders', description: 'When the next dose is allowed, and times you set',
    importance: 5, visibility: 0, vibration: true, lights: true,
  });
  await ln.registerActionTypes({ types: [{ id: ACTION_TYPE, actions: [{ id: 'log', title: 'Log dose', foreground: true }] }] });
  await ln.addListener('localNotificationActionPerformed', (/** @type {any} */ a) => {
    const extra = a?.notification?.extra ?? {};
    // Opens a screen only. The give flow checks again and only its confirm button writes.
    location.hash = hashOf(a?.actionId === 'log' ? extra.logUrl : extra.url);
  });
}

/** @returns {Promise<'granted' | 'denied' | 'prompt'>} */
export async function nativePermission() {
  // A missing or odd answer from Android must never break a screen: treat it as "not asked yet".
  let s;
  try { s = await plugin()?.checkPermissions?.(); } catch { s = null; }
  return s?.display === 'granted' ? 'granted' : s?.display === 'denied' ? 'denied' : 'prompt';
}

/** @returns {Promise<'granted' | 'denied' | 'prompt'>} */
export async function requestNativePermission() {
  let s;
  try { s = await plugin()?.requestPermissions?.(); } catch { s = null; }
  if (!s) return nativePermission();
  return s.display === 'granted' ? 'granted' : s.display === 'denied' ? 'denied' : 'prompt';
}

/** Can Android fire at the exact minute? If not, alarms may come a few minutes late. */
export async function exactAlarmsAllowed() {
  try {
    const s = await plugin().checkExactNotificationSetting();
    return s.exact_alarm !== 'denied';
  } catch {
    return true;
  }
}

export async function openExactAlarmSettings() {
  try { await plugin().changeExactNotificationSetting(); } catch { /* older Android: nothing to change */ }
}

let lastHash = '';
/**
 * Replace the phone's scheduled reminders with these. Cheap to call often:
 * nothing happens when the list has not changed.
 * @param {Notice[]} upcoming  soonest first
 * @param {{off?: boolean}} [opts]  off: the parent turned reminders off
 */
export async function syncNative(upcoming, opts = {}) {
  const ln = plugin();
  if (!ln) return;
  await setUp();
  const granted = (await nativePermission()) === 'granted';
  const list = opts.off || !granted ? [] : upcoming.slice(0, MAX_NATIVE);
  const hash = JSON.stringify([granted, list.map((n) => [n.reminderId, n.fireAt, n.title, n.body])]);
  if (hash === lastHash) return;
  const pending = await ln.getPending();
  const ours = (pending?.notifications ?? []).filter((/** @type {any} */ p) => p?.extra?.da === 1);
  if (ours.length) await ln.cancel({ notifications: ours.map((/** @type {any} */ p) => ({ id: p.id })) });
  if (list.length) await ln.schedule({ notifications: list.map(toNative) });
  lastHash = hash;
  // The closed-app nudge handler (NudgeService) must respect "reminders off" too.
  try { await cap()?.Plugins?.WhenDose?.setRemindersOff({ off: opts.off === true }); } catch { /* older build */ }
}

/** A test notification a few seconds from now, through the same channel. */
export async function testNative() {
  await setUp();
  await plugin().schedule({ notifications: [{ id: 1, title: 'WhenDose', body: 'This is how reminders will look.', channelId: CHANNEL_ID, schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true } }] });
}

/** Give the native nudge handler the family key, or clear it. @param {string | null} key */
export async function setNativeSyncKey(key) {
  if (!isNative()) return;
  try { await cap()?.Plugins?.WhenDose?.setSyncKey({ key: key ?? '' }); } catch { /* older build */ }
}

let pushStarted = false;
/**
 * Register for Firebase messages (Android app only). `onToken` gets this
 * phone's push token; `onNudge` runs when a nudge arrives with the app open.
 * @param {(token: string) => void} onToken @param {() => void} onNudge
 */
export async function registerPush(onToken, onNudge) {
  const pn = cap()?.Plugins?.PushNotifications;
  if (!isNative() || !pn || pushStarted) return;
  pushStarted = true;
  try {
    await pn.addListener('registration', (/** @type {any} */ t) => { if (typeof t?.value === 'string') onToken(t.value); });
    await pn.addListener('pushNotificationReceived', () => onNudge());
    await pn.register();
  } catch { pushStarted = false; }
}

/**
 * The nudge for linked phones: as many upcoming notices as fit, in the
 * plugin's own form, and whether that is all of them.
 * @param {Notice[]} upcoming
 */
export function nudgePayload(upcoming, count = upcoming.length) {
  const list = upcoming.slice(0, Math.min(count, MAX_NATIVE));
  return { v: 1, complete: list.length === upcoming.length, notices: list.map(toNative) };
}
