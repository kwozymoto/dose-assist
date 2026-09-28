// @ts-check
/* Durations in milliseconds. Units, not rules: no dosing number lives here. */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** mg are kept to three decimal places, so sums compare exactly. */
export function roundMg(/** @type {number} */ mg) {
  return Math.round(mg * 1000) / 1000;
}
