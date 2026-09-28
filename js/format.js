// @ts-check
/* Display formatting. All times are stored and computed in UTC ms; this is
   the one place they become words, always in the device's own time zone
   (passed in, so tests can pin Pacific/Auckland).

   House style (CLAUDE.md): plain NZ English, 12-hour clock, lower-case am/pm
   with no space: "Next dose from 2:15pm". */

import { MINUTE_MS, HOUR_MS, DAY_MS } from './engine/time.js';

/** @type {Map<string, Intl.DateTimeFormat>} */
const cache = new Map();
/** @param {string} timeZone @param {Intl.DateTimeFormatOptions} opts */
function fmt(timeZone, opts) {
  const key = timeZone + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-NZ', { timeZone, ...opts });
    cache.set(key, f);
  }
  return f;
}

/** @param {number} ms @param {string} timeZone */
function parts(ms, timeZone) {
  const p = fmt(timeZone, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(ms);
  /** @param {string} t */
  const get = (t) => p.find((x) => x.type === t)?.value ?? '';
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), h: Number(get('hour')), min: Number(get('minute')), wd: get('weekday') };
}

/** "2:15pm", "12:05am". @param {number} ms @param {string} timeZone */
export function formatTime(ms, timeZone) {
  const { h, min } = parts(ms, timeZone);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** Local calendar day number, for comparing days across DST. @param {number} ms @param {string} timeZone */
function dayNumber(ms, timeZone) {
  const { y, m, d } = parts(ms, timeZone);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 14 Oct". @param {number} ms @param {string} timeZone */
export function formatDate(ms, timeZone) {
  const { m, d, wd } = parts(ms, timeZone);
  return `${wd} ${d} ${MONTHS[m - 1]}`;
}

/**
 * A time relative to today: "2:15pm", "9:40am tomorrow", "11:10pm yesterday",
 * otherwise "Tue 14 Oct, 2:15pm".
 * @param {number} ms @param {number} now @param {string} timeZone
 */
export function formatWhen(ms, now, timeZone) {
  const diff = dayNumber(ms, timeZone) - dayNumber(now, timeZone);
  const t = formatTime(ms, timeZone);
  if (diff === 0) return t;
  if (diff === 1) return `${t} tomorrow`;
  if (diff === -1) return `${t} yesterday`;
  return `${formatDate(ms, timeZone)}, ${t}`;
}

/**
 * "1 h 5 m", "45 m", "2 d 3 h".
 * `up` rounds to the next whole minute, for countdowns: a wait is never
 * shown as shorter than it is, and never as "0 m" while it is still running.
 * @param {number} ms @param {{up?: boolean}} [opts]
 */
export function formatDuration(ms, opts = {}) {
  const total = Math.max(0, opts.up ? Math.ceil(ms / MINUTE_MS) : Math.floor(ms / MINUTE_MS));
  if (total < 1) return opts.up ? '1 m' : 'less than a minute';
  const d = Math.floor(total / (24 * 60));
  const h = Math.floor((total % (24 * 60)) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} m` : `${h} h`;
  return `${m} m`;
}

/** "4 h 20 m ago". @param {number} ms @param {number} now */
export function formatAgo(ms, now) {
  if (ms > now) return `in ${formatDuration(ms - now, { up: true })}`;
  const s = formatDuration(now - ms);
  return s === 'less than a minute' ? 'just now' : `${s} ago`;
}

/** Plain-language interval from a rule's minutes: 240 -> "4 hours", 90 -> "1 h 30 m". @param {number} minutes */
export function formatInterval(minutes) {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return formatDuration(minutes * MINUTE_MS);
}

/** Minimum age from a rule's days: 90 -> "3 months", 14 -> "14 days". @param {number} days */
export function formatAgeDays(days) {
  if (days >= 60 && days % 30 === 0) return `${days / 30} months`;
  return days === 1 ? '1 day' : `${days} days`;
}

/** "250 mg", "1,000 mg", "37.5 mg". @param {number} mg */
export function formatMg(mg) {
  return `${mg.toLocaleString('en-NZ', { maximumFractionDigits: 3 })} mg`;
}

/** "5 mL", "7.5 mL", "1 tablet", "0.5 tablets". @param {number} amount @param {string} form */
export function formatAmount(amount, form) {
  const n = amount.toLocaleString('en-NZ', { maximumFractionDigits: 2 });
  if (form === 'liquid') return `${n} mL`;
  return `${n} ${amount === 1 ? 'tablet' : 'tablets'}`;
}

/** "250 mg / 5 mL", "500 mg tablet". @param {{strengthMg: number, strengthPer: number}} c @param {string} form */
export function formatStrength(c, form) {
  if (form === 'liquid') return `${formatMg(c.strengthMg)} / ${c.strengthPer.toLocaleString('en-NZ')} mL`;
  return `${formatMg(c.strengthMg)} ${form === 'chewable' ? 'chewable' : 'tablet'}`;
}

/** Local value for <input type="datetime-local">. @param {number} ms @param {string} timeZone */
export function toLocalInput(ms, timeZone) {
  const { y, m, d, h, min } = parts(ms, timeZone);
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}T${p(h)}:${p(min)}`;
}

/**
 * Parse <input type="datetime-local"> in `timeZone` back to UTC ms.
 *
 * Two local times are not one instant. At fall-back, 2:30am happens twice;
 * in the hour skipped at spring-forward it never happens. Both resolve to
 * the LATER possible instant: a dose time read that way can only make the
 * dose look more recent, so it can only make the next one wait longer.
 * @param {string} value @param {string} timeZone
 * @returns {number | null}
 */
export function fromLocalInput(value, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = [offsetAt(wall - 14 * HOUR_MS, timeZone), offsetAt(wall + 14 * HOUR_MS, timeZone)];
  const candidates = [...new Set(offsets)].map((off) => wall - off).sort((a, b) => b - a);
  for (const c of candidates) if (toLocalInput(c, timeZone) === value) return c;
  return candidates[0];
}

/** Offset of `timeZone` from UTC at an instant, in ms. @param {number} ms @param {string} timeZone */
function offsetAt(ms, timeZone) {
  const { y, m, d, h, min } = parts(ms, timeZone);
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  return asUtc - Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}
