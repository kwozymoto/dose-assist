// @ts-check
/* A dose recorded at a time before doses already on record (logged late, or
   its time edited). checkDose looks back from a moment only; this looks
   forward: would the doses after it now break a rule? Pure.

   Tested in tests/engine/later.test.mjs. */

import { DAY_MS, MINUTE_MS, roundMg } from './time.js';
import { assertRule } from './checkDose.js';

/** @typedef {import('./types.js').DoseEvent} DoseEvent */
/** @typedef {import('./types.js').Rules} Rules */

/**
 * @typedef {object} LaterConflict
 * @property {string} ingredient
 * @property {'TOO_CLOSE' | 'COUNT' | 'MG'} reason
 *   TOO_CLOSE: a later dose is closer than the minimum gap.
 *   COUNT / MG: some 24 hours holding this dose and later ones has too many doses / mg.
 * @property {string} doseId  the later dose it clashes with (the last in the 24 hours, for COUNT and MG)
 * @property {number} givenAt
 */

/**
 * Doses at or before a time: what a check "at that time" should look back on.
 * @template {{givenAt: number}} T
 * @param {T[]} history @param {number} at
 * @returns {T[]}
 */
export function pastOnly(history, at) {
  return history.filter((d) => d.givenAt <= at);
}

/**
 * @param {{components: {ingredient: string, mg: number}[], rules: Rules, history: DoseEvent[], at: number, excludeId?: string}} input
 * @returns {LaterConflict | null}
 */
export function laterConflict({ components, rules, history, at, excludeId }) {
  /** @type {Map<string, number>} */
  const mine = new Map();
  for (const c of components) mine.set(c.ingredient, roundMg((mine.get(c.ingredient) ?? 0) + c.mg));

  for (const [ingredient, newMg] of mine) {
    if (!Object.hasOwn(rules.ingredients, ingredient)) continue;
    const rule = rules.ingredients[ingredient];
    assertRule(ingredient, rule);
    /** @type {{id: string, givenAt: number, mg: number}[]} */
    const items = [];
    for (const d of history) {
      if (d.deletedAt != null || d.id === excludeId) continue;
      const mg = d.components.filter((c) => c.ingredient === ingredient).reduce((s, c) => s + c.mg, 0);
      if (d.components.some((c) => c.ingredient === ingredient)) items.push({ id: d.id, givenAt: d.givenAt, mg });
    }
    items.sort((a, b) => a.givenAt - b.givenAt);
    const later = items.filter((i) => i.givenAt > at && i.givenAt < at + DAY_MS);
    if (later.length === 0) continue;

    const first = later[0];
    if (first.givenAt - at < rule.minIntervalMinutes * MINUTE_MS) {
      return { ingredient, reason: 'TOO_CLOSE', doseId: first.id, givenAt: first.givenAt };
    }
    // Any 24 hours that breaks a limit can be narrowed to end at a dose; the
    // ones that matter hold the new dose, so end at a later dose within 24 h.
    for (const end of later) {
      const inWindow = items.filter((i) => i.givenAt > end.givenAt - DAY_MS && i.givenAt <= end.givenAt);
      if (inWindow.length + 1 > rule.maxDosesPer24h) return { ingredient, reason: 'COUNT', doseId: end.id, givenAt: end.givenAt };
      const mg = roundMg(inWindow.reduce((s, i) => s + i.mg, 0) + newMg);
      if (mg > rule.maxMgPer24h) return { ingredient, reason: 'MG', doseId: end.id, givenAt: end.givenAt };
    }
  }
  return null;
}
