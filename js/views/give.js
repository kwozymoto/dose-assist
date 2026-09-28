// @ts-check
/* Give a dose: child -> bottle -> amount -> check -> confirm -> logged.

   Safety rules this screen carries (CLAUDE.md, PLAN.md 7.1 and 8.1):
   - Nothing is logged without the confirm screen. Not from a notification,
     not from a link: a URL can only ever open a step, never write.
   - The check runs again at the moment of logging, so a dose logged by
     someone else in the meantime is never missed.
   - A stop screen cannot be overridden. The only way past one is to record
     a dose that has already been given (below).
   - The amount is compared with the child's recorded weight (engine/weight.js):
     over the usual mg per kg is a caution; over the 24-hour mg per kg is a
     stop, when that number is verified and the weight is recent.
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
import { formatWhen, formatDate, formatAgo, formatDuration, formatMg, formatAmount, formatStrength, formatTime, toLocalInput, fromLocalInput, formatAgeDays, formatInterval, parseAmount } from '../format.js';
import { cardStatus, cap } from '../status.js';
import { statusRow } from './home.js';
import { BACKDATE_MAX_MS, SCHEDULE_PRESET_HOURS, UNDO_MS, WEIGHT_FRESH_MS } from '../config.js';
import { checkWeight } from '../engine/weight.js';
import { GUIDANCE } from '../content/guidance.js';
import { EMERGENCY } from '../constants.js';
import { refreshReminders } from '../reminders.js';
import { enablePush, notifyPermission } from '../push.js';
import { listNames } from '../schedule.js';
import { clampGap } from '../engine/gap.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */
/** @typedef {import('../db.js').Child} Child */
/** @typedef {import('../db.js').Bottle} Bottle */
/** @typedef {import('../db.js').DoseRecord} DoseRecord */
/** @typedef {import('../engine/types.js').ProductCheck} ProductCheck */
/** @typedef {import('../engine/weight.js').WeightCheck} WeightCheck */
/**
 * The engine's answer plus the weight check. WEIGHT_LIMIT: the rules allow
 * it, but the 24-hour total would be over the mg per kg for this child.
 * @typedef {Omit<ProductCheck, 'status'> & {status: ProductCheck['status'] | 'WEIGHT_LIMIT', weight: {kg: number, weighedAt: number, by: [string, WeightCheck][]} | null}} ViewCheck
 */

/**
 * The dose being prepared. Lives only in memory: a reload starts again at
 * the amount, which is the safe direction to fail.
 * @typedef {object} Draft
 * @property {string} childId
 * @property {string} bottleId
 * @property {number} amount
 * @property {number | null} givenAt   null = "just now", fixed at the moment of logging
 * @property {'ALREADY_GIVEN' | null} override
 * @property {string} [statusSeen]    the status the parent was shown and accepted
 * @property {string} [situation]     fingerprint of the situation the override was given for
 */

/** @type {Draft | null} */
let draft = null;
/** @type {{doseId: string} | null} */
let logged = null;

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function give(ctx) {
  return { ...(await giveStep(ctx)), hideTabs: true };
}

