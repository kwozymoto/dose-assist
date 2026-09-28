// @ts-check
/* The big "Dose now" button on a child's page, with a chip per medicine.

   It counts DOWN to the end of the parent's chosen gap, then UP from the
   moment a dose was allowed. Everything shown comes from the engine's answer
   (js/engine/gap.js); nothing here decides what is allowed. The button only
   opens the give flow, which checks again and never logs by itself.

   The clock ticks from timestamps, not by subtracting a second at a time, so
   a phone that slept comes back showing the right time. */

import { h, icon } from '../dom.js';
import { now, timeZone } from '../clock.js';
import { formatClock, formatGap, formatTime, formatDuration } from '../format.js';
import { pickHero } from '../engine/gap.js';
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
  const hero = pickHero(rows);
  const row = hero ? rows.find((r) => r.ingredient === hero.ingredient) : undefined;
  const view = hero && row ? heroView(hero.state, hero.ingredient, hero.plan, row.card, row.check.lastDose?.givenAt, t, tz) : { cls: 'dose-idle', icon: /** @type {const} */ ('dash'), line: 'No medicines yet' };

  const face = h('span', { class: 'dose-face' }, icon(view.icon));
  const bar = view.bar
    ? h('span', { class: 'dose-bar' }, h('i', { 'data-from': String(view.bar.from), 'data-until': String(view.bar.until), style: `width:${pct(view.bar.from, view.bar.until, t)}%` }))
    : null;
  const button = h('a', { class: `dose-hero ${view.cls}`, href: `#/give?child=${child.id}`, 'aria-label': `Dose now for ${child.name}. ${view.spoken ?? view.line}` },
    face,
    h('span', { class: 'dose-title' }, 'Dose now'),
    view.label ? h('span', { class: 'dose-label' }, view.label) : null,
    view.until !== undefined ? h('span', { class: 'dose-count', 'data-until': String(view.until) }, formatClock(view.until - t, { up: true })) : null,
    view.since !== undefined ? h('span', { class: 'dose-count', 'data-since': String(view.since) }, formatClock(t - view.since)) : null,
    h('span', { class: 'dose-line' }, view.line),
    view.line2 ? h('span', { class: 'dose-line2' }, view.line2) : null,
    bar,
  );

  const chips = h('div', { class: 'chips' }, rows.map((r) => chip(r, t)));

  const toTimeline = () => {
    const el = document.getElementById('timeline');
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };
  const actions = h('div', { class: 'below' },
    h('a', { class: 'btn btn-secondary', href: `#/give?child=${child.id}&when=earlier` }, icon('plus'), 'Add an earlier dose'),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: toTimeline }, icon('clock'), 'History and edit'),
    h('a', { class: 'btn btn-quiet below-wide', href: `#/child/${child.id}/gap` }, icon('settings'), 'Time between doses'),
  );

  const node = h('div', { class: 'stack dose-now' }, button, rows.length ? chips : null, actions);

  let fired = false;
  const tick = () => {
    const at = now();
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (node.querySelectorAll('[data-until].dose-count, [data-until].dose-chip-time'))) {
      const ms = Number(el.dataset.until) - at;
      el.textContent = formatClock(ms, { up: true });
      if (ms <= 0 && !fired) { fired = true; ctx.refresh(); }
    }
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (node.querySelectorAll('[data-since]'))) el.textContent = formatClock(at - Number(el.dataset.since));
    for (const el of /** @type {NodeListOf<HTMLElement>} */ (node.querySelectorAll('.dose-bar i'))) el.style.width = `${pct(Number(el.dataset.from), Number(el.dataset.until), at)}%`;
  };
  const id = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);
  return { node, cleanup: () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); } };
}

/** @param {number} from @param {number} until @param {number} at */
const pct = (from, until, at) => (until > from ? Math.round(Math.min(1, Math.max(0, (at - from) / (until - from))) * 100) : 100);

