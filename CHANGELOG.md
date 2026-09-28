# Changelog

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
