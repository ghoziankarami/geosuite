import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolvePython } from './python-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, ok, detail, required = true) => checks.push({ name, ok, required, detail });
check('Node.js', Number(process.versions.node.split('.')[0]) >= 18, process.version);
let python;
try { python = resolvePython(); check('Python 3.9+', true, [python.command, ...python.args].join(' ')); }
catch { check('Python 3.9+', false, 'Install Python 3.9+ and add it to PATH.'); }
const phases = existsSync(path.join(root, 'phases/Core.html')) ? 'phases' : 'exe-wrapper/pywebview/phases';
for (const module of ['Core', 'Assay', 'Resource']) check(`${module} source`, existsSync(path.join(root, phases, `${module}.html`)), `${phases}/${module}.html`);
for (const name of ['src', 'build/build.mjs']) check(name, existsSync(path.join(root, name)), name);
const patchers = existsSync(path.join(root, 'build/patchers/orebit_v194_patcher.py')) ? 'build/patchers' : 'ops/scripts/patchers';
for (const name of ['orebit_v194_patcher.py', 'orebit_help_patcher.py']) check(name, existsSync(path.join(root, patchers, name)), `${patchers}/${name}`);
const vendor = existsSync(path.join(root, 'vendor/plotly.min.js')) ? 'vendor' : 'exe-wrapper/pywebview/vendor';
for (const name of ['plotly.min.js', 'jspdf.umd.min.js', 'html2canvas.min.js', 'jszip.min.js']) check(name, existsSync(path.join(root, vendor, name)), `${vendor}/${name}`);
if (python) {
  const browser = spawnSync(python.command, [...python.args, '-c', 'import playwright.sync_api'], { stdio: 'ignore' });
  check('Python Playwright', browser.status === 0, 'Optional for browser tests; install playwright and its Chromium browser in your test environment.', false);
}
const ok = checks.every(c => !c.required || c.ok);
if (process.argv.includes('--json')) console.log(JSON.stringify({ ok, platform: process.platform, checks }, null, 2));
else {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : c.required ? 'FAIL' : 'OPTIONAL'} ${c.name}: ${c.detail}`);
  console.log(ok ? 'Build prerequisites available. Run npm run dev for a built preview; npm test for fast checks.' : 'Fix the required FAIL items before building.');
  console.log('This check does not test the browser, calculations, SSH or deployment. Git, VPS credentials and cloud services are not build prerequisites.');
}
process.exitCode = ok ? 0 : 1;
