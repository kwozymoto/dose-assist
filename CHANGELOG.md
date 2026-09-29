# Changelog

## WhenDose; Auto theme by the clock (unreleased)

- The name is written **WhenDose** (was Whendose). App id unchanged (`nz.whendose.app`).
- **Auto theme** now goes by the clock only: dark from 7pm to 7am, light by day. Before, by day it followed the phone, so a phone set to dark stayed dark all day. "Same as my phone" still follows the phone. The theme is re-checked whenever the app comes back to the front.
- **Linked phones (sync).** Pair two phones by QR code (Settings → Linked phones) so a dose either parent logs shows on both, and every check counts both. End-to-end encrypted: the family key never leaves the phones; the new sync server (`sync-worker/`) stores only sealed batches it cannot read. The confirm screen fetches the other phone's doses first ("Checked for doses from your other phone just now", or a warning to check with them if it could not). Project rule 11 updated on the owner's decision. Tests first for the merge (`js/syncmerge.js`, including a property that two phones converge whatever the order), the encryption, the stamps and the server's checks; end-to-end tested with two browser profiles against the server running locally. Not deployed yet.
- **Saved usual dose.** The amount screen has "Remember this as Elyse's usual dose of Pamol", ticked by default; it is saved when the dose is logged. Next time the medicine's button goes straight to the confirm screen ("Elyse's usual dose", with "Change the amount or time"). Every limit, the weight check and the stop screens still apply. A new bottle has no saved dose, so it is always entered fresh.
- **Check-up questions** on the confirm screen, never blocking (`js/engine/checkups.js`, tests first): "Have you weighed Elyse lately?" (monthly under 1, every 3 months to 5, every 6 months after), "Is the usual dose still right?" (after a weight change, or every 3 months), "Still using Pamol 250 mg / 5 mL?" (when the bottle has not been used for 30 days).
- **One button per medicine** on a child's page. Each shows the medicine, its state in words ("Allowed now", "Allowed now if needed", "Not yet", "Not now", "See a doctor"), a live countdown or count-up, the last dose and the count in 24 hours, and "Give paracetamol ›". The ones a dose is allowed for come first (`orderForButtons`, tested). Tapping goes straight to that medicine when there is one bottle of it. The separate chips and the repeated "Each medicine" rows are gone.
- **No more words split in half** ("Temperat / ure"). Buttons and normal text wrap only between words; only typed text (names, notes) may break mid-word. Paired buttons sit side by side only when each gets about 190 px, so they stack on most phones. Checked by measuring every word on 19 screens at 320, 360, 390 and 430 px.
- **Sideways scrolling fixed.** A rule that kept phone-number links on one line also stopped the long sentences inside the Help and onboarding call buttons from wrapping, so those pages became 674 px wide on a 360 px phone and the fixed tab bar sat below the screen. Now only the numbers themselves never break (non-breaking spaces in `js/constants.js`); long unbroken words wrap in buttons, choices, the timeline and the summary; and the page can never be wider than the phone (`overflow-x: clip`).
- **Undo** asks first ("Delete this dose?", with the amount, child and time). It is now a small line under Dose now ("Just logged: 5 mL of Paracetamol liquid for Ari, 11:52am. Undo") instead of a box at the top of Home.
- The **"Test version" notice** is off (`SHOW_TEST_NOTICE` in `js/config.js`) while only the owner's family uses the app. Turn it back on before sharing; the Sources screen still shows the review status.

## Weight check; no doctor override; 24-hour backdating (unreleased)

Owner's decisions, 2026-09-29:
- **Weight check** (`js/engine/weight.js`, tests first). With a weight on record, a dose over the rule's `mgPerKg` shows a caution on the confirm screen (label doses go by age, so it can happen). A 24-hour total over `maxMgPerKgPer24h` is a new stop screen, "Too much for their weight", when that value is source-verified and the weight is under 6 months old; otherwise a strong caution. Paracetamol can stop (60 mg/kg, bpacnz); ibuprofen only cautions (30 mg/kg is unverified). The app still never suggests an amount.
- **No "a doctor told me" override.** No stop screen can be passed. The one way on is still to record a dose that was already given (it now asks when), which then offers the Poisons Centre.
- **Backdating to 24 hours** (was 12), the length of the limit window. The time field starts empty, so "now" is never logged by accident. A dose's time can be edited to no earlier than 24 hours before it was logged.
- **Weight caution wording:** it now states the recommended dose for the child's weight and the amount chosen ("The recommended dose of paracetamol for Ari's weight (12 kg) is up to 180 mg. This is 250 mg."). A dose at or under the per-weight dose never shows it.

