# Changelog

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
