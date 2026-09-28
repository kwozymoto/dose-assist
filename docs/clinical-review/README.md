# Clinical review

Nothing in Whendose may be released to the public until a NZ-registered pharmacist or paediatrician has reviewed the items below and signed off here (PLAN.md M7). Record each sign-off as a dated file in this folder, then set `reviewedBy` and `reviewedAt` in `data/rules.json` (and `data/products.json`) in the same commit.

## What the reviewer checks

1. **`data/rules.json`**: every value for paracetamol and ibuprofen that tracker mode uses: minimum interval, maximum doses in 24 hours, maximum single dose, maximum mg in 24 hours, minimum age, and (paracetamol) the "see a doctor if still needed after" time. The file's `reviewNotes` list the open questions. The main ones:
   - Ibuprofen: Healthify's 2026 pages say 6 to 8 hours apart, no more than 3 doses in 24 hours; its 2022 page allows up to 4 doses (4 hours apart). The app uses 6 hours and 3 doses.
   - Ibuprofen 24-hour mg maxima (1200 mg, 30 mg/kg) are 3 × the per-dose maxima; no source states them directly.
   - Ibuprofen minimum weight (5 kg) has no source. Tracker mode does not use it.
   - Whether ibuprofen should also carry a "see a doctor after 2 days" warning (Healthify's ibuprofen page says so; `seekAdviceAfterHours` is not set for ibuprofen).
   - The NZ Formulary for Children was not consulted: its site needs its licence accepted.
2. **`data/products.json`**: brand names and strengths against Medsafe (Pamol, Nurofen for Children, Fenpaed are marked unverified).
3. **`js/content/guidance.js`**: every piece of advice the app shows, and the two entries marked `verify`.
4. **Behaviour decisions** that touch safety (see CHANGELOG 0.1.0):
   - No stop screen can be overridden (the "a doctor told me" override was removed on the owner's decision, 2026-09-29). A parent following a doctor's own schedule uses set-time reminders.
   - Any stop screen can record a dose that has already been given, so the record stays true; it then shows the Poisons Centre.
   - Weight (`js/engine/weight.js`, added 2026-09-29): when a weight is recorded, one dose over `mgPerKg` is a caution; the 24-hour total over `maxMgPerKgPer24h` is a stop, but only when that value is not in `unverified` and the weight is under 6 months old (`WEIGHT_FRESH_MS`); otherwise a caution. So today paracetamol (60 mg/kg, bpacnz) can stop a dose and ibuprofen (30 mg/kg, unverified) only cautions. Check that `mgPerKg` (15 and 10) is the right caution line, given that label doses go by age band.
   - Backdating is limited to 24 hours (was 12), the same as the limit window; a dose's time can be edited to no earlier than 24 hours before it was logged. An ambiguous or impossible local time at a DST change is read as the later instant.

## Sign-offs

None yet.
