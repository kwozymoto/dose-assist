// @ts-check
/* A child: their medicines now, the timeline of every dose (who, what,
   when), temperatures and symptoms; adding and editing a child; and a
   plain-text summary for a GP visit or a Healthline call. */

import { h, icon, confirmDialog, toast } from '../dom.js';
import * as db from '../db.js';
import { state, childRows, ageText, CHILD_COLOURS } from '../state.js';
import { now, timeZone } from '../clock.js';
import { formatWhen, formatTime, formatDate, formatAmount, formatMg, toLocalInput } from '../format.js';
import { statusRow } from './home.js';
import { doseNow } from './dosenow.js';
import { refreshReminders } from '../reminders.js';
import { DAY_MS } from '../engine/time.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */
/** @typedef {import('../db.js').Child} Child */
/** @typedef {import('../db.js').DoseRecord} DoseRecord */
/** @typedef {import('../db.js').SymptomEntry} SymptomEntry */

export const SYMPTOM_FLAGS = [
  { id: 'drinking-less', name: 'Drinking less than usual' },
  { id: 'fewer-wet-nappies', name: 'Fewer wet nappies' },
  { id: 'vomiting', name: 'Vomiting' },
  { id: 'diarrhoea', name: 'Diarrhoea' },
  { id: 'rash', name: 'Rash' },
  { id: 'breathing', name: 'Breathing looks hard' },
  { id: 'sleepy', name: 'Very sleepy or hard to wake' },
  { id: 'pain', name: 'In pain' },
];

/**
 * @param {Ctx} ctx
 * @param {{asHome?: boolean, lead?: Node[], after?: Node[]}} [opts]  asHome: the only child, shown as Home; Home's notices go in `lead` (above Dose now) and `after` (below it)
 * @returns {Promise<Screen>}
 */
export async function childDetail(ctx, opts = {}) {
  const child = await db.children.get(ctx.params.id);
  if (!child) { ctx.go('/', { replace: true }); return { title: '', node: h('div') }; }
  const bottles = await db.bottles.list();
  const { rows } = await childRows(child, bottles);
  const all = await db.doses.forChild(child.id, { includeDeleted: true });
  const syms = await db.symptoms.forChild(child.id);
  const weight = await db.weights.latest(child.id);
  const t = now();
  const tz = timeZone();
  const showDeleted = ctx.query.get('deleted') === '1';
  const deletedCount = all.filter((d) => d.deletedAt).length;

  const facts = [ageText(child.dateOfBirth, t), weight ? `${weight.kg} kg (weighed ${formatDate(weight.recordedAt, tz)})` : null].filter(Boolean).join(' · ');

  const dose = doseNow(child, rows, ctx);
  const only = opts.asHome || (await db.children.list()).length === 1;
  const node = h('div', { class: 'stack' },
    ...(opts.lead ?? []),
    h('div', { class: `kid-head kid-${child.colour}` },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, child.name.slice(0, 1).toUpperCase()),
      h('span', { class: 'kid-name' }, h('span', null, child.name), facts ? h('span', { class: 'muted small' }, facts) : null),
    ),
    child.notes ? h('p', { class: 'notice' }, child.notes) : null,
    dose.node,
    ...(opts.after ?? []),
    rows.length ? h('h2', null, 'Each medicine') : null,
    h('ul', { class: 'rows' }, rows.map((r) => statusRow(r.card))),
    h('div', { class: 'button-row' },
      h('a', { class: 'btn btn-secondary', href: `#/child/${child.id}/symptom` }, icon('thermo'), 'Temperature or symptom'),
      h('a', { class: 'btn btn-secondary', href: `#/child/${child.id}/summary` }, icon('share'), 'Share a summary'),
    ),
    h('h2', { id: 'timeline', tabindex: '-1' }, 'Timeline'),
    timeline(all.filter((d) => showDeleted || !d.deletedAt), syms, t, tz),
    deletedCount > 0
      ? h('a', { class: 'btn btn-quiet', href: `#/child/${child.id}${showDeleted ? '' : '?deleted=1'}` }, showDeleted ? 'Hide deleted doses' : `Show deleted doses (${deletedCount})`)
      : null,
    h('div', { class: 'button-row' },
      h('a', { class: 'btn btn-secondary', href: `#/child/${child.id}/edit` }, 'Edit details'),
    ),
  );
  return { title: child.name, back: only ? false : '/', node, tab: 'home', refreshEvery: 30000, cleanup: dose.cleanup, kid: child.colour };
}

