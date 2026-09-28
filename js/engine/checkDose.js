// @ts-check
/* The dose check. Tracker mode: the parent chooses the amount from the label
   or their doctor; this says whether the rules allow it now, and if not,
   when. It never suggests an amount and never uses weight.

   Every number comes from the `rules` passed in (data/rules.json in the
   app). Nothing here reads the clock, storage or the page. */

import { ageInDays } from './age.js';
import { countClearsAt, intervalClearsAt, mgClearsAt } from './nextAllowed.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, roundMg } from './time.js';

/** @typedef {import('./types.js').IngredientInput} IngredientInput */
/** @typedef {import('./types.js').ProductInput} ProductInput */
/** @typedef {import('./types.js').DoseCheck} DoseCheck */
/** @typedef {import('./types.js').ProductCheck} ProductCheck */
/** @typedef {import('./types.js').DoseStatus} DoseStatus */
/** @typedef {import('./types.js').DoseEvent} DoseEvent */
/** @typedef {import('./types.js').WarningCode} WarningCode */
/** @typedef {import('./nextAllowed.js').Item} Item */

/** Most severe first. */
const SEVERITY = /** @type {const} */ (['BLOCKED', 'EXCEEDS_LIMIT', 'DAILY_LIMIT_REACHED', 'TOO_SOON', 'OK']);

/**
 * Check one ingredient for one child.
 *
 * Without `enteredMg` it answers "could any dose be given now?" (the home
 * screen). With it, "can this amount be given now?" (the give-dose flow).
 *
 * @param {IngredientInput} input
 * @returns {DoseCheck}
 */
export function checkIngredient(input) {
  const { ingredient, rules, history, now, child, timeZone, enteredMg } = input;
  validate(input);

  const items = collect(history, ingredient);
  const windowItems = items.filter((i) => i.givenAt > now - DAY_MS);
  const mgInLast24h = roundMg(windowItems.reduce((s, i) => s + i.mg, 0));
  const last = items.at(-1);

  /** @type {WarningCode[]} */
  const warnings = [];
  if (rules.reviewedBy == null) warnings.push('RULES_NOT_REVIEWED');
  if (items.some((i) => i.givenAt > now)) warnings.push('DOSE_IN_FUTURE');

  const common = {
    dosesInLast24h: windowItems.length,
    mgInLast24h,
    ...(last ? { lastDose: { doseId: last.doseId, givenAt: last.givenAt, mg: last.mg } } : {}),
    warnings,
  };

  const rule = Object.hasOwn(rules.ingredients, ingredient) ? rules.ingredients[ingredient] : undefined;
  if (!rule) {
    warnings.push('NO_RULES_FOR_INGREDIENT');
    return { status: 'OK', nextAllowedAt: null, remainingMgIn24h: null, ...common };
  }
  if (rule.unverified && rule.unverified.length > 0) warnings.push('RULE_UNVERIFIED');

  const cap = rule.maxMgPer24h;
  const remainingMgIn24h = Math.max(0, roundMg(cap - mgInLast24h));

  if (child.dateOfBirth) {
    if (ageInDays(child.dateOfBirth, now, timeZone) < rule.minAgeDays) {
      return { status: 'BLOCKED', blockReason: 'UNDER_MIN_AGE', nextAllowedAt: null, remainingMgIn24h, ...common };
    }
  } else {
    warnings.push('AGE_UNKNOWN');
  }

  if (last && longUse(items, now, rule.seekAdviceAfterHours)) warnings.push('LONG_USE');

  const intervalAt = intervalClearsAt(last, rule.minIntervalMinutes * MINUTE_MS);
  const countAt = countClearsAt(windowItems, rule.maxDosesPer24h);

  if (enteredMg !== undefined) {
    const amount = roundMg(enteredMg);
    if (amount > rule.maxSingleMg || amount > cap) {
      const exceedReason = amount > rule.maxSingleMg ? 'SINGLE_DOSE' : 'OVER_DAILY_MAX';
      return { status: 'EXCEEDS_LIMIT', exceedReason, nextAllowedAt: null, remainingMgIn24h, ...common };
    }
  }

  const mgAt = mgClearsAt(windowItems, enteredMg === undefined ? 0 : roundMg(enteredMg), cap);
  const pending = [intervalAt, countAt, mgAt].filter((t) => t !== null && t > now);
  const nextAllowedAt = pending.length > 0 ? Math.max(.../** @type {number[]} */ (pending)) : null;

  const limitReached = countAt !== null || mgInLast24h >= cap;
  if (limitReached) {
    return { status: 'DAILY_LIMIT_REACHED', nextAllowedAt, remainingMgIn24h, ...common };
  }
  if (mgAt !== null && mgAt > now) {
    return { status: 'EXCEEDS_LIMIT', exceedReason: 'WOULD_EXCEED_24H', nextAllowedAt, remainingMgIn24h, ...common };
  }
  if (intervalAt !== null && intervalAt > now) {
    return { status: 'TOO_SOON', nextAllowedAt, remainingMgIn24h, ...common };
  }
  return { status: 'OK', nextAllowedAt: null, remainingMgIn24h, ...common };
}

