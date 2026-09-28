# Dose Assist: Product and Build Plan

A mobile app that helps New Zealand parents track children's medicine doses (paracetamol, ibuprofen and others), know when the next dose is allowed, and avoid double-dosing when several people are caring for a sick child.

> **Status:** Planning. Every dosing number in this document must be checked and signed off by a NZ-registered pharmacist or paediatrician before any public release. Numbers marked **VERIFY** have not been confirmed against a primary NZ source yet.

---

## 1. The problem and the goal

When a child is unwell, parents are often told to give regular paracetamol and/or ibuprofen. At 3am, after several doses, with two parents (and maybe a grandparent) sharing the care, nobody is sure when the last dose was, how much was given, or whether another is allowed yet. Paracetamol has a narrow safety margin in young children, and NZ guidance (bpac, KidsHealth, Healthify) specifically tells caregivers to write down every dose.

**Goal:** make the right action obvious in under five seconds, one-handed, half asleep.

**Success looks like:**
- A parent can log a dose in 2 taps from the home screen.
- A parent can answer "can I give another dose now?" from the home screen or a notification without opening anything else.
- The app makes it hard to accidentally give too much, too soon, or the wrong strength.

---

## 2. Two critical constraints (read before building)

### 2.1 Apple App Store guideline 1.4.2
Apple's App Review Guidelines say drug dosage calculators must come from a drug manufacturer, hospital, university, health insurer, pharmacy or other approved entity, or have regulator approval. An app built by an individual that **calculates** doses from weight is very likely to be rejected on iOS.

**Response in this plan:** build the app with two modes, controlled by a feature flag.

| Mode | What it does | Store risk |
|---|---|---|
| **Tracker mode** (MVP, default) | Parent enters the dose from the product label or their doctor's instructions. App enforces intervals, 24-hour limits, reminders, and sharing. No weight-based calculation. | Low |
| **Calculator mode** (feature-flagged) | App calculates the dose in mg and mL from the child's weight and the bottle's strength. | High on iOS unless released through or with an approved partner (e.g. a pharmacy chain, a DHB/Health NZ team, a university, or KidsHealth/Healthify) |

Build the dosing engine for both from day one, but ship Tracker mode first. Pursue a partner for Calculator mode in parallel. Android (Google Play) and a web app are alternative routes but still need clinical review.

### 2.2 NZ medical device and health regulation
Software that calculates medicine doses may count as a medical device in NZ. Medical devices supplied in NZ generally need to be notified on Medsafe's WAND database. NZ therapeutic products law has been changing, so **confirm the current position with Medsafe** before public release, especially for Calculator mode. Tracker mode is lower risk but should still be checked.

---

## 3. Target users

- **Primary:** parents and caregivers of children aged 3 months to 12 years in NZ.
- **Secondary:** grandparents, babysitters, older siblings, anyone sharing care.
- **Context of use:** night-time, tired, stressed, one hand holding a child, low light, poor focus.

Out of scope for dosing: babies under 3 months (always direct to a doctor), adults, and children with conditions requiring specialist dosing.

---

## 4. Official sources

All clinical content must come from, and cite, these sources. Store the source and date against every rule and every piece of guidance text.

| Source | Use for |
|---|---|
| KidsHealth NZ (kidshealth.org.nz) | Parent-facing guidance, safe use of paracetamol, when to seek help |
| Healthify He Puna Waiora (healthify.nz) | Paracetamol and ibuprofen for children, product strengths, cautions |
| bpacnz (bpac.org.nz) | Clinical dosing principles, weight-based dosing, adult dose caps |
| NZ Formulary for Children (nzfchildren.org.nz) | Authoritative paediatric dosing, especially ibuprofen |
| Medsafe (medsafe.govt.nz) | Product data sheets, consumer medicine information, approved strengths, device regulation |
| National Poisons Centre | Overdose guidance, contact number |

**Content licensing:** contact KidsHealth and Healthify to ask about using or linking their content. Linking out is always safe; copying text needs permission.

---

## 5. Dosing rules

### 5.1 Principles
1. Track by **active ingredient**, not product. A combination cold-and-flu product containing paracetamol counts toward the paracetamol limits.
2. Use a **rolling 24-hour window**, never "today".
3. **Never round a dose up.** Round down to the nearest measurable volume on the syringe.
4. Always apply **absolute caps** (maximum single adult dose, maximum daily adult dose) after weight-based calculation.
5. Every logged dose stores a **snapshot**: child weight used, product and strength, mg, mL, rules version. History never changes if rules change later.

