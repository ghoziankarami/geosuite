#!/usr/bin/env node
/**
 * shared-dataset-boundary.mjs — Unit tests for src/shared/data/dataset.js
 * (docs/PLAN-refactor-dataset-kolom.md Tahap 4, the pure/testable half).
 *
 * What this proves:
 *   - createDataset() never returns an object that shares rows or the column
 *     array with its input. That is the property D12 needed: the bundled sample
 *     must be copyable without a later bundle load mutating it in place.
 *   - cols/columns/headers are one list, not three that can drift (the root of
 *     the D10/D11/D15 family -- a derived-column writer reading DATA.cols on an
 *     uploaded dataset that only set `columns`).
 *   - source is explicit, so "is this the sample?" is a field read rather than
 *     an object-identity comparison that silently flips once anyone copies.
 *   - a row-less input throws instead of yielding an empty dataset that would
 *     report success for data that never loaded (D18).
 *
 * Zero dependencies, runs in the gate tier.
 *
 * Run: node shared-dataset-boundary.mjs
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
const MOD = path.join(REPO_ROOT, 'src', 'shared', 'data', 'dataset.js');
if (!fs.existsSync(MOD)) { console.error(`FATAL: ${MOD} not found`); process.exit(2); }

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(MOD, 'utf8'), sandbox, { filename: MOD });

const { createDataset, isSampleDataset, DATASET_SOURCE } = sandbox;
for (const [name, fn] of Object.entries({ createDataset, isSampleDataset })) {
  if (typeof fn !== 'function') { console.error(`FATAL: ${name} did not load`); process.exit(2); }
}
if (!DATASET_SOURCE || DATASET_SOURCE.SAMPLE !== 'sample') {
  console.error('FATAL: DATASET_SOURCE did not load'); process.exit(2);
}

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' -- ' + detail : ''}`); }
}
function throws(label, fn, re) {
  try { fn(); fail++; console.log(`  ✗ ${label} -- did not throw`); }
  catch (e) {
    if (!re || re.test(e.message)) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label} -- wrong error: ${e.message}`); }
  }
}

console.log('createDataset — copies, never aliases');
{
  const sample = { rows: [[1, 2], [3, 4]], cols: ['a', 'b'], name: 'sample' };
  const ds = createDataset(sample, { source: DATASET_SOURCE.SAMPLE });
  ok('returns a different object from its input', ds !== sample);
  ok('rows array is a new array', ds.rows !== sample.rows);
  ok('rows elements are new arrays (deep enough that in-place row writes cannot reach the sample)',
     ds.rows[0] !== sample.rows[0] && ds.rows[0][0] === 1);
  ok('cols array is a new array', ds.cols !== sample.cols);
  ok('columns and headers point at the SAME array as cols (three names, one list)',
     ds.columns === ds.cols && ds.headers === ds.cols);
  ok('column values survive the copy', ds.cols.join(',') === 'a,b');
  ok('rowCount reflects the source row count', ds.rowCount === 2);

  // The D12 property stated directly: mutating the copy must not touch the sample.
  ds.rows[0][0] = 999;
  ds.cols.push('c');
  ok('mutating the copy leaves the original rows untouched', sample.rows[0][0] === 1);
  ok('mutating the copy leaves the original columns untouched', sample.cols.length === 2);
}

console.log('\ncreateDataset — accepts every real input shape');
{
  // mergeSingle()/mergeMultiFile() return {rows, columns} and never set cols.
  const uploaded = createDataset({ rows: [[1]], columns: ['x'] });
  ok('{columns} input is read into cols/columns/headers alike',
     uploaded.cols.join() === 'x' && uploaded.columns === uploaded.cols && uploaded.headers === uploaded.cols);

  const fromHeaders = createDataset({ rows: [[1]], headers: ['h'] });
  ok('{headers}-only input is read too', fromHeaders.cols.join() === 'h');

  const bare = createDataset({ rows: [[1]] });
  ok('a row-only input yields an empty (not undefined) column list', Array.isArray(bare.cols) && bare.cols.length === 0);

  const flat = createDataset({ rows: [1, 2, 3] });
  ok('non-array rows are copied as-is, not crashed on', flat.rows.length === 3 && flat.rows[0] === 1);
}

console.log('\nsource is a field, not an identity guess');
{
  const asSample = createDataset({ rows: [[1]] }, { source: DATASET_SOURCE.SAMPLE });
  ok('sample source round-trips', asSample.source === 'sample');
  ok('isSampleDataset(sample) is true', isSampleDataset(asSample) === true);
  ok('isSampleDataset(upload) is false', isSampleDataset(createDataset({ rows: [[1]] })) === false);
  ok('an unspecified source defaults to upload, never sample',
     createDataset({ rows: [[1]] }).source === DATASET_SOURCE.UPLOAD);
  ok('isSampleDataset(null) is false rather than throwing', isSampleDataset(null) === false);
  ok('two dataset objects with equal contents are distinguishable by source',
     createDataset({ rows: [[1]] }, { source: 'sample' }).source !== createDataset({ rows: [[1]] }, { source: 'upload' }).source);
}

console.log('\nopts override input without mutating it');
{
  const input = { rows: [[1]], cols: [], units: { au: 'g/t' }, name: 'in' };
  const ds = createDataset(input, { name: 'out', units: { au: 'ppm' } });
  ok('opts.name wins', ds.name === 'out');
  ok('opts.units wins', ds.units.au === 'ppm');
  ok('the input units object was not mutated', input.units.au === 'g/t');
  ok('units is a copy, not the caller\'s object', ds.units !== input.units);
}

console.log('\nmissing rows is an error, not an empty dataset');
{
  throws('createDataset({}) throws', () => createDataset({}), /rows must be an array/);
  throws('createDataset(null) throws', () => createDataset(null), /rows must be an array/);
  throws('createDataset({rows: "x"}) throws', () => createDataset({ rows: 'x' }), /rows must be an array/);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
