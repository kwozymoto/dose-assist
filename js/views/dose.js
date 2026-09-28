// @ts-check
/* Edit or delete one dose. Every change is kept: the audit trail below the
   form shows who changed what, when, and why. A deleted dose is marked, not
   removed, and can be put back. */

import { h, confirmDialog, toast } from '../dom.js';
import * as db from '../db.js';
import { state, engineChild } from '../state.js';
import { componentsForAmount } from '../engine/amounts.js';
import { now, timeZone } from '../clock.js';
import { formatWhen, formatAmount, formatMg, toLocalInput, fromLocalInput, formatStrength, parseAmount, formatDuration } from '../format.js';
import { checkDose } from '../engine/checkDose.js';
import { refreshReminders } from '../reminders.js';
import { BACKDATE_MAX_MS } from '../config.js';

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
  // A dose can be recorded up to BACKDATE_MAX_MS after it was given, so its time can move no earlier than that before it was logged.
  const earliestAt = dose.loggedAt - BACKDATE_MAX_MS;
  const at = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'e-at', type: 'datetime-local', min: toLocalInput(earliestAt, tz), max: toLocalInput(t, tz), value: toLocalInput(dose.givenAt, tz) }));
  const by = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'e-by', value: dose.givenBy }));
  const note = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'e-note', value: dose.note ?? '' }));
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  const save = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const amt = parseAmount(amount.value);
    // The time box has minute precision. Only a time the person actually
    // changed is written, or every edit would shift the dose by up to a
    // minute (and, at a DST fall-back, by an hour).
    const timeChanged = at.value !== toLocalInput(dose.givenAt, tz);
    const givenAt = timeChanged ? fromLocalInput(at.value, tz) : dose.givenAt;
    if (amt === null) { error.textContent = 'Enter the amount, for example 5 or 2.5.'; error.hidden = false; return; }
    if (givenAt === null || givenAt > now()) { error.textContent = 'Enter a time that is not in the future.'; error.hidden = false; return; }
    if (timeChanged && givenAt < earliestAt) { error.textContent = `This dose was logged ${formatWhen(dose.loggedAt, t, tz)}. Its time can be up to ${formatDuration(BACKDATE_MAX_MS)} before that, so no earlier than ${formatWhen(earliestAt, t, tz)}.`; error.hidden = false; return; }
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
    // Say plainly if, with this change, the dose breaks a limit. The record
    // is still saved as the person says it happened.
    let warning = '';
    if (child && (changes.components || changes.givenAt !== undefined)) {
      // Only what came before it: the question is whether this dose, at its
      // time, was within the limits.
      const when = changes.givenAt ?? dose.givenAt;
      const others = (await db.doses.forChild(child.id)).filter((x) => x.id !== dose.id && x.givenAt <= when);
      const check = checkDose({
        components: changes.components ?? dose.components, rules: state.rules, history: others,
        now: when, child: engineChild(child), timeZone: tz,
      });
      if (check.status !== 'OK') warning = 'With this change, this dose is outside the usual limits. It will be recorded as you enter it. If your child may have had too much, call the Poisons Centre.';
    }
    // Would this change what the app allows right now? Moving a dose earlier
    // can lift a stop; say so, so it is never done by accident.
    let effect = '';
    if (child) {
      const all = await db.doses.forChild(child.id);
      const edited = all.map((x) => (x.id === dose.id ? { ...x, ...changes } : x));
      const t2 = now();
      for (const ing of [...new Set(dose.components.map((c) => c.ingredient))]) {
        const q = (/** @type {any[]} */ history) => checkDose({ components: [{ ingredient: ing }], rules: state.rules, history, now: t2, child: engineChild(child), timeZone: tz }).status;
        const before = q(all);
        const after = q(edited);
        if (before !== 'OK' && after === 'OK') effect += ` After this change, ${ing} will be allowed now. It is not allowed now. Only save if this is what really happened.`;
        else if (before === 'OK' && after !== 'OK') effect += ` After this change, ${ing} will not be allowed now.`;
      }
    }
    const reason = await confirmDialog({ title: 'Save this change?', body: `${warning || 'The old values are kept in this dose’s history.'}${effect}`, confirm: 'Save', input: { label: 'Why? (optional)' } });
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
    h('p', null, h('strong', null, child ? `${child.name}: ` : ''), h('strong', null, dose.bottle.name), ' · ', dose.bottle.components.map((c) => formatStrength(c, dose.bottle.form)).join(' + ')),
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
