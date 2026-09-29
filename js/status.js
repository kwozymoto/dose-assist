// @ts-check
/* What a child card says about one medicine, from the engine's answer.

   Status is never colour alone (CLAUDE.md): every state has an icon and
   words as well as a colour, and the words carry the whole meaning. The
   numbers in the words come from the rule and the engine, never from here. */

import { formatWhen, formatAgo, formatDuration, formatAgeDays, formatMg, formatGap } from './format.js';

/** @typedef {import('./engine/types.js').DoseCheck} DoseCheck */
/** @typedef {import('./engine/types.js').IngredientRule} IngredientRule */
/** @typedef {import('./engine/gap.js').GapPlan} GapPlan */

/**
 * @typedef {'none' | 'ok' | 'soon' | 'limit' | 'blocked' | 'exceeds'} CardKind
 *
 * @typedef {object} CardStatus
 * @property {CardKind} kind
 * @property {'dash' | 'tick' | 'clock' | 'stop'} icon
 * @property {string} title    one line, the answer
 * @property {string} [detail] one line, the reason
 * @property {number | null} nextAllowedAt
 * @property {number} [progress]  0..1 through the wait, for the ring
 */

/** "paracetamol" -> "Paracetamol". @param {string} s */
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {DoseCheck} check  status-only check (no amount)
 * @param {string} ingredient
 * @param {IngredientRule | undefined} rule
 * @param {number} now
 * @param {string} timeZone
 * @param {GapPlan} [plan]  the parent's gap; when given, the rows say when it ends and how long a dose has been allowed
 * @returns {CardStatus}
 */
export function cardStatus(check, ingredient, rule, now, timeZone, plan) {
  const name = ingredient;
  const last = check.lastDose;
  const lastLine = last ? `Last: ${formatWhen(last.givenAt, now, timeZone)} (${formatAgo(last.givenAt, now)})` : undefined;

  if (check.status === 'BLOCKED') {
    const age = rule ? formatAgeDays(rule.minAgeDays) : 'the minimum age';
    return { kind: 'blocked', icon: 'stop', title: `Under ${age}: please see a doctor`, detail: `This app does not track ${name} for babies under ${age}.`, nextAllowedAt: null };
  }

  if (check.status === 'DAILY_LIMIT_REACHED') {
    const next = check.nextAllowedAt;
    const reason = rule && check.dosesInLast24h >= rule.maxDosesPer24h
      ? `${check.dosesInLast24h} doses`
      : formatMg(check.mgInLast24h);
    return {
      kind: 'limit',
      icon: 'stop',
      title: `24-hour limit reached (${reason})`,
      detail: next === null ? lastLine : `Next ${name} from ${formatWhen(next, now, timeZone)}`,
      nextAllowedAt: next,
    };
  }

  if (check.status === 'TOO_SOON' && check.nextAllowedAt !== null) {
    const next = check.nextAllowedAt;
    const start = last ? last.givenAt : now;
    const span = next - start;
    return {
      kind: 'soon',
      icon: 'clock',
      title: `Next ${name} from ${formatWhen(next, now, timeZone)}`,
      detail: `in ${formatDuration(next - now, { up: true })}${lastLine ? ` · ${lastLine}` : ''}`,
      nextAllowedAt: next,
      progress: span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : 1,
    };
  }

  if (check.dosesInLast24h === 0 && !check.warnings.includes('NO_RULES_FOR_INGREDIENT')) {
    return { kind: 'none', icon: 'dash', title: `${name[0].toUpperCase()}${name.slice(1)} allowed now`, detail: lastLine || 'None in the last 24 hours', nextAllowedAt: null };
  }

  if (check.warnings.includes('NO_RULES_FOR_INGREDIENT')) {
    return {
      kind: 'none',
      icon: 'dash',
      title: last ? `${cap(name)}: follow the label for when to give it` : `No ${name} recorded yet`,
      detail: lastLine,
      nextAllowedAt: null,
    };
  }

  if (plan?.phase === 'early' && plan.targetAt !== null && last) {
    const span = plan.targetAt - last.givenAt;
    return {
      kind: 'soon',
      icon: 'clock',
      title: `${cap(name)}: your ${formatGap(plan.gapMinutes)} gap ends in ${formatDuration(plan.targetAt - now, { up: true })}`,
      detail: `Allowed now if needed${lastLine ? ` · ${lastLine}` : ''}`,
      nextAllowedAt: plan.targetAt,
      progress: span > 0 ? Math.min(1, Math.max(0, (now - last.givenAt) / span)) : 1,
    };
  }
  const allowedFor = plan?.phase === 'ready' && plan.readySince !== null ? `Allowed since ${formatWhen(plan.readySince, now, timeZone)} (${formatAgo(plan.readySince, now)})` : null;
  return { kind: 'ok', icon: 'tick', title: `${cap(name)} is allowed now`, detail: [allowedFor, lastLine].filter(Boolean).join(' · ') || undefined, nextAllowedAt: null };
}
