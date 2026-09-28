// @ts-check
/* Give a dose: child -> bottle -> amount -> check -> confirm -> logged.

   Safety rules this screen carries (CLAUDE.md, PLAN.md 7.1 and 8.1):
   - Nothing is logged without the confirm screen. Not from a notification,
     not from a link: a URL can only ever open a step, never write.
   - The check runs again at the moment of logging, so a dose logged by
     someone else in the meantime is never missed.
   - "Too soon" can be overridden only by saying a doctor advised it.
   - Any stop screen can record a dose that HAS ALREADY BEEN GIVEN. The
     record must match reality: a dose the app refused to record would make
     every later check wrong. Recording it is not approving it, and the
     screen after says so and offers the Poisons Centre.
   - The app never suggests an amount. The parent enters it from the label. */

import { h, icon, confirmDialog, buzz, toast } from '../dom.js';
import * as db from '../db.js';
import { state, ingredientsOf, ruleFor, engineChild, bottleStatus } from '../state.js';
import { checkDose } from '../engine/checkDose.js';
import { componentsForAmount } from '../engine/amounts.js';
import { now, timeZone } from '../clock.js';
import { formatWhen, formatDuration, formatMg, formatAmount, formatStrength, formatTime, toLocalInput, fromLocalInput, formatAgeDays, formatInterval } from '../format.js';
import { cardStatus, cap } from '../status.js';
import { statusRow } from './home.js';
import { BACKDATE_MAX_MS, SCHEDULE_PRESET_HOURS } from '../config.js';
import { GUIDANCE } from '../content/guidance.js';
import { EMERGENCY } from '../constants.js';
import { refreshReminders } from '../reminders.js';
import { enablePush } from '../push.js';
import { listNames } from '../schedule.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */
/** @typedef {import('../db.js').Child} Child */
/** @typedef {import('../db.js').Bottle} Bottle */
/** @typedef {import('../db.js').DoseRecord} DoseRecord */
/** @typedef {import('../engine/types.js').ProductCheck} ProductCheck */

/**
 * The dose being prepared. Lives only in memory: a reload starts again at
 * the amount, which is the safe direction to fail.
 * @typedef {object} Draft
 * @property {string} childId
 * @property {string} bottleId
 * @property {number} amount
 * @property {number | null} givenAt   null = "just now", fixed at the moment of logging
 * @property {'DOCTOR_ADVISED' | 'ALREADY_GIVEN' | null} override
 * @property {string} [statusSeen]    the status the parent was shown and accepted
 */

/** @type {Draft | null} */
let draft = null;
/** @type {{doseId: string} | null} */
let logged = null;

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function give(ctx) {
  const q = ctx.query;
  const kids = await db.children.list();
  const childId = q.get('child') ?? (kids.length === 1 ? kids[0].id : null);
  const step = q.get('step');

  if (step === 'done') return doneStep(ctx);
  if (!childId) return pickChild(kids);
  const child = await db.children.get(childId);
  if (!child) { ctx.go('/give', { replace: true }); return { title: 'Give a dose', node: h('div') }; }

  const bottleId = q.get('bottle');
  if (!bottleId) return pickBottle(child, q.get('ingredients'));
  const bottle = await db.bottles.get(bottleId);
  if (!bottle) { ctx.go(`/give?child=${child.id}`, { replace: true }); return { title: 'Give a dose', node: h('div') }; }

  const base = `/give?child=${child.id}&bottle=${bottle.id}`;
  const valid = draft && draft.childId === child.id && draft.bottleId === bottle.id;
  if ((step === 'check' || step === 'confirm') && !valid) {
    ctx.go(base, { replace: true });
    return { title: 'Give a dose', node: h('div') };
  }
  if (step === 'check') return checkStep(ctx, child, bottle, base);
  if (step === 'confirm') return confirmStep(ctx, child, bottle, base);
  return amountStep(ctx, child, bottle, base);
}

/* ---------------- step 1: child ---------------- */

/** @param {Child[]} kids @returns {Screen} */
function pickChild(kids) {
  if (kids.length === 0) {
    return { title: 'Give a dose', back: '/', node: h('div', { class: 'empty' }, h('p', null, 'Add a child first.'), h('a', { class: 'btn btn-primary', href: '#/child/new' }, 'Add a child')) };
  }
  return {
    title: 'Who is it for?',
    back: '/',
    node: h('div', { class: 'stack' },
      h('ul', { class: 'choices' }, kids.map((c) => h('li', null,
        h('a', { class: `choice kid-${c.colour}`, href: `#/give?child=${c.id}` },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, c.name.slice(0, 1).toUpperCase()),
          h('span', { class: 'choice-main' }, c.name),
          icon('chevron'),
        ),
      ))),
    ),
  };
}

