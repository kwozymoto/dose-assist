/* The checkers. Each golden rule in CLAUDE.md that a machine can hold,
   held here. check_all.mjs runs every one named in CHECKS.

   A checker that only reports is a checker that does not exist: where a
   report has legitimate exceptions, it has an allow-list with a reason
   beside each entry, so anything new in it fails. */

import { read, exists, walk, atHead, stripComments, stringLiterals, result } from './lib.mjs';

/* ------------------------------------------------------------------ */
/* check_engine: js/engine is pure (CLAUDE.md 6, 10).                   */

export function checkEngine() {
  const problems = [];
  const files = walk('js/engine').filter((f) => f.endsWith('.js'));
  if (files.length === 0) problems.push('no files found in js/engine: is the checker looking in the right place?');
  const banned = [
    [/\bDate\.now\s*\(/, 'reads the clock (Date.now): `now` must be passed in'],
    [/\bnew Date\s*\(\s*\)/, 'reads the clock (new Date()): `now` must be passed in'],
    [/\bperformance\.now\b/, 'reads the clock (performance.now)'],
    [/\b(window|document|localStorage|sessionStorage|indexedDB|navigator|location)\b/, 'touches the browser'],
    [/\b(fetch|XMLHttpRequest|WebSocket)\b/, 'touches the network'],
    [/\bMath\.random\b/, 'is not deterministic (Math.random)'],
    [/\bany\b\s*[}>|]/, 'uses the `any` type (CLAUDE.md: no any in src/engine)'],
  ];
  for (const f of files) {
    const src = read(f);
    const code = stripComments(src);
    if (!src.startsWith('// @ts-check')) problems.push(`${f}: must start with // @ts-check`);
    for (const [re, why] of banned) if (re.test(code)) problems.push(`${f} ${why}`);
    // JSDoc types live in comments; check `any` there too.
    if (/@(?:type|param|returns|property|typedef)\s*\{[^}]*\bany\b/.test(src)) problems.push(`${f} uses the \`any\` type in JSDoc`);
    for (const m of code.matchAll(/\bimport\b[^'"]*['"]([^'"]+)['"]/g)) {
      if (!m[1].startsWith('./')) problems.push(`${f} imports ${m[1]}: the engine may import only its own files`);
    }
  }
  return result('check_engine', problems, [`${files.length} engine files: no clock, DOM, storage, network or outside imports`]);
}

/* ------------------------------------------------------------------ */
/* check_rules: rules.json and products.json (CLAUDE.md 1, 2, 12).      */

const RULE_FIELDS = ['minIntervalMinutes', 'maxDosesPer24h', 'maxSingleMg', 'maxMgPer24h', 'minAgeDays'];
const OPTIONAL_FIELDS = ['seekAdviceAfterHours', 'mgPerKg', 'maxMgPerKgPer24h', 'minWeightKg'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function checkRules() {
  const problems = [];
  const notes = [];
  const rules = JSON.parse(read('data/rules.json'));
  if (!/^\d{4}\.\d+\.\d+$/.test(rules.rulesVersion)) problems.push(`rulesVersion ${rules.rulesVersion} is not YYYY.N.N`);
  if ((rules.reviewedBy === null) !== (rules.reviewedAt === null)) problems.push('reviewedBy and reviewedAt must both be set or both be null');
  if (rules.reviewedAt !== null && !ISO.test(rules.reviewedAt)) problems.push('reviewedAt must be YYYY-MM-DD');

  for (const [name, r] of Object.entries(rules.ingredients)) {
    if (name !== name.toLowerCase()) problems.push(`${name}: ingredient keys are lower case`);
    for (const k of RULE_FIELDS) {
      if (typeof r[k] !== 'number' || !(r[k] > 0) || !Number.isFinite(r[k])) problems.push(`${name}.${k} must be a positive number`);
    }
    for (const k of OPTIONAL_FIELDS) {
      if (k in r && (typeof r[k] !== 'number' || !(r[k] > 0))) problems.push(`${name}.${k} must be a positive number if present`);
    }
    if (!Number.isInteger(r.maxDosesPer24h)) problems.push(`${name}.maxDosesPer24h must be a whole number`);
    if (r.maxSingleMg > r.maxMgPer24h) problems.push(`${name}: maxSingleMg is more than maxMgPer24h`);
    if (!Array.isArray(r.sources) || r.sources.length === 0) problems.push(`${name}: no sources`);
    const unverified = new Set(r.unverified ?? []);
    const supported = new Set();
    for (const s of r.sources ?? []) {
      if (!s.name) problems.push(`${name}: a source has no name`);
      if (s.url !== null && !/^https:\/\//.test(s.url)) problems.push(`${name}: source url must be https or null: ${s.url}`);
      if (s.url && !(s.checkedAt && ISO.test(s.checkedAt))) problems.push(`${name}: source ${s.name} has a url but no checkedAt date`);
      for (const f of s.supports ?? []) supported.add(f);
    }
    // Every value is either backed by a named source or declared unverified.
    for (const k of [...RULE_FIELDS, ...OPTIONAL_FIELDS]) {
      if (!(k in r)) continue;
      if (!supported.has(k) && !unverified.has(k)) problems.push(`${name}.${k}: no source says it supports this value, and it is not listed as unverified`);
      if (supported.has(k) && unverified.has(k)) problems.push(`${name}.${k}: listed as both supported and unverified`);
    }
    for (const k of unverified) if (!(k in r)) problems.push(`${name}: unverified names ${k}, which is not a field`);
    if (unverified.size) notes.push(`${name}: unverified ${[...unverified].join(', ')}`);
  }
  if (rules.reviewedBy === null) notes.push('rules not yet clinically reviewed (reviewedBy: null)');

  problems.push(...frozen('data/rules.json', 'rulesVersion', rules));

  const products = JSON.parse(read('data/products.json'));
  const ids = new Set();
  for (const p of products.products) {
    if (ids.has(p.id)) problems.push(`products.json: duplicate id ${p.id}`);
    ids.add(p.id);
    if (!['liquid', 'tablet', 'chewable'].includes(p.form)) problems.push(`${p.id}: bad form ${p.form}`);
    for (const c of p.components) {
      if (!(c.strengthMg > 0) || !(c.strengthPer > 0)) problems.push(`${p.id}: bad strength`);
      if (!Object.hasOwn(rules.ingredients, c.ingredient)) notes.push(`${p.id}: ${c.ingredient} has no rules`);
    }
    if (p.verified && !(p.sources?.length)) problems.push(`${p.id}: verified but no source`);
  }
  notes.push(`${products.products.filter((p) => !p.verified).length} of ${products.products.length} products not yet verified`);
  problems.push(...frozen('data/products.json', 'productsVersion', products));
  return result('check_rules', problems, notes);
}

/**
 * CLAUDE.md 2: a change to the numbers bumps the version and resets the
 * review. A change to reviewedBy/reviewedAt alone is a sign-off, and fine.
 */
function frozen(path, versionKey, now) {
  const headText = atHead(path);
  if (headText === null) return [];
  const head = JSON.parse(headText);
  const strip = (o) => { const { reviewedBy: _a, reviewedAt: _b, [versionKey]: _v, ...rest } = o; return JSON.stringify(rest); };
  if (strip(head) === strip(now)) return [];
  const out = [];
  if (head[versionKey] === now[versionKey]) out.push(`${path} changed since HEAD but ${versionKey} is still ${now[versionKey]}: bump it`);
  if (now.reviewedBy !== null || now.reviewedAt !== null) out.push(`${path} changed since HEAD: reset reviewedBy and reviewedAt to null until it is reviewed again`);
  return out;
}

/* ------------------------------------------------------------------ */
/* check_numbers: emergency numbers live in one file (CLAUDE.md).       */

export function checkNumbers() {
  const problems = [];
  const files = [...walk('js'), 'index.html', 'sw.js', ...walk('css')].filter((f) => f !== 'js/constants.js');
  const pats = [/611[\s-]?116/, /764[\s-]?766/, /0800\s?POISON/i, /tel:\s*111\b/, /['"`]111['"`]/];
  for (const f of files) {
    const code = f.endsWith('.js') ? stripComments(read(f)) : read(f);
    for (const re of pats) if (re.test(code)) problems.push(`${f} writes an emergency number (${re}); use js/constants.js`);
  }
  const c = read('js/constants.js');
  for (const need of ['0800611116', '0800764766', "tel: '111'"]) if (!c.includes(need)) problems.push(`js/constants.js is missing ${need}`);
  return result('check_numbers', problems, [`${files.length} files free of hard-coded emergency numbers`]);
}

/* ------------------------------------------------------------------ */
/* check_literals: no dosing numbers outside the rules (CLAUDE.md 1).   */

/* Strings in UI code that name a number with a dosing-shaped unit. Each
   allowed one says why it is not a dosing rule. */
const LITERAL_ALLOW = [
  { file: '*', text: /\b24 hours\b/, why: 'the rolling 24-hour window is fixed by design (CLAUDE.md 5), not a rule value' },
  { file: 'js/format.js', text: /^1 (hour|day)$/, why: 'singular unit words for formatting' },
  { file: 'js/state.js', text: /^1 day$/, why: 'singular unit word in ageText' },
  { file: 'js/constants.js', text: /24 hours a day, 7 days a week/, why: 'Healthline opening hours' },
  { file: 'js/views/bottles.js', text: /^e\.g\. 250 mg in 5 mL: enter 5$/, why: 'an example of reading a label, not a dose' },
  { file: 'js/views/child.js', text: /7 days/, why: 'summary period choices' },
];
const DOSING_SHAPE = /\b\d+(?:\.\d+)?\s*(?:mg|mL|ml|hours?|hrs?|minutes?|mins?|days?|doses?|times?)\b/;

export function checkLiterals() {
  const problems = [];
  const files = walk('js').filter((f) => f.endsWith('.js') && !f.startsWith('js/engine/'));
  let scanned = 0;
  for (const f of files) {
    for (const s of stringLiterals(read(f))) {
      scanned += 1;
      const text = s.text.replace(/\$\{[^}]*\}/g, 'X');
      if (!DOSING_SHAPE.test(text)) continue;
      if (LITERAL_ALLOW.some((a) => (a.file === '*' || a.file === f) && a.text.test(s.text))) continue;
      problems.push(`${f}:${s.line} has a number with a dosing unit in text: "${s.text.slice(0, 80)}". Derive it from data/rules.json or config.js`);
    }
  }
  return result('check_literals', problems, [`${scanned} strings in ${files.length} UI files`]);
}

/* ------------------------------------------------------------------ */
/* check_content: every piece of guidance has a source (CLAUDE.md 13).  */

/* Entries whose wording or source is still to be confirmed. Adding one
   here is a decision, with its reason in the entry's `verify`. */
const VERIFY_EXPECTED = ['overdose', 'storage'];

export async function checkContent() {
  const problems = [];
  const { GUIDANCE, SOURCES } = await import('../js/content/guidance.js');
  const { EMERGENCY } = await import('../js/constants.js');
  for (const [id, s] of Object.entries(SOURCES)) {
    if (id !== 'app' && !(s.url && /^https:\/\//.test(s.url))) problems.push(`source ${id} has no https url`);
    if (s.url && !(s.checkedAt && ISO.test(s.checkedAt))) problems.push(`source ${id} has no checkedAt`);
  }
  const used = new Set();
  const verify = [];
  for (const [id, g] of Object.entries(GUIDANCE)) {
    if (!g.text && !g.items) problems.push(`${id}: no text`);
    if (!Array.isArray(g.sources) || g.sources.length === 0) problems.push(`${id}: no source (CLAUDE.md 13: never invent clinical content)`);
    for (const s of g.sources ?? []) {
      if (!SOURCES[s]) problems.push(`${id}: unknown source ${s}`);
      used.add(s);
    }
    if (g.verify !== undefined) {
      if (!g.verify.trim()) problems.push(`${id}: verify is empty; say what needs checking`);
      verify.push(id);
    }
  }
  for (const [k, n] of Object.entries(EMERGENCY)) {
    if (!SOURCES[n.source]) problems.push(`constants.js ${k}: unknown source ${n.source}`);
    used.add(n.source);
  }
  for (const id of verify) if (!VERIFY_EXPECTED.includes(id)) problems.push(`${id} is marked verify but is not in VERIFY_EXPECTED; add it there with care, or resolve it`);
  for (const id of VERIFY_EXPECTED) if (!verify.includes(id)) problems.push(`${id} is in VERIFY_EXPECTED but no longer marked verify: remove it from the list`);
  for (const id of Object.keys(SOURCES)) if (!used.has(id)) problems.push(`source ${id} is never cited`);
  return result('check_content', problems, [`${Object.keys(GUIDANCE).length} guidance entries, ${Object.keys(SOURCES).length} sources, ${verify.length} TODO(VERIFY): ${verify.join(', ')}`]);
}

/* ------------------------------------------------------------------ */
/* check_sw: the service worker's shell list, and its VERSION.          */

export function checkSw() {
  const problems = [];
  const sw = read('sw.js');
  const version = /const VERSION = '([^']+)'/.exec(sw)?.[1];
  const shellBlock = /const SHELL = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '';
  const shell = [...shellBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!version) problems.push('sw.js: no VERSION');
  if (shell.length === 0) problems.push('sw.js: SHELL is empty or not found');
  for (const p of shell) if (p !== './' && !exists(p)) problems.push(`sw.js SHELL names ${p}, which does not exist`);
  const need = ['index.html', 'manifest.webmanifest', ...walk('js'), ...walk('css'), ...walk('data'), ...walk('icons')];
  for (const p of need) if (!shell.includes(p)) problems.push(`${p} is not in sw.js SHELL: it would not work offline`);
  const dup = shell.filter((p, i) => shell.indexOf(p) !== i);
  if (dup.length) problems.push(`sw.js SHELL lists twice: ${dup.join(', ')}`);

  // A shipped shell file changed but VERSION did not: phones keep the old one.
  const headSw = atHead('sw.js');
  if (headSw !== null) {
    const headVersion = /const VERSION = '([^']+)'/.exec(headSw)?.[1];
    if (headVersion === version) {
      const changed = [...need, 'sw.js'].filter((p) => {
        if (/\.png$/.test(p)) return false; // binary: compared by git, not here
        const head = atHead(p);
        return head !== null && head !== read(p);
      });
      if (changed.length) problems.push(`shell files changed since HEAD (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}) but VERSION is still ${version}: bump it`);
    }
  }
  return result('check_sw', problems, [`VERSION ${version}, ${shell.length} shell files`]);
}

/* ------------------------------------------------------------------ */
/* check_theme: contrast of every text/ground pair, both themes.        */

const PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
  ['primary', 'bg'], ['primary', 'surface'], ['primary-text', 'primary'], ['danger-text', 'danger'], ['stop', 'bg'], ['stop', 'surface'],
  ['text', 'ok-bg'], ['text', 'soon-bg'], ['text', 'stop-bg'], ['text', 'none-bg'],
  ['ok', 'ok-bg'], ['soon', 'soon-bg'], ['stop', 'stop-bg'], ['none', 'none-bg'],
  ['warn-text', 'warn-bg'], ['test-text', 'test-bg'], ['bg', 'text'],
  ['bg', 'kid-teal'], ['bg', 'kid-orange'], ['bg', 'kid-purple'], ['bg', 'kid-blue'], ['bg', 'kid-pink'], ['bg', 'kid-green'],
];

export function checkTheme() {
  const problems = [];
  const css = read('css/app.css');
  const block = (sel) => {
    const re = new RegExp(`${sel.replace(/[[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
    const m = re.exec(css);
    const vars = {};
    if (m) for (const v of m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) vars[v[1]] = v[2];
    return vars;
  };
  const themes = { light: block('[data-theme="light"]'), dark: block('[data-theme="dark"]') };
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  let n = 0;
  for (const [t, vars] of Object.entries(themes)) {
    if (Object.keys(vars).length < 20) problems.push(`${t} theme block not found or incomplete`);
    for (const [fg, bg] of PAIRS) {
      if (!vars[fg] || !vars[bg]) { problems.push(`${t}: --${fg} or --${bg} missing`); continue; }
      const r = ratio(vars[fg], vars[bg]);
      n += 1;
      if (r < 4.5) problems.push(`${t}: --${fg} on --${bg} is ${r.toFixed(2)}:1, under 4.5:1`);
    }
  }
  const lk = Object.keys(themes.light).sort().join();
  const dk = Object.keys(themes.dark).sort().join();
  if (lk !== dk) problems.push('light and dark themes define different tokens');
  // No colour literals outside the token blocks.
  const rest = css.replace(/:root,\s*\[data-theme="light"\]\s*\{[^}]*\}/, '').replace(/\[data-theme="dark"\]\s*\{[^}]*\}/, '');
  const stray = rest.match(/#[0-9a-f]{3,8}\b/gi)?.filter((x) => !/^#(?:fff|000)$/i.test(x)) ?? [];
  if (stray.length) problems.push(`colour literals outside the tokens: ${stray.join(', ')}`);
  return result('check_theme', problems, [`${n} pairs at 4.5:1 or better`]);
}

/* ------------------------------------------------------------------ */
/* check_ids: no id used twice in index.html.                           */

export function checkIds() {
  const html = read('index.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  return result('check_ids', dup.map((d) => `index.html: id "${d}" is used twice`), [`${ids.length} ids`]);
}

export const CHECKS = [checkEngine, checkRules, checkNumbers, checkLiterals, checkContent, checkSw, checkTheme, checkIds];