### 5.2 Paracetamol (sourced; still needs clinical sign-off)
| Rule | Value | Source |
|---|---|---|
| Dose per kg | 15 mg/kg (usual range 10 to 15 mg/kg) | bpac, Medsafe |
| Minimum interval | 4 hours | KidsHealth |
| Max doses in 24 h | 4 | KidsHealth, Healthify |
| Max per 24 h by weight | 60 mg/kg | bpac, Medsafe |
| Max single dose | 1000 mg | bpac |
| Max per 24 h absolute | 4000 mg | bpac, Medsafe |
| Seek advice if still needed after | 48 hours (**VERIFY** exact wording and age range) | Medsafe label statements |
| Minimum age | 3 months; under 3 months see a doctor | Healthify, KidsHealth |

Extra cautions: underweight or malnourished children are at higher risk of toxicity (bpac). Show a prompt: "If your child is very underweight or unwell for a long time, check the dose with your pharmacist or doctor."

### 5.3 Ibuprofen (ALL VERIFY against NZ Formulary for Children and Medsafe data sheets)
| Rule | Candidate value |
|---|---|
| Dose per kg | 5 to 10 mg/kg (**VERIFY**) |
| Minimum interval | 6 hours (**VERIFY**; some sources say 6 to 8) |
| Max doses in 24 h | 3 (**VERIFY**) |
| Max per 24 h by weight | 30 mg/kg (**VERIFY**) |
| Max single dose (OTC) | 400 mg (**VERIFY**) |
| Max per 24 h absolute (OTC) | 1200 mg (**VERIFY**) |
| Minimum age/weight | 3 months and over 5 kg (**VERIFY**) |

Note: NZ ibuprofen labels are often age-banded rather than weight-based. Healthify says the dose depends on age and sometimes weight. The clinical reviewer should decide whether Calculator mode uses weight, age bands, or both.

Hard warnings (always shown when ibuprofen is selected):
- Do not give for chickenpox unless a doctor has said to (Healthify).
- Check with a doctor first if the child is dehydrated (not drinking, vomiting, diarrhoea), has asthma that worsens with anti-inflammatories, or has kidney problems (**VERIFY** wording).

### 5.4 Giving both paracetamol and ibuprofen
Healthify says it is okay to give both, with care not to give too much of either. KidsHealth guidance on routinely alternating should be checked (**VERIFY**). The app tracks each ingredient independently, shows both on the child's card, and never suggests an alternating schedule unless the parent has set one up on a doctor's advice.

### 5.5 Rules as data
Rules live in a versioned JSON file, never in UI code:

```json
{
  "rulesVersion": "2026.10.0",
  "reviewedBy": null,
  "reviewedAt": null,
  "ingredients": {
    "paracetamol": {
      "mgPerKg": 15,
      "minIntervalMinutes": 240,
      "maxDosesPer24h": 4,
      "maxMgPerKgPer24h": 60,
      "maxSingleMg": 1000,
      "maxMgPer24h": 4000,
      "minAgeDays": 90,
      "sources": [
        { "name": "KidsHealth NZ", "url": "https://www.kidshealth.org.nz/safe-use-of-paracetamol-in-children", "checkedAt": "2026-09-28" },
        { "name": "bpacnz", "url": "https://bpac.org.nz/2018/paracetamol.aspx", "checkedAt": "2026-09-28" }
      ]
    }
  }
}
```

The app refuses to enable Calculator mode for an ingredient whose `reviewedBy` is null.

### 5.6 Products
Seed list (**VERIFY** every product and strength against Medsafe before release; brands change and temporary strengths appear during supply shortages):

| Product | Ingredient | Strength |
|---|---|---|
| Pamol oral suspension | Paracetamol | 250 mg / 5 mL |
| Paracetamol liquid (various brands) | Paracetamol | 120 mg / 5 mL |
| Paracetamol liquid (various brands) | Paracetamol | 250 mg / 5 mL |
| Nurofen for Children | Ibuprofen | 100 mg / 5 mL |
| Fenpaed | Ibuprofen | 100 mg / 5 mL |
| Ibuprofen liquid (various) | Ibuprofen | 200 mg / 5 mL |
| Tablets, chewables | Either | Per product |

