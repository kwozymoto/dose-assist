/* Run every checker, the tests and the type check, and report once.

    node tools/check_all.mjs          (or: npm run check)

   Green before every commit. A checker not in CHECKS (tools/checks.mjs) is
   not a checker: register it in the same commit that creates it. */

import { spawnSync } from 'node:child_process';
import { CHECKS } from './checks.mjs';
import { ROOT } from './lib.mjs';

let failed = 0;
for (const check of CHECKS) {
  let r;
  try {
    r = await check();
  } catch (err) {
    r = { name: check.name, ok: false, problems: [`crashed: ${err.stack ?? err}`], notes: [] };
  }
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.notes.length ? `: ${r.notes.join('; ')}` : ''}`);
  for (const p of r.problems) console.log(`       ${p}`);
  if (!r.ok) failed += 1;
}

const run = (label, cmd, args) => {
  const p = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  const out = `${p.stdout ?? ''}${p.stderr ?? ''}`;
  const ok = p.status === 0;
  const summary = out.split('\n').filter((l) => /^ℹ (tests|pass|fail)|error TS|all files/.test(l)).map((l) => l.trim()).join('; ');
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${summary ? `: ${summary}` : ''}`);
  if (!ok) { console.log(out.split('\n').filter((l) => /✖|error|Error/.test(l)).slice(0, 30).map((l) => `       ${l}`).join('\n')); failed += 1; }
};
run('tests', 'npm', ['test', '--silent']);
run('engine coverage', 'npm', ['run', 'test:engine', '--silent']);
run('typecheck', 'npm', ['run', 'typecheck', '--silent']);

console.log(failed ? `\n${failed} failed` : '\nall green');
process.exit(failed ? 1 : 0);
