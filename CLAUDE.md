# CLAUDE.md: Dose Assist

Dose Assist is a React Native (Expo, TypeScript) app for NZ parents to track children's medicine doses and get reminders for when the next dose is allowed. The full plan is in `PLAN.md`. Read it before starting any task.

This is a child-safety app. A bug can lead to a child being overdosed. Correctness beats speed, features, and cleverness every time.

## Golden rules

1. **Dosing numbers live only in `src/engine/rules/rules.json` and `products.json`.** Never hard-code a dose, interval, limit, or strength anywhere else.
2. **Never change `rules.json` or `products.json` unless explicitly asked.** When asked, also: add or update tests, keep the `sources` entry for that rule, bump `rulesVersion`, reset `reviewedBy`/`reviewedAt` to null, and flag the change in your summary.
3. **Never round a dose up.** Round down to the syringe step, then recompute mg.
4. **Always apply absolute caps** (max single dose, max 24 h) after weight-based maths.
5. **Rolling 24-hour windows only.** Never use calendar days.
6. **All timestamps are UTC milliseconds.** Convert to local time only for display. Never read the system clock inside `src/engine`; `now` is always passed in.
7. **Track by ingredient, not product.** Combination products count toward ingredient totals.
8. **Nothing is logged without an explicit confirm screen.** Not from notifications, not from widgets, not from shortcuts.
9. **Dose records are never hard-deleted.** Use `deletedAt` and write a `DoseAudit` entry.
10. **`src/engine` must stay pure:** no React, Expo, React Native, database, or network imports.
11. **No network calls with health data** in the MVP. No analytics SDKs. Crash reports must not include names or dose data.
12. **Calculator mode stays behind the feature flag** and is disabled for any ingredient whose rules have `reviewedBy: null`.
13. **Never invent clinical content.** Guidance text goes in `src/content/` with a source reference. If a source is missing, leave a `TODO(VERIFY)` and say so in your summary.

## Workflow

- Work on one milestone from `PLAN.md` at a time. Stop at the end and summarise.
- For engine work: write tests first, then code.
- Run before finishing any task: `npm run typecheck && npm run lint && npm test`.
- Keep PRs small and focused. Update `CHANGELOG.md`.
- If a requirement is ambiguous and touches dosing, stop and ask rather than guess.

## Commands

```bash
npm install
npx expo start          # run the app
npm test                # Jest
npm run test:engine     # engine tests with coverage
npm run typecheck       # tsc --noEmit
npm run lint            # ESLint
maestro test e2e/       # end-to-end flows
```

## Conventions

- TypeScript strict mode; no `any` in `src/engine`.
- Functional React components and hooks.
- User-facing text is plain, calm NZ English ("Next dose from 2:15pm"). Use 12-hour time with am/pm by default.
- Accessibility: every touchable has an accessibility label; minimum tap target 56 pt; status never conveyed by colour alone.
- Emergency numbers (Healthline 0800 611 116, emergency 111, Poisons Centre 0800 764 766) come from a single constants file.
