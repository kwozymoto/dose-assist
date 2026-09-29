// @ts-check
/* Linked phones: pair two phones by QR code so they share one record.

   The first phone makes the family and shows a QR code: a link to the sync
   server's /link page with the family id and key after the #. The second
   phone's own camera opens it straight in WhenDose (Android App Links), or
   the code can be sent as a message and tapped, or pasted.
   The code is the key: anyone who has it can read this family's records, so
   the screen says to show it only to the other parent's phone. */

import { h, icon, toast, confirmDialog } from '../dom.js';
import * as db from '../db.js';
import { renderSVG } from '../vendor/uqr.js';
import { syncConfigured, syncConfig, syncStatus, startFamily, currentLink, joinFamily, unlink, syncNow } from '../sync.js';
import { readLink } from '../synccrypto.js';
import { formatAgo } from '../format.js';
import { now } from '../clock.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function linkView(ctx) {
  const back = '/settings';
  if (!syncConfigured()) {
    return { title: 'Linked phones', back, node: h('div', { class: 'stack' }, h('p', null, 'Linking phones is not set up in this version yet.')) };
  }
  const cfg = await syncConfig();
  if (ctx.query.get('show') === '1') return showCode(ctx, back);
  // Kept until used: the app redraws this screen as it comes to the front, and
  // that redraw must show the same question, not lose the link.
  const incoming = ctx.query.get('incoming') === '1' ? pending : null;
  if (incoming) return confirmIncoming(ctx, back, incoming, cfg);
  if (cfg) return linked(ctx, back);

  const paste = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input user-text', id: 'link-paste', rows: 3, placeholder: 'https://…/link#1:…' }));
  const node = h('div', { class: 'stack' },
    h('p', null, 'Link your phone and your partner’s, so a dose either of you logs shows on both and every check counts both.'),
    h('p', { class: 'small muted' }, 'Everything is locked with a key that only your two phones have. The sync server stores only locked data it cannot read.'),
    h('a', { class: 'btn btn-primary btn-big', href: '#/link?show=1' }, icon('share'), 'This is the first phone: show a code'),
    h('p', null, h('strong', null, 'Second phone? '), 'Open the phone’s camera and point it at the code on the first phone, then tap the link. WhenDose opens and links.'),
    h('details', null,
      h('summary', null, 'Or paste a code'),
      h('div', { class: 'stack-sm' },
        h('label', { class: 'label', for: 'link-paste' }, 'Link code'),
        paste,
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { if (setIncoming(paste.value)) ctx.go('/link?incoming=1'); else toast(pasteProblem(paste.value)); } }, 'Link with this code'))),
  );
  return { title: 'Linked phones', back, node };
}

/** @param {Ctx} ctx @param {string} back @returns {Promise<Screen>} */
async function showCode(ctx, back) {
  const existing = await currentLink();
  if (!existing) {
    // Nothing is shared until the parent asks: opening this screen by
    // mistake, or with Back, must not start sending records.
    const start = async () => { await startFamily(); ctx.refresh(); };
    return { title: 'Link another phone', back: '/link', node: h('div', { class: 'stack' },
      h('p', null, 'This phone will make a code. When the other phone uses it, both phones share one record of children, medicines and doses.'),
      h('p', { class: 'small muted' }, 'Records start going to the sync server, locked so it cannot read them, as soon as you tap below.'),
      h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: start }, icon('share'), 'Make the code'),
      h('a', { class: 'btn btn-secondary', href: '#/link' }, 'Cancel')) };
  }
  const text = existing;
  const qr = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code for linking another phone' });
  qr.innerHTML = renderSVG(text, { ecc: 'M', border: 2, pixelSize: 8, whiteColor: '#ffffff', blackColor: '#000000' });
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'WhenDose link code', text });
      else { await navigator.clipboard.writeText(text); toast('Copied'); }
    } catch { /* cancelled */ }
  };
  const node = h('div', { class: 'stack' },
    h('p', null, 'On the other phone, open the camera, point it at this code and tap the link. WhenDose opens and links.'),
    qr,
    h('p', { class: 'small muted' }, 'This code is the key to your records. Only show it to your partner’s phone.'),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: share }, icon('share'), 'Send the code instead'),
    h('a', { class: 'btn btn-primary btn-big', href: '#/link' }, 'Done'),
  );
  void ctx;
  return { title: 'Link another phone', back, node };
}

