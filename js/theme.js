// @ts-check
/* Theme. "Auto" (the default) goes by the clock: dark from 7pm to 7am,
   whatever the phone is set to, because the app is used at 3am (PLAN.md
   8.1), and light by day. "Same as my phone" follows the phone. */

import * as db from './db.js';
import { now } from './clock.js';

/** @typedef {'auto' | 'system' | 'light' | 'dark'} ThemeChoice */

export const THEME_CHOICES = /** @type {const} */ ([
  { id: 'auto', name: 'Auto: dark at night (7pm to 7am)' },
  { id: 'system', name: 'Same as my phone' },
  { id: 'light', name: 'Always light' },
  { id: 'dark', name: 'Always dark' },
]);

/** @param {ThemeChoice} choice @param {number} at @param {boolean} systemDark */
export function resolveTheme(choice, at, systemDark) {
  if (choice === 'light' || choice === 'dark') return choice;
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  const hour = new Date(at).getHours();
  return hour >= 19 || hour < 7 ? 'dark' : 'light';
}

/** @type {ReturnType<typeof setInterval> | undefined} */
let timer;

export async function applyTheme() {
  /** @type {ThemeChoice} */
  const choice = await db.meta.get('theme', 'auto');
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const set = () => {
    const t = resolveTheme(choice, now(), mq.matches);
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0f1230' : '#edf1ff');
  };
  set();
  mq.onchange = set;
  clearInterval(timer);
  timer = setInterval(set, 5 * 60 * 1000);
}
