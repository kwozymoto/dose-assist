// @ts-check
/* App settings that are not dosing rules. Dosing numbers live only in
   data/rules.json; nothing here may be one. */

/* The reminder push server (reminder-worker/). Empty until it is deployed:
   then reminders work only while the app is open, and the app says so. */
export const PUSH_URL = '';
/* The VAPID public key matching the worker's private key, base64url.
   Generate the pair with `node tools/vapid-keys.mjs`. */
export const VAPID_PUBLIC_KEY = '';

/* Undo stays available this long after logging (PLAN.md 8.1). */
export const UNDO_MS = 2 * 60 * 1000;
/* "I gave it earlier" reaches back this far (PLAN.md 7.1 item 9). */
export const BACKDATE_MAX_MS = 12 * 60 * 60 * 1000;
/* A reminder whose moment passed while the app was closed, by more than
   this, is marked done without an alert (see schedule.js triage). */
export const STALE_GRACE_MS = 10 * 60 * 1000;
/* "Remind me at a set time" presets, counted from the time the dose was
   given (PLAN.md 7.1 item 8). These are for a schedule the parent's doctor
   gave them; they are not the app's rules. */
export const SCHEDULE_PRESET_HOURS = [4, 6, 8];
