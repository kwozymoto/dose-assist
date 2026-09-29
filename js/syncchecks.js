// @ts-check
/* Checks that only matter once two phones share a record. Pure; tested in
   tests/syncfix.test.mjs.

   doubleDoses: the same medicine given to the same child by two different
   people (or phones) closer together than the rules' minimum gap. Each
   phone's stop screens stop its own parent; this catches the case where both
   gave at nearly the same moment, before either phone had heard from the other.

   duplicateChildren: the same child set up on both phones before linking. */

/** @typedef {import('./engine/types.js').Rules} Rules */

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * @param {Array<{id: string, childId: string, givenAt: number, givenBy?: string, _d?: string, deletedAt?: number | null, components: {ingredient: string, mg: number}[]}>} doses
 * @param {Rules} rules
 * @param {number} now
 * @returns {{childId: string, ingredient: string, ids: [string, string], gapMs: number, first: number, second: number, by: [string, string]}[]}
 */
export function doubleDoses(doses, rules, now) {
  const live = doses.filter((d) => !d.deletedAt && d.givenAt > now - DAY_MS && d.givenAt <= now).sort((a, b) => a.givenAt - b.givenAt);
  /** @type {ReturnType<typeof doubleDoses>} */
  const out = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      if (a.childId !== b.childId) continue;
      const samePerson = (a._d && b._d ? a._d === b._d : true) && (a.givenBy ?? '') === (b.givenBy ?? '');
      if (samePerson) continue;
      for (const ca of a.components) {
        const rule = Object.hasOwn(rules.ingredients, ca.ingredient) ? rules.ingredients[ca.ingredient] : undefined;
        if (!rule || !b.components.some((cb) => cb.ingredient === ca.ingredient)) continue;
        const gap = b.givenAt - a.givenAt;
        if (gap < rule.minIntervalMinutes * MINUTE_MS && !out.some((o) => o.ids[0] === a.id && o.ids[1] === b.id && o.ingredient === ca.ingredient)) {
          out.push({ childId: a.childId, ingredient: ca.ingredient, ids: [a.id, b.id], gapMs: gap, first: a.givenAt, second: b.givenAt, by: [a.givenBy ?? '', b.givenBy ?? ''] });
        }
      }
    }
  }
  return out;
}

/**
 * Medicines that are the same medicine, entered on both phones before
 * linking: same product (or name), form and strengths. Keeps the lowest id,
 * so both phones pick the same one.
 * @param {Array<{id: string, productId: string | null, name: string, form: string, components: {ingredient: string, strengthMg: number, strengthPer: number}[], archivedAt?: number | null}>} bottles
 * @returns {{keep: string, merge: string[]}[]}
 */
export function duplicateBottles(bottles) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const b of bottles) {
    if (b.archivedAt) continue;
    const strengths = b.components.map((c) => `${c.ingredient}:${c.strengthMg}/${c.strengthPer}`).sort().join('+');
    const k = `${b.productId ?? b.name.trim().toLowerCase()}|${b.form}|${strengths}`;
    groups.set(k, [...(groups.get(k) ?? []), b.id]);
  }
  const out = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    out.push({ keep: sorted[0], merge: sorted.slice(1) });
  }
  return out;
}

/**
 * Children that are the same child: same name (ignoring case and spaces at
 * the ends) and same date of birth. Keeps the lowest id, so both phones pick
 * the same one.
 * @param {Array<{id: string, name: string, dateOfBirth: string | null, archivedAt?: number | null}>} children
 * @returns {{keep: string, merge: string[]}[]}
 */
export function duplicateChildren(children) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const c of children) {
    if (c.archivedAt || !c.dateOfBirth) continue;
    const k = `${c.name.trim().toLowerCase()}|${c.dateOfBirth}`;
    groups.set(k, [...(groups.get(k) ?? []), c.id]);
  }
  const out = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    out.push({ keep: sorted[0], merge: sorted.slice(1) });
  }
  return out;
}
