// @ts-check
/* My medicines: the bottles actually in the house. The give-dose flow only
   offers these, so the wrong strength cannot be picked from a long list at
   3am (PLAN.md 5.6).

   Strength is the error that matters most here: two paracetamol liquids,
   one about twice as strong as the other. So a listed product is added only
   after the parent ticks that their label says that strength, and a custom
   one only after typing the strength twice. */

import { h, icon, confirmDialog, toast } from '../dom.js';
import * as db from '../db.js';
import { state, ingredientsOf } from '../state.js';
import { now } from '../clock.js';
import { formatStrength } from '../format.js';
import { GUIDANCE } from '../content/guidance.js';
import { guidanceBox } from './give.js';
import { field } from './child.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */
/** @typedef {import('../db.js').Bottle} Bottle */
/** @typedef {import('../state.js').Product} Product */

/** @param {Ctx} _ctx @returns {Promise<Screen>} */
export async function bottlesList(_ctx) {
  const list = await db.bottles.list();
  const node = h('div', { class: 'stack' },
    list.length === 0
      ? h('p', { class: 'muted' }, 'No medicines yet. Add the ones you have at home.')
      : h('ul', { class: 'choices' }, list.map((b) => h('li', null,
        h('a', { class: 'choice', href: `#/bottles/${b.id}` },
          h('span', { class: 'status-icon' }, icon('bottle')),
          h('span', { class: 'choice-main' },
            h('strong', null, b.name),
            h('span', { class: 'small' }, b.components.map((c) => `${formatStrength(c, b.form)} ${c.ingredient}`).join(' + ')),
          ),
          icon('chevron'),
        ),
      ))),
    h('a', { class: 'btn btn-primary btn-big', href: '#/bottles/new' }, icon('plus'), 'Add a medicine'),
  );
  return { title: 'My medicines', node, tab: 'bottles', back: false };
}

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function bottleNew(ctx) {
  const then = ctx.query.get('then');
  const onboardingFlow = ctx.query.get('onboarding') === '1';
  const done = () => ctx.go(onboardingFlow ? '/welcome?step=bottle' : then || '/bottles');
  const back = onboardingFlow ? '/welcome?step=bottle' : then || '/bottles';
  const pick = ctx.query.get('product');

  if (pick === 'custom') return customForm(ctx, done, back, onboardingFlow);
  const product = pick ? state.products.products.find((p) => p.id === pick) : undefined;
  if (product) return confirmProduct(product, done, `/bottles/new${qs(ctx, { product: null })}`, onboardingFlow);

  // Grouped by ingredient, strength in large type: the thing to match to the label.
  /** @type {Map<string, Product[]>} */
  const groups = new Map();
  for (const p of state.products.products) {
    const key = ingredientsOf(p).join(' + ');
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const node = h('div', { class: 'stack' },
    guidanceBox(GUIDANCE.strengthWarning, 'warn'),
    [...groups].map(([ing, ps]) => h('section', { class: 'stack-sm' },
      h('h2', null, ing.charAt(0).toUpperCase() + ing.slice(1)),
      h('ul', { class: 'choices' }, ps.map((p) => h('li', null,
        h('a', { class: 'choice', href: `#/bottles/new${qs(ctx, { product: p.id })}` },
          h('span', { class: 'choice-main' },
            h('strong', { class: 'strength' }, p.components.map((c) => formatStrength(c, p.form)).join(' + ')),
            h('span', null, p.name),
          ),
          icon('chevron'),
        ),
      ))),
    )),
    h('a', { class: 'btn btn-secondary', href: `#/bottles/new${qs(ctx, { product: 'custom' })}` }, 'Something else: enter it from the label'),
  );
  return { title: 'Add a medicine', back, node, bare: onboardingFlow };
}

/** Rebuild the query string with changes. @param {Ctx} ctx @param {Record<string, string | null>} changes */
function qs(ctx, changes) {
  const q = new URLSearchParams(ctx.query);
  for (const [k, v] of Object.entries(changes)) { if (v === null) q.delete(k); else q.set(k, v); }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** @param {Product} p @param {() => void} done @param {string} back @param {boolean} bare @returns {Screen} */
function confirmProduct(p, done, back, bare) {
  const strength = p.components.map((c) => formatStrength(c, p.form)).join(' + ');
  const tick = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: 'p-check', required: true }));
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const save = async (/** @type {Event} */ e) => {
    e.preventDefault();
    if (!tick.checked) { error.textContent = 'Check the label first, and tick the box.'; error.hidden = false; return; }
    /** @type {Bottle} */
    const b = { id: db.uid(), productId: p.id, name: p.name, form: p.form, components: p.components.map((c) => ({ ...c })), addedAt: now() };
    await db.bottles.save(b);
    toast(`${p.name} added`);
    done();
  };
  const node = h('form', { class: 'stack', onsubmit: save },
    h('div', { class: 'product-banner' }, h('strong', null, p.name), h('span', { class: 'strength' }, strength), h('span', null, ingredientsOf(p).join(' + '))),
    h('p', null, 'Look at the label on your bottle. Find the strength: the mg and the mL.'),
    h('label', { class: 'check', for: 'p-check' }, tick, h('span', null, `My label says ${strength}`)),
    !p.verified ? h('p', { class: 'small muted' }, 'This product name is from our starter list and has not yet been checked against Medsafe. The strength on your label is what counts.') : null,
    error,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Add this medicine'),
    h('a', { class: 'btn btn-secondary', href: '#' + back }, 'That’s not my strength'),
  );
  return { title: 'Check the label', back, node, bare };
}

