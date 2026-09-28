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
   - "Too soon" can be overridden only by saying a doctor advised it; the 24-hour limit and the age limit cannot.
   - Any stop screen can record a dose that has already been given, so the record stays true; it then shows the Poisons Centre.
   - Tracker mode does not use weight at all (no mg/kg limit is checked). This keeps it a record-keeping aid rather than a dose calculator, but it means a 24-hour mg/kg limit is not enforced for a small child. Decide whether that is acceptable.
   - Backdating is limited to 12 hours. An ambiguous or impossible local time at a DST change is read as the later instant.

## Sign-offs

None yet.