/**
 * Doses and symptom entries, newest first, grouped by local day.
 * @param {DoseRecord[]} doses @param {SymptomEntry[]} syms @param {number} t @param {string} tz
 */
function timeline(doses, syms, t, tz) {
  /** @type {{at: number, node: Node}[]} */
  const items = [];
  for (const d of doses) {
    const late = d.loggedAt - d.givenAt > 5 * 60000;
    items.push({
      at: d.givenAt,
      node: h('li', { class: `tl-item tl-dose${d.deletedAt ? ' tl-deleted' : ''}` },
        h('a', { href: `#/dose/${d.id}`, class: 'tl-link', 'aria-label': `${d.deletedAt ? 'Deleted: ' : ''}${formatTime(d.givenAt, tz)}, ${formatAmount(d.amount, d.bottle.form)} ${d.bottle.name}, given by ${d.givenBy}. Open to edit.` },
          h('span', { class: 'tl-time' }, formatTime(d.givenAt, tz)),
          h('span', { class: 'tl-main' },
            h('strong', null, `${formatAmount(d.amount, d.bottle.form)} ${d.bottle.name}`),
            h('span', { class: 'small' }, d.components.map((c) => `${formatMg(c.mg)} ${c.ingredient}`).join(' + '), ` · ${d.givenBy}`),
            d.overrideReason === 'DOCTOR_ADVISED' ? h('span', { class: 'badge' }, 'Doctor advised') : null,
            d.overrideReason === 'ALREADY_GIVEN' ? h('span', { class: 'badge badge-warn' }, 'Recorded after limits') : null,
            late ? h('span', { class: 'small muted' }, `Logged at ${formatWhen(d.loggedAt, t, tz)}`) : null,
            d.deletedAt ? h('span', { class: 'badge' }, `Deleted ${formatWhen(d.deletedAt, t, tz)}`) : null,
          ),
        ),
      ),
    });
  }
  for (const s of syms) {
    items.push({
      at: s.at,
      node: h('li', { class: 'tl-item tl-symptom' },
        h('span', { class: 'tl-time' }, formatTime(s.at, tz)),
        h('span', { class: 'tl-main' },
          h('strong', null, s.temperatureC !== null ? `${s.temperatureC.toFixed(1)} °C` : 'Symptoms'),
          s.flags.length ? h('span', { class: 'small' }, s.flags.map((f) => SYMPTOM_FLAGS.find((x) => x.id === f)?.name ?? f).join(', ')) : null,
          s.notes ? h('span', { class: 'small' }, s.notes) : null,
          h('span', { class: 'small muted' }, s.by),
        ),
      ),
    });
  }
  if (items.length === 0) return h('p', { class: 'muted' }, 'Nothing recorded yet.');
  items.sort((a, b) => b.at - a.at);
  const list = h('div', { class: 'timeline' });
  let day = '';
  /** @type {HTMLElement | null} */
  let ul = null;
  for (const it of items) {
    const label = dayLabel(it.at, t, tz);
    if (label !== day || !ul) {
      day = label;
      ul = h('ul', { class: 'tl-list' });
      list.append(h('h3', { class: 'tl-day' }, label), ul);
    }
    ul.append(it.node);
  }
  return list;
}

/** @param {number} ms @param {number} t @param {string} tz */
function dayLabel(ms, t, tz) {
  const d = formatDate(ms, tz);
  if (d === formatDate(t, tz)) return 'Today';
  if (d === formatDate(t - DAY_MS, tz)) return 'Yesterday';
  return d;
}

