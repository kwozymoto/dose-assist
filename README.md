# WhenDose

A record of your children's medicine doses, and a reminder when the next one is allowed. For New Zealand parents and anyone sharing the care of a sick child.

**Tracker mode.** The parent enters the dose from the label or their doctor. The app keeps the record (what, how much, when, who), says when the next dose is allowed under the usual limits, and reminds them. It does not work out doses, diagnose, or advise whether a child needs medicine.

> **Test version.** The limits in `data/rules.json` have not yet been checked by a NZ-registered pharmacist or paediatrician (`reviewedBy: null`). See `PLAN.md` section 12, M7.

Plain HTML, CSS and JavaScript: no build step, no framework. Installable, works offline. Built the same way as Everyday Koine.

## Run it

```bash
npm install          # dev tools only
npm run serve        # http://localhost:8741
node tools/check_all.mjs
```

`?clock=+4h` moves the app's clock for testing ("too soon" → wait → "can give" without waiting).

## What is where

```
index.html, sw.js, manifest.webmanifest   the shell; sw.js caches everything in SHELL
data/rules.json      every dosing number, with its sources. The only place they live.
data/products.json   the starter product list
js/engine/           the pure dose check: no clock, DOM, storage or network
js/db.js             IndexedDB: children, weights, bottles, doses (soft-deleted, audited), reminders
js/schedule.js       reminder times, recomputed from the doses
js/webpush.js        RFC 8291 encryption, done on the phone
js/content/          every piece of guidance, with its source
js/views/            the screens
reminder-worker/     the push server (Cloudflare Worker + Durable Object)
tools/               the checkers (check_all.mjs) and icon builder
tests/               node --test: engine, properties, DST, storage, reminders, push, worker
```

## The checks

`node tools/check_all.mjs` runs:

| | |
|---|---|
| `check_engine` | `js/engine` reads no clock, touches no DOM, storage or network, imports nothing outside itself, and has no `any` |
| `check_rules` | `rules.json` and `products.json`: shape; every value backed by a source's `supports` or listed as `unverified`; any change bumps the version and resets the review |
| `check_numbers` | emergency numbers appear only in `js/constants.js` |
| `check_literals` | no number with a dosing unit in UI text (a reasoned allow-list for the rest) |
| `check_content` | every guidance entry cites a known source; each TODO(VERIFY) is expected and says why |
| `check_sw` | every app file is in the service worker's `SHELL`; `VERSION` bumped when one changes |
| `check_theme` | every text colour at 4.5:1 or better on its ground, in both themes |
| `check_ids` | no id used twice |

It also runs the test suite (151 tests, including fast-check properties against an independent oracle and NZ daylight-saving boundaries), engine coverage (95% floor) and the type check.

## Reminders when the app is closed

A web page cannot wake itself up, so reminders with the app closed come through Web Push. The phone encrypts each reminder to its own push subscription; the worker holds only ciphertext and the time to send it, and cannot read which child, medicine or dose it is.

