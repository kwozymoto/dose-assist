// @ts-check
/* One big button per medicine on a child's page.

   Each says the medicine, its state in words ("Allowed now", "Not yet"),
   a live countdown to the end of the parent's gap or a count-up from when a
   dose became allowed, and "Give paracetamol ›". The ones a dose is allowed
   for come first (engine/gap.js orderForButtons). Everything shown comes
   from the engine's answer; nothing here decides what is allowed. A button
   only opens the give flow for that medicine, which checks again and never
   logs by itself.

   The clock ticks from timestamps, not by subtracting a second at a time, so
   a phone that slept comes back showing the right time. */

import { h, icon } from '../dom.js';
import { now, timeZone } from '../clock.js';
import { formatClock, formatGap, formatTime, formatDuration, formatWhen, formatAgo } from '../format.js';
import { GUIDANCE } from '../content/guidance.js';
import { orderForButtons } from '../engine/gap.js';
import { cap } from '../status.js';

/** @typedef {import('../db.js').Child} Child */
/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../status.js').CardStatus} CardStatus */
/** @typedef {import('../engine/gap.js').GapPlan} GapPlan */
/** @typedef {import('../engine/types.js').DoseCheck} DoseCheck */
/** @typedef {{ingredient: string, plan: GapPlan, card: CardStatus, check: DoseCheck}} Row */

/**
 * @param {Child} child
 * @param {Row[]} rows
 * @param {Ctx} ctx
 * @returns {{node: HTMLElement, cleanup: () => void}}
 */
export function doseNow(child, rows, ctx) {
  const t = now();
  const tz = timeZone();
  const ordered = orderForButtons(rows);
  const solo = ordered.length === 1;
  const allBlocked = rows.length > 0 && rows.every((r) => r.plan.phase === 'blocked');

  const buttons = ordered.length
    ? ordered.map((r) => medButton(child, r, solo, t, tz))
    : [h('a', { class: 'dose-hero dose-idle', href: '#/bottles/new' },
      h('span', { class: 'dose-face' }, icon('bottle')),
      h('span', { class: 'dose-title' }, 'Add a medicine'),
      h('span', { class: 'dose-line' }, 'Add the medicines you have at home, so you can log a dose in two taps.'))];

  const toTimeline = () => {
    const el = document.getElementById('timeline');
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };
  const actions = allBlocked ? null : h('div', { class: 'below' },
    h('a', { class: 'btn btn-secondary', href: `#/give?child=${child.id}&when=earlier` }, icon('plus'), 'Add an earlier dose'),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: toTimeline }, icon('clock'), 'History and edit'),
    h('a', { class: 'btn btn-quiet below-wide', href: `#/child/${child.id}/gap` }, icon('settings'), 'Time between doses'),
  );

  const node = h('div', { class: 'stack dose-now' }, h('div', { class: `dose-buttons${solo ? ' solo' : ''}` }, buttons), actions);

  let fired = false;
  const tick = () => {
    const at = now();
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (node.querySelectorAll('[data-until]'))) {
      const ms = Number(el.dataset.until) - at;
      el.textContent = formatClock(ms, { up: true });
      if (ms <= 0 && !fired) { fired = true; ctx.refresh(); }
    }
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (node.querySelectorAll('[data-since]'))) el.textContent = formatClock(at - Number(el.dataset.since));
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (node.querySelectorAll('.dose-bar i'))) el.style.width = `${pct(Number(el.dataset.from), Number(el.dataset.to), at)}%`;
  };
  const id = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);
  return { node, cleanup: () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); } };
}

/** @param {number} from @param {number} until @param {number} at */
const pct = (from, until, at) => (until > from ? Math.round(Math.min(1, Math.max(0, (at - from) / (until - from))) * 100) : 100);

/**
 * @typedef {object} ButtonView
 * @property {string} state   the answer in two or three words
 * @property {string} cls
 * @property {'tick' | 'clock' | 'stop' | 'dash'} icon
 * @property {string} [label]   above the timer
 * @property {number} [until]   the countdown ends at this time
 * @property {number} [since]   the count-up started at this time
 * @property {string} [line]    under the timer, or instead of it
 * @property {string} spoken    for screen readers
 */

/**
 * @param {Child} child @param {Row} r @param {boolean} solo @param {number} t @param {string} tz
 */
