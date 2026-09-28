/* Dose Assist service worker.

   Cache-first for the app shell: it opens instantly and works with no
   connection. Bump VERSION to ship a change; the old cache is dropped on
   activate, and the page offers a reload (js/pwa.js).

   tools/check_sw.mjs fails if a file the app loads is missing from SHELL,
   if SHELL names a file that does not exist, or if a shell file changed
   since git HEAD without VERSION changing. */

const VERSION = 'v6';
const CACHE = `dose-assist-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'data/rules.json',
  'data/products.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/badge-96.png',
  'js/app.js',
  'js/clock.js',
  'js/config.js',
  'js/constants.js',
  'js/db.js',
  'js/dom.js',
  'js/format.js',
  'js/push.js',
  'js/pwa.js',
  'js/reminders.js',
  'js/schedule.js',
  'js/state.js',
  'js/status.js',
  'js/theme.js',
  'js/webpush.js',
  'js/content/guidance.js',
  'js/engine/age.js',
  'js/engine/amounts.js',
  'js/engine/checkDose.js',
  'js/engine/gap.js',
  'js/engine/nextAllowed.js',
  'js/engine/time.js',
  'js/engine/types.js',
  'js/views/bottles.js',
  'js/views/child.js',
  'js/views/dosenow.js',
  'js/views/gap.js',
  'js/views/dose.js',
  'js/views/give.js',
  'js/views/help.js',
  'js/views/home.js',
  'js/views/onboarding.js',
  'js/views/settings.js',
  'js/views/sources.js',
  'js/views/symptoms.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('dose-assist-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      if (req.mode === 'navigate') return (await cache.match('index.html')) ?? Response.error();
      return Response.error();
    }
  })());
});

/* ---------------- reminders ----------------

   A push carries an encrypted notification made by the phone itself (the
   server cannot read it). Before showing it as current, check it is still
   the plan: the reminder must exist, not be cancelled, and its planned
   rev (a fingerprint of time and wording, schedule.js noticeRev) must match
   the message's. A dose edited or logged while
   the phone was offline could otherwise leave a stale "allowed from now"
   on the server. A stale message is replaced by a neutral one that tells
   nobody to give anything.

   Every push shows a notification, because browsers require it. */

const DB_NAME = 'dose-assist';

function openDb() {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => req.transaction.abort(); // never create it from here
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function reminderRecord(id) {
  const db = await openDb();
  if (!db || !db.objectStoreNames.contains('reminders')) return null;
  return new Promise((resolve) => {
    const t = db.transaction('reminders', 'readonly');
    const r = t.objectStore('reminders').get(id);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => resolve(null);
  });
}

async function markFired(id, at) {
  const db = await openDb();
  if (!db || !db.objectStoreNames.contains('reminders')) return;
  await new Promise((resolve) => {
    const t = db.transaction('reminders', 'readwrite');
    const s = t.objectStore('reminders');
    const r = s.get(id);
    r.onsuccess = () => { if (r.result && !r.result.firedAt) s.put({ ...r.result, firedAt: at }); };
    t.oncomplete = t.onerror = t.onabort = () => resolve();
  });
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let msg = null;
    try { msg = e.data ? e.data.json() : null; } catch { msg = null; }
    const rec = msg && msg.rid ? await reminderRecord(msg.rid) : null;
    const current = rec && !rec.cancelledAt && rec.planned && rec.planned.rev === msg.rev;
    if (current) {
      await self.registration.showNotification(msg.title, {
        body: msg.body,
        tag: msg.tag,
        renotify: !rec.firedAt,
        requireInteraction: true,
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        data: { url: msg.url, logUrl: msg.logUrl, reminderId: msg.rid },
        actions: [{ action: 'log', title: 'Log dose' }],
      });
      await markFired(msg.rid, Date.now());
    } else {
      await self.registration.showNotification('Dose Assist', {
        body: 'Your reminder times have changed. Open Dose Assist to see the latest.',
        tag: 'dose-assist-changed',
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        data: { url: './#/' },
      });
    }
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'reminder-shown' });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  // "Log dose" opens the give flow for that child. It never logs anything:
  // the confirm screen is still ahead.
  const target = new URL(e.action === 'log' && data.logUrl ? data.logUrl : data.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        if ('navigate' in w) return w.navigate(target);
        return undefined;
      }
    }
    return self.clients.openWindow(target);
  })());
});
