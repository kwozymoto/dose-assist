# Dose Assist

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

On iPhone, push needs iOS 16.4 or later and Dose Assist added to the Home Screen.

## Sources

Every rule and piece of advice names its source and the date it was checked: KidsHealth NZ, Healthify He Puna Waiora, bpacnz, Health New Zealand (Healthline) and the National Poisons Centre. The app links to them; it does not copy their text. The Sources screen in the app lists them all, and what is still unconfirmed.

## Not medical advice

This app keeps a record. Always follow the product label and your doctor or pharmacist. If you are unsure, call Healthline on 0800 611 116. In an emergency, call 111. If a child may have had too much medicine, call the National Poisons Centre on 0800 764 766.
