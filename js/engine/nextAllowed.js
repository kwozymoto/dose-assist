// @ts-check
import { DAY_MS, roundMg } from './time.js';

/**
 * One ingredient's share of one dose record.
 * @typedef {object} Item
 * @property {string} doseId
 * @property {number} givenAt
 * @property {number} mg
 */

/*  Each function answers one question about a fixed history: from what
    time onward is this one rule satisfied? Every rule here only ever gets
    easier as time passes (doses leave the rolling window, the interval
    elapses), so the earliest time all of them are satisfied is simply the
    latest of their individual answers. null means "already satisfied".

    `windowItems` are the doses still inside the rolling 24-hour window at
    `now`, sorted oldest first. A dose leaves the window exactly 24 hours
    after it was given. */

/**
 * @param {Item | undefined} last  the most recent dose, in or out of the window
 * @param {number} intervalMs
 * @returns {number | null}
 */
export function intervalClearsAt(last, intervalMs) {
  return last ? last.givenAt + intervalMs : null;
}

/**
 * The time enough doses have left the window for one more to be given.
 * @param {Item[]} windowItems
 * @param {number} maxDoses
 * @returns {number | null}
 */
export function countClearsAt(windowItems, maxDoses) {
  if (windowItems.length < maxDoses) return null;
  // One more dose needs the count at maxDoses - 1, so the oldest
  // (length - maxDoses + 1) must go; the last of those is at this index.
  return windowItems[windowItems.length - maxDoses].givenAt + DAY_MS;
}

/**
 * The time enough mg has left the window.
 *
 * With `extraMg` > 0: when the window total plus `extraMg` is at or under the cap.
 * With `extraMg` = 0 (status only, no amount chosen): when the window total
 * is strictly under the cap, i.e. when any dose at all could fit.
 *
 * Returns Infinity if even an empty window cannot fit `extraMg`; callers
 * rule that case out first.
 *
 * @param {Item[]} windowItems
 * @param {number} extraMg
 * @param {number} capMg
 * @returns {number | null}
 */
export function mgClearsAt(windowItems, extraMg, capMg) {
  /** @param {number} from */
  const fits = (from) => {
    let sum = 0;
    for (let i = from; i < windowItems.length; i += 1) sum += windowItems[i].mg;
    const total = roundMg(sum + extraMg);
    return extraMg > 0 ? total <= capMg : total < capMg;
  };
  if (fits(0)) return null;
  for (let i = 0; i < windowItems.length; i += 1) {
    if (fits(i + 1)) return windowItems[i].givenAt + DAY_MS;
  }
  return Infinity;
}
