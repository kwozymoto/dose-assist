// @ts-check
/* Boot and routing. Hash routes, one view per screen; each view is an
   async function that returns the screen's title and content. */

import { h, icon } from './dom.js';
import * as db from './db.js';
import { state, loadData } from './state.js';
import { clockOffset, setClockOffset } from './clock.js';
import { formatDuration } from './format.js';
import { EMERGENCY } from './constants.js';
import { applyTheme } from './theme.js';
import { startReminders, refreshReminders } from './reminders.js';
import { home } from './views/home.js';
import { onboarding } from './views/onboarding.js';
import { give } from './views/give.js';
import { childDetail, childForm, childSummary } from './views/child.js';
import { gapView } from './views/gap.js';
import { linkView } from './views/link.js';
import { startSync } from './sync.js';
import { doseEdit } from './views/dose.js';
import { bottlesList, bottleNew, bottleDetail } from './views/bottles.js';
import { symptomForm } from './views/symptoms.js';
import { settings } from './views/settings.js';
import { help } from './views/help.js';
import { sources } from './views/sources.js';

/**
 * @typedef {object} Ctx
 * @property {Record<string, string>} params
 * @property {URLSearchParams} query
 * @property {(path: string, opts?: {replace?: boolean}) => void} go
 * @property {() => void} refresh
 *
 * @typedef {object} Screen
 * @property {string} title
 * @property {Node} node
 * @property {string | false} [back]   hash to go back to; false for none
 * @property {'home' | 'bottles' | 'help' | 'settings'} [tab]
 * @property {boolean} [bare]          no nav bar (onboarding)
 * @property {() => void} [cleanup]
 * @property {number} [refreshEvery]   re-render every n ms (countdowns)
 * @property {string} [kid]            the child's colour, when the screen is about one child
 * @property {boolean} [hideTabs]      no tab bar (the give flow: its main button must never sit under it)
 */

/** @type {[RegExp, string[], (ctx: Ctx) => Promise<Screen>][]} */
const ROUTES = [];
/** @param {string} pattern @param {(ctx: Ctx) => Promise<Screen>} view */
function route(pattern, view) {
  /** @type {string[]} */
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  ROUTES.push([re, keys, view]);
}

route('/', home);
route('/welcome', onboarding);
route('/give', give);
route('/child/new', childForm);
route('/child/:id', childDetail);
route('/child/:id/edit', childForm);
route('/child/:id/symptom', symptomForm);
route('/child/:id/summary', childSummary);
route('/child/:id/gap', gapView);
route('/link', linkView);
route('/dose/:id', doseEdit);
route('/bottles', bottlesList);
route('/bottles/new', bottleNew);
route('/bottles/:id', bottleDetail);
route('/settings', settings);
route('/help', help);
route('/sources', sources);

/** @param {string} path @param {{replace?: boolean}} [opts] */
function go(path, opts = {}) {
  const target = '#' + path;
  if (opts.replace) location.replace(target);
  else location.hash = path;
  if (location.hash === target) render();
}

/** @type {Screen | null} */
let current = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let refreshTimer;
let rendering = 0;

/** @param {boolean} [soft] true when re-rendering the same screen in place */
async function render(soft = false) {
  const token = ++rendering;
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');

  // A dialog belongs to the screen that opened it. Moving to another screen
  // (Back included) closes it as a cancel, so it can never act on the wrong one.
  if (!soft) for (const d of document.querySelectorAll('dialog[open]')) /** @type {HTMLDialogElement} */ (d).close();
  const onboarded = await db.meta.get('onboardedAt', null);
  if (!onboarded && path !== '/welcome' && !path.startsWith('/child/new') && !path.startsWith('/bottles/new')) {
    go('/welcome', { replace: true });
    return;
  }

  let found = null;
  /** @type {Record<string, string>} */
  const params = {};
  for (const [re, keys, view] of ROUTES) {
    const m = re.exec(path);
    if (m) {
      keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      found = view;
      break;
    }
  }
  if (!found) { go('/', { replace: true }); return; }

  /** @type {Screen} */
  let screen;
  try {
    screen = await found({ params, query, go, refresh: () => render(true) });
  } catch (err) {
    console.error(err);
    screen = errorScreen(err);
  }
  if (token !== rendering) return; // a newer navigation won
  // The sky takes the child's colour on a screen about one child.
  const kidId = path.startsWith('/child/') && params.id ? params.id : query.get('child');
  const kid = screen.kid ?? (kidId ? (await db.children.get(kidId))?.colour : undefined);
  if (token !== rendering) return;
  if (kid) document.documentElement.dataset.kid = kid;
  else delete document.documentElement.dataset.kid;
  current?.cleanup?.();
  current = screen;
  paint(screen);
  if (!soft) scrollTo(0, 0);
  clearTimeout(refreshTimer);
  if (screen.refreshEvery) refreshTimer = setTimeout(() => { if (token === rendering) softRefresh(); }, screen.refreshEvery);
}

