// @ts-check
/* Help and red flags. One tap to call. Every line here comes from
   js/content/guidance.js with its source; the numbers from constants.js. */

import { h, icon } from '../dom.js';
import { EMERGENCY } from '../constants.js';
import { GUIDANCE, SOURCES } from '../content/guidance.js';
import { guidanceBox } from './give.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

/** @param {'emergency' | 'healthline' | 'poisons'} key @param {string} [cls] */
export function callButton(key, cls = 'btn-secondary') {
  const n = EMERGENCY[key];
  return h('a', { class: `btn ${cls} btn-call`, href: `tel:${n.tel}`, 'aria-label': `Call ${n.name}, ${n.display}` },
    icon('phone'),
    h('span', { class: 'call-text' }, h('strong', null, `${n.name} ${n.display}`), h('span', { class: 'small' }, n.when)),
  );
}

/** @param {string[]} ids */
function cite(ids) {
  const links = ids.filter((id) => SOURCES[id]?.url).map((id) => h('a', { href: /** @type {string} */ (SOURCES[id].url), target: '_blank', rel: 'noopener' }, SOURCES[id].name));
  if (links.length === 0) return null;
  return h('p', { class: 'cite small muted' }, 'Source: ', links.flatMap((l, i) => (i === 0 ? [l] : ['; ', l])));
}

/** @param {Ctx} _ctx @returns {Promise<Screen>} */
export async function help(_ctx) {
  const node = h('div', { class: 'stack' },
    h('section', { class: 'stack-sm' },
      callButton('emergency', 'btn-danger'),
      callButton('healthline', 'btn-primary'),
      callButton('poisons'),
    ),
    section(GUIDANCE.call111),
    section(GUIDANCE.seeUrgently),
    section(GUIDANCE.callHealthline),
    h('p', null, h('strong', null, GUIDANCE.ifWorried.text)),
    h('h2', null, 'About medicines'),
    section(GUIDANCE.overdose),
    section(GUIDANCE.vomited),
    section(GUIDANCE.bothMedicines),
    section(GUIDANCE.storage),
    h('h2', null, 'About this app'),
    section(GUIDANCE.whatItDoes),
    section(GUIDANCE.whatItDoesNot),
    h('a', { class: 'btn btn-secondary', href: '#/sources' }, 'Where the limits and advice come from'),
  );
  return { title: 'Help', node, tab: 'help', back: false };
}

/** @param {import('../content/guidance.js').Guidance} g */
function section(g) {
  return h('div', { class: 'stack-sm' }, guidanceBox(g), cite(g.sources));
}
