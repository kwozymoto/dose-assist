// @ts-check
/* First run: what the app does and does not do, the numbers to call, who
   you are, a child, a medicine, notifications, and installing. */

import { h, icon } from '../dom.js';
import * as db from '../db.js';
import { state } from '../state.js';
import { now } from '../clock.js';
import { GUIDANCE } from '../content/guidance.js';
import { enablePush } from '../push.js';
import { callButton } from './help.js';
import { guidanceBox } from './give.js';
import { field } from './child.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

const STEPS = ['intro', 'numbers', 'name', 'child', 'bottle', 'notify', 'install'];

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
        const kids = await db.children.list();
        next(kids.length ? 'bottle' : 'child');
      } },
      field('Your name', 'o-name', name, 'Each dose shows who gave it, so everyone sharing care can see.'),
      h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Next'),
      ),
    );
  }

  if (step === 'child') {
    ctx.go('/child/new?onboarding=1', { replace: true });
    return screen('Add a child');
  }

  if (step === 'bottle') {
    const bottles = await db.bottles.list();
    if (bottles.length) { next('notify'); return screen(''); }
    return screen('Your medicines', progress,
      h('p', null, 'Add the children’s medicines you have at home. You only do this once per bottle.'),
      h('a', { class: 'btn btn-primary btn-big', href: '#/bottles/new?onboarding=1' }, icon('bottle'), 'Add a medicine'),
      h('button', { class: 'btn btn-quiet', onclick: () => next('notify') }, 'Later'),
    );
  }

  if (step === 'notify') {
    return screen('Reminders', progress,
      h('p', null, 'Whendose can tell you when the next dose is allowed, so nobody has to watch the clock.'),
      h('p', { class: 'small muted' }, 'Your phone will ask whether to allow notifications. The app only sends reminders you ask for.'),
      h('button', { class: 'btn btn-primary btn-big', onclick: async () => { try { await enablePush(); } catch { /* shown later */ } next('install'); } }, icon('bell'), 'Turn on reminders'),
      h('button', { class: 'btn btn-quiet', onclick: () => next('install') }, 'Not now'),
    );
  }

  if (step === 'install') {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const finish = async () => {
      await db.meta.set('onboardedAt', now());
      ctx.go('/', { replace: true });
    };
    return screen('Keep it on your Home Screen', progress,
      ios
        ? h('p', null, 'On iPhone, tap Share, then “Add to Home Screen”. Reminders only work on iPhone once Whendose is on your Home Screen, and it keeps your records safe from being cleared.')
        : h('p', null, 'Add Whendose to your Home Screen so it opens like an app, works offline, and your records are kept. Your browser’s menu has “Install app” or “Add to Home screen”.'),
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
  return screen('Welcome to Whendose', progress,
    h('p', { class: 'lead' }, 'A record of your children’s medicine doses, and a reminder when the next one is allowed.'),
    guidanceBox(GUIDANCE.whatItDoes),
    guidanceBox(GUIDANCE.whatItDoesNot, 'warn'),
    state.rules.reviewedBy === null ? h('p', { class: 'notice notice-test' }, GUIDANCE.notReviewed.text) : null,
    h('label', { class: 'check', for: 'o-accept' }, accept, h('span', null, 'I understand this app keeps a record and is not medical advice. I will follow the label and my doctor or pharmacist.')),
    go,
  );
}

/** @param {string} title @param {...any} children @returns {Screen} */
function screen(title, ...children) {
  return { title, node: h('div', { class: 'stack onboarding' }, ...children), bare: true, back: false };
}
