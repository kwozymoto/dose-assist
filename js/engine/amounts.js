// @ts-check
import { roundMg } from './time.js';

/** @typedef {import('./types.js').BottleInput} BottleInput */
/** @typedef {import('./types.js').Component} Component */

/**
 * What an amount of a product contains, ingredient by ingredient.
 *
 * This converts what the parent measured (mL, or tablets) into mg using the
 * strength on the label. It is unit conversion of an amount the parent chose,
 * not a dose recommendation.
 *
 * @param {BottleInput} bottle
 * @param {number} amount  mL for a liquid, units for a tablet
 * @returns {Component[]}
 */
export function componentsForAmount(bottle, amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new RangeError(`amount must be a positive number, got ${amount}`);
  }
  if (!Array.isArray(bottle.components) || bottle.components.length === 0) {
    throw new RangeError('bottle has no components');
  }
  return bottle.components.map((c) => {
    if (!(c.strengthMg > 0) || !(c.strengthPer > 0) || !Number.isFinite(c.strengthMg) || !Number.isFinite(c.strengthPer)) {
      throw new RangeError(`bad strength for ${c.ingredient}: ${c.strengthMg} mg / ${c.strengthPer}`);
    }
    return { ingredient: c.ingredient, mg: roundMg((amount * c.strengthMg) / c.strengthPer) };
  });
}
