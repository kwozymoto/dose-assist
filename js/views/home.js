// @ts-check
/* Home: a card per child, a row per medicine, one big "Give a dose". The
   question it answers in under five seconds: can I give another dose now? */

import { h, icon, ring } from '../dom.js';
import * as db from '../db.js';
import { state, childRows, ageText } from '../state.js';
import { now } from '../clock.js';
import { UNDO_MS, SHOW_TEST_NOTICE } from '../config.js';
import { GUIDANCE } from '../content/guidance.js';
import { pushStatus, notifyPermission } from '../push.js';
import { formatTime, formatAmount } from '../format.js';
import { timeZone } from '../clock.js';
import { childDetail } from './child.js';
import { undoDose } from './give.js';
import { syncConfigured, syncConfig, syncStatus } from '../sync.js';
import { doubleDoses } from '../syncchecks.js';
import { EMERGENCY } from '../constants.js';
import { formatWhen, formatAgo } from '../format.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */
/** @typedef {import('../status.js').CardStatus} CardStatus */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function home(ctx) {
  const [kids, bottles] = await Promise.all([db.children.list(), db.bottles.list()]);
  const t = now();
  const node = h('div', { class: 'stack' });

  node.append(...(await banners(ctx)));

  if (kids.length === 0) {
    node.append(h('div', { class: 'empty' },
      h('p', null, 'Add a child to start keeping a record of their doses.'),
      h('a', { class: 'btn btn-primary', href: '#/child/new' }, icon('plus'), 'Add a child'),
    ));
    return { title: 'WhenDose', node, tab: 'home', back: false };
  }
  if (bottles.length === 0) {
    node.append(h('div', { class: 'notice' },
      h('p', null, 'Add the medicines you have at home, so you can log a dose in two taps.'),
      h('a', { class: 'btn btn-secondary', href: '#/bottles/new' }, icon('bottle'), 'Add a medicine'),
    ));
  }

  // One child: their page is Home, so Dose now is the first thing seen.
  if (kids.length === 1) {
    const after = [...node.childNodes, addChildLink('Add another child')];
    const screen = await childDetail({ ...ctx, params: { id: kids[0].id } }, { asHome: true, lead: [], after });
    return { ...screen, title: 'WhenDose', back: false, tab: 'home' };
  }

  // The children come first; notices (undo included) go below them.
  const notices = [...node.childNodes];
  for (const n of notices) n.remove();
  node.prepend(hello(t));

  let soonest = Infinity;
  for (const child of kids) {
    const { rows } = await childRows(child, bottles);
    for (const r of rows) if (r.card.nextAllowedAt) soonest = Math.min(soonest, r.card.nextAllowedAt);
    node.append(childCard(child, rows, t, bottles));
  }

  node.append(addChildLink('Add a child'));
  node.append(...notices);
  node.append(h('p', { class: 'muted small center' }, GUIDANCE.writeItDown.text));

  // Countdowns: refresh every 30 s, and exactly when the next wait ends.
  const untilNext = soonest === Infinity ? Infinity : soonest - now() + 500;
  return { title: 'WhenDose', node, tab: 'home', back: false, refreshEvery: Math.max(1000, Math.min(30000, untilNext)) };
}

/** @param {string} words */
function addChildLink(words) {
  return h('a', { class: 'btn btn-quiet', href: '#/child/new' }, icon('plus'), words);
}