/** @param {Ctx} _ctx @param {() => void} done @param {string} back @param {boolean} bare @returns {Screen} */
function customForm(_ctx, done, back, bare) {
  const known = Object.keys(state.rules.ingredients);
  const name = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'b-name', placeholder: 'As on the box', maxlength: 60 }));
  const form = /** @type {HTMLSelectElement} */ (h('select', { class: 'input', id: 'b-form' },
    h('option', { value: 'liquid' }, 'Liquid'), h('option', { value: 'tablet' }, 'Tablet or capsule'), h('option', { value: 'chewable' }, 'Chewable tablet')));
  const perWrap = h('div');
  const rows = h('div', { class: 'stack-sm' });
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const photo = /** @type {HTMLInputElement} */ (h('input', { type: 'file', id: 'b-photo', accept: 'image/*', capture: 'environment', class: 'input' }));
  /** @type {string | null} */
  let photoUrl = null;
  const preview = h('div', { class: 'photo-preview' });
  photo.addEventListener('change', async () => {
    const f = photo.files?.[0];
    if (!f) return;
    photoUrl = await shrink(f);
    preview.replaceChildren(h('img', { src: photoUrl, alt: 'Photo of the label' }));
  });

  let n = 0;
  const addRow = () => {
    n += 1;
    const i = n;
    const ing = /** @type {HTMLSelectElement} */ (h('select', { class: 'input', id: `b-ing-${i}`, 'aria-label': i === 1 ? 'Active ingredient' : 'Another ingredient' },
      known.map((k) => h('option', { value: k }, k)), h('option', { value: '__other' }, 'Something else')));
    const other = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: `b-other-${i}`, placeholder: 'Active ingredient, as on the label', hidden: true }));
    ing.addEventListener('change', () => { other.hidden = ing.value !== '__other'; });
    const mg = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: `b-mg-${i}`, inputmode: 'decimal', placeholder: 'mg' }));
    const mg2 = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: `b-mg2-${i}`, inputmode: 'decimal', placeholder: 'mg again', autocomplete: 'off' }));
    rows.append(h('fieldset', { class: 'field ingredient-row', 'data-row': String(i) },
      h('legend', { class: 'label' }, i === 1 ? 'Active ingredient' : 'Another ingredient'),
      ing, other,
      h('div', { class: 'two' }, field('Strength (mg)', `b-mg-${i}`, mg), field('Strength again (mg)', `b-mg2-${i}`, mg2)),
    ));
  };
  addRow();

  const per = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'b-per', inputmode: 'decimal', placeholder: 'e.g. 5' }));
  const per2 = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'b-per2', inputmode: 'decimal', placeholder: 'again' }));
  const drawPer = () => {
    perWrap.replaceChildren(form.value === 'liquid'
      ? h('div', { class: 'two' }, field('In how many mL?', 'b-per', per, 'e.g. 250 mg in 5 mL: enter 5'), field('mL again', 'b-per2', per2))
      : h('p', { class: 'small muted' }, 'Strength is per tablet.'));
  };
  form.addEventListener('change', drawPer);
  drawPer();

  const num = (/** @type {string} */ s) => { const v = Number(s.replace(',', '.').trim()); return Number.isFinite(v) && v > 0 ? v : null; };
  const save = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const fail = (/** @type {string} */ msg) => { error.textContent = msg; error.hidden = false; error.scrollIntoView({ block: 'center' }); };
    if (!name.value.trim()) return fail('Enter the name on the box.');
    const liquid = form.value === 'liquid';
    let strengthPer = 1;
    if (liquid) {
      const a = num(per.value);
      const b = num(per2.value);
      if (a === null) return fail('Enter how many mL the strength is for.');
      if (a !== b) return fail('The two mL numbers do not match. Read them from the label again.');
      strengthPer = a;
    }
    const components = [];
    for (const row of rows.querySelectorAll('[data-row]')) {
      const i = row.getAttribute('data-row');
      const ing = /** @type {HTMLSelectElement} */ (row.querySelector(`#b-ing-${i}`)).value;
      const other = /** @type {HTMLInputElement} */ (row.querySelector(`#b-other-${i}`)).value.trim().toLowerCase();
      const a = num(/** @type {HTMLInputElement} */ (row.querySelector(`#b-mg-${i}`)).value);
      const b = num(/** @type {HTMLInputElement} */ (row.querySelector(`#b-mg2-${i}`)).value);
      const ingredient = ing === '__other' ? other : ing;
      if (!ingredient) return fail('Enter the active ingredient.');
      if (ing === '__other') {
        // A tracked ingredient typed as free text would escape its limits.
        const same = knownIn(other, known);
        if (same) return fail(`That is ${same}. Choose ${same} from the list, so it counts toward ${same} limits.`);
      }
      if (a === null) return fail(`Enter the strength of ${ingredient} in mg.`);
      if (a !== b) return fail(`The two strengths for ${ingredient} do not match. Read them from the label again.`);
      components.push({ ingredient, strengthMg: a, strengthPer });
    }
    // A brand name on the box whose medicine is not in the list above.
    const named = knownIn(name.value, known);
    if (named && !components.some((c) => c.ingredient === named)) {
      return fail(`${name.value.trim()} has ${named} in it. Choose ${named} as the active ingredient, so it counts toward ${named} limits.`);
    }
    const strength = components.map((c) => `${formatStrength(c, form.value)} ${c.ingredient}`).join(' + ');
    const odd = unusualStrengths(components, form.value);
    error.hidden = true;
    const ok = await confirmDialog({
      title: 'Is this exactly what the label says?',
      body: h('div', null, h('p', { class: 'strength' }, strength),
        odd.length ? h('p', { class: 'notice notice-warn' }, `${odd.join(' ')} Check the mg and the mL on the label once more.`) : null,
        photoUrl ? h('img', { src: photoUrl, alt: 'Your photo of the label', class: 'photo-check' }) : h('p', { class: 'small' }, 'Tip: add a photo of the label so anyone giving a dose can check it.')),
      confirm: 'Yes, it matches the label',
      cancel: 'Let me check',
    });
    if (!ok) return;
    let photoId = null;
    if (photoUrl) { photoId = db.uid(); await db.photos.save({ id: photoId, dataUrl: photoUrl, at: now() }); }
    /** @type {Bottle} */
    const bottle = { id: db.uid(), productId: null, name: name.value.trim(), form: /** @type {Bottle['form']} */ (form.value), components, photoId, addedAt: now() };
    await db.bottles.save(bottle);
    toast(`${bottle.name} added`);
    done();
  };

  const node = h('form', { class: 'stack', onsubmit: save, novalidate: true },
    guidanceBox(GUIDANCE.strengthWarning, 'warn'),
    field('Name', 'b-name', name),
    field('Form', 'b-form', form),
    rows,
    h('button', { type: 'button', class: 'btn btn-quiet', onclick: addRow }, icon('plus'), 'It has another active ingredient (combination medicine)'),
    perWrap,
    field('Photo of the label', 'b-photo', photo, 'Stays on this phone.'),
    preview,
    error,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Add this medicine'),
  );
  return { title: 'Enter from the label', back, node, bare };
}

