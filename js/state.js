// @ts-check
/* Shared app state: the rules and products (loaded once), the person using
   this phone, and helpers that join storage to the engine. */

import * as db from './db.js';
import { checkDose, checkIngredient } from './engine/checkDose.js';
import { cardStatus } from './status.js';
import { now, timeZone } from './clock.js';
import { DAY_MS } from './engine/time.js';

/** @typedef {import('./engine/types.js').Rules} Rules */
/** @typedef {import('./db.js').Child} Child */
/** @typedef {import('./db.js').Bottle} Bottle */
/** @typedef {import('./db.js').DoseRecord} DoseRecord */

/**
 * @typedef {object} Product
 * @property {string} id
 * @property {string} name
 * @property {'liquid' | 'tablet' | 'chewable'} form
 * @property {{ingredient: string, strengthMg: number, strengthPer: number}[]} components
 * @property {boolean} verified
 */

export const state = {
  /** @type {Rules} */
  rules: /** @type {any} */ (null),
  /** @type {{productsVersion: string, products: Product[]}} */
  products: /** @type {any} */ (null),
  caregiver: '',
  /** @type {{doseId: string, at: number, childId: string} | null} */
  lastLogged: null,
};

export async function loadData() {
  const [rules, products] = await Promise.all([
    fetch('data/rules.json').then((r) => r.json()),
    fetch('data/products.json').then((r) => r.json()),
  ]);
  state.rules = rules;
  state.products = products;
  state.caregiver = await db.meta.get('caregiverName', '');
}

/** @param {{components: {ingredient: string}[]}} b */
export const ingredientsOf = (b) => [...new Set(b.components.map((c) => c.ingredient))];

/** @param {string} ingredient */
export const ruleFor = (ingredient) => (Object.hasOwn(state.rules.ingredients, ingredient) ? state.rules.ingredients[ingredient] : undefined);

/** Engine input for a child. @param {Child} child */
export const engineChild = (child) => ({ id: child.id, dateOfBirth: child.dateOfBirth });

/**
 * What to show on a child's card: one row per medicine in the house, plus
 * any other medicine given in the last 48 hours.
 * @param {Child} child @param {Bottle[]} bottles
 */
export async function childRows(child, bottles) {
  const history = await db.doses.forChild(child.id);
  const t = now();
  const tz = timeZone();
  const names = new Set();
  for (const b of bottles) for (const i of ingredientsOf(b)) names.add(i);
  for (const d of history) {
    if (d.givenAt > t - 2 * DAY_MS) for (const c of d.components) names.add(c.ingredient);
  }
  const rows = [...names].sort().map((ingredient) => {
    const check = checkIngredient({ ingredient, rules: state.rules, history, now: t, child: engineChild(child), timeZone: tz });
    return { ingredient, check, card: cardStatus(check, ingredient, ruleFor(ingredient), t, tz) };
  });
  return { rows, history };
}

/**
 * Status of a bottle for a child right now (no amount chosen yet).
 * @param {Child} child @param {Bottle} bottle @param {DoseRecord[]} history
 */
export function bottleStatus(child, bottle, history) {
  return checkDose({
    components: ingredientsOf(bottle).map((ingredient) => ({ ingredient })),
    rules: state.rules, history, now: now(), child: engineChild(child), timeZone: timeZone(),
  });
}

/** Age in plain words: "3 years", "7 months", "5 weeks". @param {string | null} dob @param {number} at */
export function ageText(dob, at) {
  if (!dob) return '';
  const [y, m, d] = dob.split('-').map(Number);
  const born = new Date(y, m - 1, d);
  const today = new Date(at);
  let months = (today.getFullYear() - born.getFullYear()) * 12 + (today.getMonth() - born.getMonth());
  if (today.getDate() < born.getDate()) months -= 1;
  if (months >= 24) return `${Math.floor(months / 12)} years`;
  if (months >= 2) return `${months} months`;
  const days = Math.floor((today.getTime() - born.getTime()) / DAY_MS);
  if (days >= 14) return `${Math.floor(days / 7)} weeks`;
  return days === 1 ? '1 day' : `${Math.max(0, days)} days`;
}

export const CHILD_COLOURS = [
  { id: 'teal', name: 'Teal' },
  { id: 'orange', name: 'Orange' },
  { id: 'purple', name: 'Purple' },
  { id: 'blue', name: 'Blue' },
  { id: 'pink', name: 'Pink' },
  { id: 'green', name: 'Green' },
];
