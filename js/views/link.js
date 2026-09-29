// @ts-check
/* Linked phones: pair two phones by QR code so they share one record.

   The first phone makes the family and shows a QR code holding the family
   id and key. The second scans it (the Android app's camera) or pastes it.
   The code is the key: anyone who has it can read this family's records, so
   the screen says to show it only to the other parent's phone. */

import { h, icon, toast, confirmDialog } from '../dom.js';
import * as db from '../db.js';
import { renderSVG } from '../vendor/uqr.js';
import { syncConfigured, syncConfig, syncStatus, startFamily, currentLink, joinFamily, unlink, syncNow } from '../sync.js';
import { readLink } from '../synccrypto.js';
import { isNative } from '../native.js';
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
  if (cfg) return linked(ctx, back);

  const scan = async () => {
    const text = await scanCode();
    if (text) await join(ctx, text);
  };
  const paste = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'input user-text', id: 'link-paste', rows: 3, placeholder: 'whendose:link:1:…' }));
  const node = h('div', { class: 'stack' },
    h('p', null, 'Link your phone and your partner’s, so a dose either of you logs shows on both and every check counts both.'),
    h('p', { class: 'small muted' }, 'Everything is locked with a key that only your two phones have. The sync server stores only locked data it cannot read.'),
    h('a', { class: 'btn btn-primary btn-big', href: '#/link?show=1' }, icon('share'), 'This is the first phone: show a code'),
    isNative() ? h('button', { class: 'btn btn-secondary btn-big', type: 'button', onclick: scan }, icon('plus'), 'Scan the other phone’s code') : null,
    h('details', null,
      h('summary', null, isNative() ? 'Or paste a code' : 'Paste the other phone’s code'),
      h('div', { class: 'stack-sm' },
        h('label', { class: 'label', for: 'link-paste' }, 'Link code'),
        paste,
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => join(ctx, paste.value) }, 'Link with this code'))),
  );
  return { title: 'Linked phones', back, node };
}

/** @param {Ctx} ctx @param {string} back @returns {Promise<Screen>} */
async function showCode(ctx, back) {
  const text = (await currentLink()) ?? (await startFamily());
  const qr = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code for linking another phone' });
  qr.innerHTML = renderSVG(text, { ecc: 'M', border: 2, pixelSize: 8, whiteColor: '#ffffff', blackColor: '#000000' });
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'WhenDose link code', text });
      else { await navigator.clipboard.writeText(text); toast('Copied'); }
    } catch { /* cancelled */ }
  };
  const node = h('div', { class: 'stack' },
    h('p', null, 'On the other phone: Settings → Linked phones → Scan the other phone’s code.'),
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
  const line = st.okAt
    ? `In step with your other phone. Last checked ${formatAgo(st.okAt, t)}.`
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

/** The camera, in the Android app. @returns {Promise<string | null>} */
async function scanCode() {
  const scanner = /** @type {any} */ (globalThis).Capacitor?.Plugins?.CapacitorBarcodeScanner;
  if (!scanner) { toast('Scanning needs the WhenDose app. Paste the code instead.'); return null; }
  try {
    // hint 0 = QR code; camera 1 = back; orientation 3 = adaptive.
    const r = await scanner.scanBarcode({ hint: 0, scanInstructions: 'Point the camera at the code on the other phone', scanButton: false, scanText: ' ', cameraDirection: 1, scanOrientation: 3 });
    return typeof r?.ScanResult === 'string' ? r.ScanResult : null;
  } catch {
    return null;
  }
}

/** @param {Ctx} ctx @param {string} text */
async function join(ctx, text) {
  if (!readLink(text)) { toast('That is not a WhenDose link code.'); return; }
  const kids = await db.children.list({ includeArchived: true });
  let replace = false;
  if (kids.length) {
    const combine = await confirmDialog({
      title: 'This phone already has records',
      body: 'Combine them with the other phone’s? If both phones have the same child, you will see them twice and can archive one.',
      confirm: 'Combine them', cancel: 'Another way',
    });
    if (!combine) {
      const rep = await confirmDialog({
        title: 'Use the other phone’s records instead?',
        body: 'This phone’s children, medicines and doses will be removed, and the other phone’s taken instead. Your settings stay.',
        confirm: 'Use the other phone’s', danger: true,
      });
      if (!rep) return;
      replace = true;
    }
  }
  const r = await joinFamily(text, { replace });
  toast(r.status === 'ok' ? 'Linked. Your records are in step.' : 'Linked. Could not reach the sync server yet; it will keep trying.');
  ctx.go('/link');
}
