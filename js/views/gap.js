// @ts-check
/* Time between doses: the parent picks how long they would like to wait,
   from the rules' minimum up to the top of the usual range. Chips only, so a
   value outside the range cannot be entered. The minimum is set by the
   safety rules and never moves; this only changes when the countdown ends
   and when reminders come (js/engine/gap.js). */

import { h, icon, toast } from '../dom.js';
import * as db from '../db.js';
import { childRows, ruleFor } from '../state.js';
import { gapChoices, clampGap } from '../engine/gap.js';
import { formatGap, formatInterval } from '../format.js';
import { cap } from '../status.js';
import { refreshReminders } from '../reminders.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function gapView(ctx) {
  const child = await db.children.get(ctx.params.id);
  if (!child) { ctx.go('/', { replace: true }); return { title: '', node: h('div') }; }
  const bottles = await db.bottles.list();
  const { rows } = await childRows(child, bottles);

  /** @type {Record<string, number>} */
  const picks = {};
  const cards = [];
  for (const { ingredient } of rows) {
    const rule = ruleFor(ingredient);
    if (!rule) continue;
    const choices = gapChoices(rule);
    if (choices.length < 2) continue;
    picks[ingredient] = clampGap(rule, child.gapMinutes?.[ingredient]);
    cards.push(gapCard(ingredient, choices, picks));
  }

  const back = `/child/${child.id}`;
  if (cards.length === 0) {
    return {
      title: 'Time between doses', back,
      node: h('div', { class: 'stack' },
        h('p', null, 'There is no range to choose from for the medicines in your house. The countdown uses the time between doses set by the safety limits.'),
        h('a', { class: 'btn btn-secondary', href: `#${back}` }, 'Back')),
    };
  }

  const save = async () => {
    /** @type {Record<string, number>} */
    const next = { ...(child.gapMinutes ?? {}) };
    for (const [ingredient, minutes] of Object.entries(picks)) {
      const rule = ruleFor(ingredient);
      if (rule && minutes === gapChoices(rule)[0]) delete next[ingredient];
      else next[ingredient] = minutes;
    }
    const { gapMinutes: _old, ...rest } = child;
    await db.children.save(Object.keys(next).length ? { ...rest, gapMinutes: next } : rest);
    await refreshReminders();
    toast('Saved');
    ctx.go(back);
  };

  const node = h('div', { class: 'stack' },
    h('p', null, 'Choose how long you would like to wait between doses. The countdown on Dose now counts to this time.'),
    ...cards,
    h('p', { class: 'note-line' }, 'The earliest time is set by the safety limits and does not change. Your choice only changes when the countdown ends and when reminders come.'),
    h('a', { class: 'btn btn-quiet', href: '#/sources' }, 'Where these times come from'),
    h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: save }, icon('tick'), 'Save'),
  );
  return { title: 'Time between doses', back, node };
}

/**
 * @param {string} ingredient @param {number[]} choices @param {Record<string, number>} picks
 */
function gapCard(ingredient, choices, picks) {
  const now = h('span', { class: 'gap-now' }, formatGap(picks[ingredient]));
  const first = choices[0];
  const last = choices[choices.length - 1];
  const chips = choices.map((m) => {
    const chip = h('button', { class: 'gap-chip', type: 'button', role: 'radio', 'aria-checked': String(m === picks[ingredient]), 'aria-label': `${formatInterval(m)}${m === first ? ', the earliest allowed' : m === last ? ', the top of the usual range' : ''}` },
      h('span', null, formatGap(m)),
      m === first ? h('small', null, 'earliest') : m === last ? h('small', null, 'top') : null);
    return chip;
  });
  const group = h('div', { class: 'gap-chips', role: 'radiogroup', 'aria-label': `Time between ${ingredient} doses` }, chips);
  chips.forEach((chip, i) => chip.addEventListener('click', () => {
    picks[ingredient] = choices[i];
    for (const [j, c] of chips.entries()) c.setAttribute('aria-checked', String(j === i));
    now.textContent = formatGap(choices[i]);
  }));
  return h('section', { class: 'card gap-card' },
    h('div', { class: 'gap-head' }, h('h2', null, cap(ingredient)), now),
    group,
    h('p', { class: 'small gap-hint' }, `${formatInterval(first)} is the earliest allowed and ${formatInterval(last)} is the top of the usual range.`),
  );
}