/** "Good evening", with the little droplet. The words follow the local hour. @param {number} t */
function hello(t) {
  const hour = Number(new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', hourCycle: 'h23', timeZone: timeZone() }).format(t));
  const words = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : hour >= 17 && hour < 22 ? 'Good evening' : 'Hello';
  return h('div', { class: 'hello' }, mascot(), h('div', null, h('h2', null, words), h('p', { class: 'muted' }, 'Here is how everyone is doing.')));
}

function mascot() {
  const s = document.createElement('span');
  s.className = 'mascot';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 80 88" width="64" height="72" focusable="false">
    <path class="m-body" d="M40 6C40 6 12 34 12 55a28 28 0 0 0 56 0C68 34 40 6 40 6z"/>
    <path class="m-shine" d="M24 52a16 16 0 0 1 8-13" fill="none" stroke-width="5" stroke-linecap="round"/>
    <ellipse class="m-cheek" cx="24" cy="62" rx="6" ry="4"/><ellipse class="m-cheek" cx="56" cy="62" rx="6" ry="4"/>
    <circle class="m-eye" cx="31" cy="54" r="3.6"/><circle class="m-eye" cx="49" cy="54" r="3.6"/>
    <path class="m-smile" d="M33 64q7 7 14 0" fill="none" stroke-width="3.2" stroke-linecap="round"/>
    <path class="m-spark" d="M66 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
  </svg>`;
  return s;
}

/**
 * @param {import('../db.js').Child} child
 * @param {{ingredient: string, card: CardStatus}[]} rows
 * @param {number} t
 * @param {import('../db.js').Bottle[]} bottles
 */
function childCard(child, rows, t, bottles) {
  const age = ageText(child.dateOfBirth, t);
  return h('section', { class: `card kid kid-${child.colour}`, 'aria-labelledby': `kid-${child.id}` },
    h('a', { class: 'kid-head', href: `#/child/${child.id}`, 'aria-label': `${child.name}: see all doses` },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, child.name.slice(0, 1).toUpperCase()),
      h('span', { class: 'kid-name' }, h('span', { id: `kid-${child.id}` }, child.name), age ? h('span', { class: 'muted small' }, age) : null),
      icon('chevron'),
    ),
    rows.length === 0
      ? h('p', { class: 'muted' }, 'No medicines yet.')
      : h('ul', { class: 'rows' }, rows.map((r) => {
        // Tapping a medicine logs that medicine: straight to its bottle when there is just one.
        const only = bottles.filter((b) => b.components.length === 1 && b.components[0].ingredient === r.ingredient);
        return statusRow(r.card, `#/give?child=${child.id}${only.length === 1 ? `&bottle=${only[0].id}` : ''}`, `Log ${r.ingredient} for ${child.name}`);
      })),
    h('a', { class: 'btn btn-primary btn-big', href: `#/give?child=${child.id}` }, icon('plus'), `Log a dose for ${child.name}`),
  );
}

/**
 * Split "in 3 h 54 m · Last: 2:47pm (6 m ago)" into pieces that each stay on
 * one line: the text wraps only between them.
 * @param {string} text
 */
export function unbroken(text) {
  const out = [];
  for (const [i, part] of text.split(' · ').entries()) {
    if (i) out.push(' · ');
    // "Last: 2:47pm (6 m ago)": the label and time together, the bracket together.
    const m = /^(.*?)(\s\([^)]*\))$/.exec(part);
    if (m) out.push(h('span', { class: 'nw' }, m[1]), ' ', h('span', { class: 'nw' }, m[2].trim()));
    else out.push(h('span', { class: 'nw' }, part));
  }
  return out;
}

/** @param {CardStatus} c @param {string} [href] @param {string} [label] */
export function statusRow(c, href, label) {
  const inner = [
    c.kind === 'soon' && c.progress !== undefined ? ring(c.progress) : h('span', { class: 'status-icon' }, icon(c.icon)),
    h('div', { class: 'status-text' },
      h('strong', null, c.title),
      c.detail ? h('span', { class: 'small' }, unbroken(c.detail)) : null,
    ),
  ];
  if (href) return h('li', null, h('a', { class: `status status-${c.kind} status-tap`, href, 'aria-label': `${c.title}. ${label ?? ''}` }, ...inner, h('span', { class: 'status-go', 'aria-hidden': 'true' }, icon('chevron'))));
  return h('li', { class: `status status-${c.kind}` },
    c.kind === 'soon' && c.progress !== undefined ? ring(c.progress) : h('span', { class: 'status-icon' }, icon(c.icon)),
    h('div', { class: 'status-text' },
      h('strong', null, c.title),
      c.detail ? h('span', { class: 'small' }, unbroken(c.detail)) : null,
    ),
  );
}

