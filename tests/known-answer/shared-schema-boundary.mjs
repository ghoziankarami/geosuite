#!/usr/bin/env node
/**
 * shared-schema-boundary.mjs — Unit tests for src/shared/io/schema.js
 * (docs/PLAN-refactor-dataset-kolom.md Tahap 2).
 *
 * Loads parse.js, columns.js AND schema.js into ONE vm context, the way
 * build/build.mjs's @orebit-inline resolution puts all of src/shared/io/*
 * into one phase's script scope -- schema.js calls _parseSchemaComments()
 * (parse.js) and reads COLUMN_ROLES (columns.js), so testing it alone
 * would not catch a real cross-file break.
 *
 * What this proves:
 *   - round-trip: a ColumnMap survives write -> read -> write -> read (the
 *     Core -> Assay -> Resource handoff, simulated at the data level since
 *     schema.js is phase-agnostic) with every header, role and unit intact
 *     (D16: no partial canonicalisation) -- including the real tin-placer
 *     fixture's SN_KGM3/BD_TM3, tying Tahap 1's fix to Tahap 2's transport.
 *   - v1 back-compat: a v1 file (today's real export shape) reads back
 *     with EXACTLY the same units/schema/source/notes _parseSchemaComments
 *     already gives it -- schema.js changes nothing for v1 (exit criterion).
 *   - a v2 file opened by v1-only logic degrades to v1 fields, not a parse
 *     error (the `# columns:` line matches none of _parseSchemaComments'
 *     own patterns).
 *   - header names containing the line's own delimiters (',', '=', ':')
 *     round-trip via escaping instead of corrupting the parse.
 *
 * Run: node shared-schema-boundary.mjs
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
for (const file of ['parse.js', 'columns.js', 'schema.js']) {
  const p = path.join(IO_DIR, file);
  if (!fs.existsSync(p)) { console.error(`FATAL: ${p} not found`); process.exit(2); }
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
}

const { classifyColumns, writeSchemaV2Lines, readSchema, buildColumnsHeaderLine, parseColumnsHeaderLine } = sandbox;
for (const [name, fn] of Object.entries({ classifyColumns, writeSchemaV2Lines, readSchema })) {
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

function rows(headers, n) { return Array.from({ length: n }, (_, i) => headers.map(() => i)); }

// ------------------------------------------------------------ round trip through 3 "phases"
section('Round trip: Core -> Assay -> Resource (real tin-placer fixture)');
{
  const FIX = path.join(__dirname, '..', 'fixtures', 'columns', 'tin-placer');
  const headers = fs.readFileSync(path.join(FIX, 'assay.csv'), 'utf8').split(/\r?\n/)[0].split(',');
  const original = classifyColumns(headers, rows(headers, 5));

  // "Core" writes it.
  const coreText = writeSchemaV2Lines({ source: 'phase1-core', columnMap: original }).join('\n')
    + '\n' + headers.join(',') + '\ndata,line,here\n';
  const afterCore = readSchema(coreText);
  eq('Core -> Assay: version is 2', afterCore.version, 2);
  eq('Core -> Assay: every header/role/unit survives exactly', afterCore.columnMap.columns, original.columns);

  // "Assay" re-writes the SAME map (unchanged) for Resource.
  const assayText = writeSchemaV2Lines({ source: 'phase2-eda', columnMap: afterCore.columnMap }).join('\n')
    + '\n' + headers.join(',') + '\ndata,line,here\n';
  const afterAssay = readSchema(assayText);
  eq('Assay -> Resource: still every header/role/unit exact, two hops later', afterAssay.columnMap.columns, original.columns);
  eq('SN_KGM3 is still grade:kgm3 after two round trips (D10 fix actually survives the handoff)',
    afterAssay.columnMap.columns.find(c => c.header === 'SN_KGM3'), { header: 'SN_KGM3', role: 'grade', unit: 'kgm3' });
  eq('BD_TM3 is still density after two round trips (D11 fix actually survives the handoff)',
    afterAssay.columnMap.columns.find(c => c.header === 'BD_TM3'), { header: 'BD_TM3', role: 'density', unit: null });
}

// ------------------------------------------------------------ whole corpus, not just tin
section('Round trip holds for every commodity in Tahap 1\'s corpus, not only tin');
{
  const CORPUS = {
    'gold-silver': ['hole_id', 'from_m', 'to_m', 'au_gpt', 'ag_gpt'],
    'copper-porphyry': ['hole_id', 'from_m', 'to_m', 'cu_pct', 'mo_ppm', 'ag_gpt'],
    'nickel-laterite': ['hole_id', 'from_m', 'to_m', 'NI_PCT', 'CO_PCT', 'FE_PCT', 'MGO_PCT'],
    bauxite: ['hole_id', 'from_m', 'to_m', 'al2o3_pct', 'sio2_pct', 'fe2o3_pct'],
    'alluvial-tin': ['hole_id', 'from_m', 'to_m', 'sn_kgm3', 'bd_tm3'],
    ree: ['hole_id', 'from_m', 'to_m', 'y_ppm', 'nd_ppm', 'ce_ppm'],
    coal: ['hole_id', 'from_m', 'to_m', 'cv_kcal_kg', 'ash_pct', 'sulfur_pct', 'seam'],
  };
  let allOk = true;
  for (const [name, headers] of Object.entries(CORPUS)) {
    const map = classifyColumns(headers, rows(headers, 4));
    const text = writeSchemaV2Lines({ source: 'phase1-core', columnMap: map }).join('\n') + '\nx\n';
    const read = readSchema(text);
    const ok = JSON.stringify(read.columnMap.columns) === JSON.stringify(map.columns);
    if (!ok) { console.log(`     ${name} did not round-trip: ${JSON.stringify(read.columnMap.columns)}`); allOk = false; }
  }
  assert('all 7 commodity groups round-trip with zero loss', allOk);
}

// ------------------------------------------------------------ D16: original spelling preserved, not partially canonicalised
section('D16: mixed-case / partially-aliased headers keep their EXACT original spelling');
{
  const headers = ['BHID', 'FROM', 'TO', 'NI_PCT', 'CO_PCT', 'Fe_Pct'];
  const map = classifyColumns(headers, rows(headers, 4));
  const text = writeSchemaV2Lines({ source: 'phase1-core', columnMap: map }).join('\n');
  const read = readSchema(text + '\nheader,line\n1,2\n');
  eq('NI_PCT, CO_PCT and Fe_Pct all keep their own original casing (no partial lowercasing)',
    read.columnMap.columns.map(c => c.header), headers);
}

// ------------------------------------------------------------ v1 back-compat
section('v1 back-compat: a real v1 export reads back exactly as before');
{
  const v1Text = [
    '# orebit-schema=v1 source=phase1-core',
    '# units: au_gpt=gpt, ag_gpt=gpt',
    '# notes: BDL applied per STATE.bdlMode. Grade columns dynamically detected from input.',
    'hole_id,from_m,to_m,au_gpt,ag_gpt',
    'H01,0,1,5.2,12.1',
  ].join('\n');
  const { meta: rawMeta } = sandbox._parseSchemaComments(v1Text);
  const viaSchema = readSchema(v1Text);
  eq('schema.js reports the same version as a v1 marker implies', viaSchema.version, 1);
  eq('units come out identical to parse.js\'s own _parseSchemaComments (nothing re-interpreted)',
    viaSchema.units, rawMeta.units);
  eq('source identical', viaSchema.source, rawMeta.source);
  eq('notes identical', viaSchema.notes, rawMeta.notes);
  eq('no columnMap fabricated for a v1-only file', viaSchema.columnMap, null);
}

// ------------------------------------------------------------ forward-compat: old reader sees a v2 file as v1
section("Forward direction: a v1-only reader's own patterns ignore the v2 columns: line harmlessly");
{
  const headers = ['hole_id', 'from_m', 'to_m', 'au_gpt'];
  const map = classifyColumns(headers, rows(headers, 3));
  const v2Text = writeSchemaV2Lines({ source: 'phase1-core', columnMap: map }).join('\n')
    + '\nhole_id,from_m,to_m,au_gpt\nH01,0,1,5.2\n';
  const { meta } = sandbox._parseSchemaComments(v2Text);
  assert('the raw v1 parser does not choke on the extra `# columns:` line', meta !== null);
  eq('and does not mistake it for a `units:` line (units stays empty, not corrupted)', meta.units, {});
}

// ------------------------------------------------------------ escaping
section('Escaping: header names containing the line\'s own delimiters');
{
  const headers = ['hole_id', 'Grade (Au, g/t)', 'Ratio Au:Ag', 'weird=name'];
  const map = classifyColumns(headers, rows(headers, 3));
  const line = buildColumnsHeaderLine(map);
  const parsed = parseColumnsHeaderLine(line);
  eq('all four original headers round-trip byte-for-byte through escaping',
    parsed.columns.map(c => c.header), headers);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