/* ---------------- step 2: bottle ---------------- */

/** @param {Child} child @param {string | null} ingredientsParam @returns {Promise<Screen>} */
async function pickBottle(child, ingredientsParam) {
  const all = await db.bottles.list();
  const want = ingredientsParam ? ingredientsParam.split(',') : null;
  const list = want ? all.filter((b) => ingredientsOf(b).some((i) => want.includes(i))) : all;
  const history = await db.doses.forChild(child.id);
  const t = now();
  const tz = timeZone();

  const node = h('div', { class: 'stack' });
  if (list.length === 0) {
    node.append(h('div', { class: 'empty' },
      h('p', null, want ? `No medicine at home with ${listNames(want)} in it.` : 'No medicines added yet.'),
      h('a', { class: 'btn btn-primary', href: `#/bottles/new?then=${encodeURIComponent(`/give?child=${child.id}`)}` }, icon('plus'), 'Add a medicine'),
    ));
  } else {
    node.append(h('ul', { class: 'choices' }, list.map((b) => {
      const s = bottleStatus(child, b, history);
      const summary = productLine(s, b, t, tz);
      return h('li', null,
        h('a', { class: `choice choice-${summary.kind}`, href: `#/give?child=${child.id}&bottle=${b.id}` },
          h('span', { class: 'status-icon' }, icon(summary.icon)),
          h('span', { class: 'choice-main' },
            h('strong', null, b.name),
            h('span', { class: 'small' }, b.components.map((c) => formatStrength(c, b.form)).join(' + ')),
            h('span', { class: 'small' }, summary.text),
          ),
          icon('chevron'),
        ),
      );
    })));
    node.append(h('a', { class: 'btn btn-secondary', href: `#/bottles/new?then=${encodeURIComponent(`/give?child=${child.id}`)}` }, icon('plus'), 'A different medicine'));
  }
  return { title: `Medicine for ${child.name}`, back: '/', node };
}

/**
 * One line for a product on the picker: worst ingredient wins.
 * @param {ProductCheck} s @param {Bottle} b @param {number} t @param {string} tz
 * @returns {{kind: string, icon: 'tick' | 'clock' | 'stop' | 'dash', text: string}}
 */
function productLine(s, b, t, tz) {
  const names = listNames(ingredientsOf(b));
  if (s.status === 'OK') return { kind: 'ok', icon: 'tick', text: `${cap(names)} can be given now` };
  if (s.status === 'BLOCKED') return { kind: 'blocked', icon: 'stop', text: 'Too young for this medicine in the app' };
  if (s.status === 'DAILY_LIMIT_REACHED') return { kind: 'limit', icon: 'stop', text: s.nextAllowedAt ? `24-hour limit reached. Next from ${formatWhen(s.nextAllowedAt, t, tz)}` : '24-hour limit reached' };
  if (s.nextAllowedAt) return { kind: 'soon', icon: 'clock', text: `Next from ${formatWhen(s.nextAllowedAt, t, tz)}` };
  return { kind: 'none', icon: 'dash', text: '' };
}

/* ---------------- step 3: amount and time ---------------- */

