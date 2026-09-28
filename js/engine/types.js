// @ts-check
/* Types shared by the engine. JSDoc only; this module exports nothing at
   runtime. `npm run typecheck` holds js/engine to them under strict mode.

   The engine is pure: no DOM, no storage, no network, no system clock.
   `now` is always passed in, in UTC milliseconds. tools/check_engine.mjs
   enforces that mechanically. */

/**
 * @typedef {'OK' | 'TOO_SOON' | 'DAILY_LIMIT_REACHED' | 'EXCEEDS_LIMIT' | 'BLOCKED'} DoseStatus
 *
 * @typedef {'UNDER_MIN_AGE'} BlockReason
 *
 * SINGLE_DOSE: the amount is over the single-dose maximum. Never allowed.
 * OVER_DAILY_MAX: the amount alone is over the 24-hour maximum. Never allowed.
 * WOULD_EXCEED_24H: with what was already given, the 24-hour total would go
 *   over. Allowed once enough earlier doses leave the window.
 * @typedef {'SINGLE_DOSE' | 'OVER_DAILY_MAX' | 'WOULD_EXCEED_24H'} ExceedReason
 *
 * @typedef {'RULES_NOT_REVIEWED' | 'RULE_UNVERIFIED' | 'NO_RULES_FOR_INGREDIENT'
 *   | 'AGE_UNKNOWN' | 'LONG_USE' | 'DOSE_IN_FUTURE'} WarningCode
 */

/**
 * @typedef {object} Source
 * @property {string} name
 * @property {string | null} url
 * @property {string | null} checkedAt  ISO date
 *
 * @typedef {object} IngredientRule
 * @property {number} minIntervalMinutes
 * @property {number} maxDosesPer24h
 * @property {number} maxSingleMg
 * @property {number} maxMgPer24h
 * @property {number} minAgeDays
 * @property {number} [seekAdviceAfterHours]
 * @property {number} [mgPerKg]            calculator mode only; unused here
 * @property {number} [maxMgPerKgPer24h]   calculator mode only; unused here
 * @property {number} [minWeightKg]        calculator mode only; unused here
 * @property {string[]} [unverified]       fields not yet confirmed against a source
 * @property {Source[]} sources
 *
 * @typedef {object} Rules
 * @property {string} rulesVersion
 * @property {string | null} reviewedBy
 * @property {string | null} reviewedAt
 * @property {Record<string, IngredientRule>} ingredients
 */

/**
 * @typedef {object} Component
 * @property {string} ingredient
 * @property {number} mg
 *
 * A dose as the engine sees it. The stored record carries much more (who
 * gave it, the bottle snapshot); the engine needs only this.
 * @typedef {object} DoseEvent
 * @property {string} id
 * @property {number} givenAt   UTC ms
 * @property {Component[]} components
 * @property {number | null} [deletedAt]
 *
 * @typedef {object} ChildInput
 * @property {string} id
 * @property {string | null} [dateOfBirth]  ISO date, YYYY-MM-DD, in the child's own calendar
 */

/**
 * @typedef {object} LastDose
 * @property {string} doseId
 * @property {number} givenAt
 * @property {number} mg
 *
 * @typedef {object} DoseCheck
 * @property {DoseStatus} status
 * @property {BlockReason} [blockReason]
 * @property {ExceedReason} [exceedReason]
 * @property {number | null} nextAllowedAt  UTC ms; null when OK now, or when never allowed
 * @property {number} dosesInLast24h
 * @property {number} mgInLast24h
 * @property {number | null} remainingMgIn24h  null when there is no rule
 * @property {LastDose} [lastDose]
 * @property {WarningCode[]} warnings
 *
 * @typedef {object} IngredientInput
 * @property {string} ingredient
 * @property {Rules} rules
 * @property {DoseEvent[]} history
 * @property {number} now
 * @property {ChildInput} child
 * @property {string} timeZone   IANA zone for the child's calendar, e.g. Pacific/Auckland
 * @property {number} [enteredMg]
 *
 * @typedef {object} ProductComponent
 * @property {string} ingredient
 * @property {number} [mg]  omitted for a status-only check
 *
 * @typedef {object} ProductInput
 * @property {ProductComponent[]} components
 * @property {Rules} rules
 * @property {DoseEvent[]} history
 * @property {number} now
 * @property {ChildInput} child
 * @property {string} timeZone
 *
 * @typedef {object} ProductCheck
 * @property {DoseStatus} status
 * @property {BlockReason} [blockReason]
 * @property {number | null} nextAllowedAt
 * @property {Record<string, DoseCheck>} perIngredient
 * @property {WarningCode[]} warnings
 */

/**
 * @typedef {object} BottleComponent
 * @property {string} ingredient
 * @property {number} strengthMg   mg in `strengthPer` units
 * @property {number} strengthPer  mL for a liquid, 1 for a tablet
 *
 * @typedef {object} BottleInput
 * @property {string} form
 * @property {BottleComponent[]} components
 */

export {};
