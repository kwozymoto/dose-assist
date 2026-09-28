// @ts-check
/* The app's one clock. Everything outside js/engine asks this for the time,
   and passes it in to the engine.

   For testing only, the clock can be moved forward: add ?clock=+4h (or
   +90m, -1d) to the URL. The offset is kept for the session so the
   "too soon, then wait, then can give" flow can be walked through without
   waiting four hours. The app shows a banner whenever it is set. */

const KEY = 'da.clockOffsetMs';

function readOffset() {
  try {
    const q = new URLSearchParams(location.search).get('clock');
    if (q !== null) {
      const ms = parseOffset(q);
      if (ms === 0) sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, String(ms));
      return ms;
    }
    return Number(sessionStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** "+4h" -> 14400000. @param {string} s */
export function parseOffset(s) {
  const m = /^([+-]?)(\d+(?:\.\d+)?)([mhd])$/.exec(s.trim());
  if (!m) return 0;
  const unit = { m: 60e3, h: 3600e3, d: 86400e3 }[/** @type {'m'|'h'|'d'} */ (m[3])];
  return (m[1] === '-' ? -1 : 1) * Number(m[2]) * unit;
}

let offset = typeof location === 'undefined' ? 0 : readOffset();

export const now = () => Date.now() + offset;
export const clockOffset = () => offset;
/** @param {number} ms */
export function setClockOffset(ms) {
  offset = ms;
  try {
    if (ms === 0) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(ms));
  } catch { /* private mode */ }
}

/** The device's own time zone, for the engine's calendar and for display. */
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Pacific/Auckland';