/** @param {Ctx} ctx @returns {Promise<Screen>} */
async function giveStep(ctx) {
  const q = ctx.query;
  const kids = await db.children.list();
  const childId = q.get('child') ?? (kids.length === 1 ? kids[0].id : null);
  const step = q.get('step');

  if (step === 'done') return doneStep(ctx);
  if (!childId) return pickChild(kids);
  const child = await db.children.get(childId);
  if (!child) { ctx.go('/give', { replace: true }); return { title: 'Give a dose', node: h('div') }; }

  const bottleId = q.get('bottle');
  if (!bottleId) return pickBottle(child, q.get('ingredients'), q.get('when') === 'earlier');
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
async function pickBottle(child, ingredientsParam, earlier = false) {
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
        h('a', { class: `choice choice-${summary.kind}`, href: `#/give?child=${child.id}&bottle=${b.id}${earlier ? '&when=earlier' : ''}` },
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
  if (s.status === 'OK') return { kind: 'ok', icon: 'tick', text: `${cap(names)} is allowed now` };
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

  // Read the text, not float arithmetic: 4.4 * 100 is 440.00000000000006,
  // and rejecting a correct 4.4 mL invites rounding it up to 4.5 or 5.
  const parse = () => parseAmount(amount.value);
  const update = () => {
    const v = parse();
    picture.replaceChildren(liquid ? syringe(v ?? 0) : tablets(v ?? 0, bottle.form));
    if (v === null) { mgOut.textContent = ''; return; }
    mgOut.textContent = `${formatAmount(v, bottle.form)} = ${componentsForAmount(bottle, v).map((c) => `${formatMg(c.mg)} ${c.ingredient}`).join(' + ')}`;
  };
  amount.addEventListener('input', () => { error.hidden = true; update(); });
  const nudge = (/** @type {number} */ d) => {
    const v = parse() ?? 0;
    const next = Math.max(0, Math.round((v + d) * 100) / 100);
    amount.value = next > 0 ? String(next) : '';
    update();
  };

  // When was it given? "Add an earlier dose" arrives here with ?when=earlier.
  const earlierFirst = ctx.query.get('when') === 'earlier';
  const earliest = t - BACKDATE_MAX_MS;
  const whenNow = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'when', id: 'when-now', value: 'now', checked: !(earlierFirst || (keep && keep.givenAt !== null)) }));
  const whenEarlier = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'when', id: 'when-earlier', value: 'earlier', checked: earlierFirst || (!!keep && keep.givenAt !== null) }));
  const at = /** @type {HTMLInputElement} */ (h('input', {
    class: 'input', type: 'datetime-local', id: 'given-at',
    min: toLocalInput(earliest, tz), max: toLocalInput(t, tz),
    value: keep?.givenAt ? toLocalInput(keep.givenAt, tz) : '',
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
  const engine = checkDose({ components, rules: state.rules, history, now: at, child: engineChild(child), timeZone: timeZone() });
  const w = await db.weights.latest(child.id);
  /** @type {ViewCheck} */
  let check = { ...engine, weight: null };
  if (w) {
    /** @type {[string, WeightCheck][]} */
    const by = [];
    for (const [ing, c] of Object.entries(engine.perIngredient)) {
      const rule = ruleFor(ing);
      if (!rule) continue;
      const doseMg = components.filter((x) => x.ingredient === ing).reduce((s, x) => s + x.mg, 0);
      by.push([ing, checkWeight({ rule, weightKg: w.kg, weighedAt: w.recordedAt, doseMg, windowMg: c.mgInLast24h, at, freshMs: WEIGHT_FRESH_MS })]);
    }
    check = { ...engine, weight: { kg: w.kg, weighedAt: w.recordedAt, by } };
    if (engine.status === 'OK' && by.some(([, x]) => x.stop)) check.status = 'WEIGHT_LIMIT';
  }
  return { check, components, history, at };
}

/** @param {Ctx} ctx @param {Child} child @param {Bottle} bottle @param {string} base @returns {Promise<Screen>} */
async function checkStep(ctx, child, bottle, base) {
  const d = /** @type {Draft} */ (draft);
  const { check, history, at } = await runCheck(child, bottle);
  // An override answers one situation. If anything has changed since (a
  // dose logged elsewhere, a different status), it no longer applies.
  const now_situation = situation(check);
  if (d.override && d.situation !== now_situation) d.override = null;
  d.statusSeen = check.status;
  d.situation = now_situation;
  if (check.status === 'OK') {
    d.override = null;
    ctx.go(`${base}&step=confirm`, { replace: true });
    return { title: 'Checking', node: h('div') };
  }

  const tz = timeZone();
  const t = now();
  const backdated = d.givenAt !== null;
  const names = listNames(ingredientsOf(bottle));
  const worst = (check.status === 'WEIGHT_LIMIT' ? Object.entries(check.perIngredient).find(([k]) => check.weight?.by.some(([i, x]) => i === k && x.stop)) : undefined)
    ?? Object.entries(check.perIngredient).find(([, c]) => c.status === check.status) ?? Object.entries(check.perIngredient)[0];
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
      big: backdated ? `At ${formatTime(at, tz)}, the next ${names} was not allowed until ${formatWhen(next, at, tz)}.` : `Not yet. Next ${names} from ${formatWhen(next, t, tz)}`,
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
  } else if (check.status === 'WEIGHT_LIMIT') {
    const [wIng, wc] = /** @type {[string, WeightCheck]} */ (check.weight?.by.find(([, x]) => x.stop));
    const day = /** @type {NonNullable<WeightCheck['perDay']>} */ (wc.perDay);
    view = {
      title: 'Too much for their weight',
      kind: 'limit', icon: 'stop',
      big: `With this dose, ${child.name} would have had ${formatMg(day.totalMg)} of ${wIng} in 24 hours. For ${check.weight?.kg} kg the most is ${formatMg(day.maxMg)}.`,
      lines: [
        `That is ${day.maxPerKg} mg per kg in 24 hours, from ${child.name}’s weight recorded ${formatDate(/** @type {number} */ (check.weight?.weighedAt), tz)}.`,
        'Check the amount against the label.',
        h('a', { href: `#/child/${child.id}/edit` }, `If ${child.name}’s weight has changed, update it`),
      ],
    };
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
    ? h('div', { class: 'stack-sm' },
      h('p', null, `${bottle.name} also has ${listNames(others.map(([k]) => k))} in it. It cannot be given until everything in it is allowed.`),
      h('ul', { class: 'rows' }, others.map(([k, c]) => statusRow(cardStatus(c, k, ruleFor(k), t, tz)))))
    : null;

  const alreadyGiven = async () => {
    if (!backdated) {
      // It happened already, so the time matters: ask for it, then check at that time.
      toast('When was it given?');
      ctx.go(`${base}&when=earlier`);
      return;
    }
    const ok = await confirmDialog({
      title: 'Record a dose that was already given?',
      body: 'It goes on the record so the times for the next dose are right. Recording it does not mean it was safe.',
      confirm: 'Record it',
    });
    if (!ok) return;
    d.override = 'ALREADY_GIVEN';
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
        check.status === 'EXCEEDS_LIMIT' || check.status === 'WEIGHT_LIMIT'
          ? h('a', { class: 'btn btn-primary btn-big', href: '#' + base }, 'Change the amount')
          : check.status === 'BLOCKED'
            ? h('a', { class: 'btn btn-primary btn-big', href: `tel:${EMERGENCY.healthline.tel}` }, icon('phone'), `Call Healthline ${EMERGENCY.healthline.display}`)
            : h('a', { class: 'btn btn-primary btn-big', href: '#/' }, 'Don’t give it now'),
        check.status === 'BLOCKED' ? h('a', { class: 'btn btn-secondary', href: '#/' }, 'Back home') : null,
        canRemind && check.nextAllowedAt ? h('button', { class: 'btn btn-secondary', onclick: remind }, icon('bell'), `Remind me at ${formatTime(check.nextAllowedAt, tz)}`) : null,
        check.status === 'BLOCKED' ? null : h('p', { class: 'small muted' }, 'If it was given by mistake, it still needs to go on the record:'),
        h('button', { class: 'btn btn-quiet', onclick: alreadyGiven }, 'It has already been given: record it'),
      ),
    check.status === 'BLOCKED' ? null : h('a', { class: 'btn btn-quiet', href: `tel:${EMERGENCY.healthline.tel}` }, icon('phone'), `Unsure? Call Healthline ${EMERGENCY.healthline.display}`),
  );
  return { title: view.title, back: base, node };
}

/**
 * What the override was given for: the status, when the next dose would be
 * allowed, and the last dose of each ingredient. Any change, and the parent
 * is asked again.
 * @param {ViewCheck} check
 */
function situation(check) {
  return JSON.stringify([
    check.status,
    check.weight ? [check.weight.kg, check.weight.by.filter(([, x]) => x.stop).map(([i]) => i)] : null,
    check.nextAllowedAt,
    Object.entries(check.perIngredient).map(([k, c]) => [k, c.lastDose?.doseId ?? null, c.dosesInLast24h]),
  ]);
}

/**
 * May this check be logged? OK always; otherwise only as a dose that was
 * already given, recorded for exactly this situation.
 * @param {Draft} d @param {ViewCheck} check
 */
function overrideCovers(d, check) {
  if (check.status === 'OK') return true;
  if (!d.override || d.situation !== situation(check)) return false;
  return d.override === 'ALREADY_GIVEN';
}

/* ---------------- step 5: confirm ---------------- */

/** @param {Ctx} ctx @param {Child} child @param {Bottle} bottle @param {string} base @returns {Promise<Screen>} */
async function confirmStep(ctx, child, bottle, base) {
  const d = /** @type {Draft} */ (draft);
  const { check, components } = await runCheck(child, bottle);
  // Something changed since the check (another dose logged, the clock moved
  // past a limit): go back and show the new answer. An override covers only
  // the situation it was given for.
  if (!overrideCovers(d, check)) {
    ctx.go(`${base}&step=check`, { replace: true });
    return { title: 'Checking', node: h('div') };
  }
  const tz = timeZone();
  const t = now();
  const names = await knownCaregivers();
  const by = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'given-by', list: 'caregivers', value: state.caregiver, autocomplete: 'name', placeholder: 'e.g. Mum, Dad, Nana' }));
  const warnings = warningList(check, child, bottle);
  const weightNotes = weightCautions(check, child, tz);
  const byError = h('p', { class: 'error', role: 'alert', hidden: true }, 'Enter who gave it, so everyone sharing care can see.');
  by.addEventListener('input', () => { byError.hidden = true; });

  const logIt = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const btn = /** @type {HTMLButtonElement} */ (document.getElementById('log-btn'));
    btn.disabled = true;
    // Last look, at the real moment of logging.
    const again = await runCheck(child, bottle);
    const tooOld = d.givenAt !== null && d.givenAt < now() - BACKDATE_MAX_MS;
    if (tooOld || !overrideCovers(d, again.check)) {
      toast(tooOld ? 'That time is now too long ago. Enter it again.' : 'Something changed. Check again before logging.');
      ctx.go(tooOld ? base : `${base}&step=check`, { replace: true });
      return;
    }
    const who = by.value.trim();
    if (!who) {
      btn.disabled = false;
      byError.hidden = false;
      by.focus();
      return;
    }
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
      ? h('div', { class: 'notice notice-warn' }, icon('warn'), h('div', { class: 'stack-sm' },
        h('p', null, 'Recorded as: already given. This does not mean it was safe.'),
        ...Object.entries(check.perIngredient).map(([k, c]) => h('p', null,
          c.lastDose ? `Last ${k}: ${formatWhen(c.lastDose.givenAt, t, tz)} (${formatAgo(c.lastDose.givenAt, t)}). ` : '',
          `In the last 24 hours: ${c.dosesInLast24h} ${c.dosesInLast24h === 1 ? 'dose' : 'doses'}, ${formatMg(c.mgInLast24h)}.`))))
      : null,
    weightNotes,
    warnings,
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'given-by' }, 'Given by'),
      by,
      byError,
      h('datalist', { id: 'caregivers' }, names.map((n) => h('option', { value: n }))),
    ),
    h('button', { class: 'btn btn-primary btn-big', id: 'log-btn', type: 'submit' }, icon('tick'), 'Log this dose'),
    h('a', { class: 'btn btn-secondary', href: '#' + base }, 'Change something'),
  );
  return { title: 'Check and log', back: base, node };
}

