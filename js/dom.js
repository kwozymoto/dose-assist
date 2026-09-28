// @ts-check
/* A small DOM toolkit: h() to build elements, icons, toasts, a confirm
   dialog, and the live region screen readers hear. No framework. */

/**
 * h('button', {class: 'btn', onclick: fn, 'aria-label': 'Close'}, 'Close')
 * Children: strings, numbers, Nodes, arrays of them, or null/false (skipped).
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && typeof v !== 'string') /** @type {any} */ (el)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

/** @param {Node} el @param {any[]} children */
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/* Icons: inline SVG, drawn with currentColor so they take the text colour.
   Always paired with words; never the only carrier of meaning. */
const PATHS = {
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  stop: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M8.5 12h7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  dash: '<path d="M7 12h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  home: '<path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  bottle: '<path d="M9.5 3h5v3l2 2.5V20a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V8.5l2-2.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7.5 12.5h9" stroke="currentColor" stroke-width="2"/>',
  help: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  phone: '<path d="M6.6 3.5l2.6.4 1.3 4-2 1.6a12 12 0 0 0 6 6l1.6-2 4 1.3.4 2.6a2 2 0 0 1-2 2.1A16.5 16.5 0 0 1 4.5 5.6a2 2 0 0 1 2.1-2.1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  minus: '<path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2"/>',
  bellOff: '<path d="M6 16.5V11a6 6 0 0 1 9.5-4.9M18 11v5.5l1.5 2h-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  warn: '<path d="M12 3.5l9.5 16.5h-19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.2" fill="currentColor"/>',
  thermo: '<path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v7.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V12" fill="none" stroke="currentColor" stroke-width="2"/>',
  chevron: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
};

/** @typedef {keyof typeof PATHS} IconName */

/** @param {IconName} name @param {string} [cls] */
export function icon(name, cls = 'icon') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" focusable="false">${PATHS[name]}</svg>`;
  return span;
}

/** A countdown ring, 0..1 filled. @param {number} progress */
export function ring(progress) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const span = document.createElement('span');
  span.className = 'ring';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="${r}" class="ring-track"/><circle cx="24" cy="24" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - progress)}" transform="rotate(-90 24 24)"/></svg>`;
  return span;
}

/* ---------- live region, toast ---------- */

/** Say something to screen readers without moving focus. @param {string} text */
export function announce(text) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 50);
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/** @param {string} text */
export function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 4000);
  announce(text);
}

/* ---------- dialogs ---------- */

/**
 * A modal confirm. Resolves true only on the confirm button.
 * @param {{title: string, body?: string | Node, confirm: string, cancel?: string, danger?: boolean, input?: {label: string, required?: string}}} opts
 * @returns {Promise<false | {value: string}>}
 */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    const dlg = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' }));
    /** @type {HTMLInputElement | null} */
    let input = null;
    /* Resolve from the buttons themselves. Relying only on the dialog's
       'close' event left the flow stuck in a browser that did not fire it. */
    let settled = false;
    /** @param {boolean} yes */
    const finish = (yes) => {
      if (settled) return;
      settled = true;
      try { dlg.close(); } catch { /* already closed */ }
      dlg.remove();
      resolve(yes ? { value: input ? input.value : '' } : false);
    };
    const ok = h('button', { class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit', value: 'ok' }, opts.confirm);
    if (opts.input) {
      input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'text', id: 'dlg-input', autocomplete: 'off' }));
      if (opts.input.required) {
        const want = opts.input.required;
        /** @type {HTMLButtonElement} */ (ok).disabled = true;
        input.addEventListener('input', () => { /** @type {HTMLButtonElement} */ (ok).disabled = input?.value.trim() !== want; });
      }
    }
    const form = h('form', {
      method: 'dialog',
      onsubmit: (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        const yes = /** @type {HTMLButtonElement | null} */ (e.submitter)?.value === 'ok';
        if (yes && /** @type {HTMLButtonElement} */ (ok).disabled) return;
        finish(yes);
      },
    },
      h('h2', { id: 'dlg-title' }, opts.title),
      opts.body ? (typeof opts.body === 'string' ? h('p', null, opts.body) : opts.body) : null,
      opts.input ? h('label', { class: 'field', for: 'dlg-input' }, h('span', { class: 'label' }, opts.input.label), input) : null,
      h('div', { class: 'actions' },
        ok,
        h('button', { class: 'btn btn-secondary', type: 'submit', value: 'cancel' }, opts.cancel ?? 'Cancel'),
      ),
    );
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', () => finish(false)); // Escape
    dlg.addEventListener('close', () => finish(dlg.returnValue === 'ok'));
    dlg.showModal();
    (input ?? ok).focus();
  });
}

/** Light haptic tap where supported. */
export function buzz(ms = 25) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}
