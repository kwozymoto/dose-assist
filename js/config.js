// @ts-check
/* App settings that are not dosing rules. Dosing numbers live only in
   data/rules.json; nothing here may be one. */

/* The reminder push server (reminder-worker/). Empty until it is deployed:
   then reminders work only while the app is open, and the app says so. */
export const PUSH_URL = '';
/* The VAPID public key matching the worker's private key, base64url.
   Generate the pair with `node tools/vapid-keys.mjs`. */
export const VAPID_PUBLIC_KEY = '';
/* The sync server (sync-worker/), for linked phones. Empty until deployed:
   then Settings says sync is not set up. */
export const SYNC_URL = /** @type {string} */ ('https://whendose-sync.fraser-e76.workers.dev');

/* Undo stays available this long after logging (PLAN.md 8.1). */
/* The "Test version: limits not yet checked by a pharmacist" notice. Off
   while only the owner's family uses the app (owner's decision, 2026-09-29).
   Turn it back on before sharing the app with anyone else: the rules are
   still unreviewed (docs/clinical-review). The Sources screen always says so. */
export const SHOW_TEST_NOTICE = false;

export const UNDO_MS = 2 * 60 * 1000;
/* "I gave it earlier" reaches back this far, the same as the rolling limit
   window, so any dose that still counts can be recorded (PLAN.md 7.1 item 9,
   widened from 12 hours on the owner's decision, 2026-09-29). A dose's time
   can also only be edited within this long before it was logged. */
export const BACKDATE_MAX_MS = 24 * 60 * 60 * 1000;
/* A weight older than this still gives cautions, but never stops a dose:
   children grow, and a stale weight must not block what the label allows. */
export const WEIGHT_FRESH_MS = 183 * 24 * 60 * 60 * 1000;
/* A reminder whose moment passed while the app was closed, by more than
   this, is marked done without an alert (see schedule.js triage). */
export const STALE_GRACE_MS = 10 * 60 * 1000;
/* "Remind me at a set time" presets, counted from the time the dose was
   given (PLAN.md 7.1 item 8). These are for a schedule the parent's doctor
   gave them; they are not the app's rules. */
export const SCHEDULE_PRESET_HOURS = [4, 6, 8];