/** @param {Ctx} ctx @param {Child} child @param {Bottle} bottle @param {string} base @returns {Promise<Screen>} */
async function amountStep(ctx, child, bottle, base) {
  const tz = timeZone();
  const t = now();
  const keep = draft && draft.childId === child.id && draft.bottleId === bottle.id ? draft : null;
  const liquid = bottle.form === 'liquid';
  const unit = liquid ? 'mL' : bottle.form === 'chewable' ? 'chewables' : 'tablets';
  const stepBy = 0.5;

  const amount = /** @type {HTMLInputElement} */ (h('input', {
    class: 'input input-amount', id: 'amount', type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: keep ? String(keep.amount) : '', 'aria-describedby': 'amount-help amount-mg',
  }));
  const mgOut = h('p', { id: 'amount-mg', class: 'mg-line', 'aria-live': 'polite' });
  const picture = h('div', { class: 'picture' });
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  const parse = () => {
    const v = Number(amount.value.replace(',', '.').trim());
    return Number.isFinite(v) && v > 0 && Math.round(v * 100) === v * 100 ? v : null;
  };
  const update = () => {
    const v = parse();
    picture.replaceChildren(liquid ? syringe(v ?? 0) : tablets(v ?? 0, bottle.form));
    if (v === null) { mgOut.textContent = ''; return; }
    mgOut.textContent = `${formatAmount(v, bottle.form)} = ${componentsForAmount(bottle, v).map((c) => `${formatMg(c.mg)} ${c.ingredient}`).join(' + ')}`;
  };
  amount.addEventListener('input', update);
  const nudge = (/** @type {number} */ d) => {
    const v = parse() ?? 0;
    const next = Math.max(0, Math.round((v + d) * 100) / 100);
    amount.value = next > 0 ? String(next) : '';
    update();
  };

  // When was it given?
  const earliest = t - BACKDATE_MAX_MS;
  const whenNow = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'when', id: 'when-now', value: 'now', checked: !keep || keep.givenAt === null }));
  const whenEarlier = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'when', id: 'when-earlier', value: 'earlier', checked: !!keep && keep.givenAt !== null }));
  const at = /** @type {HTMLInputElement} */ (h('input', {
    class: 'input', type: 'datetime-local', id: 'given-at',
    min: toLocalInput(earliest, tz), max: toLocalInput(t, tz),
    value: toLocalInput(keep?.givenAt ?? t, tz),
  }));
  const atWrap = h('div', { class: 'field', hidden: !whenEarlier.checked },
    h('label', { class: 'label', for: 'given-at' }, 'Time given'),
    at,
    h('p', { class: 'small muted' }, `Up to ${formatDuration(BACKDATE_MAX_MS)} ago.`),
  );
  for (const r of [whenNow, whenEarlier]) r.addEventListener('change', () => { atWrap.hidden = !whenEarlier.checked; });

  const next = h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Continue');
  const form = h('form', {
    class: 'stack',
    onsubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      const v = parse();
      if (v === null) { error.textContent = `Enter the amount in ${unit}, for example ${liquid ? '5' : '1'}.`; error.hidden = false; amount.focus(); return; }
      let givenAt = null;
      if (whenEarlier.checked) {
        givenAt = fromLocalInput(at.value, tz);
        const t2 = now();
        if (givenAt === null) { error.textContent = 'Enter the time it was given.'; error.hidden = false; at.focus(); return; }
        if (givenAt > t2) { error.textContent = 'That time is in the future.'; error.hidden = false; at.focus(); return; }
        if (givenAt < t2 - BACKDATE_MAX_MS) { error.textContent = `You can go back up to ${formatDuration(BACKDATE_MAX_MS)}. For an older dose, log it now and then edit its time from the timeline.`; error.hidden = false; at.focus(); return; }
      }
      draft = { childId: child.id, bottleId: bottle.id, amount: v, givenAt, override: null };
      ctx.go(`${base}&step=check`);
    },
  },
    h('div', { class: 'product-banner' },
      h('strong', null, bottle.name),
      h('span', null, bottle.components.map((c) => `${formatStrength(c, bottle.form)} ${c.ingredient}`).join(' + ')),
      h('span', { class: 'small' }, 'Check your bottle’s label says this strength.'),
    ),
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'amount' }, `How much? (${unit})`),
      h('p', { id: 'amount-help', class: 'small muted' }, 'Use the dose on the label, or what your doctor or pharmacist told you.'),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', class: 'btn btn-secondary btn-square', 'aria-label': `Less, by ${stepBy}`, onclick: () => nudge(-stepBy) }, icon('minus')),
        amount,
        h('span', { class: 'unit', 'aria-hidden': 'true' }, unit),
        h('button', { type: 'button', class: 'btn btn-secondary btn-square', 'aria-label': `More, by ${stepBy}`, onclick: () => nudge(stepBy) }, icon('plus')),
      ),
      mgOut,
    ),
    picture,
    h('fieldset', { class: 'field' },
      h('legend', { class: 'label' }, 'When?'),
      h('div', { class: 'segmented' },
        h('label', { for: 'when-now' }, whenNow, h('span', null, 'Giving it now')),
        h('label', { for: 'when-earlier' }, whenEarlier, h('span', null, 'I gave it earlier')),
      ),
      atWrap,
    ),
    cautions(bottle),
    error,
    next,
  );
  update();
  return { title: `${child.name}: ${bottle.name}`, back: `/give?child=${child.id}`, node: form };
}