/* Other names for ingredients the app tracks, so they cannot be entered as
   free text and escape the limits. Names, not doses. */
const ALIASES = {
  acetaminophen: 'paracetamol', apap: 'paracetamol',
  panadol: 'paracetamol', pamol: 'paracetamol', dolomol: 'paracetamol', calpol: 'paracetamol', tylenol: 'paracetamol',
  paracare: 'paracetamol', parafast: 'paracetamol', panamax: 'paracetamol',
  nurofen: 'ibuprofen', brufen: 'ibuprofen', advil: 'ibuprofen', fenpaed: 'ibuprofen', motrin: 'ibuprofen', ibugesic: 'ibuprofen',
};

/**
 * The tracked ingredient a free-text entry names, if any.
 * @param {string} text @param {string[]} known @returns {string | null}
 */
export function knownIn(text, known) {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (known.includes(w)) return w;
    const alias = /** @type {Record<string, string>} */ (ALIASES)[w];
    if (alias && known.includes(alias)) return alias;
  }
  return null;
}

/**
 * Strengths of tracked ingredients that match no product we know, in words.
 * Not a stop: new strengths do appear; a typo (25 for 250) is far likelier.
 * @param {{ingredient: string, strengthMg: number, strengthPer: number}[]} components @param {string} formValue
 */
