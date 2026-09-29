// @ts-check
import { DAY_MS } from './time.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Days between a date of birth and the local calendar date at `now`.
 *
 * Both are calendar dates in `timeZone`, so a baby born on 16 July is 90
 * days old for the whole of 14 October in New Zealand, whatever the UTC
 * date is and whether or not the clocks changed in between.
 *
 * @param {string} dateOfBirth  YYYY-MM-DD
 * @param {number} now          UTC ms
 * @param {string} timeZone     IANA zone
 * @returns {number}
 */
export function ageInDays(dateOfBirth, now, timeZone) {
  const m = ISO_DATE.exec(dateOfBirth);
  if (!m) throw new TypeError(`dateOfBirth must be YYYY-MM-DD, got ${JSON.stringify(dateOfBirth)}`);
  const born = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(born) || new Date(born).toISOString().slice(0, 10) !== dateOfBirth) {
    throw new TypeError(`dateOfBirth is not a real date: ${dateOfBirth}`);
  }
  const today = localDateUtc(now, timeZone);
  return Math.round((today - born) / DAY_MS);
}

/**
 * The local calendar date at `now` in `timeZone`, as UTC ms of that date's midnight.
 * @param {number} now
 * @param {string} timeZone
 */
function localDateUtc(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  /** @param {string} type */
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

/** The app is for children: older than this, adult doses apply. */
export const MAX_AGE_DAYS = 18 * 365 + 4;

/**
 * Is this weight far from what is usual at this age? A rough, generous band
 * (half to double a typical weight) to catch typing slips such as 145 for
 * 14.5, or grams for kilograms. Not a growth chart; the parent can confirm.
 * @param {number} kg @param {number} ageDays
 * @returns {boolean}
 */
export function weightLooksOdd(kg, ageDays) {
  const y = Math.max(0, ageDays) / 365.25;
  const typical = y < 1 ? 3.5 + 6.5 * y : y <= 10 ? 8 + 2 * y : 28 + 3 * (y - 10);
  return kg < typical * 0.5 || kg > typical * 2;
}