/** Always-shown cautions for the ingredients in this bottle. @param {Bottle} bottle */
function cautions(bottle) {
  const ings = ingredientsOf(bottle);
  const out = h('div', { class: 'stack-sm' });
  if (ings.includes('ibuprofen')) out.append(guidanceBox(GUIDANCE.ibuprofenCautions, 'warn'));
  if (ings.includes('paracetamol')) out.append(h('p', { class: 'small muted' }, GUIDANCE.underweight.text));
  return out;
}

/** @param {import('../content/guidance.js').Guidance} g @param {'warn' | 'info'} [kind] */
export function guidanceBox(g, kind = 'info') {
  return h('div', { class: `notice ${kind === 'warn' ? 'notice-warn' : ''}` },
    kind === 'warn' ? icon('warn') : null,
    h('div', null,
      g.title ? h('strong', null, g.title) : null,
      g.text ? h('p', null, g.text) : null,
      g.items ? h('ul', { class: 'bullets' }, g.items.map((i) => h('li', null, i))) : null,
    ),
  );
}

/* ---------------- step 4: the check ---------------- */

/** @param {Child} child @param {Bottle} bottle */
async function runCheck(child, bottle) {
  if (!draft) throw new Error('no draft');
  const history = await db.doses.forChild(child.id);
  const at = draft.givenAt ?? now();
  const components = componentsForAmount(bottle, draft.amount);
  const check = checkDose({ components, rules: state.rules, history, now: at, child: engineChild(child), timeZone: timeZone() });
  return { check, components, history, at };
}

