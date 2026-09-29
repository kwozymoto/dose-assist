// @ts-check
/* The weight check. Tracker mode never suggests an amount; this compares the
   amount the parent chose with the child's recorded weight, using the
   rule's mg per kg (data/rules.json):

   - one dose over the usual mg per kg: a caution (label doses go by age,
     and can be a little over for a light child in the band);
   - the 24-hour total over the mg per kg maximum: a stop, but only when that
     number is source-verified and the weight is recent. An old weight or an
     unverified number gives a caution instead, so a stale record never
     blocks a dose the label allows.

   Pure: every number comes from the rule and the inputs. */

import { roundMg } from './time.js';

/** One dose this many times the usual mg per kg (or more) is a stop, with a recent weight. */
export const SINGLE_DOSE_STOP_FACTOR = 1.5;

/** @typedef {import('./types.js').IngredientRule} IngredientRule */

/**
 * @typedef {object} WeightCheck
 * @property {boolean} known   a usable weight was given
 * @property {boolean} stale   weighed longer than freshMs before the dose
 * @property {{mg: number, perKg: number, maxPerKg: number, maxMg: number} | null} perDose   only when over
 * @property {{totalMg: number, perKg: number, maxPerKg: number, maxMg: number, verified: boolean} | null} perDay   only when over
 * @property {boolean} bigDose  one dose at SINGLE_DOSE_STOP_FACTOR times the usual mg per kg or more, with a recent weight
 * @property {boolean} stop
 */

/**
 * @param {object} p
 * @param {IngredientRule} p.rule
 * @param {number | null} p.weightKg
 * @param {number | null} p.weighedAt  UTC ms
 * @param {number} p.doseMg    this ingredient in this dose
 * @param {number} p.windowMg  this ingredient already in the 24 hours before the dose
 * @param {number} p.at        when the dose is given
 * @param {number} p.freshMs   how old a weight may be and still stop a dose
 * @returns {WeightCheck}
 */
export function checkWeight({ rule, weightKg, weighedAt, doseMg, windowMg, at, freshMs }) {
  const none = { known: false, stale: false, perDose: null, perDay: null, bigDose: false, stop: false };
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0) return none;
  const stale = typeof weighedAt !== 'number' || at - weighedAt > freshMs;

  let perDose = null;
  if (typeof rule.mgPerKg === 'number') {
    const maxMg = roundMg(rule.mgPerKg * weightKg);
    if (roundMg(doseMg) > maxMg) perDose = { mg: roundMg(doseMg), perKg: doseMg / weightKg, maxPerKg: rule.mgPerKg, maxMg };
  }

  let perDay = null;
  if (typeof rule.maxMgPerKgPer24h === 'number') {
    const maxMg = roundMg(rule.maxMgPerKgPer24h * weightKg);
    const totalMg = roundMg(doseMg + windowMg);
    if (totalMg > maxMg) {
      perDay = { totalMg, perKg: totalMg / weightKg, maxPerKg: rule.maxMgPerKgPer24h, maxMg, verified: !(rule.unverified ?? []).includes('maxMgPerKgPer24h') };
    }
  }

  const bigDose = perDose !== null && !stale && perDose.mg >= roundMg(perDose.maxMg * SINGLE_DOSE_STOP_FACTOR);
  return { known: true, stale, perDose, perDay, bigDose, stop: bigDose || (perDay !== null && perDay.verified && !stale) };
}