/** @param {Ctx} ctx @param {string} back @returns {Promise<Screen>} */
async function linked(ctx, back) {
  const st = await syncStatus();
  const t = now();
  const cfgNow = await syncConfig();
  const line = !cfgNow?.otherAt
    ? 'Waiting for your other phone to link. On it, open the camera and point it at the code (Show the code, below).'
    : st.okAt
      ? `Linked with ${cfgNow.otherName ? `${cfgNow.otherName}’s phone` : 'your other phone'}. Last checked ${formatAgo(st.okAt, t)}; last change from it ${formatAgo(cfgNow.otherAt, t)}.`
      : 'Linked. Waiting to reach the sync server.';
  const failing = st.errorAt && (!st.okAt || st.errorAt > st.okAt);
  const syncBtn = async () => {
    const r = await syncNow();
    toast(r.status === 'ok' ? 'In step' : 'Could not reach the sync server. It will keep trying.');
    ctx.refresh();
  };
  const off = async () => {
    const ok = await confirmDialog({ title: 'Unlink this phone?', body: 'This phone keeps its records but stops sharing new ones. The other phone keeps its own.', confirm: 'Unlink', danger: true });
    if (!ok) return;
    await unlink();
    toast('Unlinked');
    ctx.refresh();
  };
  const node = h('div', { class: 'stack' },
    h('div', { class: `notice ${failing ? 'notice-warn' : 'notice-undo'}` }, icon(failing ? 'warn' : 'tick'),
      h('p', null, line, failing ? ` The last try did not work (${st.error ?? 'no connection'}); it will keep trying.` : '')),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: syncBtn }, 'Check now'),
    h('a', { class: 'btn btn-secondary', href: '#/link?show=1' }, icon('share'), 'Show the code to link another phone'),
    h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: off }, 'Unlink this phone'),
  );
  return { title: 'Linked phones', back, node };
}

/* A pairing link that opened the app (from the camera, or tapped in a message). */
/** @type {string | null} */
let pending = null;
/** Hold a link that opened the app, for the Linked phones screen. @param {string} text */
export function setIncoming(text) { pending = readLink(text) ? text.trim() : null; return pending !== null; }

/**
 * Ask before joining: a link only links this phone when the parent says so.
 * @param {Ctx} ctx @param {string} back @param {string} text @param {import('../sync.js').SyncConfig | null} cfg
 * @returns {Screen}
 */
function confirmIncoming(ctx, back, text, cfg) {
  const f = readLink(text);
  if (cfg && f && cfg.fid === f.fid) {
    return { title: 'Linked phones', back, node: h('div', { class: 'stack' }, h('p', null, 'This phone is already linked with that phone.'), h('a', { class: 'btn btn-primary', href: '#/link' }, 'OK')) };
  }
  if (cfg) {
    return { title: 'Linked phones', back, node: h('div', { class: 'stack' },
      h('p', null, 'This phone is linked with a different phone. Unlink it first (Settings → Linked phones), then open the link again.'),
      h('a', { class: 'btn btn-primary', href: '#/link' }, 'OK')) };
  }
  return { title: 'Link this phone?', back, node: h('div', { class: 'stack' },
    h('p', null, 'This link joins this phone to your partner’s WhenDose, so both phones share one record of children, medicines and doses.'),
    h('p', { class: 'small muted' }, 'Only continue if the link came from your partner’s phone.'),
    h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: () => join(ctx, text, false) }, 'Link and combine our records'),
    h('p', { class: 'small muted' }, 'Combine keeps what is on both phones. The same child or medicine on both is made into one.'),
    h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: () => join(ctx, text, true) }, 'Link and use only the other phone’s records'),
    h('a', { class: 'btn btn-secondary', href: '#/settings', onclick: () => { pending = null; } }, 'Cancel')) };
}

/** Why a pasted code is not a link code, in words. @param {string} text */
function pasteProblem(text) {
  const t = text.trim();
  if (!t) return 'Paste the code first.';
  if (!t.includes('#1:')) return 'That does not look like a WhenDose code. It starts with https:// and has #1: in it.';
  return 'That code looks cut off. Copy it again, all of it.';
}

/** @param {Ctx} ctx @param {string} text @param {boolean} replace */
async function join(ctx, text, replace) {
  if (!readLink(text)) { toast(pasteProblem(text)); return; }
  if (replace && (await db.children.list({ includeArchived: true })).length) {
    const ok = await confirmDialog({
      title: 'Use only the other phone’s records?',
      body: 'This phone’s children, medicines and doses will be removed, and the other phone’s taken instead. Your settings stay.',
      confirm: 'Remove this phone’s records', danger: true,
    });
    if (!ok) return;
  }
  pending = null;
  const r = await joinFamily(text, { replace });
  /** @type {Record<string, string>} */
  const msg = {
    'not-found': 'That code did not find the other phone. Check it was copied whole, or show the code again on the first phone.',
    'wrong-key': 'That code is not quite right. Show the code again on the first phone and try once more.',
    offline: 'Could not reach the sync server. Check your connection and try again. Nothing on this phone has changed.',
  };
  if (msg[r.status]) {
    await confirmDialog({ title: 'Not linked', body: msg[r.status], confirm: 'OK', cancel: 'Close' });
    return;
  }
  const merged = /** @type {any} */ (r).mergedChildren ?? 0;
  toast(r.status === 'ok'
    ? `Linked. Your records are in step.${merged ? ` ${merged === 1 ? 'A child on both phones was' : `${merged} children on both phones were`} made into one.` : ''}`
    : 'Linked. Could not reach the sync server yet; it will keep trying.');
  ctx.go('/link');
}
