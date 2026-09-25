#!/usr/bin/env node
/**
 * shared-columns-boundary.mjs — Unit tests for src/shared/io/columns.js
 * (docs/PLAN-refactor-dataset-kolom.md Tahap 1).
 *
 * WHY vm, NOT A HAND-COPY OR eval() — same reasoning as
 * shared-parse-boundary.mjs: columns.js has no `export` statement (it gets
 * inlined raw via @orebit-inline), so vm.runInContext runs the REAL file's
 * source text and pulls the functions out of it, nothing to keep in sync by
 * hand.
 *
 * WHAT THIS DOES NOT TEST — columns.js is not wired into any phase yet.
 * Whether Core/Assay/Resource's real column detection routes through it is
 * Tahap 3+; test_history_independence.py's D10/D11 sections keep measuring
 * the REAL app's behaviour in the meantime.
 *
 * The corpus below is deliberately per-commodity (K6: "semuanya" -- every
 * commodity, not just the one that happened to break first): gold-silver,
 * copper porphyry, nickel laterite, bauxite, alluvial tin (the one that
 * drove D10/D11), REE, and coal. Every corpus case asserts two things: the
 * columns that MUST get a specific role, and that headers[] length equals
 * columns.length (nothing dropped) — same shape as D15's finding.
 *
 * Run: node shared-columns-boundary.mjs
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
const COLUMNS_JS = path.join(REPO_ROOT, 'src', 'shared', 'io', 'columns.js');

if (!fs.existsSync(COLUMNS_JS)) {
  console.error(`FATAL: ${COLUMNS_JS} not found`);
  process.exit(2);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(COLUMNS_JS, 'utf8'), sandbox, { filename: COLUMNS_JS });

const { classifyColumns, columnRole, columnsByRole, canonicalGradeName, planGradeRenames } = sandbox;
if (typeof classifyColumns !== 'function') {
  console.error('FATAL: classifyColumns did not load from columns.js');
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

// A generic "make a few sample rows so numeric-vs-text detection has something
// to look at" helper: `spec` maps header -> a value used for every synthetic row.
function rows(headers, spec, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(headers.map(h => (spec[h] !== undefined ? spec[h] : i)));
  return out;
}

function roleOf(map, header) { return columnRole(map, header); }

// ------------------------------------------------------------------ nothing dropped
section('Structural contract: every header gets exactly one role, none dropped');
{
  const headers = ['hole_id', 'from_m', 'to_m', 'midx', 'midy', 'midz', 'au_gpt', 'lithology', 'ALT'];
  const map = classifyColumns(headers, rows(headers, { hole_id: 'H01', lithology: 'AND', ALT: 'ARG' }, 3));
  eq('columns.length === headers.length', map.columns.length, headers.length);
  const covered = new Set();
  for (const r of Object.keys(map.byRole)) map.byRole[r].forEach(h => covered.add(h));
  eq('every original header appears in exactly one byRole bucket',
    headers.every(h => covered.has(h)) && covered.size === headers.length, true);
  assert("a column nothing recognises (ALT) still gets a role, not silently dropped (D15)",
    roleOf(map, 'ALT') !== null && roleOf(map, 'ALT') !== undefined);
}

// ------------------------------------------------------------------ D10/D11 fix, proven against the REAL fixture
section('D10/D11: the real tin-placer fixture (fixtures/columns/tin-placer)');
{
  const FIX = path.join(__dirname, '..', 'fixtures', 'columns', 'tin-placer');
  const assayHeader = fs.readFileSync(path.join(FIX, 'assay.csv'), 'utf8').split(/\r?\n/)[0].split(',');
  eq('fixture header is the real one (sanity)', assayHeader, ['BHID', 'FROM', 'TO', 'SN_KGM3', 'BD_TM3']);
  const sample = rows(assayHeader, { BHID: 'SBR-01-050', SN_KGM3: 0.0064, BD_TM3: 1.53 }, 5);
  const map = classifyColumns(assayHeader, sample);
  eq('SN_KGM3 classifies as grade (D10 -- Core/Assay/Resource\'s shared regex misses this today)',
    roleOf(map, 'SN_KGM3'), 'grade');
  eq('SN_KGM3\'s unit is read from its own suffix, not guessed elsewhere', map.columns.find(c => c.header === 'SN_KGM3').unit, 'kgm3');
  eq('BD_TM3 classifies as density, not dropped (D11)', roleOf(map, 'BD_TM3'), 'density');
  eq('BHID classifies as hole_id', roleOf(map, 'BHID'), 'hole_id');
  eq('FROM / TO classify correctly', [roleOf(map, 'FROM'), roleOf(map, 'TO')], ['from', 'to']);
}

// ------------------------------------------------------------------ per-commodity corpus (K6: every commodity)
section('Gold-silver epithermal (au_gpt, ag_gpt)');
{
  const h = ['hole_id', 'from_m', 'to_m', 'midx', 'midy', 'midz', 'domain', 'lithology', 'au_gpt', 'ag_gpt'];
  const map = classifyColumns(h, rows(h, { hole_id: 'H', domain: 'D1', lithology: 'AND' }, 4));
  eq('au_gpt / ag_gpt both grade, unit gpt',
    h.filter(c => c.endsWith('gpt')).map(c => [roleOf(map, c), map.columns.find(x => x.header === c).unit]),
    [['grade', 'gpt'], ['grade', 'gpt']]);
}

section('Copper porphyry (cu_pct, mo_ppm, ag_gpt)');
{
  const h = ['hole_id', 'from_m', 'to_m', 'cu_pct', 'mo_ppm', 'ag_gpt'];
  const map = classifyColumns(h, rows(h, { hole_id: 'H' }, 4));
  eq('cu_pct/mo_ppm/ag_gpt all grade with their own units',
    ['cu_pct', 'mo_ppm', 'ag_gpt'].map(c => [roleOf(map, c), map.columns.find(x => x.header === c).unit]),
    [['grade', 'pct'], ['grade', 'ppm'], ['grade', 'gpt']]);
}

section('Nickel laterite (ni_pct, co_pct, fe_pct, mgo_pct, sio2_pct, al2o3_pct, cr2o3_pct)');
{
  const h = ['hole_id', 'from_m', 'to_m', 'NI_PCT', 'CO_PCT', 'FE_PCT', 'MGO_PCT', 'SIO2_PCT', 'AL2O3_PCT', 'CR2O3_PCT'];
  const map = classifyColumns(h, rows(h, { hole_id: 'H' }, 4));
  assert('every nickel laterite oxide/element column is grade (D16: no partial-lowercasing left to drift)',
    h.slice(3).every(c => roleOf(map, c) === 'grade'));
}

section('Bauxite (al2o3_pct, sio2_pct, fe2o3_pct, tio2_pct)');
{
  const h = ['hole_id', 'from_m', 'to_m', 'al2o3_pct', 'sio2_pct', 'fe2o3_pct', 'tio2_pct'];
  const map = classifyColumns(h, rows(h, { hole_id: 'H' }, 4));
  assert('bauxite oxide suite all classify as grade', h.slice(3).every(c => roleOf(map, c) === 'grade'));
}

section('Alluvial tin, second real-shaped case (sn_kgm3 + REE by-products in ppm)');
{
  const h = ['hole_id', 'from_m', 'to_m', 'sn_kgm3', 'y_ppm', 'nd_ppm', 'ce_ppm', 'bd_tm3'];
  const map = classifyColumns(h, rows(h, { hole_id: 'H' }, 4));
  eq('sn_kgm3 grade (kgm3), REE elements grade (ppm), density its own role',
    h.slice(3).map(c => roleOf(map, c)),
    ['grade', 'grade', 'grade', 'grade', 'density']);
}

section('Coal (calorific value, ash, sulfur, moisture -- NOT metal grade columns)');
{
  // Coal quality parameters have no element-symbol prefix at all, so today's shared
  // regex (and this module's alias table) correctly does NOT call them `grade` --
  // they land in other_numeric, still present, never silently discarded.
  const h = ['hole_id', 'from_m', 'to_m', 'cv_kcal_kg', 'ash_pct', 'sulfur_pct', 'moisture_pct', 'seam'];
  const map = classifyColumns(h, rows(h, { hole_id: 'H', seam: 'A' }, 4));
  eq('none of the coal quality columns are misclassified as metal grade',
    h.slice(3, 7).every(c => roleOf(map, c) !== 'grade'), true);
  assert('every coal quality column still gets a role (numeric), none dropped',
    h.slice(3, 7).every(c => roleOf(map, c) === 'other_numeric'));
  eq('seam name (text) is classified, not dropped', roleOf(map, 'seam') !== null, true);
}

// ------------------------------------------------------------------ Indonesian headers, mixed case, whitespace
section('Indonesian headers and mixed case (D16: names preserved verbatim)');
{
  const h = ['No_Lubang', ' Kedalaman_Dari ', 'kedalaman_sampai', 'Koordinat_X', 'Litologi'];
  const map = classifyColumns(h, rows(h, {}, 3));
  eq('Indonesian aliases resolve to the same roles as their English equivalents',
    h.map(c => roleOf(map, c)), ['hole_id', 'from', 'to', 'x', 'category']);
  eq('original spelling (with its own casing/whitespace) is preserved in the map, not canonicalised',
    map.columns.map(c => c.header), h);
}

// ------------------------------------------------------------------ empty grade column falls through, not misreported
section('A schema-default grade column with zero real data does not claim the grade role');
{
  const h = ['hole_id', 'from_m', 'to_m', 'sn_kgm3', 'au_gpt'];
  // au_gpt present in the header (as many multi-commodity templates carry) but every
  // value is empty -- same rule Core/Assay/Resource already apply before this module
  // existed ("only returns columns that actually contain non-null numeric data").
  const sample = [['H1', 0, 1, 0.5, ''], ['H1', 1, 2, 0.6, ''], ['H1', 2, 3, 0.7, '']];
  const map = classifyColumns(h, sample);
  eq('sn_kgm3 (has real values) is grade', roleOf(map, 'sn_kgm3'), 'grade');
  eq('au_gpt (all empty) is not reported as a live grade column for this dataset',
    roleOf(map, 'au_gpt') !== 'grade', true);
}

// ------------------------------------------------------------------ columnsByRole helper
section('columnsByRole() reads the same map the structural contract checked');
{
  const h = ['hole_id', 'from_m', 'to_m', 'au_gpt', 'ag_gpt', 'lithology'];
  const map = classifyColumns(h, rows(h, { hole_id: 'H', lithology: 'AND' }, 3));
  eq('columnsByRole(map, "grade") lists both grade columns, in file order',
    columnsByRole(map, 'grade'), ['au_gpt', 'ag_gpt']);
}

// ---------------------------------------------------------------------------
section('Unit-notation grade headers (audit 2026-09-25)');
// Real lab/spreadsheet headers. Before this, none matched: Assay imported such a
// file as "complete" with zero grade elements; Core kept "Cu (%)" as raw text.
const notation = {
  'Au (g/t)': 'au_gpt', 'Au g/t': 'au_gpt', 'Au_g/t': 'au_gpt', 'Au_gt': 'au_gpt', 'AU (G/T)': 'au_gpt',
  'Ni (%)': 'ni_pct', 'Ni %': 'ni_pct', 'Ni%': 'ni_pct', 'Ni_%': 'ni_pct', 'Ni (wt%)': 'ni_pct', 'Ni persen': 'ni_pct',
  'Cu (ppm)': 'cu_ppm', 'Au ppb': 'au_ppb', 'Fe2O3 (%)': 'fe2o3_pct', 'MgO %': 'mgo_pct', 'S %': 's_pct',
  'Sn (kg/m3)': 'sn_kgm3', 'Sn (kg/m\u00b3)': 'sn_kgm3',
};
for (const [h, want] of Object.entries(notation)) eq(`"${h}" -> ${want}`, canonicalGradeName(h), want);
for (const h of ['To', 'From', 'Pb', 'CU', 'Au_FA', 'Y (m)', 'At (m)', 'Depth (m)', 'Recovery %', 'RQD %', 'Litho', 'Hole'])
  eq(`"${h}" is not a unit-notation grade header`, canonicalGradeName(h), null);
{
  const m = classifyColumns(['Hole_ID', 'From', 'To', 'Au (g/t)', 'Cu (%)'], [['A', 0, 1, 1.2, 0.4]]);
  eq('classifyColumns: "Au (g/t)" is a g/t grade', [columnRole(m, 'Au (g/t)'), m.columns[3].unit], ['grade', 'gpt']);
  eq('classifyColumns: "Cu (%)" is a % grade', [columnRole(m, 'Cu (%)'), m.columns[4].unit], ['grade', 'pct']);
}
eq('planGradeRenames: renames notation headers', JSON.stringify(planGradeRenames(['hole_id', 'Au (g/t)', 'Cu (%)'])),
   JSON.stringify({ 'Au (g/t)': 'au_gpt', 'Cu (%)': 'cu_pct' }));
eq('planGradeRenames: never overwrites an existing canonical column', JSON.stringify(planGradeRenames(['au_gpt', 'Au (g/t)'])), '{}');
eq('planGradeRenames: two headers claiming one name -> neither renamed', JSON.stringify(planGradeRenames(['Cu %', 'Cu (%)'])), '{}');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
