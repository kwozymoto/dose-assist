// @ts-check
/* Edit or delete one dose. Every change is kept: the audit trail below the
   form shows who changed what, when, and why. A deleted dose is marked, not
   removed, and can be put back. */

import { h, confirmDialog, toast } from '../dom.js';
import * as db from '../db.js';
import { state } from '../state.js';
import { componentsForAmount } from '../engine/amounts.js';
import { now, timeZone } from '../clock.js';
import { formatWhen, formatAmount, formatMg, toLocalInput, fromLocalInput, formatStrength } from '../format.js';
import { refreshReminders } from '../reminders.js';
import { field } from './child.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */
/** @typedef {import('../db.js').DoseAudit} DoseAudit */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function doseEdit(ctx) {
  const dose = await db.doses.get(ctx.params.id);
  if (!dose) { ctx.go('/', { replace: true }); return { title: '', node: h('div') }; }
  const child = await db.children.get(dose.childId);
  const audit = await db.doses.audit(dose.id);
  const tz = timeZone();
  const t = now();
  const back = `/child/${dose.childId}`;
  const who = () => state.caregiver || 'Someone';

  const history = h('section', { class: 'stack-sm' },
    h('h2', null, 'History of this record'),
    h('ul', { class: 'audit' }, audit.map((a) => h('li', null, auditLine(a, t, tz)))),
  );

  if (dose.deletedAt) {
    const restore = async () => {
      const reason = await confirmDialog({ title: 'Put this dose back on the record?', confirm: 'Put it back', input: { label: 'Why? (optional)' } });
      if (!reason) return;
      await db.doses.restore(dose.id, { by: who(), at: now(), reason: reason.value.trim() || undefined });
      await refreshReminders();
      toast('Dose put back');
      ctx.refresh();
    };
    return {
      title: 'Deleted dose',
      back,
      node: h('div', { class: 'stack' },
        h('p', null, `${formatAmount(dose.amount, dose.bottle.form)} ${dose.bottle.name} for ${child?.name ?? 'a child'}, ${formatWhen(dose.givenAt, t, tz)}. Deleted ${formatWhen(dose.deletedAt, t, tz)}.`),
        h('p', { class: 'muted small' }, 'Deleted doses do not count toward limits. The record is kept.'),
        h('button', { class: 'btn btn-secondary', onclick: restore }, 'Put it back'),
        history,
      ),
    };
  }

  const amount = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'e-amount', inputmode: 'decimal', value: String(dose.amount) }));
  const at = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'e-at', type: 'datetime-local', max: toLocalInput(t, tz), value: toLocalInput(dose.givenAt, tz) }));
  const by = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'e-by', value: dose.givenBy }));
  const note = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'e-note', value: dose.note ?? '' }));
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  const save = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const amt = Number(amount.value.replace(',', '.'));
    const givenAt = fromLocalInput(at.value, tz);
    if (!Number.isFinite(amt) || amt <= 0) { error.textContent = 'Enter the amount.'; error.hidden = false; return; }
    if (givenAt === null || givenAt > now()) { error.textContent = 'Enter a time that is not in the future.'; error.hidden = false; return; }
    /** @type {Record<string, any>} */
    const changes = {};
    if (amt !== dose.amount) {
      changes.amount = amt;
      // mg follows the amount, from the strength recorded with the dose.
      changes.components = componentsForAmount(dose.bottle, amt);
    }
    if (givenAt !== dose.givenAt) changes.givenAt = givenAt;
    if (by.value.trim() && by.value.trim() !== dose.givenBy) changes.givenBy = by.value.trim();
    if (note.value.trim() !== (dose.note ?? '')) changes.note = note.value.trim();
    if (Object.keys(changes).length === 0) { ctx.go(back); return; }
    const reason = await confirmDialog({ title: 'Save this change?', body: 'The old values are kept in this dose’s history.', confirm: 'Save', input: { label: 'Why? (optional)' } });
    if (!reason) return;
    await db.doses.edit(dose.id, changes, { by: who(), at: now(), reason: reason.value.trim() || undefined });
    await refreshReminders();
    toast('Saved');
    ctx.go(back);
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete this dose?',
      body: 'It will stop counting toward limits and reminders. The record is kept, marked as deleted, and can be put back.',
      confirm: 'Delete', danger: true, input: { label: 'Why? (optional)' },
    });
    if (!ok) return;
    await db.doses.remove(dose.id, { by: who(), at: now(), reason: ok.value.trim() || undefined });
    await refreshReminders();
    toast('Dose deleted');
    ctx.go(back);
  };

  const node = h('form', { class: 'stack', onsubmit: save },
    h('p', null, h('strong', null, dose.bottle.name), ' · ', dose.bottle.components.map((c) => formatStrength(c, dose.bottle.form)).join(' + ')),
    field(`Amount (${dose.bottle.form === 'liquid' ? 'mL' : 'tablets'})`, 'e-amount', amount),
    field('Time given', 'e-at', at),
    field('Given by', 'e-by', by),
    field('Note', 'e-note', note),
    h('p', { class: 'small muted' }, `Recorded: ${dose.components.map((c) => `${formatMg(c.mg)} ${c.ingredient}`).join(' + ')}. Limits version ${dose.rulesVersion}.`),
    error,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Save changes'),
    h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: remove }, 'Delete this dose'),
    history,
  );
  return { title: 'Edit dose', back, node };
}

/** @param {DoseAudit} a @param {number} t @param {string} tz */
function auditLine(a, t, tz) {
  const when = formatWhen(a.at, t, tz);
  const reason = a.reason ? ` (“${a.reason}”)` : '';
  if (a.action === 'create') return `Logged by ${a.by}, ${when}`;
  if (a.action === 'delete') return `Deleted by ${a.by}, ${when}${reason}`;
  if (a.action === 'restore') return `Put back by ${a.by}, ${when}${reason}`;
  const parts = Object.keys(a.after ?? {}).filter((k) => k !== 'components').map((k) => {
    const b = /** @type {any} */ (a.before ?? {})[k];
    const v = /** @type {any} */ (a.after ?? {})[k];
    if (k === 'givenAt') return `time ${formatWhen(b, t, tz)} → ${formatWhen(v, t, tz)}`;
    return `${k === 'givenBy' ? 'given by' : k} ${b ?? '(none)'} → ${v}`;
  });
  return `Changed by ${a.by}, ${when}: ${parts.join('; ')}${reason}`;
}