Requirements:
- Product list is downloadable and updatable without an app release (signed JSON from a static host, bundled fallback).
- Parent adds "My bottles" (their actual products) once; the give-dose flow only shows their bottles.
- Custom product: parent enters ingredient and strength, must type the strength twice and confirm against a photo of the label. Show a strong warning that strength must be read from the label, not guessed from colour or flavour.
- Phase 2: barcode scan to identify product.

---

## 6. Dosing engine specification

A pure TypeScript module with no UI or platform dependencies. It is the heart of the app and must have near-100% test coverage.

### 6.1 Inputs
- `child`: id, date of birth, weight (kg), weight recorded at.
- `product`: ingredient, strength (mg per mL or mg per unit), form.
- `doseHistory`: all doses for this child in the last 48 hours, across all products.
- `now`: timestamp (injected, never read from the system clock inside the engine).
- `rules`: the rules object.
- `mode`: `tracker` or `calculator`.
- `enteredDoseMg` (tracker mode only).

### 6.2 Outputs
```ts
type DoseCheck = {
  status: 'OK' | 'TOO_SOON' | 'DAILY_LIMIT_REACHED' | 'EXCEEDS_LIMIT' | 'BLOCKED';
  blockReason?: 'UNDER_MIN_AGE' | 'WEIGHT_MISSING' | 'WEIGHT_STALE' | 'RULES_NOT_REVIEWED' | 'DURATION_EXCEEDED';
  recommendedMg?: number;        // calculator mode only
  recommendedMl?: number;        // calculator mode only, rounded DOWN to syringe step
  nextAllowedAt: number | null;  // UTC ms
  dosesInLast24h: number;
  mgInLast24h: number;
  remainingMgIn24h: number;
  lastDose?: DoseRecord;
  warnings: WarningCode[];
};
```

### 6.3 Next allowed time
`nextAllowedAt` is the latest of:
1. Last dose time plus minimum interval.
2. If dose count in the rolling 24 h window is at the maximum: the time the oldest dose in the window drops out.
3. If the next dose would push total mg over the 24 h limit: the earliest time enough earlier doses drop out of the window.

### 6.4 Rounding
- Syringe step: 0.5 mL for doses of 5 mL and above, 0.1 mL below (**VERIFY** with reviewer; depends on syringes supplied in NZ).
- Always round down. Recalculate mg from the rounded mL and store both.

### 6.5 Weight staleness
Warn (not block) if weight was recorded more than 3 months ago for children over 1 year, or more than 1 month ago for children under 1 year (**VERIFY** thresholds). Block Calculator mode if weight is missing.

### 6.6 Required tests
- Table-driven tests for every rule, for weights from 5 kg to 80 kg.
- Property-based tests (fast-check): for any random history and weight, the engine never returns a recommendation that would exceed any per-dose or 24 h limit.
- Boundary tests: exactly at 4 h, one minute before, the 24 h rollover, the 65 kg adult cap, 3 months minus one day.
- Daylight saving tests: NZ DST changes (last Sunday of September, first Sunday of April). All maths uses UTC ms, so a dose at 1:30am before the change must still allow the next dose exactly 4 real hours later.
- Combination products count toward ingredient totals.
- Doses logged by two caregivers within minutes of each other are both counted.

---

## 7. Features