/** @param {Ctx} ctx @param {Child} child @param {Bottle} bottle @param {string} base @returns {Promise<Screen>} */
async function checkStep(ctx, child, bottle, base) {
  const d = /** @type {Draft} */ (draft);
  const { check, history, at } = await runCheck(child, bottle);
  d.statusSeen = check.status;
  if (check.status === 'OK') {
    d.override = null;
    ctx.go(`${base}&step=confirm`, { replace: true });
    return { title: 'Checking', node: h('div') };
  }

  const tz = timeZone();
  const t = now();
  const backdated = d.givenAt !== null;
  const names = listNames(ingredientsOf(bottle));
  const worst = Object.entries(check.perIngredient).find(([, c]) => c.status === check.status) ?? Object.entries(check.perIngredient)[0];
  const [ing, ic] = worst;
  const rule = ruleFor(ing);
  const lastDose = ic.lastDose ? history.find((x) => x.id === ic.lastDose?.doseId) : undefined;

  /** @type {{title: string, big: string, lines: (string | Node)[], kind: string, icon: 'clock' | 'stop'}} */
  let view;
  if (check.status === 'TOO_SOON') {
    const next = /** @type {number} */ (check.nextAllowedAt);
    view = {
      title: backdated ? 'That was too soon' : 'Too soon',
      kind: 'soon', icon: 'clock',
      big: backdated ? `At ${formatTime(at, tz)}, the next ${names} was not allowed until ${formatWhen(next, at, tz)}.` : `Next ${names} from ${formatWhen(next, t, tz)}`,
      lines: backdated ? [] : [`That is in ${formatDuration(next - t, { up: true })}.`],
    };
    if (rule) view.lines.push(`${cap(ing)} needs at least ${formatInterval(rule.minIntervalMinutes)} between doses.`);
  } else if (check.status === 'DAILY_LIMIT_REACHED') {
    const next = check.nextAllowedAt;
    view = {
      title: '24-hour limit reached',
      kind: 'limit', icon: 'stop',
      big: rule && ic.dosesInLast24h >= rule.maxDosesPer24h
        ? `${ic.dosesInLast24h} doses of ${ing} in the last 24 hours. The most is ${rule.maxDosesPer24h}.`
        : `${formatMg(ic.mgInLast24h)} of ${ing} in the last 24 hours.`,
      lines: next ? [`Next ${names} from ${formatWhen(next, t, tz)}.`] : [],
    };
    view.lines.push(`If your child still needs relief, call Healthline on ${EMERGENCY.healthline.display}.`);
  } else if (check.status === 'EXCEEDS_LIMIT') {
    const mg = componentsForAmount(bottle, d.amount).filter((c) => c.ingredient === ing).reduce((s, c) => s + c.mg, 0);
    const reason = ic.exceedReason;
    view = {
      title: 'More than the limit',
      kind: 'limit', icon: 'stop',
      big: reason === 'SINGLE_DOSE' && rule
        ? `${formatAmount(d.amount, bottle.form)} of this bottle is ${formatMg(mg)} of ${ing}. The most for one dose is ${formatMg(rule.maxSingleMg)}.`
        : reason === 'OVER_DAILY_MAX' && rule
          ? `${formatAmount(d.amount, bottle.form)} of this bottle is ${formatMg(mg)} of ${ing}, more than the most for a whole day (${formatMg(rule.maxMgPer24h)}).`
          : `This would take ${ing} over the 24-hour limit${rule ? ` of ${formatMg(rule.maxMgPer24h)}` : ''}. Already given in the last 24 hours: ${formatMg(ic.mgInLast24h)}.`,
      lines: ['Check the amount against the label.'],
    };
    if (check.nextAllowedAt) view.lines.push(`This amount would be allowed from ${formatWhen(check.nextAllowedAt, t, tz)}.`);
  } else {
    const age = rule ? formatAgeDays(rule.minAgeDays) : 'the minimum age';
    view = { title: 'Please see a doctor', kind: 'blocked', icon: 'stop', big: `Under ${age}: please see a doctor.`, lines: [GUIDANCE.underMinAge.text ?? ''] };
  }

  if (lastDose) {
    view.lines.push(`Last ${ing}: ${formatWhen(lastDose.givenAt, t, tz)}, ${formatAmount(lastDose.amount, lastDose.bottle.form)} of ${lastDose.bottle.name}, given by ${lastDose.givenBy}.`);
  }

  // Other ingredients in a combination product, each on its own line.
  const others = Object.entries(check.perIngredient).filter(([k]) => k !== ing);
  const otherRows = others.length > 0
    ? h('ul', { class: 'rows' }, others.map(([k, c]) => statusRow(cardStatus(c, k, ruleFor(k), t, tz))))
    : null;

  const alreadyGiven = async () => {
    const ok = await confirmDialog({
      title: 'Record a dose that was already given?',
      body: 'It goes on the record so the times for the next dose are right. Recording it does not mean it was safe.',
      confirm: 'Record it',
    });
    if (!ok) return;
    d.override = 'ALREADY_GIVEN';
    ctx.go(`${base}&step=confirm`);
  };
  const doctor = async () => {
    const ok = await confirmDialog({
      title: 'Did a doctor, nurse or pharmacist tell you to give it now?',
      body: 'Only continue if a health professional told you to give this dose at this time. The app will record that.',
      confirm: 'Yes, they told me to',
    });
    if (!ok) return;
    d.override = 'DOCTOR_ADVISED';
    ctx.go(`${base}&step=confirm`);
  };
  const remind = async () => {
    await addReminder({ childId: child.id, kind: 'next_allowed', ingredients: ingredientsOf(bottle), bottleId: bottle.id });
    draft = null;
    ctx.go('/');
  };

  const canRemind = check.nextAllowedAt !== null && !backdated;
  const node = h('div', { class: `stack stop stop-${view.kind}` },
    h('div', { class: 'stop-head', role: 'alert' },
      h('span', { class: 'stop-icon' }, icon(view.icon)),
      h('p', { class: 'stop-big' }, view.big),
    ),
    view.lines.map((l) => h('p', null, l)),
    otherRows,
    backdated
      ? h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary btn-big', onclick: alreadyGiven }, 'It was given: record it'),
        h('a', { class: 'btn btn-secondary', href: '#' + base }, 'Change the time or amount'),
      )
      : h('div', { class: 'actions' },
        check.status === 'EXCEEDS_LIMIT'
          ? h('a', { class: 'btn btn-primary btn-big', href: '#' + base }, 'Change the amount')
          : h('a', { class: 'btn btn-primary btn-big', href: '#/' }, check.status === 'BLOCKED' ? 'Back home' : 'Don’t give it now'),
        canRemind && check.nextAllowedAt ? h('button', { class: 'btn btn-secondary', onclick: remind }, icon('bell'), `Remind me at ${formatTime(check.nextAllowedAt, tz)}`) : null,
        h('p', { class: 'small muted' }, 'Only if one of these is true:'),
        check.status === 'TOO_SOON' ? h('button', { class: 'btn btn-quiet', onclick: doctor }, 'A doctor told me to give it now') : null,
        h('button', { class: 'btn btn-quiet', onclick: alreadyGiven }, 'It has already been given: record it'),
      ),
    h('a', { class: 'btn btn-quiet', href: `tel:${EMERGENCY.healthline.tel}` }, icon('phone'), `Unsure? Call Healthline ${EMERGENCY.healthline.display}`),
  );
  return { title: view.title, back: base, node };
}

