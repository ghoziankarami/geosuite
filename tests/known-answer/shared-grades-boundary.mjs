#!/usr/bin/env node
/**
 * shared-grades-boundary.mjs — negative grade codes and over-limit markers.
 *
 * WHY THIS EXISTS
 *   Audit 2026-09-25 (docs/audits/kredibilitas-dan-opensource-2026-09-25.md).
 *   Lab/database exports use negative numbers for two different things:
 *   "-0.005" = below a 0.005 detection limit, "-99"/"-999"/"-9999" = missing
 *   sample. Core halved every negative, so -9999 became 4,999.5 g/t Au, and a
 *   6-hole file averaged 47.69 g/t instead of 1.50. Assay and Resource kept the
 *   raw negatives (Assay mean -91 g/t; Resource fed -9999 into kriging).
 *   ">10" (over-limit) was dropped, removing the highest-grade samples.
 *
 *   Runs the real src/shared/io/grades.js and parse.js source via vm, no copy.
 *
 * Run: node shared-grades-boundary.mjs      Exit: 0 pass, 1 fail
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
const sandbox = {};
vm.createContext(sandbox);
for (const f of ['grades.js', 'parse.js']) {
  const p = path.join(REPO_ROOT, 'src', 'shared', 'io', f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
}
const { resolveNegativeGrades, classifyNegativeGrade, positiveGradeMax, parseDrillholeCSV } = sandbox;
if (typeof resolveNegativeGrades !== 'function' || typeof parseDrillholeCSV !== 'function') {
  console.error('FATAL: grades.js / parse.js did not load');
  process.exit(2);
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

section('classifyNegativeGrade');
const mx = 2.94; // highest measured Au g/t in the column
eq('-0.005 is a detection limit', classifyNegativeGrade(-0.005, mx), 'bdl');
eq('-0.01 is a detection limit', classifyNegativeGrade(-0.01, mx), 'bdl');
for (const code of [-9, -99, -999, -9999, -99999, -99.0]) {
  eq(`${code} is a missing-sample code`, classifyNegativeGrade(code, mx), 'missing');
}
eq('-5 above the column maximum (2.94) cannot be a detection limit', classifyNegativeGrade(-5, mx), 'missing');
eq('-0.1 below a tiny median but under the max is still a limit', classifyNegativeGrade(-0.1, 45), 'bdl');
eq('-1 in a Cu ppm column (max 25000) is a 1 ppm detection limit', classifyNegativeGrade(-1, 25000), 'bdl');
eq('-99 in a Cu ppm column (max 25000) is still a missing code', classifyNegativeGrade(-99, 25000), 'missing');
eq('-995000 in a Pb ppm column (max 180000) is a code, not 49.75 % Pb', classifyNegativeGrade(-995000, 180000), 'missing');
eq('-0.9 is not an all-nines code', classifyNegativeGrade(-0.9, mx), 'bdl');
eq('no positives: small negative stays BDL', classifyNegativeGrade(-0.01, null), 'bdl');
eq('no positives: -999 stays missing', classifyNegativeGrade(-999, null), 'missing');

section('positiveGradeMax');
eq('ignores negatives, nulls, text', positiveGradeMax([3, 1, 2, -9, null, 'x']), 3);
eq('none positive', positiveGradeMax([-1, 0, null]), null);

section('resolveNegativeGrades — the 6-hole case the audit measured');
// 116 real Au values averaging ~1.5 g/t plus -0.005, -99, -999, -9999.
const real = [];
for (let i = 0; i < 116; i++) real.push(0.2 + (i % 27) * 0.1);
const trueMean = real.reduce((a, b) => a + b, 0) / real.length;
const rows = real.map(v => ({ au_gpt: v, cu_pct: 0.5 }));
rows.push({ au_gpt: -0.005, cu_pct: 0.5 }, { au_gpt: -99, cu_pct: -99 }, { au_gpt: -999, cu_pct: 0.5 }, { au_gpt: -9999, cu_pct: 0.5 });
const rep = resolveNegativeGrades(rows, ['au_gpt', 'cu_pct'], 'half');
eq('counts: 1 BDL + 4 missing codes (3 Au, 1 Cu)', [rep.bdl, rep.missing], [1, 4]);
eq('-0.005 -> 0.0025', rows[116].au_gpt, 0.0025);
eq('-99 / -999 / -9999 -> null', [rows[117].au_gpt, rows[118].au_gpt, rows[119].au_gpt], [null, null, null]);
eq('cu_pct -99 -> null, not 49.5 %', rows[117].cu_pct, null);
const au = rows.map(r => r.au_gpt).filter(v => typeof v === 'number');
const mean = au.reduce((a, b) => a + b, 0) / au.length;
assert(`mean after resolve (${mean.toFixed(3)}) within 1% of true mean (${trueMean.toFixed(3)})`, Math.abs(mean - trueMean) / trueMean < 0.01);
assert('no value above the real maximum survives', Math.max(...au) <= Math.max(...real));
eq('per-column breakdown', Object.keys(rep.byColumn).sort(), ['au_gpt', 'cu_pct']);

section('resolveNegativeGrades — modes and positional rows');
const arr = [[0.5, -0.01], [0.7, -999], [0.9, 1.2]];
const r2 = resolveNegativeGrades(arr, [1], 'null');
eq('null mode: BDL -> null', arr[0][1], null);
eq('null mode: missing -> null', arr[1][1], null);
eq('null mode counts', [r2.bdl, r2.missing], [1, 1]);
const keep = [{ g: -0.01 }, { g: -999 }, { g: 2 }];
const r3 = resolveNegativeGrades(keep, ['g'], 'keep');
eq('keep mode: nothing changed', keep.map(r => r.g), [-0.01, -999, 2]);
eq('keep mode: still counted for the report', [r3.bdl, r3.missing], [1, 1]);
const again = [{ g: 0.0025 }, { g: null }, { g: 2 }];
const r4 = resolveNegativeGrades(again, ['g'], 'half');
eq('idempotent: a resolved column reports nothing', [r4.bdl, r4.missing], [0, 0]);

section('parse.js — over-limit and below-detection tokens');
const csv = 'hole_id,from,to,au_gpt\nA,0,1,>10\nA,1,2,<0.005\nA,2,3,1.5\nA,3,4,> 5\n';
const p = parseDrillholeCSV(csv);
const cell = i => p.rows[i].au_gpt;
eq('">10" -> value 10, flagged over-limit', [cell(0).value, cell(0).wasOverLimit], [10, true]);
eq('"<0.005" -> half the limit', [cell(1).value, cell(1).wasBelowDetection], [0.0025, true]);
eq('plain number untouched', cell(2), 1.5);
eq('"> 5" with a space -> 5', cell(3).value, 5);
const semi = 'hole_id;from;to;au_gpt\nA;0;1;>10,5\nA;1;2;0,7\n';
const ps = parseDrillholeCSV(semi);
eq('comma-decimal file: ">10,5" -> 10.5', ps.rows[0].au_gpt.value, 10.5);

section('real data — the bundled Thalanga VMS sample (src/assets/sample/core.json)');
// Known answer computed by hand from the JSON (audit 2026-09-25): the only
// negatives larger than their column's maximum are the database codes
// -995000 (pb_ppm x15), -9910000 (ag_gpt x19); every other negative is a
// genuine limit from some lab/era (-0.01, -0.05, -0.1 Au; -5 Cu; -1 Ag ...).
const sample = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src', 'assets', 'sample', 'core.json'), 'utf8'));
const cols = ['au_gpt', 'cu_ppm', 'pb_ppm', 'zn_ppm', 'ag_gpt', 'as_ppm'];
const count = (col, v) => sample.assay.filter(r => r[col] === v).length;
const expectPb = count('pb_ppm', -995000), expectAg = count('ag_gpt', -9910000);
const auLimits = sample.assay.filter(r => typeof r.au_gpt === 'number' && r.au_gpt < 0).length;
const srep = resolveNegativeGrades(sample.assay, cols, 'half');
eq('Pb -995000 codes are missing (not 497,500 ppm)', srep.byColumn.pb_ppm.missing, expectPb);
eq('Ag -9910000 codes are missing', srep.byColumn.ag_gpt.missing, expectAg);
eq('every negative Au is a genuine limit (none missing)', [srep.byColumn.au_gpt.bdl, srep.byColumn.au_gpt.missing], [auLimits, 0]);
eq('total missing = exactly those two code families', srep.missing, expectPb + expectAg);
assert('no Pb value above the real maximum survives', Math.max(...sample.assay.map(r => r.pb_ppm).filter(v => typeof v === 'number')) < 995000 / 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