function unusualStrengths(components, formValue) {
  const liquid = formValue === 'liquid';
  const out = [];
  for (const c of components) {
    const same = (state.products?.products ?? []).filter((p) => (p.form === 'liquid') === liquid)
      .flatMap((p) => p.components).filter((x) => x.ingredient === c.ingredient);
    if (!same.length) continue;
    const per = (/** @type {{strengthMg: number, strengthPer: number}} */ x) => x.strengthMg / x.strengthPer;
    if (same.some((x) => Math.abs(per(x) - per(c)) < 0.01)) continue;
    const usual = [...new Set(same.map((x) => formatStrength(x, formValue)))].join(', ');
    out.push(`${formatStrength(c, formValue)} is not a strength of ${c.ingredient} we know (usual: ${usual}).`);
  }
  return out;
}

/** Resize a photo to at most 1000 px so it stores small. @param {File} file */
async function shrink(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function bottleDetail(ctx) {
  const b = await db.bottles.get(ctx.params.id);
  if (!b) { ctx.go('/bottles', { replace: true }); return { title: '', node: h('div') }; }
  const photo = b.photoId ? await db.photos.get(b.photoId) : undefined;
  const archive = async () => {
    const ok = await confirmDialog({ title: `Remove ${b.name}?`, body: 'For a bottle that is finished or thrown out. Doses already given from it stay on the record.', confirm: 'Remove' });
    if (!ok) return;
    await db.bottles.archive(b.id, now());
    toast('Removed');
    ctx.go('/bottles');
  };
  const node = h('div', { class: 'stack' },
    h('div', { class: 'product-banner' },
      h('strong', null, b.name),
      h('span', { class: 'strength' }, b.components.map((c) => `${formatStrength(c, b.form)} ${c.ingredient}`).join(' + ')),
      h('span', { class: 'small' }, b.productId ? 'From the product list' : 'Entered from the label'),
    ),
    photo ? h('img', { src: photo.dataUrl, alt: `Label of ${b.name}`, class: 'photo-check' }) : null,
    h('button', { class: 'btn btn-secondary', onclick: archive }, 'Finished or thrown out: remove it'),
  );
  return { title: b.name, back: '/bottles', node, tab: 'bottles' };
}