## Fixes from two test runs (unreleased)

Two testers used every screen at phone and tablet sizes, in both themes. Fixed:
- **Symptoms:** ticking a box that matches the app's own sourced red-flag advice (breathing, very sleepy, rash; or drinking less, fewer wet nappies, vomiting, diarrhoea, pain) now shows that advice with Call 111 / Call Healthline, instead of only "Saved".
- **Dialogs** close when you leave their screen (Back included), so a "Delete this dose?" can never act on another screen; Cancel has the focus, so Enter never confirms a risky choice.
- **Editing a dose** says when the change would lift a stop ("ibuprofen will be allowed now") or add one; the edit screen names the child.
- **Already given, recorded from a stop screen** now asks when it was given and checks at that time, instead of recording "now".
- **A doctor's override** shows the last dose and the last-24-hour total on the confirm screen. "Given by" must be filled in; the app no longer saves "Someone" as your name.
- **Dose now** says "Not yet", "Not now" (limit) or "See a doctor" (too young) when a dose is not allowed; "Dose now" only when it is. The count-up reads "Allowed since 2:52pm". "Can be given now" is now "is allowed now" everywhere. The Too soon screen reads "Not yet. Next paracetamol from 2:52pm". A combination medicine says which ingredient holds it back.
- **Under 3 months:** the stop screen's main button calls Healthline.
- **The logged screen's reminder** shows when it will really come (the parent's gap). Setting a reminder with notifications off says so.
- **Layout:** no tab bar in the give flow, so its main button is never covered; on Home with several children the cards come before the standing notices; colour chips no longer overflow; 56 px header buttons; phone numbers never wrap; larger emergency links; wider toasts; a readable Sources table; the tab bar no wider than the page on a tablet; a huge typed amount no longer draws thousands of syringe ticks.
- **Onboarding** lets you add another child and another medicine. Stale form errors clear as you type; custom-medicine fields have proper labels.

## Renamed to Whendose; Android app (unreleased)

**Name.** The app is now **Whendose** everywhere a person sees it (title, home screen name, notifications, summaries, backup file names). Android app id `nz.whendose.app`. Internal names keep `dose-assist` (the browser database, the backup format, the offline cache), so records and backups made before the rename still open.

**Android.** A Capacitor 8 wrapper for a sideloaded APK. Reminders are scheduled as exact Android alarms on the phone (`js/native.js`), so they fire with the app closed and no internet, and are restored after a restart. A tap opens a screen and never logs a dose. `www/` is copied from the `sw.js` SHELL, so the APK and the web app ship the same files. Not yet built or run on a phone.

## The Dreamy look; one child means Home is their page (unreleased)

**Look.** The app now uses "Dreamy" (chosen from the three in `design/`): a sky-to-lilac sky with clouds by day and a starry twilight at night, frosted rounded cards, a floating tab bar, pastel periwinkle buttons, Quicksand headings and Nunito text (self-hosted in `css/fonts/`, OFL, with Latin Extended for macrons). On a screen about one child the top of the sky takes that child's colour. `--primary` is now a pastel fill; text in the brand colour uses the new `--link`. Child colours are pastel with `--on-kid` ink. `check_theme` now holds 114 pairs at 4.5:1, including text on every child-tinted sky in both themes. Stop screens keep a heavier border and the biggest words on the page.

**Home.** A greeting with a small droplet character when there are several children. With one child, Home is that child's page, so Dose now is the first thing seen; the undo notice sits above it and the other notices below. The Dose now button follows a medicine in use (given in the last 24 hours) over one not in use.

## Dose now, and your own gap between doses (unreleased)

