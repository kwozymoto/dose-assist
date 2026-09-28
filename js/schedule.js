// @ts-check
/* Reminder planning: from the reminders a parent asked for, and the doses
   on record, work out what to show and when. Pure; tested in
   tests/schedule.test.mjs.

   A 'next_allowed' reminder has no stored time. Its time is worked out from
   the doses, every time the doses change, so editing, deleting or adding a
   dose can never leave a reminder pointing at the wrong moment.

   Wording (PLAN.md 8.4): a next_allowed notification says a dose is
   *allowed*, never "give Mia paracetamol now". Only a reminder the parent
   set for a doctor's schedule may say it is time to give one. */

import { checkDose } from './engine/checkDose.js';
import { clampGap } from './engine/gap.js';
import { MINUTE_MS } from './engine/time.js';
import { formatTime, formatWhen } from './format.js';

/** @typedef {import('./db.js').Reminder} Reminder */
/** @typedef {import('./db.js').Child} Child */
/** @typedef {import('./db.js').DoseRecord} DoseRecord */
/** @typedef {import('./engine/types.js').Rules} Rules */

/**
 * @typedef {object} Notice
 * @property {string} reminderId
 * @property {string} childId
 * @property {number} fireAt
 * @property {string} title
 * @property {string} body
 * @property {string} tag      one per reminder, so a local and a pushed copy collapse into one
 * @property {string} url      where a tap opens
 * @property {string} logUrl   the "Log dose" action: opens the give flow, never logs by itself
 * @property {'next_allowed' | 'scheduled'} kind
 */

/** "paracetamol", "paracetamol and ibuprofen". @param {string[]} xs */
export const listNames = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * @param {object} p
 * @param {Reminder[]} p.reminders   active ones
 * @param {Child[]} p.children
 * @param {DoseRecord[]} p.doses     every dose (deleted ones are ignored by the engine)
 * @param {Rules} p.rules
 * @param {string} p.timeZone
 * @returns {Notice[]} soonest first
 */
export function planNotices({ reminders, children, doses, rules, timeZone }) {
  /** @type {Notice[]} */
  const out = [];
  for (const r of reminders) {
    if (r.firedAt || r.cancelledAt) continue;
    const child = children.find((c) => c.id === r.childId);
    if (!child || child.archivedAt) continue;
    const history = doses.filter((d) => d.childId === child.id);
    const names = listNames(r.ingredients);
    const url = `./#/child/${child.id}`;
    const logUrl = `./#/give?child=${child.id}&ingredients=${encodeURIComponent(r.ingredients.join(','))}`;
    const components = r.ingredients.map((ingredient) => ({ ingredient }));
    const last = latestGiven(history, r.ingredients);

    /** @type {Notice | null} */
    let notice = null;
    if (r.kind === 'next_allowed') {
      if (last === null) continue;
      // Asked at the moment of the last dose, "when is the next one allowed?"
      // has an answer that does not depend on when we happen to ask it.
      const check = checkDose({ components, rules, history, now: last, child, timeZone });
      if (check.nextAllowedAt === null) continue;
      // The parent may have chosen a gap longer than the rules' minimum; the
      // reminder comes when that gap ends. Never earlier than the rules.
      let fireAt = check.nextAllowedAt;
      for (const ing of r.ingredients) {
        const rule = Object.hasOwn(rules.ingredients, ing) ? rules.ingredients[ing] : undefined;
        const lastOfIng = check.perIngredient[ing]?.lastDose?.givenAt;
        if (rule && lastOfIng !== undefined) fireAt = Math.max(fireAt, lastOfIng + clampGap(rule, child.gapMinutes?.[ing]) * MINUTE_MS);
      }
      notice = {
        reminderId: r.id, childId: child.id, fireAt, kind: 'next_allowed', tag: r.id, url, logUrl,
        title: `${child.name}: next ${names} allowed from now`,
        body: `Last given ${formatWhen(last, fireAt, timeZone)}. Open Whendose to check before giving.`,
      };
    } else if (r.kind === 'scheduled' && typeof r.fireAt === 'number') {
      const at = r.fireAt;
      const check = checkDose({ components, rules, history, now: at, child, timeZone });
      const lastText = last === null ? '' : ` Last given ${formatWhen(last, at, timeZone)}.`;
      const label = r.label || 'the time you set';
      let body;
      if (check.status === 'OK') {
        body = `Time for ${child.name}'s ${names}, as you set (${label}).${lastText}`;
      } else if (check.nextAllowedAt !== null) {
        body = `Your reminder for ${child.name}'s ${names} (${label}). The usual limits allow the next dose from ${formatTime(check.nextAllowedAt, timeZone)}. Follow your doctor's instructions.${lastText}`;
      } else {
        body = `Your reminder for ${child.name}'s ${names} (${label}). Open Whendose to check before giving.${lastText}`;
      }
      notice = { reminderId: r.id, childId: child.id, fireAt: at, kind: 'scheduled', tag: r.id, url, logUrl, title: `${child.name}: ${names} reminder`, body };
    }
    if (notice) out.push(notice);
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

/**
 * A short fingerprint of what a notice says and when. sw.js shows a pushed
 * message as current only if its rev matches the reminder's planned rev, so
 * a message made before a dose was logged (same time, different words, say
 * a doctor's-schedule reminder that now clashes with a new dose) is never
 * passed off as current. FNV-1a, 32-bit, as 8 hex digits.
 * @param {Pick<Notice, 'fireAt' | 'title' | 'body'>} n
 */
export function noticeRev(n) {
  const s = `${n.fireAt}|${n.title}|${n.body}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * @param {DoseRecord[]} history @param {string[]} ingredients
 * @returns {number | null}
 */
function latestGiven(history, ingredients) {
  let t = null;
  for (const d of history) {
    if (d.deletedAt) continue;
    if (!d.components.some((c) => ingredients.includes(c.ingredient))) continue;
    if (t === null || d.givenAt > t) t = d.givenAt;
  }
  return t;
}

/**
 * Split notices by what to do with them at `now`.
 * - due: time has come, within `graceMs` — show it
 * - stale: missed by more than `graceMs` (the app was closed and nothing
 *   pushed it) — mark it done without a notification; the home screen
 *   already shows the current state, and an alert about a moment long
 *   gone would only confuse
 * - upcoming: still to come
 * @param {Notice[]} notices @param {number} now @param {number} graceMs
 */
export function triage(notices, now, graceMs) {
  /** @type {Notice[]} */ const due = [];
  /** @type {Notice[]} */ const stale = [];
  /** @type {Notice[]} */ const upcoming = [];
  for (const n of notices) {
    if (n.fireAt > now) upcoming.push(n);
    else if (now - n.fireAt <= graceMs) due.push(n);
    else stale.push(n);
  }
  return { due, stale, upcoming };
}
