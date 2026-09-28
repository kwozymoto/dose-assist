// @ts-check
/* The parent's own gap between doses, and what the countdown and count-up
   should be doing.

   The rules' minimum interval is a hard limit and never moves. A parent may
   choose a LONGER gap, up to the top of the usual range in the rules
   (`usualIntervalMaxMinutes`). The gap only sets when the countdown ends and
   when reminders fire; it can never turn a stop into a go, and it never
   blocks a dose the rules allow (the screen says so while it waits).

   Pure: `now` is passed in, every number comes from the rule. */

import { MINUTE_MS } from './time.js';

/** @typedef {import('./types.js').IngredientRule} IngredientRule */
/** @typedef {import('./types.js').DoseCheck} DoseCheck */

/** How coarse the parent's choice is. A screen granularity, not a dosing number. */
export const GAP_STEP_MINUTES = 30;

/**
 * @typedef {'none' | 'blocked' | 'idle' | 'wait' | 'early' | 'ready' | 'limit'} Phase
 *   none: no rules for this ingredient. blocked: under the minimum age.
 *   idle: nothing in the last 24 hours, so nothing to count from.
 *   wait: the rules do not allow a dose yet. early: the rules allow it, the
 *   parent's own gap has not ended. ready: the gap has ended; count up.
 *   limit: a 24-hour limit is reached.
 *
 * @typedef {object} GapPlan
 * @property {Phase} phase
 * @property {number | null} ruleAt      when the rules next allow a dose (wait and limit)
 * @property {number | null} targetAt    when the countdown ends: the later of the rules' time and the parent's gap
 * @property {number | null} readySince  when the count-up starts (ready only)
 * @property {number} gapMinutes         the gap in effect, after clamping
 */

/**
 * The gaps a parent can pick, in minutes, from the rules' minimum to the top
 * of the usual range. The top is always offered.
 * @param {IngredientRule} rule
 * @returns {number[]}
 */
export function gapChoices(rule) {
  const min = rule.minIntervalMinutes;
  const max = typeof rule.usualIntervalMaxMinutes === 'number' ? Math.max(min, rule.usualIntervalMaxMinutes) : min;
  /** @type {number[]} */
  const out = [];
  for (let m = min; m < max; m += GAP_STEP_MINUTES) out.push(m);
  out.push(max);
  return out;
}

/**
 * Keep a stored gap inside what the rules allow. Nothing (or nonsense) means
 * the minimum. Applied every time a gap is read, so a rules update that
 * narrows the range is respected the moment it loads.
 * @param {IngredientRule} rule
 * @param {unknown} minutes
 * @returns {number}
 */
export function clampGap(rule, minutes) {
  const choices = gapChoices(rule);
  const min = choices[0];
  const max = choices[choices.length - 1];
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return min;
  return Math.min(max, Math.max(min, Math.round(minutes)));
}

/**
 * What the countdown and count-up should show for one ingredient.
 * `check` is the engine's status-only answer for the same moment as `now`.
 *
 * @param {object} p
 * @param {DoseCheck} p.check
 * @param {IngredientRule | undefined} p.rule
 * @param {unknown} p.gapMinutes  the parent's stored choice, if any
 * @param {number} p.now
 * @returns {GapPlan}
 */
export function planGap({ check, rule, gapMinutes, now }) {
  if (!rule || check.warnings.includes('NO_RULES_FOR_INGREDIENT')) return plan('none', 0);
  const gap = clampGap(rule, gapMinutes);
  if (check.status === 'BLOCKED') return plan('blocked', gap);

  const last = check.lastDose;
  const gapAt = last ? last.givenAt + gap * MINUTE_MS : null;

  if (check.status !== 'OK') {
    const ruleAt = check.nextAllowedAt;
    const targetAt = ruleAt === null ? null : Math.max(ruleAt, gapAt ?? ruleAt);
    const limit = check.status === 'DAILY_LIMIT_REACHED' || check.status === 'EXCEEDS_LIMIT';
    return { phase: limit ? 'limit' : 'wait', ruleAt, targetAt, readySince: null, gapMinutes: gap };
  }

  if (!last || gapAt === null || check.dosesInLast24h === 0) return plan('idle', gap);
  if (now < gapAt) return { phase: 'early', ruleAt: null, targetAt: gapAt, readySince: null, gapMinutes: gap };
  return { phase: 'ready', ruleAt: null, targetAt: gapAt, readySince: Math.max(check.allowedSince ?? gapAt, gapAt), gapMinutes: gap };
}

/** @param {Phase} phase @param {number} gapMinutes @returns {GapPlan} */
function plan(phase, gapMinutes) {
  return { phase, ruleAt: null, targetAt: null, readySince: null, gapMinutes };
}

/** Which state leads the big button, best first. Idle is neutral: it never says "go". */
const HERO_RANK = /** @type {Record<Phase, number>} */ ({ ready: 0, idle: 1, early: 2, wait: 3, limit: 4, blocked: 5, none: 6 });

/**
 * Pick the medicine that drives the big Dose now button.
 * @param {{ingredient: string, plan: GapPlan}[]} entries
 * @returns {{state: Phase, ingredient: string, plan: GapPlan} | null}
 */
export function pickHero(entries) {
  if (entries.length === 0) return null;
  /** ready: allowed longest first; others: soonest end first; no end time last. */
  const time = (/** @type {{plan: GapPlan}} */ e) => (e.plan.phase === 'ready' ? (e.plan.readySince ?? Infinity) : (e.plan.targetAt ?? Infinity));
  const best = [...entries].sort((a, b) =>
    HERO_RANK[a.plan.phase] - HERO_RANK[b.plan.phase]
    || time(a) - time(b)
    || (a.ingredient < b.ingredient ? -1 : a.ingredient > b.ingredient ? 1 : 0))[0];
  return { state: best.plan.phase, ingredient: best.ingredient, plan: best.plan };
}