/** Undo, reminders off, unreviewed rules. @param {Ctx} ctx */
async function banners(ctx) {
  const out = [];
  const t = now();

  // The same medicine given twice by two people, too close together: only
  // possible with linked phones (each phone's own stop screen stops its parent).
  const kidsById = new Map((await db.children.list()).map((k) => [k.id, k]));
  const dismissed = await db.meta.get('doubleSeen', /** @type {string[]} */ ([]));
  for (const x of doubleDoses(await db.doses.all(), state.rules, t)) {
    const key = `${x.ids.join('+')}:${x.ingredient}`;
    if (dismissed.includes(key) || !kidsById.has(x.childId)) continue;
    const kid = kidsById.get(x.childId);
    out.push(h('div', { class: 'notice notice-danger', role: 'alert' },
      h('strong', null, `${kid?.name ?? 'Your child'} had ${x.ingredient} twice, ${Math.max(1, Math.round(x.gapMs / 60000))} min apart`),
      h('p', null, `Given by ${x.by[0] || 'one phone'} at ${formatWhen(x.first, t, timeZone())} and by ${x.by[1] || 'the other phone'} at ${formatWhen(x.second, t, timeZone())}. If ${kid?.name ?? 'your child'} may have had too much, call the Poisons Centre now.`),
      h('a', { class: 'btn btn-danger btn-big', href: `tel:${EMERGENCY.poisons.tel}` }, icon('phone'), `Call Poisons Centre ${EMERGENCY.poisons.display}`),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { await db.meta.set('doubleSeen', [...dismissed, key]); ctx.refresh(); } }, 'We have dealt with this'),
    ));
  }

  // Linked phones: say when this phone may be missing the other's doses.
  if (syncConfigured()) {
    const cfg = await syncConfig();
    if (cfg) {
      const st = await syncStatus();
      const stale = !st.okAt || (st.errorAt && st.errorAt > st.okAt) || Date.now() - st.okAt > 10 * 60 * 1000;
      if (!cfg.otherAt) {
        out.push(h('div', { class: 'notice' }, icon('share'), h('p', null, 'Your other phone has not linked yet. Until it does, doses given on it do not show here.'), h('a', { class: 'btn btn-secondary', href: '#/link' }, 'Linked phones')));
      } else if (stale) {
        out.push(h('div', { class: 'notice notice-warn', role: 'status' }, icon('warn'), h('p', null,
          `Not checked with your other phone ${st.okAt ? `since ${formatAgo(st.okAt, Date.now())}` : 'yet'}. Doses given on it may be missing here. Check with your partner before giving.`)));
      }
    }
  }

  const last = state.lastLogged;
  if (last && t - last.at < UNDO_MS) {
    const dose = await db.doses.get(last.doseId);
    if (dose && !dose.deletedAt) {
      const child = await db.children.get(dose.childId);
      out.push(h('p', { class: 'notice-undo', role: 'status' },
        `Just logged: ${formatAmount(dose.amount, dose.bottle.form)} of ${dose.bottle.name} for ${child?.name ?? 'your child'}, ${formatTime(dose.givenAt, timeZone())}. `,
        h('button', { class: 'linkbtn', onclick: async () => { if (await undoDose(dose, child?.name ?? 'your child')) ctx.refresh(); } }, 'Undo'),
      ));
    }
  }

  const push = await pushStatus();
  const perm = await notifyPermission();
  if (perm !== 'granted') {
    out.push(h('div', { class: 'notice notice-warn' },
      icon('bellOff'),
      h('p', null, perm === 'denied'
        ? 'Reminders are off because notifications are blocked for this app. Turn them on in your phone’s settings.'
        : 'Reminders are off. Turn them on to be told when the next dose is allowed.'),
      perm === 'denied' ? null : h('a', { class: 'btn btn-secondary', href: '#/settings' }, 'Turn on'),
    ));
  } else if (push === 'not-configured') {
    out.push(h('div', { class: 'notice' },
      icon('bell'),
      h('p', null, 'Reminders work while WhenDose is open. Reminders with the app closed are not set up yet in this version.'),
    ));
  }

  if (SHOW_TEST_NOTICE && state.rules.reviewedBy === null) {
    out.push(h('div', { class: 'notice notice-test' }, icon('warn'), h('p', null, GUIDANCE.notReviewed.text)));
  }
  return out;
}
