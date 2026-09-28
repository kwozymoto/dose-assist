// @ts-check
/* Sources and about: every rule with its value, source and date checked,
   what is still unverified, and the review status. Read straight from
   data/rules.json, data/products.json and content/guidance.js, so this
   screen cannot disagree with what the app does. */

import { h } from '../dom.js';
import { state } from '../state.js';
import { formatInterval, formatAgeDays, formatMg, formatStrength } from '../format.js';
import { GUIDANCE, SOURCES } from '../content/guidance.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

/** Only the fields tracker mode uses, in words. */
const SHOWN = /** @type {const} */ ([
  ['minIntervalMinutes', 'Time between doses', (/** @type {number} */ v) => `at least ${formatInterval(v)}`],
  ['usualIntervalMaxMinutes', 'Top of the usual range (you can choose a gap up to this)', formatInterval],
  ['maxDosesPer24h', 'Doses in any 24 hours', (/** @type {number} */ v) => `no more than ${v}`],
  ['maxSingleMg', 'Most in one dose', formatMg],
  ['maxMgPer24h', 'Most in any 24 hours', formatMg],
  ['minAgeDays', 'Youngest age', formatAgeDays],
  ['seekAdviceAfterHours', 'See a doctor if still needed after', (/** @type {number} */ v) => formatInterval(v * 60)],
]);

/** @param {Ctx} _ctx @returns {Promise<Screen>} */
export async function sources(_ctx) {
  const r = state.rules;
  const node = h('div', { class: 'stack' },
    h('div', { class: `notice ${r.reviewedBy ? '' : 'notice-test'}` },
      h('p', null, h('strong', null, `Limits version ${r.rulesVersion}. `),
        r.reviewedBy ? `Checked by ${r.reviewedBy} on ${r.reviewedAt}.` : 'Not yet checked by a pharmacist or paediatrician. Follow the label.'),
    ),
    Object.entries(r.ingredients).map(([name, rule]) => h('section', { class: 'card stack-sm' },
      h('h2', null, name.charAt(0).toUpperCase() + name.slice(1)),
      h('dl', { class: 'facts' }, SHOWN.flatMap(([key, label, fmt]) => {
        const v = /** @type {any} */ (rule)[key];
        if (typeof v !== 'number') return [];
        const unverified = rule.unverified?.includes(key);
        return [h('dt', null, label), h('dd', null, fmt(v), unverified ? h('span', { class: 'badge badge-warn' }, 'not yet confirmed') : null)];
      })),
      h('ul', { class: 'bullets small' }, rule.sources.map((s) => h('li', null,
        s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name) : s.name,
        s.checkedAt ? ` (checked ${s.checkedAt})` : ' (not yet checked)',
      ))),
      /** @type {any} */ (rule).reviewNotes?.length
        ? h('details', null, h('summary', null, 'Notes for the reviewer'), h('ul', { class: 'bullets small' }, /** @type {string[]} */ (/** @type {any} */ (rule).reviewNotes).map((n) => h('li', null, n))))
        : null,
    )),
    h('section', { class: 'card stack-sm' },
      h('h2', null, 'Products'),
      h('p', { class: 'small muted' }, `Product list ${state.products.productsVersion}. The strength on your own label always wins.`),
      h('ul', { class: 'bullets small' }, state.products.products.map((p) => h('li', null,
        `${p.name}: ${p.components.map((c) => formatStrength(c, p.form)).join(' + ')}`,
        p.verified ? '' : h('span', { class: 'badge badge-warn' }, 'brand not yet checked'),
      ))),
    ),
    h('section', { class: 'card stack-sm' },
      h('h2', null, 'Advice in the app'),
      h('ul', { class: 'bullets small' }, Object.entries(SOURCES).filter(([id]) => id !== 'app').map(([, s]) => h('li', null,
        s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name) : s.name, s.checkedAt ? ` (checked ${s.checkedAt})` : ''))),
      Object.values(GUIDANCE).some((g) => g.verify)
        ? h('details', null, h('summary', null, 'Still to confirm'), h('ul', { class: 'bullets small' },
          Object.values(GUIDANCE).filter((g) => g.verify).map((g) => h('li', null, `${g.title ?? g.text?.slice(0, 60)}: ${g.verify}`))))
        : null,
    ),
    h('section', { class: 'stack-sm' },
      h('h2', null, 'Privacy'),
      h('p', null, 'Everything stays on this phone: no account, no analytics, no advertising. If reminders with the app closed are switched on, the reminder server receives only encrypted messages and the times to send them. It cannot read which child, which medicine or which dose.'),
    ),
  );
  return { title: 'Sources and about', back: '/help', node, tab: 'help' };
}
