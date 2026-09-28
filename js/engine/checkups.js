// @ts-check
/* Check-up prompts: when to ask whether the child's weight, a saved usual
   dose, or a bottle's strength is still right. They never block a dose;
   they only decide when a question shows on the confirm screen. The
   intervals are the owner's (2026-09-29), not dosing rules. Pure. */

import { ageInDays } from './age.js';
import { DAY_MS } from './time.js';

/** How often to ask about weight: children grow fastest when youngest. */
export const WEIGHT_EVERY_DAYS = /** @type {const} */ ({ underOne: 30, underFive: 91, older: 182 });
/** How long a saved dose goes before we ask if it is still right. */
export const SAVED_DOSE_EVERY_DAYS = 91;
/** A bottle unused this long may have been replaced (maybe by another strength). */
export const BOTTLE_IDLE_DAYS = 30;

/**
 * @param {object} p
 * @param {string | null} p.dateOfBirth
 * @param {number | null} p.weighedAt     latest weight on record
 * @param {number | null} p.confirmedAt   the parent said "still right"
 * @param {number} p.now
 * @param {string} p.timeZone
 * @returns {{due: false} | {due: true, reason: 'none'} | {due: true, reason: 'old', since: number}}
 */
export function weightCheckup({ dateOfBirth, weighedAt, confirmedAt, now, timeZone }) {
  if (weighedAt === null) return { due: true, reason: 'none' };
  const age = dateOfBirth ? ageInDays(dateOfBirth, now, timeZone) : 0;
  const every = age < 365 ? WEIGHT_EVERY_DAYS.underOne : age < 5 * 365 ? WEIGHT_EVERY_DAYS.underFive : WEIGHT_EVERY_DAYS.older;
  const last = Math.max(weighedAt, confirmedAt ?? -Infinity);
  return now - last > every * DAY_MS ? { due: true, reason: 'old', since: weighedAt } : { due: false };
}

/**
 * @param {object} p
 * @param {{amount: number, setAt: number, reviewedAt?: number} | undefined} p.saved
 * @param {number | null} p.weighedAt
 * @param {number} p.now
 * @returns {{due: false} | {due: true, reason: 'weight' | 'age'}}
 */
export function savedDoseCheckup({ saved, weighedAt, now }) {
  if (!saved) return { due: false };
  const checked = Math.max(saved.setAt, saved.reviewedAt ?? -Infinity);
  if (weighedAt !== null && weighedAt > checked) return { due: true, reason: 'weight' };
  if (now - checked > SAVED_DOSE_EVERY_DAYS * DAY_MS) return { due: true, reason: 'age' };
  return { due: false };
}

/**
 * @param {object} p
 * @param {number | null} p.lastUsedAt   the last dose from this bottle, any child
 * @param {number | null} p.confirmedAt  the parent said "still using it"
 * @param {number} p.now
 * @returns {{due: false} | {due: true, since: number}}
 */
export function bottleCheckup({ lastUsedAt, confirmedAt, now }) {
  if (lastUsedAt === null) return { due: false };
  if (confirmedAt !== null && confirmedAt >= lastUsedAt) return { due: false };
  return now - lastUsedAt >= BOTTLE_IDLE_DAYS * DAY_MS ? { due: true, since: lastUsedAt } : { due: false };
}
