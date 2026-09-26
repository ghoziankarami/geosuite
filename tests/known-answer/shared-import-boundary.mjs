#!/usr/bin/env node
/**
 * shared-import-boundary.mjs — Unit tests for src/shared/io/import.js
 * (docs/PLAN-refactor-dataset-kolom.md Tahap 3, the pure/testable half of
 * the import pipeline -- src/shared/ui/column-mapper.js, the DOM-rendered
 * fallback, is not covered by a Node test for the same reason no phase's
 * existing UI code is: it needs a browser. What buildImportReport() decides
 * (ready/not-ready, what's missing, what was rejected) is covered here in
 * full, end to end from real CSV TEXT through parseDrillholeCSVTokens()
 * (parse.js) and classifyColumns() (columns.js) -- not hand-built token
 * arrays, so a change to either of those two files' output shape breaks
 * this test too, the same protection shared-schema-boundary.mjs gives
 * schema.js against parse.js and columns.js.
 *
 * What this proves, one per defect ID:
 *   D17 - a malformed row shows up in report.rejected with its line number
 *         and reason, instead of silently vanishing from the row count.
 *   D18 - a file with zero grade columns still says so in the report
 *         (warnings includes 'no_grade_columns') rather than a fixed
 *         "Upload sukses" string that does not look at what actually loaded.
 *   D7  - missing a phase's required role (no hole_id at all) sets
 *         ready=false and names the missing role -- a caller that only
 *         activates the dataset when ready is true can no longer silently
 *         swap in a broken dataset.
 *   Per-phase requirements differ on purpose: Core only needs hole_id (it
 *   can work from collar alone); Assay needs hole_id/from/to; Resource
 *   additionally needs x/y/z (it estimates in 3-D space).
 *
 * Run: node shared-import-boundary.mjs
 * Exit: 0 = all pass, 1 = any failure
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
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
const IO_DIR = path.join(REPO_ROOT, 'src', 'shared', 'io');
const sandbox = {};
vm.createContext(sandbox);
for (const file of ['parse.js', 'columns.js', 'import.js']) {
  const p = path.join(IO_DIR, file);
  if (!fs.existsSync(p)) { console.error(`FATAL: ${p} not found`); process.exit(2); }
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
}

const { parseDrillholeCSVTokens, buildImportReport, summarizeImportReport } = sandbox;
for (const [name, fn] of Object.entries({ parseDrillholeCSVTokens, buildImportReport, summarizeImportReport })) {
  if (typeof fn !== 'function') { console.error(`FATAL: ${name} did not load`); process.exit(2); }
}

let passed = 0, failed = 0;
function assert(desc, ok) {
  if (ok) { passed++; console.log(`  ✅ ${desc}`); }
  else { failed++; console.log(`  ❌ ${desc}`); }
  return ok;
}
function eq(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.log(`     got: ${JSON.stringify(actual)}\n     expected: ${JSON.stringify(expected)}`);
  return assert(desc, ok);
}
function section(s) { console.log(`\n── ${s} ──`); }

function report(csvText, phase) {
  const p = parseDrillholeCSVTokens(csvText);
  return buildImportReport(p.headers, p.tokenRows, p.rejected, phase);
}

// ------------------------------------------------------------------ D17
section('D17: a malformed row is named in the report, not silently dropped');
{
  const lines = ['hole_id,from_m,to_m,midx,midy,midz,au_gpt', 'H1,0,1'];
  for (let i = 0; i < 9; i++) lines.push(`H${i},${i},${i + 1},${i * 10},0,${100 - i},5.0`);
  const csv = lines.join('\n') + '\n';
  const r = report(csv, 'Assay');
  eq('9 well-formed rows loaded', r.rowCount, 9);
  eq('1 row rejected, with its real line number', r.rejected.map(x => x.line), [2]);
  assert('the report says WHY it was rejected, not just that it was',
    typeof r.rejected[0].reason === 'string' && r.rejected[0].reason.length > 0);
  assert('a rejected row does not block activation on its own (9 good rows is enough)', r.ready);
}

// ------------------------------------------------------------------ D18
section("D18: a file with zero grade columns says so, instead of a fixed \"success\" message");
{
  const csv = 'hole_id,from_m,to_m,lithology\nH1,0,1,AND\nH1,1,2,STK\n';
  const r = report(csv, 'Assay');
  assert('warnings names the missing grade data', r.warnings.includes('no_grade_columns'));
  assert('still ready -- a lithology-only file is a legitimate geology upload, not required to have grades',
    r.ready);
  const summary = summarizeImportReport(r);
  assert('summarizeImportReport surfaces it as a structured fact a phase can translate',
    summary.some(l => l.kind === 'warning' && l.code === 'no_grade_columns'));
}

// ------------------------------------------------------------------ D7
section('D7: a file missing a required role blocks activation and names what is missing');
{
  const csv = 'foo,bar,baz\n1,2,3\n4,5,6\n';
  const r = report(csv, 'Assay');
  eq('hole_id/from/to all reported missing for Assay', r.missingRequired.sort(), ['from', 'hole_id', 'to']);
  assert('ready is false -- the caller must keep the previous dataset active, not swap in this one', !r.ready);
}

// ------------------------------------------------------------------ per-phase requirements differ on purpose
section('Per-phase required roles: Core needs only hole_id; Resource also needs x/y/z');
{
  const csv = 'hole_id,from_m,to_m,au_gpt\nH1,0,1,5.0\nH1,1,2,5.2\n'; // no midx/midy/midz
  eq('Core is satisfied with just hole_id present', report(csv, 'Core').missingRequired, []);
  eq('Assay is satisfied with hole_id/from/to present', report(csv, 'Assay').missingRequired, []);
  eq('Resource is NOT satisfied -- it needs x/y/z to place anything in 3-D',
    report(csv, 'Resource').missingRequired.sort(), ['x', 'y', 'z']);
}

// ------------------------------------------------------------------ a fully empty upload
section('An empty upload (header only, or unreadable) is never "ready"');
{
  eq('header-only CSV: zero rows, not ready', [report('hole_id,from_m,to_m\n', 'Assay').rowCount,
    report('hole_id,from_m,to_m\n', 'Assay').ready], [0, false]);
  eq('completely empty text: zero rows, not ready', [report('', 'Assay').rowCount, report('', 'Assay').ready], [0, false]);
}

// ------------------------------------------------------------------ the real tin-placer fixture end to end
section('Real tin-placer fixture: hole_id/from/to present, ready for Assay despite an unfamiliar grade unit');
{
  const FIX = path.join(__dirname, '..', 'fixtures', 'columns', 'tin-placer', 'assay.csv');
  const csv = fs.readFileSync(FIX, 'utf8');
  const r = report(csv, 'Assay');
  assert('ready (BHID/FROM/TO satisfy hole_id/from/to)', r.ready);
  eq('SN_KGM3 recognised as the grade column (Tahap 1 fix reachable end to end from real CSV text)',
    r.columnMap.byRole.grade, ['SN_KGM3']);
  assert('no "missing grade" warning -- the fixture DOES have one once Tahap 1\'s fix is in the chain',
    !r.warnings.includes('no_grade_columns'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
