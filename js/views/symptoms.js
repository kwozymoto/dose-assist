// @ts-check
/* Temperature and symptom log. A record for the parent and for whoever
   they talk to next; it does not interpret anything (PLAN.md 7.3: no
   diagnosis). The help link is always there, whatever is ticked. */

import { h, icon, toast } from '../dom.js';
import * as db from '../db.js';
import { state } from '../state.js';
import { now, timeZone } from '../clock.js';
import { toLocalInput, fromLocalInput } from '../format.js';
import { SYMPTOM_FLAGS, field } from './child.js';
import { GUIDANCE } from '../content/guidance.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function symptomForm(ctx) {
  const child = await db.children.get(ctx.params.id);
  if (!child) { ctx.go('/', { replace: true }); return { title: '', node: h('div') }; }
  const tz = timeZone();
  const t = now();
  const temp = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 's-temp', inputmode: 'decimal', placeholder: 'e.g. 38.2' }));
  const at = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 's-at', type: 'datetime-local', max: toLocalInput(t, tz), value: toLocalInput(t, tz) }));
  const notes = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input', id: 's-notes', rows: 3 }));
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const checks = SYMPTOM_FLAGS.map((f) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: `f-${f.id}`, value: f.id }));
    return { f, input, node: h('label', { class: 'check', for: `f-${f.id}` }, input, h('span', null, f.name)) };
  });

  const save = async (/** @type {Event} */ e) => {
    e.preventDefault();
    let c = null;
    if (temp.value.trim()) {
      c = Number(temp.value.replace(',', '.'));
      if (!Number.isFinite(c) || c < 30 || c > 45) { error.textContent = 'Enter the temperature in °C, for example 38.2.'; error.hidden = false; return; }
    }
    const flags = checks.filter((x) => x.input.checked).map((x) => x.f.id);
    const when = fromLocalInput(at.value, tz);
    if (when === null || when > now()) { error.textContent = 'Enter a time that is not in the future.'; error.hidden = false; return; }
    if (c === null && flags.length === 0 && !notes.value.trim()) { error.textContent = 'Enter a temperature, tick something, or write a note.'; error.hidden = false; return; }
    await db.symptoms.save({ id: db.uid(), childId: child.id, at: when, temperatureC: c, flags, notes: notes.value.trim(), by: state.caregiver || 'Someone' });
    toast('Saved');
    ctx.go(`/child/${child.id}`);
  };

  const node = h('form', { class: 'stack', onsubmit: save, novalidate: true },
    field('Temperature (°C)', 's-temp', temp),
    h('fieldset', { class: 'field' }, h('legend', { class: 'label' }, 'Anything else?'), h('div', { class: 'checks' }, checks.map((x) => x.node))),
    field('Notes', 's-notes', notes),
    field('Time', 's-at', at),
    error,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Save'),
    h('a', { class: 'btn btn-quiet', href: '#/help' }, icon('help'), 'When to get help'),
    h('p', { class: 'small muted' }, GUIDANCE.ifWorried.text),
  );
  return { title: `${child.name}: temperature and symptoms`, back: `/child/${child.id}`, node };
}
