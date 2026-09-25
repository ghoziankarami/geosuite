#!/usr/bin/env node
/**
 * phase-inline-markers.mjs — no phase file may silently lose an @orebit-inline
 * marker.
 *
 * WHY THIS EXISTS
 *   build/build.mjs resolves `@orebit-inline: <path>` markers into the phase
 *   output. A marker that disappears from a phase file takes its module with
 *   it: the symbol simply is not defined in the built artifact any more.
 *   Nothing else notices, because every other test reads src/shared/*.js
 *   directly from disk — shared-columns-boundary.mjs would still pass with
 *   columns.js inlined into precisely zero phases.
 *
 *   This is not hypothetical. On 2026-09-17 two parallel agents were asked to
 *   ADD `shared/data/dataset.js` to the Assay and Resource marker blocks. Both
 *   replaced the `shared/io/columns.js` line instead of inserting a new one,
 *   so classifyColumns/columnRole/columnsByRole vanished from all three built
 *   artifacts while the gate tier stayed fully green. Caught by reading a diff,
 *   not by a test — which is the whole reason this file exists.
 *
 * WHAT IT CHECKS
 *   For each phase, the set of `@orebit-inline: shared/...` markers must be a
 *   SUPERSET of the recorded baseline below. Adding a marker is fine (that is
 *   how Tahap 3/4 land). Removing or renaming one fails until the baseline is
 *   updated deliberately, in the same commit that removes the module's last
 *   user — with the reasoning written down.
 *
 * Run: node phase-inline-markers.mjs
 * Exit: 0 = all present, 1 = a marker went missing
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'build', 'build.mjs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not find repo root (no build/build.mjs found above ' + start + ')');
}

const REPO_ROOT = findRepoRoot(__dirname);
// orebit-ops keeps the phases under exe-wrapper/; the public GeoSuite tree
// (ops/opensource/export-public.py) keeps them at phases/.
const PHASES_DIR = [path.join(REPO_ROOT, 'phases'), path.join(REPO_ROOT, 'exe-wrapper', 'pywebview', 'phases')]
  .find(d => fs.existsSync(path.join(d, 'Core.html'))) || path.join(REPO_ROOT, 'exe-wrapper', 'pywebview', 'phases');

// Recorded 2026-09-17 against the tree that first had this test. Every entry is
// a module some phase file actually needs inlined; none is decorative.
// 2026-09-25: shared/license/index.js removed from all three -- the licence gate
// is gone (GPL-3.0, docs/PLAN-opensource-dan-excellence.md O2) and its last
// readers (footer badge, PDF licensee line) were removed in the same commit.
// shared/io/grades.js and shared/ui/pwa.js added the same day.
const BASELINE = {
  Core: [
    'shared/geostat/desurvey.js',
    'shared/i18n/index.js',
    'shared/io/columns.js',
    'shared/io/import.js',
    'shared/io/index.js',
    'shared/io/grades.js',
    'shared/io/parse.js',
    'shared/ui/column-mapper.js',
    'shared/ui/pwa.js',
    'shared/ui/index.js',
  ],
  Assay: [
    'shared/data/dataset.js',
    'shared/i18n/index.js',
    'shared/io/columns.js',
    'shared/io/import.js',
    'shared/io/index.js',
    'shared/io/grades.js',
    'shared/io/parse.js',
    'shared/ui/column-mapper.js',
    'shared/ui/pwa.js',
    'shared/ui/index.js',
  ],
  Resource: [
    'shared/data/dataset.js',
    'shared/geostat/resource-estimation.js',
    'shared/i18n/index.js',
    'shared/io/columns.js',
    'shared/io/import.js',
    'shared/io/index.js',
    'shared/io/grades.js',
    'shared/io/parse.js',
    'shared/ui/column-mapper.js',
    'shared/ui/pwa.js',
    'shared/ui/index.js',
  ],
};

const MARKER = /@orebit-inline:\s*(shared\/[^\s*]+)/g;

let pass = 0, fail = 0;
for (const [phase, required] of Object.entries(BASELINE)) {
  const file = path.join(PHASES_DIR, `${phase}.html`);
  if (!fs.existsSync(file)) {
    fail++; console.log(`  ✗ ${phase}.html: not found`); continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  const present = new Set();
  for (const m of src.matchAll(MARKER)) present.add(m[1]);

  const missing = required.filter(r => !present.has(r));
  if (missing.length) {
    fail++;
    console.log(`  ✗ ${phase}.html: marker(s) gone -- ${missing.join(', ')}`);
    console.log(`      its module is no longer inlined into this phase; any symbol it defines is undefined at runtime.`);
  } else {
    pass++;
    console.log(`  ✓ ${phase}.html: all ${required.length} required markers present`);
  }

  // A module the phase actually reads from src/ should be verified to exist,
  // so a typo'd marker path cannot pass as "present".
  for (const r of required) {
    const mod = path.join(REPO_ROOT, 'src', r);
    if (!fs.existsSync(mod)) {
      fail++;
      console.log(`  ✗ ${phase}.html: marker "${r}" points at a file that does not exist (${mod})`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