/**
 * Check a product: every ingredient in it, combined.
 *
 * Components carry the mg of the amount chosen; leave mg out (on every
 * component) for a status-only check.
 *
 * @param {ProductInput} input
 * @returns {ProductCheck}
 */
export function checkDose(input) {
  const { components, ...rest } = input;
  if (!Array.isArray(components) || components.length === 0) throw new TypeError('components must be a non-empty array');
  const withMg = components.filter((c) => c.mg !== undefined).length;
  if (withMg !== 0 && withMg !== components.length) throw new TypeError('components must all have mg, or none');

  /** @type {Map<string, number | undefined>} */
  const byIngredient = new Map();
  for (const c of components) {
    const prev = byIngredient.get(c.ingredient);
    byIngredient.set(c.ingredient, c.mg === undefined ? undefined : roundMg((prev ?? 0) + c.mg));
  }

  /** @type {Record<string, DoseCheck>} */
  const perIngredient = {};
  for (const [ingredient, mg] of byIngredient) {
    perIngredient[ingredient] = checkIngredient({ ...rest, ingredient, ...(mg === undefined ? {} : { enteredMg: mg }) });
  }
  const checks = Object.values(perIngredient);

  const status = SEVERITY.find((s) => checks.some((c) => c.status === s)) ?? 'OK';
  const blocked = checks.find((c) => c.blockReason);
  const never = checks.some((c) => c.status === 'BLOCKED' || c.exceedReason === 'SINGLE_DOSE' || c.exceedReason === 'OVER_DAILY_MAX');
  const times = checks.map((c) => c.nextAllowedAt).filter((t) => t !== null);
  const nextAllowedAt = status === 'OK' || never || times.length === 0 ? null : Math.max(.../** @type {number[]} */ (times));

  /** @type {WarningCode[]} */
  const warnings = [];
  for (const c of checks) for (const w of c.warnings) if (!warnings.includes(w)) warnings.push(w);

  return {
    status,
    ...(blocked && blocked.blockReason ? { blockReason: blocked.blockReason } : {}),
    nextAllowedAt,
    perIngredient,
    warnings,
  };
}

/**
 * This ingredient's share of each live dose, oldest first.
 * @param {DoseEvent[]} history
 * @param {string} ingredient
 * @returns {Item[]}
 */
function collect(history, ingredient) {
  /** @type {Item[]} */
  const items = [];
  for (const d of history) {
    if (d.deletedAt != null) continue;
    let mg = 0;
    let found = false;
    for (const c of d.components) {
      if (c.ingredient === ingredient) {
        mg += c.mg;
        found = true;
      }
    }
    if (found) items.push({ doseId: d.id, givenAt: d.givenAt, mg: roundMg(mg) });
  }
  items.sort((a, b) => a.givenAt - b.givenAt || (a.doseId < b.doseId ? -1 : a.doseId > b.doseId ? 1 : 0));
  return items;
}

/**
 * Has the current, unbroken course gone on longer than the advice threshold?
 * A course is broken by a gap of more than 24 hours between doses, and is
 * over once the last dose is more than 24 hours old.
 *
 * @param {Item[]} items  oldest first, non-empty
 * @param {number} now
 * @param {number | undefined} hours
 */
function longUse(items, now, hours) {
  if (typeof hours !== 'number') return false;
  const last = items[items.length - 1];
  if (now - last.givenAt > DAY_MS) return false;
  let start = items.length - 1;
  while (start > 0 && items[start].givenAt - items[start - 1].givenAt <= DAY_MS) start -= 1;
  return now - items[start].givenAt > hours * HOUR_MS;
}

/** @param {IngredientInput} input */
function validate(input) {
  const { now, timeZone, history, child, enteredMg, rules } = input;
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('now must be UTC milliseconds');
  if (typeof timeZone !== 'string' || timeZone === '') throw new TypeError('timeZone is required');
  if (!rules || typeof rules !== 'object' || !rules.ingredients) throw new TypeError('rules are required');
  if (!child || typeof child.id !== 'string') throw new TypeError('child is required');
  if (!Array.isArray(history)) throw new TypeError('history must be an array');
  for (const d of history) {
    if (typeof d.givenAt !== 'number' || !Number.isFinite(d.givenAt)) throw new TypeError(`dose ${d.id}: givenAt must be UTC milliseconds`);
    if (!Array.isArray(d.components)) throw new TypeError(`dose ${d.id}: components must be an array`);
    for (const c of d.components) {
      if (typeof c.mg !== 'number' || !Number.isFinite(c.mg) || c.mg < 0) throw new TypeError(`dose ${d.id}: mg must be a non-negative number`);
    }
  }
  if (enteredMg !== undefined && (typeof enteredMg !== 'number' || !Number.isFinite(enteredMg) || enteredMg <= 0)) {
    throw new RangeError(`enteredMg must be a positive number, got ${enteredMg}`);
  }
}