function medButton(child, r, solo, t, tz) {
  const v = buttonView(r, t, tz);
  const name = cap(r.ingredient);
  const lastAt = r.check.lastDose?.givenAt;
  const facts = [
    lastAt !== undefined ? `Last ${formatWhen(lastAt, t, tz)} (${formatAgo(lastAt, t)})` : null,
    r.check.dosesInLast24h > 0 ? `${r.check.dosesInLast24h} in 24 h` : null,
  ].filter(Boolean).join(' · ');
  const bar = v.until !== undefined && lastAt !== undefined
    ? h('span', { class: 'dose-bar' }, h('i', { 'data-from': String(lastAt), 'data-to': String(v.until), style: `width:${pct(lastAt, v.until, t)}%` }))
    : null;
  return h('a', {
    class: `dose-hero dose-med ${v.cls}${solo ? ' dose-solo' : ''}`,
    href: `#/give?child=${child.id}&ingredients=${encodeURIComponent(r.ingredient)}`,
    'aria-label': `${name} for ${child.name}: ${v.spoken}${facts ? ` ${facts}.` : ''} Give ${r.ingredient}.`,
  },
    h('span', { class: 'dose-top' }, h('span', { class: 'dose-face' }, icon(v.icon)), h('span', { class: 'dose-name' }, name)),
    h('span', { class: 'dose-title' }, v.state),
    v.label ? h('span', { class: 'dose-label' }, v.label) : null,
    v.until !== undefined ? h('span', { class: 'dose-count', 'data-until': String(v.until) }, formatClock(v.until - t, { up: true })) : null,
    v.since !== undefined ? h('span', { class: 'dose-count', 'data-since': String(v.since) }, formatClock(t - v.since)) : null,
    v.line ? h('span', { class: 'dose-line' }, v.line) : null,
    facts ? h('span', { class: 'dose-line2' }, facts) : null,
    h('span', { class: 'dose-go' }, `Give ${r.ingredient}`, icon('chevron')),
    bar,
  );
}

/** @param {Row} r @param {number} t @param {string} tz @returns {ButtonView} */
function buttonView(r, t, tz) {
  const p = r.plan;
  const target = p.targetAt;
  switch (p.phase) {
    case 'ready':
      if (p.readySince !== null) {
        return {
          state: 'Allowed now', cls: 'dose-ready', icon: 'tick', label: `Allowed since ${formatTime(p.readySince, tz)}`, since: p.readySince,
          spoken: `Allowed now, since ${formatTime(p.readySince, tz)}, ${formatDuration(t - p.readySince)} ago.`,
        };
      }
      break;
    case 'idle':
      return { state: 'Allowed now', cls: 'dose-ready', icon: 'tick', line: 'No doses in the last 24 hours', spoken: 'Allowed now. No doses in the last 24 hours.' };
    case 'early':
      if (target !== null) {
        return {
          state: 'Allowed now if needed', cls: 'dose-wait', icon: 'clock', label: `Your ${formatGap(p.gapMinutes)} gap ends in`, until: target,
          spoken: `Allowed now if needed. Your ${formatGap(p.gapMinutes)} gap ends in ${formatDuration(target - t, { up: true })}.`,
        };
      }
      break;
    case 'wait':
      if (target !== null) {
        const longer = p.ruleAt !== null && target > p.ruleAt;
        return {
          state: 'Not yet', cls: 'dose-wait', icon: 'clock',
          label: longer ? `Your ${formatGap(p.gapMinutes)} gap ends in` : 'Allowed in',
          until: target,
          line: longer && p.ruleAt !== null ? `Not allowed until ${formatTime(p.ruleAt, tz)}` : `From ${formatTime(target, tz)}`,
          spoken: `Not yet. Allowed in ${formatDuration(target - t, { up: true })}, from ${formatTime(p.ruleAt ?? target, tz)}.`,
        };
      }
      break;
    case 'limit':
      return { state: 'Not now', cls: 'dose-limit', icon: 'stop', line: r.card.title, spoken: `Not now. ${r.card.title}. ${r.card.detail ?? ''}` };
    case 'blocked':
      return { state: 'See a doctor', cls: 'dose-limit', icon: 'stop', line: GUIDANCE.underMinAge.text, spoken: `${r.card.title}. ${GUIDANCE.underMinAge.text}` };
    default:
      break;
  }
  return { state: 'Follow the label', cls: 'dose-idle', icon: 'dash', line: r.card.title, spoken: r.card.title };
}