/* ---------------- step 5: confirm ---------------- */

/** @param {Ctx} ctx @param {Child} child @param {Bottle} bottle @param {string} base @returns {Promise<Screen>} */
async function confirmStep(ctx, child, bottle, base) {
  const d = /** @type {Draft} */ (draft);
  const { check, components } = await runCheck(child, bottle);
  // Something changed since the check (another dose logged, the clock moved
  // past a limit): go back and show the new answer. An override covers only
  // the situation it was given for.
  if (check.status !== 'OK' && (!d.override || check.status !== d.statusSeen)) {
    ctx.go(`${base}&step=check`, { replace: true });
    return { title: 'Checking', node: h('div') };
  }
  const tz = timeZone();
  const t = now();
  const names = await knownCaregivers();
  const by = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'given-by', list: 'caregivers', value: state.caregiver, autocomplete: 'name', placeholder: 'e.g. Mum, Dad, Nana' }));
  const warnings = warningList(check, child, bottle);

  const logIt = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const btn = /** @type {HTMLButtonElement} */ (document.getElementById('log-btn'));
    btn.disabled = true;
    // Last look, at the real moment of logging.
    const again = await runCheck(child, bottle);
    if (again.check.status !== 'OK' && (!d.override || again.check.status !== d.statusSeen)) {
      toast('Something changed. Check again before logging.');
      ctx.go(`${base}&step=check`, { replace: true });
      return;
    }
    const who = by.value.trim() || 'Someone';
    const weight = await db.weights.latest(child.id);
    const logTime = now();
    /** @type {DoseRecord} */
    const dose = {
      id: db.uid(),
      childId: child.id,
      bottleId: bottle.id,
      bottle: { name: bottle.name, form: bottle.form, components: bottle.components, productId: bottle.productId },
      amount: d.amount,
      components: again.components,
      givenAt: d.givenAt ?? logTime,
      loggedAt: logTime,
      givenBy: who,
      weightKgUsed: weight ? weight.kg : null,
      rulesVersion: state.rules.rulesVersion,
      overrideReason: again.check.status === 'OK' ? null : d.override,
      statusAtLog: again.check.status,
    };
    await db.doses.add(dose, who);
    if (who !== state.caregiver && !state.caregiver) { state.caregiver = who; await db.meta.set('caregiverName', who); }
    state.lastLogged = { doseId: dose.id, at: logTime, childId: child.id };
    logged = { doseId: dose.id };
    draft = null;
    buzz(40);
    await refreshReminders();
    ctx.go('/give?step=done', { replace: true });
  };

  const node = h('form', { class: 'stack', onsubmit: logIt },
    h('div', { class: `confirm-card kid-${child.colour}` },
      h('div', { class: 'confirm-who' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, child.name.slice(0, 1).toUpperCase()),
        h('strong', null, child.name),
      ),
      h('p', { class: 'confirm-amount' }, formatAmount(d.amount, bottle.form)),
      bottle.form === 'liquid' ? syringe(d.amount) : tablets(d.amount, bottle.form),
      h('dl', { class: 'facts' },
        h('dt', null, 'Medicine'), h('dd', null, bottle.name),
        h('dt', null, 'Strength'), h('dd', null, bottle.components.map((c) => `${formatStrength(c, bottle.form)} ${c.ingredient}`).join(' + ')),
        h('dt', null, 'That is'), h('dd', null, components.map((c) => `${formatMg(c.mg)} ${c.ingredient}`).join(' + ')),
        h('dt', null, 'Time'), h('dd', null, d.givenAt === null ? `Now (${formatTime(t, tz)})` : formatWhen(d.givenAt, t, tz)),
      ),
    ),
    d.override && check.status !== 'OK'
      ? h('div', { class: 'notice notice-warn' }, icon('warn'), h('p', null, d.override === 'DOCTOR_ADVISED'
        ? 'Recorded as: a doctor told you to give this dose now.'
        : 'Recorded as: already given. This does not mean it was safe.'))
      : null,
    warnings,
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'given-by' }, 'Given by'),
      by,
      h('datalist', { id: 'caregivers' }, names.map((n) => h('option', { value: n }))),
    ),
    h('button', { class: 'btn btn-primary btn-big', id: 'log-btn', type: 'submit' }, icon('tick'), 'Log this dose'),
    h('a', { class: 'btn btn-secondary', href: '#' + base }, 'Change something'),
  );
  return { title: 'Check and log', back: base, node };
}