**Rules** `data/rules.json` **2026.10.1**, review reset (still `reviewedBy: null`). New field `usualIntervalMaxMinutes`: paracetamol 360 (bpacnz 2018 and Healthify's April 2026 pain-relief page: every 4 to 6 hours) and ibuprofen 480 (Healthify's April 2026 calculator and pain-relief pages: every 6 to 8 hours). `minIntervalMinutes` is unchanged and remains the only hard limit. The checker requires the new field to be sourced and never below the minimum.

**A parent's own gap.** From a child's page, "Time between doses" lets a parent choose a gap from the rules' minimum up to the top of the usual range, in half-hour steps (chips only, so nothing outside the range can be entered; clamped again on every read). It only sets when the countdown ends and when "next allowed" reminders fire. It can never allow a dose earlier than the rules do, and it never blocks one the rules allow: between the minimum and the parent's gap the screen says "allowed now if needed". Stored on the child (`gapMinutes`, by ingredient); no database migration.

**Dose now.** A child's page opens with one big button that follows the child's situation: counting down to the end of the gap (yellow), counting up from the moment a dose was allowed (green), limit reached or under-age (pink), or neutral when nothing was given in the last 24 hours. A chip per medicine sits under it. "Add an earlier dose" opens the give flow with "I gave it earlier" selected, and "History and edit" jumps to the timeline. The button only opens the give flow, which checks again and never logs by itself. The original status rows remain below it, so every safety message is still shown.

**Engine.** `allowedSince` on an OK check: the first instant every rule was satisfied (interval, 24-hour count, 24-hour mg), so the count-up starts at the right moment even when a 24-hour limit cleared last. New `js/engine/gap.js` (choices, clamping, phases, which medicine leads). Tests first, including fast-check properties (one millisecond before `allowedSince` was not OK; a plan never allows earlier than the rules; a clamped gap stays in range).

## 0.1.0 (unreleased)

First build: tracker mode, as a PWA built like Everyday Koine (PLAN.md 9.0).

**Engine** (`js/engine`, pure). Interval, rolling 24-hour dose count and mg total, single-dose and daily maxima, minimum age by NZ calendar date, combination products by ingredient, soft-deleted and clock-skewed doses, and a long-use warning. Tests first: 85 engine tests including fast-check properties checked against an independent oracle and the 2026/2027 NZ daylight-saving changes.

**Rules** `data/rules.json` 2026.10.0, **not clinically reviewed**. Paracetamol values sourced from KidsHealth, Healthify and bpacnz. Ibuprofen interval, doses per day, single-dose max and minimum age sourced from Healthify's 2026 pages. Ibuprofen 24-hour mg maxima and minimum weight are listed as unverified. `data/products.json` 2026.10.0: generic strengths confirmed by Healthify, brand names unverified.

**App.** Onboarding (disclaimer, numbers, name, child, medicine, reminders, install). Children, weights, My medicines (from the list after ticking the label matches; custom with strength typed twice, label photo and combinations). The give-a-dose flow with check, confirm, logged, undo for 2 minutes, and backdating up to 12 hours. Too soon, 24-hour limit, over the limit and age screens. Timeline with edit, soft delete, restore and full audit. Temperature and symptom log. Plain-text summary to share. Reminders: when the next dose is allowed (recomputed from the doses), or at a set time. Help and red flags, sources screen, backup, restore, delete all. Dark at night by default. Test clock.

**Decisions that touch dosing, for the clinical reviewer:**
- Any stop screen can record a dose that has *already been given* (`overrideReason: 'ALREADY_GIVEN'`, a value PLAN.md's data model did not have). Refusing to record a real dose would make every later check wrong. It is followed by the Poisons Centre prompt.
- A doctor-advised override is offered for "too soon" only, as PLAN.md says.
- Tracker mode does not use weight. No mg/kg limit is checked.
- The optional 15-minute follow-up reminder (PLAN.md 8.4) is not built.

**Reminders when closed.** `reminder-worker/` (Cloudflare Worker + Durable Object) with phone-side RFC 8291 encryption; the worker holds only ciphertext. Built and run locally against a real push service; not deployed.

**Checks.** `tools/check_all.mjs`: engine purity, rules and products (sourced-or-unverified, version bump and review reset on change), emergency numbers in one place, no dosing numbers in UI text, sourced guidance, service worker shell and version, contrast in both themes, unique ids; plus tests, coverage and type check. CI on GitHub Actions.
