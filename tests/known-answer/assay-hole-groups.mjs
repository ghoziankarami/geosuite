// Exercise the actual per-call Assay owner: typed keys, order and source identity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.existsSync(path.join(here, '../../../src')) ? path.resolve(here, '../../..') : path.resolve(here, '../..');
const sourcePath = fs.existsSync(path.join(root, 'phases/Assay.html')) ? 'phases/Assay.html' : 'exe-wrapper/pywebview/phases/Assay.html';
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
const owner = source.match(/^function _assayHoleRows\(rows, holeIndex\) \{[\s\S]*?^\}/m);
assert.ok(owner, 'The actual Assay grouping owner must exist');
const group = vm.runInNewContext(owner[0] + '\n_assayHoleRows');
const objectA = {}, objectB = {};
const rows = [
  ['H2', 0], [1, 1], ['H1', 2], ['1', 3], ['H2', 4],
  [NaN, 5], [undefined, 6], [null, 7], ['', 8], [false, 9],
  [-0, 10], [+0, 11], [objectA, 12], [objectB, 13], [objectA, 14],
];
const result = group(rows, 0);
assert.equal(result.holes.length, 12);
assert.deepEqual(Array.from(result.holes.slice(0, 5)), ['H2', 1, 'H1', '1', NaN]);
assert.deepEqual(Array.from(result.byHole.get('H2')), [rows[0], rows[4]]);
assert.deepEqual(Array.from(result.byHole.get(1)), [rows[1]]);
assert.deepEqual(Array.from(result.byHole.get('1')), [rows[3]]);
assert.equal(result.byHole.has(NaN), false, 'NaN never satisfies strict equality');
for (const [key, indexes] of [[undefined, [6]], [null, [7]], ['', [8]], [false, [9]], [0, [10, 11]], [objectA, [12, 14]], [objectB, [13]]]) {
  assert.deepEqual(Array.from(result.byHole.get(key)), indexes.map(i => rows[i]));
  for (let i = 0; i < indexes.length; i++) assert.equal(result.byHole.get(key)[i], rows[indexes[i]], 'Retain original rows, rather than copies or reordered measurements');
}
assert.ok(Object.is(rows[10][0], -0), 'Grouping does not normalize source values');
rows[0][0] = 'corrected';
const revised = group(rows, 0);
assert.deepEqual(Array.from(revised.byHole.get('corrected')), [rows[0]]);
assert.deepEqual(Array.from(revised.byHole.get('H2')), [rows[4]]);
assert.equal(revised.holes[0], 'corrected', 'Every call sees current input/order');
assert.equal(group([], 0).byHole.size, 0);
assert.deepEqual(Array.from(group(rows, -1).byHole.get(undefined)), rows, 'Missing column retains former strict undefined matching');
console.log('PASS actual Assay grouping: typed/NaN/missing keys, source order/identity and fresh corrections.');