/* ---------------- add / edit ---------------- */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function childForm(ctx) {
  const editing = ctx.params.id ? await db.children.get(ctx.params.id) : undefined;
  const onboardingFlow = ctx.query.get('onboarding') === '1';
  const t = now();
  const tz = timeZone();
  const today = toLocalInput(t, tz).slice(0, 10);
  const weight = editing ? await db.weights.latest(editing.id) : undefined;

  const name = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'c-name', required: true, value: editing?.name ?? '', autocomplete: 'off', maxlength: 40 }));
  const dob = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'c-dob', type: 'date', required: true, max: today, value: editing?.dateOfBirth ?? '' }));
  const kg = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'c-kg', type: 'text', inputmode: 'decimal', value: '', placeholder: weight ? `Last: ${weight.kg} kg` : 'Optional' }));
  const notes = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input', id: 'c-notes', rows: 3, placeholder: 'Allergies, or instructions from your doctor' }));
  notes.value = editing?.notes ?? '';
  let colour = editing?.colour ?? CHILD_COLOURS[(await db.children.list({ includeArchived: true })).length % CHILD_COLOURS.length].id;
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  for (const el of [name, dob, kg]) el.addEventListener('input', () => { error.hidden = true; });
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' },
    CHILD_COLOURS.map((c) => {
      const input = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'colour', value: c.id, id: `col-${c.id}`, checked: c.id === colour }));
      input.addEventListener('change', () => { colour = c.id; });
      return h('label', { class: `swatch kid-${c.id}`, for: `col-${c.id}` }, input, h('span', { class: 'swatch-dot', 'aria-hidden': 'true' }), h('span', null, c.name));
    }),
  );

  const save = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) { error.textContent = 'Enter a name.'; error.hidden = false; name.focus(); return; }
    error.hidden = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob.value) || dob.value > today) { error.textContent = 'Enter their date of birth. The app uses it to check age limits.'; error.hidden = false; dob.focus(); return; }
    let kgVal = null;
    if (kg.value.trim()) {
      kgVal = Number(kg.value.replace(',', '.'));
      if (!Number.isFinite(kgVal) || kgVal <= 0 || kgVal > 200) { error.textContent = 'Enter the weight in kilograms, for example 14.5.'; error.hidden = false; kg.focus(); return; }
    }
    /** @type {Child} */
    const child = { ...(editing ?? { id: db.uid(), createdAt: now() }), name: n, colour, dateOfBirth: dob.value, notes: notes.value.trim() };
    await db.children.save(child);
    if (kgVal !== null) await db.weights.add({ id: db.uid(), childId: child.id, kg: Math.round(kgVal * 10) / 10, recordedAt: now() });
    await refreshReminders();
    toast(editing ? 'Saved' : `${n} added`);
    ctx.go(onboardingFlow ? '/welcome?step=child' : `/child/${child.id}`);
  };

  const archive = async () => {
    if (!editing) return;
    const ok = await confirmDialog({ title: `Archive ${editing.name}?`, body: 'They will leave the home screen and their reminders stop. Their records are kept, and you can bring them back from Settings.', confirm: 'Archive' });
    if (!ok) return;
    await db.children.archive(editing.id, now());
    await refreshReminders();
    toast(`${editing.name} archived`);
    ctx.go('/');
  };

  const node = h('form', { class: 'stack', onsubmit: save, novalidate: true },
    field('Name', 'c-name', name),
    field('Date of birth', 'c-dob', dob),
    h('fieldset', { class: 'field' }, h('legend', { class: 'label' }, 'Colour'), swatches),
    field(weight ? `Weight today (kg), last recorded ${formatDate(weight.recordedAt, tz)}` : 'Weight (kg)', 'c-kg', kg, 'The app never works out a dose from it. It uses it to warn you if an amount looks like a lot for your child’s weight.'),
    field('Notes', 'c-notes', notes),
    error,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, editing ? 'Save' : 'Add child'),
    editing ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: archive }, `Archive ${editing.name}`) : null,
  );
  return { title: editing ? `Edit ${editing.name}` : 'Add a child', back: editing ? `/child/${editing.id}` : onboardingFlow ? '/welcome' : '/', node, bare: onboardingFlow };
}

