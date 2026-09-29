// @ts-check
/* First run: what the app does and does not do, the numbers to call, who
   you are, a child, a medicine, notifications, and installing. */

import { h, icon } from '../dom.js';
import * as db from '../db.js';
import { state } from '../state.js';
import { now } from '../clock.js';
import { GUIDANCE } from '../content/guidance.js';
import { SHOW_TEST_NOTICE } from '../config.js';
import { enablePush } from '../push.js';
import { callButton } from './help.js';
import { guidanceBox } from './give.js';
import { field } from './child.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

import { isNative } from '../native.js';

/* The installed Android app is already on the Home Screen: no install step there. */
const STEPS = isNative() ? ['intro', 'numbers', 'name', 'child', 'bottle', 'notify'] : ['intro', 'numbers', 'name', 'child', 'bottle', 'notify', 'install'];

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function onboarding(ctx) {
  const step = ctx.query.get('step') ?? 'intro';
  const i = Math.max(0, STEPS.indexOf(step));
  const next = (/** @type {string} */ s) => ctx.go(`/welcome?step=${s}`);
  const progress = h('p', { class: 'small muted center', 'aria-label': `Step ${i + 1} of ${STEPS.length}` }, `${i + 1} of ${STEPS.length}`);

  if (step === 'numbers') {
    return screen('Numbers to know', progress,
      h('p', null, 'You can call these from any screen in the app.'),
      callButton('emergency', 'btn-danger'),
      callButton('healthline', 'btn-primary'),
      callButton('poisons'),
      h('button', { class: 'btn btn-primary btn-big', onclick: () => next('name') }, 'Next'),
    );
  }

  if (step === 'name') {
    const name = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'o-name', value: state.caregiver, placeholder: 'e.g. Mum, Dad, Nana', autocomplete: 'name' }));
    return screen('Who uses this phone?', progress,
      h('form', { class: 'stack', onsubmit: async (/** @type {Event} */ e) => {
        e.preventDefault();
        state.caregiver = name.value.trim();
        await db.meta.set('caregiverName', state.caregiver);
        next('child');
      } },
      field('Your name', 'o-name', name, 'Each dose shows who gave it, so everyone sharing care can see.'),
      h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Next'),
      ),
    );
  }

  if (step === 'child') {
    const kids = await db.children.list();
    if (!kids.length) { ctx.go('/child/new?onboarding=1', { replace: true }); return screen('Add a child'); }
    return screen('Your children', progress,
      h('ul', { class: 'bullets' }, kids.map((k) => h('li', null, k.name))),
      h('button', { class: 'btn btn-primary btn-big', onclick: () => next('bottle') }, 'Next'),
      h('a', { class: 'btn btn-secondary', href: '#/child/new?onboarding=1' }, icon('plus'), 'Add another child'),
    );
  }

  if (step === 'bottle') {
    const bottles = await db.bottles.list();
    if (bottles.length) {
      return screen('Your medicines', progress,
        h('ul', { class: 'bullets' }, bottles.map((b) => h('li', null, b.name))),
        ...missingNote(bottles),
        h('button', { class: 'btn btn-primary btn-big', onclick: () => next('notify') }, 'Next'),
        h('a', { class: 'btn btn-secondary', href: '#/bottles/new?onboarding=1' }, icon('plus'), 'Add another medicine'),
      );
    }
    return screen('Your medicines', progress,
      h('p', null, 'Add the children’s medicines you have at home. You only do this once per bottle.'),
      h('a', { class: 'btn btn-primary btn-big', href: '#/bottles/new?onboarding=1' }, icon('bottle'), 'Add a medicine'),
      h('button', { class: 'btn btn-quiet', onclick: () => next('notify') }, 'Later'),
    );
  }

  /** A tracked medicine with no bottle yet: say so, once, plainly. @param {{components: {ingredient: string}[]}[]} bs */
  function missingNote(bs) {
    const have = new Set(bs.flatMap((b) => b.components.map((c) => c.ingredient)));
    const missing = Object.keys(state.rules.ingredients).filter((k) => !have.has(k));
    return missing.length ? [h('p', { class: 'notice' }, `Do you also have ${missing.join(' or ')} at home? Add it now, so it is ready when you need it.`)] : [];
  }

  const finish = async () => {
    await db.meta.set('onboardedAt', now());
    ctx.go('/', { replace: true });
  };
  const afterNotify = () => (isNative() ? finish() : next('install'));

  if (step === 'notify') {
    return screen('Reminders', progress,
      h('p', null, 'WhenDose can tell you when the next dose is allowed, so nobody has to watch the clock.'),
      h('p', { class: 'small muted' }, 'Your phone will ask whether to allow notifications. The app only sends reminders you ask for.'),
      h('button', { class: 'btn btn-primary btn-big', onclick: async () => { try { await enablePush(); } catch { /* shown later */ } afterNotify(); } }, icon('bell'), 'Turn on reminders'),
      h('button', { class: 'btn btn-quiet', onclick: afterNotify }, 'Not now'),
    );
  }

  if (step === 'install') {
    if (isNative()) { await finish(); return screen(''); }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return screen('Keep it on your Home Screen', progress,
      ios
        ? h('p', null, 'On iPhone, tap Share, then “Add to Home Screen”. Reminders only work on iPhone once WhenDose is on your Home Screen, and it keeps your records safe from being cleared.')
        : h('p', null, 'Add WhenDose to your Home Screen so it opens like an app, works offline, and your records are kept. Your browser’s menu has “Install app” or “Add to Home screen”.'),
      h('button', { class: 'btn btn-primary btn-big', onclick: finish }, 'Start'),
    );
  }

  // intro
  const accept = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: 'o-accept' }));
  const go = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn btn-primary btn-big', disabled: true, onclick: async () => {
    await db.meta.set('disclaimerAcceptedAt', now());
    next('numbers');
  } }, 'I understand'));
  accept.addEventListener('change', () => { go.disabled = !accept.checked; });
  return screen('Welcome to WhenDose', progress,
    h('p', { class: 'lead' }, 'A record of your children’s medicine doses, and a reminder when the next one is allowed.'),
    guidanceBox(GUIDANCE.whatItDoes),
    guidanceBox(GUIDANCE.whatItDoesNot, 'warn'),
    SHOW_TEST_NOTICE && state.rules.reviewedBy === null ? h('p', { class: 'notice notice-test' }, GUIDANCE.notReviewed.text) : null,
    h('label', { class: 'check', for: 'o-accept' }, accept, h('span', null, 'I understand this app keeps a record and is not medical advice. I will follow the label and my doctor or pharmacist.')),
    go,
  );
}

/** @param {string} title @param {...any} children @returns {Screen} */
function screen(title, ...children) {
  return { title, node: h('div', { class: 'stack onboarding' }, ...children), bare: true, back: false };
}
