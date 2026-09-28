/* Shared helpers for the checkers. */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const exists = (p) => existsSync(join(ROOT, p));
export const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

/** Every file under `dir` (repo-relative), recursively. */
export function walk(dir) {
  const out = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...walk(rel(p)));
    else out.push(rel(p));
  }
  return out.sort();
}

/** The file as committed at HEAD, or null if it is new / there is no HEAD. */
export function atHead(path) {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** JS source with comments removed (strings kept), for pattern checks. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

/** The contents of every string and template literal in JS source (comments ignored). */
export function stringLiterals(src) {
  const code = stripComments(src);
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/gs;
  let m;
  while ((m = re.exec(code))) out.push({ text: m[2], index: m.index, line: code.slice(0, m.index).split('\n').length });
  return out;
}

/** Result helper. */
export function result(name, problems, notes = []) {
  return { name, ok: problems.length === 0, problems, notes };
}
