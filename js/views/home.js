// @ts-check
/* Home: a card per child, a row per medicine, one big "Give a dose". The
   question it answers in under five seconds: can I give another dose now? */

import { h, icon, ring, toast } from '../dom.js';
import * as db from '../db.js';
import { state, childRows, ageText } from '../state.js';
import { now } from '../clock.js';
import { UNDO_MS } from '../config.js';
import { GUIDANCE } from '../content/guidance.js';
import { pushStatus } from '../push.js';
import { refreshReminders } from '../reminders.js';
import { formatTime, formatDuration } from '../format.js';
import { timeZone } from '../clock.js';

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
    return { title: 'Dose Assist', node, tab: 'home', back: false };
  }
  if (bottles.length === 0) {
    node.append(h('div', { class: 'notice' },
      h('p', null, 'Add the medicines you have at home, so you can log a dose in two taps.'),
      h('a', { class: 'btn btn-secondary', href: '#/bottles/new' }, icon('bottle'), 'Add a medicine'),
    ));
  }

  let soonest = Infinity;
  for (const child of kids) {
    const { rows } = await childRows(child, bottles);
    for (const r of rows) if (r.card.nextAllowedAt) soonest = Math.min(soonest, r.card.nextAllowedAt);
    node.append(childCard(child, rows, t));
  }

  node.append(h('p', { class: 'muted small center' }, GUIDANCE.writeItDown.text));

  // Countdowns: refresh every 30 s, and exactly when the next wait ends.
  const untilNext = soonest === Infinity ? Infinity : soonest - now() + 500;
  return { title: 'Dose Assist', node, tab: 'home', back: false, refreshEvery: Math.max(1000, Math.min(30000, untilNext)) };
}

/**
 * @param {import('../db.js').Child} child
 * @param {{ingredient: string, card: CardStatus}[]} rows
 * @param {number} t
 */
function childCard(child, rows, t) {
  const age = ageText(child.dateOfBirth, t);
  return h('section', { class: `card kid kid-${child.colour}`, 'aria-labelledby': `kid-${child.id}` },
    h('a', { class: 'kid-head', href: `#/child/${child.id}`, 'aria-label': `${child.name}: see all doses` },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, child.name.slice(0, 1).toUpperCase()),
      h('span', { class: 'kid-name' }, h('span', { id: `kid-${child.id}` }, child.name), age ? h('span', { class: 'muted small' }, age) : null),
      icon('chevron'),
    ),
    rows.length === 0
      ? h('p', { class: 'muted' }, 'No medicines yet.')
      : h('ul', { class: 'rows' }, rows.map((r) => statusRow(r.card))),
    h('a', { class: 'btn btn-primary btn-big', href: `#/give?child=${child.id}` }, icon('plus'), `Give ${child.name} a dose`),
  );
}

/** @param {CardStatus} c */
export function statusRow(c) {
  return h('li', { class: `status status-${c.kind}` },
    c.kind === 'soon' && c.progress !== undefined ? ring(c.progress) : h('span', { class: 'status-icon' }, icon(c.icon)),
    h('div', { class: 'status-text' },
      h('strong', null, c.title),
      c.detail ? h('span', { class: 'small' }, c.detail) : null,
    ),
  );
}

/** Undo, reminders off, unreviewed rules. @param {Ctx} ctx */
async function banners(ctx) {
  const out = [];
  const t = now();

  const last = state.lastLogged;
  if (last && t - last.at < UNDO_MS) {
    const dose = await db.doses.get(last.doseId);
    if (dose && !dose.deletedAt) {
      const child = await db.children.get(dose.childId);
      out.push(h('div', { class: 'notice notice-undo', role: 'status' },
        h('p', null, `Logged ${dose.bottle.name} for ${child?.name ?? 'your child'} at ${formatTime(dose.givenAt, timeZone())}.`),
        h('button', {
          class: 'btn btn-secondary',
          onclick: async () => {
            await db.doses.remove(dose.id, { by: state.caregiver || 'Unknown', at: now(), reason: `Undo within ${formatDuration(UNDO_MS)} of logging` });
            state.lastLogged = null;
            toast('Dose removed');
            await refreshReminders();
            ctx.refresh();
          },
        }, icon('undo'), 'Undo'),
      ));
    }
  }

  const push = await pushStatus();
  const perm = 'Notification' in window ? Notification.permission : 'denied';
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
      h('p', null, 'Reminders work while Dose Assist is open. Reminders with the app closed are not set up yet in this version.'),
    ));
  }

  if (state.rules.reviewedBy === null) {
    out.push(h('div', { class: 'notice notice-test' }, icon('warn'), h('p', null, GUIDANCE.notReviewed.text)));
  }
  return out;
}