Until the worker is deployed, `PUSH_URL` in `js/config.js` is empty and the app says reminders work only while it is open. To deploy (needs a Cloudflare account; the Koine sync worker's account works):

```bash
node tools/vapid-keys.mjs                         # prints a public key and a private JWK
cd reminder-worker
npx wrangler secret put VAPID_PRIVATE_JWK         # paste the private JWK line
npx wrangler secret put VAPID_SUBJECT             # mailto: a contact address
npx wrangler deploy
```

Then set `PUSH_URL` (the worker's URL) and `VAPID_PUBLIC_KEY` in `js/config.js`, bump `VERSION` in `sw.js`, and add the site's origin to `ALLOWED_ORIGINS` in `reminder-worker/wrangler.toml` if it is not `https://kwozymoto.github.io`.

On iPhone, push needs iOS 16.4 or later and WhenDose added to the Home Screen.

## Sources

Every rule and piece of advice names its source and the date it was checked: KidsHealth NZ, Healthify He Puna Waiora, bpacnz, Health New Zealand (Healthline) and the National Poisons Centre. The app links to them; it does not copy their text. The Sources screen in the app lists them all, and what is still unconfirmed.

## Not medical advice

This app keeps a record. Always follow the product label and your doctor or pharmacist. If you are unsure, call Healthline on 0800 611 116. In an emergency, call 111. If a child may have had too much medicine, call the National Poisons Centre on 0800 764 766.

## Android app (sideloaded APK)

The same app, wrapped with [Capacitor](https://capacitorjs.com/) so reminders are scheduled as Android alarms on the phone: they fire with no internet and with the app closed, and are restored after a restart. The web app is unchanged and still has no build step.

- `js/native.js` hands the plan from `planNotices` to `@capacitor/local-notifications` (exact alarms, allowed in Doze, one channel "Dose reminders"). A tap opens a screen; it never logs a dose. In a browser it does nothing.
- `tools/build_www.mjs` copies exactly the `sw.js` SHELL into `www/` (Capacitor's `webDir`, git-ignored), so the APK and the web app cannot ship different files. There is no service worker inside the app.
- `android/` is the generated Android Studio project. `USE_EXACT_ALARM` is declared for sideloading; remove it before any Google Play listing (see the comment in `AndroidManifest.xml`).
- App id `nz.whendose.app`. Changing it later makes a different app, so decide before the first real install.

Build (needs the Android SDK and a JDK, e.g. both from Android Studio). Point `JAVA_HOME` at Android Studio's bundled JDK (`<Android Studio>/jbr`) and `android/local.properties` at the SDK (`sdk.dir=D\:/path/to/Sdk`, forward slashes). The Gradle wrapper is 9.1 so it runs on the JDK 25 that Android Studio ships; the Capacitor plugins compile with a Java 21 toolchain, which Gradle fetches itself (foojay resolver in `android/settings.gradle`).

```bash
npm run android:sync          # copy the shell into www/ and update android/
npm run android:apk           # debug APK at android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open          # or open the project in Android Studio
python tools/android_icons.py # redraw launcher and notification icons from icons/
```

After changing any shell file, run `npm run android:sync` again before building.

## Linked phones (sync)

Two phones can share one record. Settings → Linked phones: the first phone shows a QR code; the second scans it (the Android app's camera) or pastes the code.

- The code holds a random family id and a 256-bit key. The key never leaves the phones. Every change is sealed on the phone with AES-256-GCM (`js/synccrypto.js`) before it is sent.
- `sync-worker/` (Cloudflare Worker, one Durable Object per family) stores only the sealed batches, which phone sent each, and a hash of the family's access token (an HMAC of the key). It cannot read anything.
- `js/db.js` stamps every shared record with when and on which phone it changed; `js/syncmerge.js` keeps the later change (records are never hard-deleted, so a deletion is just a newer version). Settings and label photos stay on each phone.
- `js/sync.js` sends and fetches on open, after any change, every two minutes while open, when the app returns to the front, and before a dose is logged; the confirm screen says whether the other phone's doses were checked.
- Set `SYNC_URL` in `js/config.js` to the deployed worker. Local testing: `cd sync-worker && npx wrangler dev --port 8787`, set `SYNC_URL` to `http://127.0.0.1:8787` (do not commit that), and use `127.0.0.1:8741` and `localhost:8741` as two phones.

Deploy: `cd sync-worker && npx wrangler login && npx wrangler deploy`.

**Nudges (Firebase).** After a push the server sends the family's other phones a Firebase data message with the new reminder times, sealed with the family key, so a closed Android app can move its alarms (`android/app/src/main/java/nz/whendose/app/NudgeService.java`, `Nudge.java`; the app gives the native side the key through `WhenDosePlugin`). Setup: `android/app/google-services.json` from the Firebase console (git-ignored), and the service account key as a secret: `npx wrangler secret put FCM_SERVICE_ACCOUNT < path/to/key.json` (keep the key outside the repo).