/** @param {ProductCheck} check @param {Child} child @param {Bottle} bottle */
function warningList(check, child, bottle) {
  const out = h('div', { class: 'stack-sm' });
  const w = check.warnings;
  if (w.includes('RULE_UNVERIFIED') || w.includes('RULES_NOT_REVIEWED')) out.append(h('p', { class: 'small muted' }, GUIDANCE.notReviewed.text));
  if (w.includes('LONG_USE')) out.append(guidanceBox(GUIDANCE.longUse, 'warn'));
  if (w.includes('AGE_UNKNOWN')) out.append(h('p', { class: 'small' }, `Add ${child.name}’s date of birth so the app can check age limits.`));
  if (w.includes('DOSE_IN_FUTURE')) out.append(h('p', { class: 'small' }, 'A dose on record has a time later than now. Check the clock on each phone is right.'));
  if (w.includes('NO_RULES_FOR_INGREDIENT')) out.append(h('p', { class: 'small' }, `The app has no limits for ${listNames(ingredientsOf(bottle).filter((i) => !ruleFor(i)))}. Follow the label for how much and how often.`));
  if (ingredientsOf(bottle).includes('ibuprofen')) out.append(guidanceBox(GUIDANCE.ibuprofenCautions, 'warn'));
  return out;
}

async function knownCaregivers() {
  const names = new Set(state.caregiver ? [state.caregiver] : []);
  for (const d of await db.doses.all()) names.add(d.givenBy);
  return [...names].filter(Boolean).slice(0, 12);
}

/* ---------------- step 6: logged, and reminders ---------------- */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
async function doneStep(ctx) {
  const dose = logged ? await db.doses.get(logged.doseId) : undefined;
  if (!dose) { ctx.go('/', { replace: true }); return { title: 'Dose Assist', node: h('div') }; }
  const child = /** @type {Child} */ (await db.children.get(dose.childId));
  const tz = timeZone();
  const t = now();
  const ings = [...new Set(dose.components.map((c) => c.ingredient))];
  const history = await db.doses.forChild(child.id);
  const status = checkDose({ components: ings.map((ingredient) => ({ ingredient })), rules: state.rules, history, now: t, child: engineChild(child), timeZone: tz });
  const nextAt = status.nextAllowedAt;

  const worrying = dose.overrideReason === 'ALREADY_GIVEN' && dose.statusAtLog !== 'OK';

  const setNext = async () => {
    await addReminder({ childId: child.id, kind: 'next_allowed', ingredients: ings, bottleId: dose.bottleId });
    ctx.go('/');
  };
  const setAt = async (/** @type {number} */ fireAt) => {
    await addReminder({ childId: child.id, kind: 'scheduled', ingredients: ings, bottleId: dose.bottleId, fireAt, label: 'Doctor’s schedule' });
    ctx.go('/');
  };
  const custom = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'datetime-local', id: 'remind-at', min: toLocalInput(t, tz), value: toLocalInput(nextAt ?? dose.givenAt + SCHEDULE_PRESET_HOURS[0] * 3600e3, tz) }));

  const undo = async () => {
    await db.doses.remove(dose.id, { by: state.caregiver || dose.givenBy, at: now(), reason: 'Undo straight after logging' });
    state.lastLogged = null;
    logged = null;
    await refreshReminders();
    toast('Dose removed');
    ctx.go('/');
  };

  const node = h('div', { class: 'stack' },
    h('div', { class: 'done-head', role: 'status' },
      h('span', { class: 'status-icon' }, icon('tick')),
      h('p', null, h('strong', null, 'Logged. '), `${formatAmount(dose.amount, dose.bottle.form)} of ${dose.bottle.name} for ${child.name} at ${formatTime(dose.givenAt, tz)}.`),
    ),
    h('button', { class: 'btn btn-secondary', onclick: undo }, icon('undo'), 'Undo'),
    worrying ? h('div', { class: 'notice notice-danger', role: 'alert' },
      h('strong', null, GUIDANCE.overdose.title),
      h('p', null, GUIDANCE.overdose.text),
      h('a', { class: 'btn btn-danger btn-big', href: `tel:${EMERGENCY.poisons.tel}` }, icon('phone'), `Call Poisons Centre ${EMERGENCY.poisons.display}`),
    ) : null,
    h('section', { class: 'card stack' },
      h('h2', null, 'Reminder'),
      nextAt
        ? h('button', { class: 'btn btn-primary btn-big', onclick: setNext }, icon('bell'), `When the next dose is allowed (${formatWhen(nextAt, t, tz)})`)
        : h('p', { class: 'muted' }, 'The app has no limit times for this medicine, so it cannot remind you when the next dose is allowed. You can set a time instead.'),
      h('p', { class: 'small muted' }, 'Or at a set time, if your doctor gave you a schedule:'),
      h('div', { class: 'preset-row' }, SCHEDULE_PRESET_HOURS.map((hrs) => {
        const at = dose.givenAt + hrs * 3600e3;
        return h('button', { class: 'btn btn-secondary', disabled: at <= t, onclick: () => setAt(at), 'aria-label': `${hrs} hours after the dose, at ${formatWhen(at, t, tz)}` }, `${hrs} h`, h('span', { class: 'small' }, formatTime(at, tz)));
      })),
      h('div', { class: 'field row' },
        h('label', { class: 'label', for: 'remind-at' }, 'Another time'),
        custom,
        h('button', {
          class: 'btn btn-secondary',
          onclick: () => {
            const at = fromLocalInput(custom.value, tz);
            if (at === null || at <= now()) { toast('Choose a time later than now.'); return; }
            setAt(at);
          },
        }, 'Set'),
      ),
      h('a', { class: 'btn btn-quiet', href: '#/' }, 'No reminder'),
    ),
  );
  return { title: 'Dose logged', back: '/', node };
}

