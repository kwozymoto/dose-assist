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