/** Re-render in place without moving focus or scroll (countdowns). */
async function softRefresh() {
  const y = scrollY;
  const active = document.activeElement?.id;
  await render(true);
  scrollTo(0, y);
  if (active) document.getElementById(active)?.focus();
}

/** @param {Screen} s */
function paint(s) {
  document.title = s.title === 'WhenDose' ? 'WhenDose' : `${s.title} · WhenDose`;
  const top = /** @type {HTMLElement} */ (document.getElementById('topbar'));
  top.replaceChildren(
    s.back ? h('a', { class: 'iconbtn', href: '#' + s.back, 'aria-label': 'Back' }, icon('back')) : h('span', { class: 'iconbtn-space' }),
    h('h1', { id: 'screen-title', tabindex: '-1' }, s.title),
    h('a', { class: 'iconbtn call', href: `tel:${EMERGENCY.healthline.tel}`, 'aria-label': `Call Healthline, ${EMERGENCY.healthline.display}` }, icon('phone')),
  );
  const main = /** @type {HTMLElement} */ (document.getElementById('view'));
  main.replaceChildren(s.node);
  const nav = /** @type {HTMLElement} */ (document.getElementById('tabs'));
  nav.hidden = !!s.bare || !!s.hideTabs;
  document.body.classList.toggle('no-tabs', nav.hidden);
  for (const a of nav.querySelectorAll('a')) {
    const on = a.getAttribute('data-tab') === s.tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  paintClockBanner();
}

function paintClockBanner() {
  const el = /** @type {HTMLElement} */ (document.getElementById('clockBanner'));
  const off = clockOffset();
  el.hidden = off === 0;
  if (off !== 0) {
    el.replaceChildren(
      `Test clock: ${off > 0 ? '+' : '−'}${formatDuration(Math.abs(off))}. Times are not real. `,
      h('button', { class: 'linkbtn', onclick: () => { setClockOffset(0); location.search = ''; } }, 'Use the real time'),
    );
  }
}

/** @param {unknown} err @returns {Screen} */
function errorScreen(err) {
  return {
    title: 'Something went wrong',
    back: '/',
    node: h('div', { class: 'stack' },
      h('p', null, 'The app hit a problem showing this screen. Your records are safe on this phone.'),
      h('p', { class: 'muted small' }, String(err instanceof Error ? err.message : err)),
      h('a', { class: 'btn btn-primary', href: '#/' }, 'Go home'),
    ),
  };
}

function footer() {
  const f = /** @type {HTMLElement} */ (document.getElementById('lifeline'));
  f.replaceChildren(
    'Unsure? Call ',
    h('a', { href: `tel:${EMERGENCY.healthline.tel}` }, `Healthline ${EMERGENCY.healthline.display}`),
    '. Emergency ',
    h('a', { href: `tel:${EMERGENCY.emergency.tel}` }, EMERGENCY.emergency.display),
    '.',
  );
}

async function boot() {
  try {
    await loadData();
  } catch (err) {
    document.getElementById('view')?.replaceChildren(h('p', { class: 'stack' }, 'WhenDose could not load its medicine rules. Check your connection and reload.'));
    throw err;
  }
  await applyTheme();
  footer();
  addEventListener('hashchange', () => render());
  // Refresh countdowns when the phone wakes or the app comes back.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { applyTheme(); softRefresh(); refreshReminders(); } });
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  await render();
  startReminders({ onFire: () => softRefresh() });
  startSync();
  // Another phone's changes arrived: new reminder times, and fresh screens,
  // except where someone is typing (a form would lose what they entered).
  addEventListener('whendose:synced', () => {
    refreshReminders();
    const h = location.hash;
    if (!/\/(give|edit|new|symptom|gap|link)\b|#\/dose\//.test(h)) softRefresh();
  });
  // Screen readers: tell them the screen changed.
  addEventListener('hashchange', () => setTimeout(() => document.getElementById('screen-title')?.focus(), 0));
  /** @type {any} */ (window).__doseAssist = { state, db, refresh: render };
}

boot();