/** @param {ViewCheck} check @param {Child} child @param {Bottle} bottle */
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
  if (!dose) { ctx.go('/', { replace: true }); return { title: 'Whendose', node: h('div') }; }
  const child = /** @type {Child} */ (await db.children.get(dose.childId));
  const tz = timeZone();
  const t = now();
  const ings = [...new Set(dose.components.map((c) => c.ingredient))];
  const history = await db.doses.forChild(child.id);
  const status = checkDose({ components: ings.map((ingredient) => ({ ingredient })), rules: state.rules, history, now: t, child: engineChild(child), timeZone: tz });
  const ruleNext = status.nextAllowedAt;
  // A "next allowed" reminder comes at the end of the parent's own gap, if longer (schedule.js).
  /** @type {number | null} */
  let nextAt = null;
  if (ruleNext !== null) {
    let at = ruleNext;
    for (const ing of ings) {
      const rule = ruleFor(ing);
      const last = status.perIngredient[ing]?.lastDose?.givenAt;
      if (rule && last !== undefined) at = Math.max(at, last + clampGap(rule, child.gapMinutes?.[ing]) * 60000);
    }
    nextAt = at;
  }

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
    now() - dose.loggedAt < UNDO_MS ? h('button', { class: 'btn btn-secondary', onclick: undo }, icon('undo'), 'Undo') : null,
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
 * What the weight check says that is not a stop: one dose over the usual mg
 * per kg, or a 24-hour excess that cannot stop (old weight, unverified limit).
 * @param {ViewCheck} check @param {Child} child @param {string} tz
 */
