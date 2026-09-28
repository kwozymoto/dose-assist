/* Test fixtures for the engine.

   The numbers here are test data, deliberately NOT the shipped rules: the
   logic tests must not change meaning when data/rules.json is revised. The
   tests that exercise data/rules.json itself live in rules-data.test.mjs and
   read every number from the file. */

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const TZ = 'Pacific/Auckland';

/* A fixed instant: 2026-10-14 12:00 NZDT. */
export const NOW = Date.UTC(2026, 9, 13, 23, 0, 0);

export const RULES = {
  rulesVersion: 'test.1',
  reviewedBy: 'Test Reviewer',
  reviewedAt: '2026-01-01',
  ingredients: {
    alpha: {
      minIntervalMinutes: 240,
      maxDosesPer24h: 4,
      maxSingleMg: 1000,
      maxMgPer24h: 4000,
      minAgeDays: 90,
      seekAdviceAfterHours: 48,
      sources: [{ name: 't', url: 'https://example.test', checkedAt: '2026-01-01' }],
    },
    beta: {
      minIntervalMinutes: 360,
      maxDosesPer24h: 3,
      maxSingleMg: 400,
      maxMgPer24h: 1200,
      minAgeDays: 90,
      sources: [{ name: 't', url: 'https://example.test', checkedAt: '2026-01-01' }],
    },
  },
};

export const CHILD = { id: 'c1', dateOfBirth: '2022-03-01' };

let seq = 0;
/** A dose of one ingredient, `ago` ms before NOW. */
export function dose(ingredient, mg, ago, extra = {}) {
  seq += 1;
  return {
    id: `d${seq}`,
    givenAt: NOW - ago,
    components: [{ ingredient, mg }],
    ...extra,
  };
}

/** Base input for checkIngredient. */
export function input(over = {}) {
  return {
    ingredient: 'alpha',
    rules: RULES,
    history: [],
    now: NOW,
    child: CHILD,
    timeZone: TZ,
    ...over,
  };
}