/**
 * Save a reminder, asking for notification permission the first time.
 * @param {{childId: string, kind: 'next_allowed' | 'scheduled', ingredients: string[], bottleId?: string, fireAt?: number, label?: string}} r
 */
async function addReminder(r) {
  await db.reminders.add({ id: db.uid(), createdAt: now(), ...r });
  if ('Notification' in window && Notification.permission === 'default') {
    try { await enablePush(); } catch { /* the banner on home explains */ }
  }
  await refreshReminders();
  toast('Reminder set');
}

/* ---------------- pictures ---------------- */

/**
 * An oral syringe with the amount drawn up. Scale is 5 or 10 mL (the common
 * NZ oral syringe sizes), or more for larger amounts, and always labelled
 * in words beside it.
 * @param {number} ml
 */
function syringe(ml) {
  const size = ml <= 5 ? 5 : ml <= 10 ? 10 : Math.ceil(ml / 5) * 5;
  const W = 300;
  const x0 = 40;
  const len = 220;
  const fill = Math.min(1, ml / size) * len;
  let ticks = '';
  for (let i = 0; i <= size; i += size <= 10 ? 1 : 5) {
    const x = x0 + (i / size) * len;
    ticks += `<line x1="${x}" y1="18" x2="${x}" y2="${i % 5 === 0 ? 30 : 25}" class="syr-tick"/>`;
    if (i % 5 === 0) ticks += `<text x="${x}" y="64" class="syr-num">${i}</text>`;
  }
  const span = document.createElement('div');
  span.className = 'syringe';
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', `Syringe filled to ${ml} mL`);
  span.innerHTML = `<svg viewBox="0 0 ${W} 72" width="100%" preserveAspectRatio="xMidYMid meet">
    <rect x="${x0 - 22}" y="28" width="22" height="6" class="syr-tip"/>
    <rect x="${x0}" y="16" width="${len}" height="30" rx="4" class="syr-barrel"/>
    <rect x="${x0}" y="16" width="${fill}" height="30" rx="4" class="syr-fill"/>
    <rect x="${x0 + fill}" y="12" width="6" height="38" class="syr-plunger"/>
    <rect x="${x0 + fill + 6}" y="28" width="${Math.max(0, len - fill + 24)}" height="6" class="syr-rod"/>
    ${ticks}
  </svg>`;
  return span;
}

/** Tablets as whole and half pills. @param {number} n @param {string} form */
function tablets(n, form) {
  const div = h('div', { class: 'pills', role: 'img', 'aria-label': formatAmount(n, form) });
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  for (let i = 0; i < Math.min(whole, 8); i += 1) div.append(h('span', { class: 'pill' }));
  if (half) div.append(h('span', { class: 'pill pill-half' }));
  return div;
}