function weightCautions(check, child, tz) {
  const w = check.weight;
  if (!w) return null;
  const out = [];
  const when = formatDate(w.weighedAt, tz);
  for (const [ing, x] of w.by) {
    if (x.perDay && !x.stop) {
      out.push(h('div', { class: 'notice notice-danger', role: 'alert' }, h('p', null,
        `With this dose, ${child.name} would have had ${formatMg(x.perDay.totalMg)} of ${ing} in 24 hours, more than ${x.perDay.maxPerKg} mg per kg for ${w.kg} kg (${formatMg(x.perDay.maxMg)}). `,
        x.stale ? `${child.name}’s weight was recorded ${when}; if it has changed, update it. ` : 'This limit is not yet confirmed by a source. ',
        'Check with your pharmacist or Healthline before giving it.')));
    }
    if (x.perDose) {
      out.push(h('div', { class: 'notice notice-warn' }, icon('warn'), h('p', null,
        `${formatMg(x.perDose.mg)} of ${ing} is ${Math.round(x.perDose.perKg * 10) / 10} mg per kg for ${child.name}’s weight (${w.kg} kg, ${when}). `,
        `The usual dose is ${x.perDose.maxPerKg} mg per kg (${formatMg(x.perDose.maxMg)}). Label doses go by age, so this can happen. Check the label, or ask your pharmacist.`)));
    }
  }
  return out.length ? h('div', { class: 'stack-sm' }, out) : null;
}

/**
 * Save a reminder, asking for notification permission the first time.
 * @param {{childId: string, kind: 'next_allowed' | 'scheduled', ingredients: string[], bottleId?: string, fireAt?: number, label?: string}} r
 */
async function addReminder(r) {
  await db.reminders.add({ id: db.uid(), createdAt: now(), ...r });
  if ((await notifyPermission()) === 'default') {
    try { await enablePush(); } catch { /* the banner on home explains */ }
  }
  await refreshReminders();
  toast((await notifyPermission()) === 'granted' ? 'Reminder set' : 'Reminder saved, but notifications are off, so it will only show inside the app. Turn them on in Settings.');
}

/* ---------------- pictures ---------------- */

/**
 * An oral syringe with the amount drawn up. Scale is 5 or 10 mL (the common
 * NZ oral syringe sizes), or more for larger amounts, and always labelled
 * in words beside it.
 * @param {number} ml
 */
function syringe(ml) {
  const size = ml <= 5 ? 5 : ml <= 10 ? 10 : Math.min(60, Math.ceil(ml / 5) * 5);
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