/**
 * @typedef {object} HeroView
 * @property {string} cls
 * @property {'tick' | 'clock' | 'stop' | 'dash'} icon
 * @property {string} [label]
 * @property {number} [until]   the countdown ends at this time
 * @property {number} [since]   the count-up started at this time
 * @property {string} line
 * @property {string} [line2]
 * @property {string} [spoken]  for screen readers, when the visible text is not a sentence
 * @property {{from: number, until: number}} [bar]
 */

/**
 * @param {import('../engine/gap.js').Phase} state @param {string} ingredient @param {GapPlan} plan
 * @param {CardStatus} card @param {number | undefined} lastAt  the last dose of this ingredient
 * @param {number} t @param {string} tz
 * @returns {HeroView}
 */
function heroView(state, ingredient, plan, card, lastAt, t, tz) {
  const name = cap(ingredient);
  const target = plan.targetAt;
  if (state === 'ready' && plan.readySince !== null) {
    return {
      cls: 'dose-ready', icon: 'tick', label: 'Allowed for', since: plan.readySince,
      line: `${name}, since ${formatTime(plan.readySince, tz)}`,
      spoken: `${name} can be given now. Allowed for ${formatDuration(t - plan.readySince)}.`,
    };
  }
  if (state === 'early' && target !== null) {
    return {
      cls: 'dose-wait', icon: 'clock', label: `Your ${formatGap(plan.gapMinutes)} gap ends in`, until: target,
      line: `${name} is allowed now if needed`,
      spoken: `Your gap for ${ingredient} ends in ${formatDuration(target - t, { up: true })}. It is allowed now if needed.`,
      bar: { from: lastAt ?? target - plan.gapMinutes * 60000, until: target },
    };
  }
  if (state === 'wait' && target !== null) {
    const longer = plan.ruleAt !== null && target > plan.ruleAt;
    return {
      cls: 'dose-wait', icon: 'clock',
      label: longer ? `Your ${formatGap(plan.gapMinutes)} gap ends in` : 'Next dose allowed in',
      until: target,
      line: longer && plan.ruleAt !== null ? `${name}: earliest allowed ${formatTime(plan.ruleAt, tz)}` : `${name}, from ${formatTime(target, tz)}`,
      spoken: `${name} is not allowed yet. ${longer ? 'Your gap' : 'The wait'} ends in ${formatDuration(target - t, { up: true })}.`,
      bar: { from: lastAt ?? target - plan.gapMinutes * 60000, until: target },
    };
  }
  if (state === 'idle') {
    return { cls: 'dose-idle', icon: 'dash', line: 'No doses in the last 24 hours', line2: card.detail };
  }
  if (state === 'limit' || state === 'blocked') {
    return { cls: 'dose-limit', icon: 'stop', line: card.title, line2: card.detail, spoken: `${card.title}. ${card.detail ?? ''}` };
  }
  return { cls: 'dose-idle', icon: 'dash', line: card.title };
}

/** One small chip per medicine. @param {Row} r @param {number} t */
function chip(r, t) {
  const name = cap(r.ingredient);
  const p = r.plan;
  if ((p.phase === 'wait' || p.phase === 'early') && p.targetAt !== null) {
    return h('span', { class: 'dose-chip dose-wait' }, icon('clock'), name, h('b', { class: 'dose-chip-time', 'data-until': String(p.targetAt) }, formatClock(p.targetAt - t, { up: true })));
  }
  if (p.phase === 'ready') return h('span', { class: 'dose-chip dose-ready' }, icon('tick'), `${name} allowed`);
  if (p.phase === 'limit') return h('span', { class: 'dose-chip dose-limit' }, icon('stop'), `${name} limit`);
  if (p.phase === 'blocked') return h('span', { class: 'dose-chip dose-limit' }, icon('stop'), `${name}: not for this age`);
  if (p.phase === 'idle') return h('span', { class: 'dose-chip dose-idle' }, icon('dash'), `${name}: no recent doses`);
  return h('span', { class: 'dose-chip dose-idle' }, icon('dash'), `${name}: follow the label`);
}
