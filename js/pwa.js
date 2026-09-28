// @ts-check
/* Service worker registration and the "New version ready" bar.

   Same approach as Everyday Koine: a new version installs and waits, and
   only the Reload button activates it, so nobody is thrown out of the
   give-dose flow mid-step. Checks for an update on load, hourly while open,
   and whenever the app comes back to the front. */

import { toast } from './dom.js';
import { isNative } from './native.js';

const CHECK_EVERY = 60 * 60 * 1000;
const CHECK_GAP = 15 * 60 * 1000;

// The installed app ships its files in the APK; a service worker there would serve stale copies after an update.
if ('serviceWorker' in navigator && !isNative()) {
  /** @type {ServiceWorkerRegistration | null} */
  let reg = null;
  let lastCheck = 0;
  const check = () => {
    if (!reg || !navigator.onLine) return;
    const t = Date.now();
    if (t - lastCheck < CHECK_GAP) return;
    lastCheck = t;
    reg.update().catch(() => {});
  };

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => {
    reg = r;
    lastCheck = Date.now();
    /** @param {ServiceWorker | null} w */
    const watch = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(r, w);
      });
    };
    if (r.waiting && navigator.serviceWorker.controller) offerUpdate(r, r.waiting);
    watch(r.installing);
    r.addEventListener('updatefound', () => watch(r.installing));
    setInterval(check, CHECK_EVERY);
  }).catch(() => {});

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  addEventListener('online', check);

  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

/** @param {ServiceWorkerRegistration} reg @param {ServiceWorker} w */
function offerUpdate(reg, w) {
  const bar = document.getElementById('updateBar');
  bar?.classList.add('on');
  const btn = document.getElementById('btnReload');
  if (btn) btn.onclick = () => {
    bar?.classList.remove('on');
    (reg.waiting ?? w).postMessage('skip-waiting');
  };
}

const no = document.getElementById('btnUpdateNo');
if (no) no.onclick = () => {
  document.getElementById('updateBar')?.classList.remove('on');
  toast('It will update next time you open the app');
};