### 7.1 MVP (Tracker mode)
1. **Onboarding:** plain-language explanation of what the app does and does not do; disclaimer acceptance; emergency numbers; notification permission request with a clear reason.
2. **Children:** add, edit, archive. Name, avatar/colour, date of birth, weight with date. Optional notes (allergies, doctor's instructions).
3. **My bottles:** add products from the list or custom.
4. **Give a dose:** child → bottle → dose amount → confirm → logged. Shows mL clearly with a syringe graphic.
5. **Safety checks:** too-soon screen, 24 h limit screen, age block, warnings. Parent can override "too soon" only by confirming a doctor told them to, and the override is recorded.
6. **Home screen:** a card per child showing each active medicine's status.
7. **Timeline:** per child, all doses with time, amount, who gave it. Edit/delete with confirmation and an audit trail.
8. **Reminders:** after logging, offer "Remind me when the next dose is allowed" or "Remind me at a set time (doctor's schedule)". Preset buttons: 4 h, 6 h, 8 h, custom.
9. **Backdating:** "I gave it earlier" time picker, limited to the last 24 hours (the length of the rolling limit window; widened from 12 hours, 2026-09-29).
10. **Help and red flags:** when to call Healthline 0800 611 116, when to call 111, Poisons Centre 0800 764 766 (0800 POISON). One tap to call from anywhere in the app.
11. **Sources screen:** every rule and piece of advice with its source and date checked.

### 7.2 Phase 2
- **Family sharing:** invite other caregivers by link; live sync; every dose shows who gave it; alert everyone if two doses are logged close together.
- **Calculator mode** (with partner and clinical sign-off).
- **Temperature and symptom log** (temperature, drinking, wet nappies, rash, breathing, notes).
- **Share a summary** as a PDF or text for a GP visit or Healthline call.
- **Prescribed medicines:** antibiotic courses with schedule and "course complete".
- **Home screen and lock screen widgets** (native modules).
- **Barcode scanning** of products.
- **Te reo Māori** and other language options.
- **Illness episodes:** group doses into "Tama's cold, Oct 2026" and show "paracetamol for 2 days; see a doctor if still needed" prompts.

### 7.3 Explicitly not doing
- Diagnosing illness or advising whether a child needs medicine.
- Suggesting a re-dose if a child vomits or spits out a dose (show "ask your pharmacist or Healthline").
- Adult dosing.
- Ads, or selling data.

---

## 8. Screens and UX

### 8.1 Design principles
- **3am-proof:** dark theme by default at night, minimum 56 pt tap targets, large type, respects system font size.
- **One primary action per screen.**
- **Status never by colour alone:** always colour + icon + words.
- **Confirmation before anything is logged.** Nothing logs from a single accidental tap. Undo available for 2 minutes after logging.
- **Plain language,** no medical jargon. Warm, calm tone. "Next dose from 2:15pm" not "Contraindicated until 14:15".

### 8.2 Home screen: child card states
| State | Display |
|---|---|
| No doses in 24 h | Grey: "No paracetamol in the last 24 hours" |
| Can give | Green tick: "Paracetamol can be given now. Last: 6:10am (4 h 20 m ago)" |
| Too soon | Amber clock: "Next paracetamol from 2:15pm (in 1 h 5 m)" with countdown ring |
| Daily limit | Red stop: "24-hour limit reached (4 doses). Next from 9:40am tomorrow" |
| Blocked | Red: "Under 3 months: please see a doctor" |

### 8.3 Screen list
1. Welcome and disclaimer
2. Emergency numbers
3. Add first child
4. Add first bottle
5. Home (child cards)
6. Give dose: pick child (skipped if one child)
7. Give dose: pick bottle
8. Give dose: amount (tracker: enter from label; calculator: shows calculated amount)
9. Give dose: confirm (big syringe graphic, child name, medicine, strength, amount, time)
10. Dose logged + reminder picker
11. Too soon / limit reached / blocked
12. Child detail and timeline
13. Edit dose
14. My bottles
15. Caregivers (phase 2)
16. Settings: notifications, theme, units, data export, delete all data, mode
17. Help and red flags
18. Sources and about

### 8.4 Notifications
- Local notifications scheduled on-device (no server needed for MVP).
- Text: "Mia: next paracetamol allowed from now (last given 2:15pm)". Never say "Give Mia paracetamol now" unless the parent chose a doctor's-schedule reminder.
- Notification action "Log dose" opens the confirm screen; it never logs silently.
- Reschedule or cancel reminders whenever a dose is added, edited, deleted, or synced from another caregiver.
- Handle permission denied: show an in-app banner explaining reminders are off, with a button to settings.
- iOS limits pending local notifications to 64; schedule only the next reminder per child per ingredient.
- Optional follow-up if not acknowledged within 15 minutes (off by default).

---

## 9. Technical architecture

### 9.0 Stack decision (2026-09-28): a PWA, built like Everyday Koine

The app is built as an installable web app, the way Everyday Koine is: plain HTML, CSS and ES modules, no build step, a service worker for offline, and checkers in `tools/`. The table in 9.1 below is the original React Native plan, kept for reference; the mapping is:

| 9.1 said | Built as | Note |
|---|---|---|
| React Native + Expo | Static PWA (`index.html`, `js/`, `css/`) | Installable on Android and iPhone. Android store route later via a Trusted Web Activity, as Koine has. |
| expo-router | Hash routes in `js/app.js` | |
| expo-sqlite + Drizzle | IndexedDB (`js/db.js`), append-only migrations | Soft delete and audit in one transaction. |
| expo-notifications (local) | In-app timers + Web Push via `reminder-worker/` (Cloudflare) | A web app cannot schedule a local notification for when it is closed. The phone encrypts each reminder to itself (RFC 8291) and the worker only holds ciphertext and a time, so rule 11 holds. On iPhone, reminders need the app on the Home Screen (iOS 16.4+). |
| Jest, fast-check | `node --test`, fast-check, fake-indexeddb | |
| TypeScript strict | `// @ts-check` + JSDoc, `tsc --noEmit` | Same checking, no build. |
| ESLint | The checkers in `tools/checks.mjs` | They hold the golden rules directly. |
| Maestro e2e | Walked through in a browser with `?clock=+4h` | An automated browser run is still to do. |
| EAS Build/Submit | GitHub Pages | Apple 1.4.2 does not apply to a website; Medsafe still does (2.2). |

Why: one codebase that runs everywhere with no store review for tracker mode, no Mac or Expo account needed to build it, the same deploy and checker discipline as Koine, and every screen testable on this machine.

### 9.1 Stack
| Area | Choice | Why |
|---|---|---|
| App | React Native with Expo (SDK latest), TypeScript strict | One codebase for iOS and Android; Claude Code handles it well |
| Navigation | expo-router | File-based routing |
| Local database | expo-sqlite with Drizzle ORM | Reliable, offline, typed |
| State | Zustand (UI state) + database as source of truth | Simple |
| Notifications | expo-notifications | Local scheduling |
| Dates | date-fns / date-fns-tz, all storage in UTC ms | Avoid DST bugs |
| Testing | Jest, React Native Testing Library, fast-check; Maestro for end-to-end flows | |
| Lint/format | ESLint, Prettier | |
| CI | GitHub Actions: typecheck, lint, test on every PR | |
| Builds | EAS Build and EAS Submit | TestFlight and Play internal testing |
| Phase 2 sync | Supabase (Postgres + row-level security + realtime), Sydney region | Closest region to NZ; family-scoped access |

### 9.2 Repo structure
```
dose-assist/
  app/                    # expo-router screens
  src/
    engine/               # PURE dosing engine, no React, no platform imports
      rules/
        rules.json
        products.json
      checkDose.ts
      nextAllowed.ts
      rounding.ts
      types.ts
      __tests__/
    db/                   # schema, migrations, repositories
    features/
      children/
      bottles/
      doses/
      reminders/
      safety/
    components/           # shared UI
    content/              # guidance text with source references
    theme/
  e2e/                    # Maestro flows
  docs/
    clinical-review/      # reviewer sign-off records
  CLAUDE.md
  PLAN.md
```

### 9.3 Data model
```ts
Child {
  id: string; name: string; colour: string; avatar?: string;
  dateOfBirth: string;        // ISO date
  notes?: string; archivedAt?: number;
}

WeightRecord { id; childId; kg: number; recordedAt: number; }

Bottle {
  id; ingredient: 'paracetamol' | 'ibuprofen' | string;
  productId?: string;         // from products.json
  customName?: string;
  strengthMg: number; strengthPerMl?: number; form: 'liquid' | 'tablet' | 'chewable';
  addedAt: number; archivedAt?: number;
}

DoseRecord {
  id; childId; bottleId;
  ingredient: string;
  givenAt: number;            // UTC ms, when given
  loggedAt: number;           // UTC ms, when recorded
  mg: number; ml?: number;
  givenBy: string;            // caregiver id or name
  weightKgUsed?: number;
  rulesVersion: string;
  overrideReason?: 'DOCTOR_ADVISED';
  deletedAt?: number;         // soft delete
}

DoseAudit { id; doseId; action: 'create' | 'edit' | 'delete'; before?: json; after?: json; at: number; by: string; }

Reminder { id; childId; ingredient; fireAt: number; kind: 'next_allowed' | 'scheduled'; notificationId: string; }
```

---

## 10. Privacy and security

- **Local-first:** MVP stores everything on the device. No account, no server, no analytics containing health data.
- Comply with the NZ Privacy Act 2020 and the Health Information Privacy Code 2020 (children's health information is sensitive).
- Optional app lock (Face ID / fingerprint / PIN).
- Export all data (JSON and readable PDF) and delete all data from settings.
- Phase 2 sync: encrypt in transit, row-level security scoped to a family, clear consent before first upload, Australian region hosting disclosed in the privacy policy.
- Crash reporting (if any) must strip names and health data.
- Privacy policy and terms written in plain language before beta.

---

## 11. Safety content and disclaimers

- First-run disclaimer: the app is a record-keeping aid, not medical advice; always follow the product label and your doctor or pharmacist; if unsure, call Healthline.
- Persistent footer link: "Unsure? Call Healthline 0800 611 116. Emergency 111."
- Red-flag list (from KidsHealth "when to seek help" content, **VERIFY** and licence): e.g. baby under 3 months with fever, difficulty breathing, floppy or hard to wake, not drinking, fewer wet nappies, rash that does not fade when pressed, seizure.
- Overdose: if a child may have had too much, call the Poisons Centre on 0800 764 766 immediately, even if they seem well.
- Storage reminder: keep medicines up high and out of sight of tamariki.

---

## 12. Milestones

Work through these in order. Each milestone ends with a PR, passing CI, and a human review.

### M0: Project setup
- Expo TypeScript app, expo-router, ESLint, Prettier, Jest, GitHub Actions CI.
- `CLAUDE.md` in place.
- **Done when:** app runs on a simulator, CI passes on a trivial test.

### M1: Dosing engine (no UI)
- `src/engine` with types, rules.json, products.json, checkDose, nextAllowed, rounding.
- Full test suite from section 6.6.
- **Done when:** all tests pass, coverage above 95% for `src/engine`, engine has zero React/Expo imports.

### M2: Data layer
- SQLite schema, migrations, repositories for children, weights, bottles, doses, audit, reminders.
- **Done when:** repository tests pass; data survives app restart.

### M3: Core flows (Tracker mode)
- Onboarding, add child, add bottle, home cards, give-dose flow, confirm, too-soon/limit/blocked screens, timeline, edit/delete with audit, undo, backdating.
- **Done when:** Maestro e2e covers: add child → add bottle → give dose → see "too soon" → wait (mock clock) → "can give".

### M4: Reminders
- Reminder picker after logging, scheduling, rescheduling on edit/delete, permission handling.
- **Done when:** notifications fire at correct times on real iOS and Android devices, including across a DST change (test with device clock).

### M5: Safety content
- Help, red flags, emergency call buttons, sources screen, disclaimers.
- **Done when:** every guidance string links to a source entry.

### M6: Polish and accessibility
- Dark mode, dynamic type, screen reader labels, haptics on confirm, empty states, error states.
- **Done when:** VoiceOver and TalkBack can complete the give-dose flow; passes a contrast check.

### M7: Clinical review and beta
- Pharmacist/paediatrician reviews rules.json, products.json and all content; record sign-off in `docs/clinical-review/`.
- Check Medsafe position; privacy policy; TestFlight and Play internal testing with 10 to 20 NZ families.
- **Done when:** reviewer sign-off recorded, beta feedback triaged.

### Phase 2
Family sync → temperature log → shareable summary → Calculator mode (with partner) → widgets → prescribed medicines → barcode scan → languages.

---

## 13. Testing with real parents

- Test at night-like conditions: dim room, one hand, a time limit.
- Tasks: "Log that you just gave Mia 5 mL of Pamol", "Can you give Leo ibuprofen now?", "Your partner gave a dose an hour ago; check it".
- Measure: time to complete, errors, hesitation, whether anyone logs the wrong child or wrong bottle.

---

## 14. Open questions

1. Which organisation could partner for Calculator mode (pharmacy chain, Health NZ, a university paediatrics department, KidsHealth/Healthify)?
2. Ibuprofen: weight-based or age-band dosing in Calculator mode?
3. Exact syringe steps and weight-staleness thresholds (clinical reviewer).
4. Wording and licensing of red-flag content.
5. Monetisation: free, one-off purchase, or free with paid family sync? (No ads.)
6. Medsafe: does Tracker mode or Calculator mode need WAND notification?

---

## 15. How to use this plan with Claude Code

1. Create an empty GitHub repo, add `PLAN.md` and `CLAUDE.md` at the root.
2. Start Claude Code in the repo and say: *"Read PLAN.md and CLAUDE.md. Do milestone M0 only, then stop and summarise what you did."*
3. Review, merge, then: *"Do milestone M1. Write the tests first, then the engine. Stop when all tests pass."*
4. Continue one milestone at a time. Review every change to `src/engine` and `rules.json` yourself.
5. Keep a `CHANGELOG.md` and bump `rulesVersion` whenever rules change.
