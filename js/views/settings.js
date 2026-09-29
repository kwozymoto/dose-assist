// @ts-check
/* Settings: who you are, reminders, theme, your data (backup, restore,
   delete everything), archived children. */

import { h, icon, confirmDialog, toast } from '../dom.js';
import * as db from '../db.js';
import { state } from '../state.js';
import { now, timeZone, clockOffset, setClockOffset, parseOffset } from '../clock.js';
import { formatDate } from '../format.js';
import { THEME_CHOICES, applyTheme } from '../theme.js';
import { pushStatus, enablePush, disablePush, notifyPermission } from '../push.js';
import { isNative, testNative, exactAlarmsAllowed, openExactAlarmSettings } from '../native.js';
import { refreshReminders } from '../reminders.js';
import { syncConfigured, syncConfig, syncStatus } from '../sync.js';
import { formatAgo } from '../format.js';
import { field } from './child.js';

/** @typedef {import('../app.js').Ctx} Ctx */
/** @typedef {import('../app.js').Screen} Screen */

/** @param {Ctx} ctx @returns {Promise<Screen>} */
export async function settings(ctx) {
  const tz = timeZone();
  const name = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'st-name', value: state.caregiver, placeholder: 'e.g. Mum', autocomplete: 'name' }));
  name.addEventListener('change', async () => {
    state.caregiver = name.value.trim();
    await db.meta.set('caregiverName', state.caregiver);
    toast('Saved');
  });

  const theme = await db.meta.get('theme', 'auto');
  const themeSel = /** @type {HTMLSelectElement} */ (h('select', { class: 'input', id: 'st-theme' }, THEME_CHOICES.map((c) => h('option', { value: c.id, selected: c.id === theme }, c.name))));
  themeSel.addEventListener('change', async () => { await db.meta.set('theme', themeSel.value); await applyTheme(); });

  const push = await pushStatus();
  const perm = await notifyPermission();
  const reminderText = {
    unsupported: 'This browser cannot show notifications. Reminders show inside the app while it is open. On iPhone, add WhenDose to your Home Screen first.',
    'not-configured': perm === 'granted'
      ? 'Notifications are on. They come while WhenDose is open or in the background. Reminders with the app fully closed are not set up in this version yet.'
      : 'Turn notifications on so reminders can reach you.',
    denied: 'Notifications are blocked. Turn them on for WhenDose in your phone’s settings.',
    off: 'Reminders are off.',
    on: 'Reminders are on, including when the app is closed.',
  }[push];

  // Android can be set to deliver alarms late to save battery; reminders need the exact minute.
  const inexact = isNative() && perm === 'granted' && !(await exactAlarmsAllowed());

  const linkCfg = syncConfigured() ? await syncConfig() : null;
  const linkSt = linkCfg ? await syncStatus() : {};
  const linkLine = !syncConfigured() ? 'Not set up in this version yet.'
    : !linkCfg ? 'Share one record with your partner’s phone.'
      : linkSt.okAt ? `Linked. Last checked ${formatAgo(linkSt.okAt, now())}.` : 'Linked. Waiting to reach the sync server.';

  const active = await db.reminders.active();
  const kids = await db.children.list({ includeArchived: true });
  const archived = kids.filter((k) => k.archivedAt);

  const exportData = async () => {
    const file = await db.exportAll(now());
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `whendose-backup-${new Date(now()).toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    toast('Backup saved');
  };
  const importInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'application/json,.json', hidden: true }));
  importInput.addEventListener('change', async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    let parsed;
    try { parsed = JSON.parse(await f.text()); } catch { toast('That file could not be read.'); return; }
    const ok = await confirmDialog({ title: 'Replace everything on this phone?', body: `Everything now on this phone will be replaced by the backup from ${parsed?.exportedAt ? formatDate(parsed.exportedAt, tz) : 'the file'}.`, confirm: 'Replace', danger: true });
    if (!ok) return;
    try {
      await db.importAll(parsed);
      state.caregiver = await db.meta.get('caregiverName', '');
      await refreshReminders();
      toast('Backup restored');
      ctx.go('/');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restore failed');
    }
  });
  const wipe = async () => {
    const ok = await confirmDialog({
      title: 'Delete all data?',
      body: 'Every child, medicine, dose and reminder on this phone will be permanently deleted. This cannot be undone. Save a backup first if you might want it.',
      confirm: 'Delete everything', danger: true,
      input: { label: 'Type DELETE to confirm', required: 'DELETE' },
    });
    if (!ok) return;
    await disablePush().catch(() => {});
    await db.deleteEverything();
    state.caregiver = '';
    state.lastLogged = null;
    await refreshReminders();
    toast('All data deleted');
    ctx.go('/welcome');
  };

  const node = h('div', { class: 'stack' },
    h('section', { class: 'stack-sm' },
      h('h2', null, 'You'),
      field('Your name on this phone', 'st-name', name, 'Shown on each dose you log, so others can see who gave it.'),
    ),
    h('section', { class: 'stack-sm' },
      h('h2', null, 'Reminders'),
      h('p', null, reminderText),
      push === 'off' || (push === 'not-configured' && perm === 'default')
        ? h('button', { class: 'btn btn-primary', onclick: async () => { const s = await enablePush(); toast(s === 'on' || (await notifyPermission()) === 'granted' ? 'Notifications on' : 'Notifications not allowed'); await refreshReminders(); ctx.refresh(); } }, icon('bell'), 'Turn on notifications')
        : null,
      push === 'on' ? h('button', { class: 'btn btn-secondary', onclick: async () => { await disablePush(); toast('Reminders with the app closed are off'); ctx.refresh(); } }, 'Turn off reminders when closed') : null,
      inexact ? h('div', { class: 'notice notice-warn' }, h('p', null, 'Your phone may deliver reminders a few minutes late. Allow alarms and reminders for WhenDose so they come on time.'), h('button', { class: 'btn btn-secondary', onclick: async () => { await openExactAlarmSettings(); ctx.refresh(); } }, 'Allow alarms')) : null,
      perm === 'granted' ? h('button', { class: 'btn btn-secondary', onclick: testNotification }, 'Send a test notification') : null,
      h('p', { class: 'small muted' }, active.length === 0 ? 'No reminders set.' : `${active.length} reminder${active.length === 1 ? '' : 's'} set.`),
      active.length ? h('button', { class: 'btn btn-quiet', onclick: async () => { for (const r of active) await db.reminders.cancel(r.id, now()); await refreshReminders(); toast('Reminders cleared'); ctx.refresh(); } }, 'Clear all reminders') : null,
    ),
    h('section', { class: 'stack-sm' },
      h('h2', null, 'Linked phones'),
      h('p', null, linkLine),
      syncConfigured() ? h('a', { class: 'btn btn-secondary', href: '#/link' }, icon('share'), linkCfg ? 'Linked phones' : 'Link with another phone') : null,
    ),
    h('section', { class: 'stack-sm' },
      h('h2', null, 'Display'),
      field('Theme', 'st-theme', themeSel),
      h('p', { class: 'small muted' }, 'Text size follows your phone’s settings.'),
    ),
    h('section', { class: 'stack-sm' },
      h('h2', null, 'Your data'),
      h('p', { class: 'small' }, 'Everything is stored only on this phone. A backup file lets you move it to a new phone. Keep it private: it holds your children’s health records.'),
      h('button', { class: 'btn btn-secondary', onclick: exportData }, 'Save a backup file'),
      h('button', { class: 'btn btn-secondary', onclick: () => importInput.click() }, 'Restore from a backup file'),
      importInput,
      h('button', { class: 'btn btn-danger-quiet', onclick: wipe }, 'Delete all data'),
    ),
    archived.length ? h('section', { class: 'stack-sm' },
      h('h2', null, 'Archived children'),
      archived.map((k) => h('div', { class: 'row-between' }, h('span', null, k.name),
        h('button', { class: 'btn btn-quiet', onclick: async () => { await db.children.unarchive(k.id); toast(`${k.name} is back`); ctx.refresh(); } }, 'Bring back'))),
    ) : null,
    h('section', { class: 'stack-sm' },
      h('h2', null, 'About'),
      h('a', { class: 'btn btn-quiet', href: '#/sources' }, 'Sources, limits and privacy'),
      h('p', { class: 'small muted' }, `Limits version ${state.rules.rulesVersion} · products ${state.products.productsVersion} · Tracker mode`),
    ),
    ctx.query.get('debug') === '1' || clockOffset() !== 0 ? testClock(ctx) : null,
  );
  return { title: 'Settings', node, tab: 'settings', back: false };
}

async function testNotification() {
  if (isNative()) { await testNative(); toast('A test notification is on its way'); return; }
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) { toast('Not available here'); return; }
  await reg.showNotification('WhenDose', { body: 'This is how reminders will look.', tag: 'test', icon: 'icons/icon-192.png' });
}

/** Testing only: move the app's clock. @param {Ctx} ctx */
function testClock(ctx) {
  const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', id: 'st-clock', placeholder: '+4h, +30m, -1d' }));
  return h('section', { class: 'stack-sm' },
    h('h2', null, 'Test clock'),
    h('p', { class: 'small muted' }, 'For testing the app only. Moves the app’s idea of now; a banner shows while it is set.'),
    field('Move the clock by', 'st-clock', input),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn btn-secondary', onclick: async () => { setClockOffset(clockOffset() + parseOffset(input.value)); await refreshReminders(); ctx.refresh(); } }, 'Move'),
      h('button', { class: 'btn btn-secondary', onclick: async () => { setClockOffset(0); await refreshReminders(); ctx.refresh(); } }, 'Real time'),
    ),
  );
}