/** @param {string} label @param {string} id @param {HTMLElement} input @param {string} [help] */
export function field(label, id, input, help) {
  return h('div', { class: 'field' },
    h('label', { class: 'label', for: id }, label),
    input,
    help ? h('p', { class: 'small muted' }, help) : null,
  );
}

/* ---------------- summary ---------------- */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function childSummary(ctx) {
  const child = await db.children.get(ctx.params.id);
  if (!child) { ctx.go('/', { replace: true }); return { title: '', node: h('div') }; }
  const t = now();
  const tz = timeZone();
  const hours = Number(ctx.query.get('hours') || 48);
  const text = await summaryText(child, t, tz, hours);
  const pre = h('pre', { class: 'summary', tabindex: '0' }, text);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `${child.name}: medicine record`, text });
      else { await navigator.clipboard.writeText(text); toast('Copied'); }
    } catch { /* cancelled */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy'); }
  };

  const node = h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'For a GP visit or a call to Healthline. Only what you choose to share leaves this phone.'),
    h('div', { class: 'segmented' }, [24, 48, 168].map((hh) =>
      h('a', { class: `seg${hh === hours ? ' on' : ''}`, href: `#/child/${child.id}/summary?hours=${hh}`, 'aria-current': hh === hours ? 'true' : null }, hh === 168 ? '7 days' : `${hh} hours`))),
    pre,
    h('div', { class: 'button-row' },
      h('button', { class: 'btn btn-primary', onclick: share }, icon('share'), 'Share'),
      h('button', { class: 'btn btn-secondary', onclick: copy }, 'Copy'),
      h('button', { class: 'btn btn-secondary', onclick: () => print() }, 'Print'),
    ),
  );
  return { title: 'Summary', back: `/child/${child.id}`, node };
}

/** @param {Child} child @param {number} t @param {string} tz @param {number} hours */
export async function summaryText(child, t, tz, hours) {
  const since = t - hours * 3600e3;
  const doses = (await db.doses.forChild(child.id)).filter((d) => d.givenAt >= since).reverse();
  const syms = (await db.symptoms.forChild(child.id)).filter((s) => s.at >= since).reverse();
  const weight = await db.weights.latest(child.id);
  const lines = [];
  lines.push(`${child.name}${child.dateOfBirth ? `, born ${child.dateOfBirth} (${ageText(child.dateOfBirth, t)})` : ''}`);
  if (weight) lines.push(`Weight ${weight.kg} kg, recorded ${formatDate(weight.recordedAt, tz)}`);
  if (child.notes) lines.push(`Notes: ${child.notes}`);
  lines.push('');
  lines.push(`Medicines, last ${hours === 168 ? '7 days' : `${hours} hours`} (to ${formatDate(t, tz)} ${formatTime(t, tz)}):`);
  if (doses.length === 0) lines.push('  none recorded');
  for (const d of doses) {
    const mg = d.components.map((c) => `${formatMg(c.mg)} ${c.ingredient}`).join(' + ');
    const flag = d.overrideReason === 'DOCTOR_ADVISED' ? ' [doctor advised]' : d.overrideReason === 'ALREADY_GIVEN' ? ' [recorded after limits]' : '';
    lines.push(`  ${formatDate(d.givenAt, tz)} ${formatTime(d.givenAt, tz)}: ${mg} (${formatAmount(d.amount, d.bottle.form)} ${d.bottle.name}), by ${d.givenBy}${flag}`);
  }
  if (syms.length) {
    lines.push('');
    lines.push('Temperatures and symptoms:');
    for (const s of syms) {
      const bits = [s.temperatureC !== null ? `${s.temperatureC.toFixed(1)} °C` : null, ...s.flags.map((f) => SYMPTOM_FLAGS.find((x) => x.id === f)?.name ?? f), s.notes || null].filter(Boolean);
      lines.push(`  ${formatDate(s.at, tz)} ${formatTime(s.at, tz)}: ${bits.join('; ')}`);
    }
  }
  lines.push('');
  lines.push(`From Whendose (a record-keeping app; limits version ${state.rules.rulesVersion}).`);
  return lines.join('\n');
}
