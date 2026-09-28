// Copy the app's shell into www/ for the Android app (Capacitor's webDir).
// The web app itself has no build step; this only packages the same files
// the service worker caches (sw.js SHELL), so the APK and the web app can
// never ship different code. Run: npm run android:sync
import { readFileSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const m = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
if (!m) throw new Error('SHELL not found in sw.js');
const files = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((f) => f !== './');

const out = join(root, 'www');
rmSync(out, { recursive: true, force: true });
for (const f of files) {
  const from = join(root, f);
  if (!existsSync(from)) throw new Error(`SHELL names ${f}, which does not exist`);
  const to = join(out, f);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
console.log(`www/: ${files.length} files from sw.js SHELL`);
