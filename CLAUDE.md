# CLAUDE.md: Dose Assist

Dose Assist is an installable web app (PWA) for NZ parents to track children's medicine doses and get reminders for when the next dose is allowed. The full plan is in `PLAN.md`. Read it before starting any task.

It is built the same way as Everyday Koine: plain HTML, CSS and JavaScript (ES modules), **no build step, no framework**, a service worker for offline, and checkers in `tools/` that hold the rules below. `PLAN.md` section 9 was written for React Native; section 9.0 records the change and why.

This is a child-safety app. A bug can lead to a child being overdosed. Correctness beats speed, features, and cleverness every time.

## Golden rules

1. **Dosing numbers live only in `data/rules.json` and `data/products.json`.** Never hard-code a dose, interval, limit, or strength anywhere else. (`check_literals` fails on a number with a dosing unit in UI text.)
2. **Never change `rules.json` or `products.json` unless explicitly asked.** When asked, also: add or update tests, keep the `sources` entry for that rule (and its `supports` list), bump `rulesVersion`, reset `reviewedBy`/`reviewedAt` to null, and flag the change in your summary. (`check_rules` enforces the bump and the reset against git HEAD, and that every value is either backed by a source's `supports` or listed in `unverified`.)
3. **Never round a dose up.** Round down to the syringe step, then recompute mg. (Calculator mode only; tracker mode never suggests an amount.)
4. **Always apply absolute caps** (max single dose, max 24 h) after weight-based maths.
5. **Rolling 24-hour windows only.** Never use calendar days. A dose leaves the window exactly 24 hours after it was given.
6. **All timestamps are UTC milliseconds.** Convert to local time only for display (`js/format.js`). Never read the system clock inside `js/engine`; `now` is always passed in. Everywhere else asks `js/clock.js`.
7. **Track by ingredient, not product.** Combination products count toward ingredient totals.
8. **Nothing is logged without an explicit confirm screen.** Not from notifications, not from links, not from shortcuts. A URL can open a step of the give flow; only the confirm button writes.
9. **Dose records are never hard-deleted.** Use `deletedAt` and write a `DoseAudit` entry in the same transaction (`js/db.js`). The only hard delete is the user's own "Delete all data".
10. **`js/engine` must stay pure:** no DOM, storage, network, clock or imports from outside `js/engine`. (`check_engine`.)
11. **No network calls with health data.** No analytics. The reminder server receives only ciphertext encrypted on the phone (`js/webpush.js`) and the time to send it. Never add a field to what it receives.
12. **Calculator mode stays behind the feature flag** and is disabled for any ingredient whose rules have `reviewedBy: null`. (Not built yet.)
13. **Never invent clinical content.** Guidance text goes in `js/content/guidance.js` with a source from `SOURCES`. If a source is missing, mark the entry `verify` with the reason, add it to `VERIFY_EXPECTED` in `tools/checks.mjs`, and say so in your summary.
14. **A stop screen never refuses to record a dose that has already been given.** The record must match reality, or every later check is wrong. Recording it (`overrideReason: 'ALREADY_GIVEN'`) is not approving it; the screen after offers the Poisons Centre.

## Workflow

- Work on one milestone from `PLAN.md` at a time unless asked otherwise. Stop at the end and summarise.
- For engine work: write tests first, then code.
- Run before every commit, and read what it says: `node tools/check_all.mjs` (every checker, the tests, engine coverage, the type check). Green, no exceptions.
- **A checker not in `CHECKS` (`tools/checks.mjs`) is not a checker.** Register it in the same commit that creates it. When you add data of a kind no checker covers, write the checker in the same commit. A checker that can only report is not a checker: give its legitimate exceptions an allow-list with a reason beside each.
- Keep commits small and focused. Update `CHANGELOG.md`.
- If a requirement is ambiguous and touches dosing, stop and ask rather than guess.

## Commands

```bash
npm install                 # dev tools only: TypeScript (JSDoc type check), fast-check, fake-indexeddb
npm run serve               # the app at http://localhost:8741
node tools/check_all.mjs    # everything; must be green
npm test                    # tests only
npm run test:engine         # engine tests with coverage (95% floor)
npm run typecheck           # tsc over the JSDoc types
python tools/build_icons.py # redraw icons/
```

Testing tips: `?clock=+4h` in the URL moves the app's clock (a banner shows while set); Settings shows the test clock with `#/settings?debug=1`. The Browser pane in the desktop app blocks service workers, so test those in a real browser.

## Shipping

- **Bump `VERSION` in `sw.js` on every change to a shell file**, or phones keep the old one. `check_sw` fails if a shell file changed since HEAD and VERSION did not.
- **New file? Add it to `SHELL` in `sw.js`.** `check_sw` fails if a file under `js/`, `css/`, `data/` or `icons/` is missing.
- A new version installs and waits; only the "New version ready · Reload" button activates it, so nobody is thrown out mid-dose. A reload is not enough to see a deploy.
- The reminder worker (`reminder-worker/`) deploys separately with wrangler. See `README.md`.
- **Android app:** `npm run android:sync` copies the shell into `www/` and updates `android/`. Never edit `www/` or `android/app/src/main/assets/public/`; they are copies. Native reminders live in `js/native.js` and take the same `planNotices` output as push. See `README.md`.

## Git

- **Never `git add -A` or `git add .`**: stage by name and read `git status --short` before committing.
- Never commit a VAPID private key or `.dev.vars`.

## Conventions

- JavaScript with `// @ts-check` and JSDoc types, strict. No `any` in `js/engine`.
- User-facing text is plain, calm NZ English ("Next dose from 2:15pm"). 12-hour time with am/pm, no space.
- Accessibility: every touchable has an accessible name; minimum tap target 56 px; status never conveyed by colour alone (colour + icon + words). Colours are CSS tokens only; `check_theme` holds every text/ground pair at 4.5:1 in both themes. `--primary` is a pastel fill, never text: text in the brand colour uses `--link`, text on a child colour uses `--on-kid`.
- Emergency numbers (Healthline 0800 611 116, emergency 111, Poisons Centre 0800 764 766) come from `js/constants.js` only. (`check_numbers`.)
