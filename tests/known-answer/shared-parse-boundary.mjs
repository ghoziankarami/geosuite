#!/usr/bin/env node
/**
 * shared-parse-boundary.mjs — Unit tests for src/shared/io/parse.js against
 * the Langkah 0b corpus (PLAN-arsitektur-4.2-4.3.md, Tahap 4.2 Commit #3).
 *
 * WHY vm, NOT A HAND-COPY OR eval()
 *   src/shared/io/parse.js deliberately has no `export` statement -- it gets
 *   inlined raw into a classic (non-module) <script> tag via @orebit-inline,
 *   matching every other file in src/shared/. A hand-copied test version of
 *   its functions would be exactly the drift risk already found and fixed
 *   in csv-import-regression.mjs (see that file's corrected docstring).
 *   Node's vm module runs the REAL file's source text in an isolated
 *   context and pulls the functions out of it, so there is nothing to keep
 *   in sync by hand.
 *
 * WHAT THIS DOES NOT TEST
 *   parse.js is not wired into any phase yet (Commit #3 of 7 is explicitly
 *   "not wired to any phase yet"). Whether Core/Assay/Resource's REAL
 *   upload path uses this module is what Commits #4-6 change, and what
 *   csv-parser-characterization.py's baseline continues to guard.
 *
 * Run: node shared-parse-boundary.mjs
 * Exit: 0 = all pass, 1 = any failure
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Walk up from this file to find the repo root, rather than hardcoding a
// relative-`..` count that silently breaks if this file ever moves --
// same reasoning as csv-parser-characterization.py's _repo_root().
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
const PARSE_JS = path.join(REPO_ROOT, 'src', 'shared', 'io', 'parse.js');
const CORPUS_DIR = path.join(__dirname, '..', 'fixtures', 'csv-corpus');

if (!fs.existsSync(PARSE_JS)) {
  console.error(`FATAL: ${PARSE_JS} not found`);
  process.exit(2);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(PARSE_JS, 'utf8'), sandbox, { filename: PARSE_JS });

const {
  parseDrillholeCSV, parseResultToObjectRows, parseResultToArrayRows, parseResultToColsRows,
  parseDrillholeCSVTokens, detectDecimalConvention, coerceTokenRows,
} = sandbox;
if (typeof parseDrillholeCSV !== 'function') {
  console.error('FATAL: parseDrillholeCSV did not load from parse.js');
  process.exit(2);
}
if (typeof parseDrillholeCSVTokens !== 'function' || typeof detectDecimalConvention !== 'function'
    || typeof coerceTokenRows !== 'function') {
  console.error('FATAL: the granular multi-file API did not load from parse.js');
  process.exit(2);
}

function readCorpus(name) {
  // Corpus files may carry a real BOM/CRLF on purpose -- read as utf8 text,
  // same as a browser's File API would hand it to the real parsers.
  return fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8');
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

section('01 comma-standard: plain roundtrip');
{
  const r = parseDrillholeCSV(readCorpus('01-comma-standard.csv'));
  eq('delimiter detected', r.delimiter, ',');
  eq('3 rows parsed, 0 rejected', [r.rows.length, r.rejected.length], [3, 0]);
  eq('first row au_gpt coerced to number', r.rows[0].au_gpt, 2.5);
}

section('02 semicolon + European decimal (comma)');
{
  const r = parseDrillholeCSV(readCorpus('02-semicolon-euro-decimal.csv'));
  eq('delimiter detected', r.delimiter, ';');
  eq('decimal detected as comma', r.decimal, ',');
  eq('au_gpt "2,5" -> 2.5', r.rows[0].au_gpt, 2.5);
  eq('cu_pct "0,30" -> 0.3', r.rows[0].cu_pct, 0.3);
}

section('03 tab-delimited');
{
  const r = parseDrillholeCSV(readCorpus('03-tab-delimited.csv'));
  eq('delimiter detected as real tab', r.delimiter, '\t');
  eq('3 rows parsed', r.rows.length, 3);
}

section('04 thousands-comma + decimal-dot in the same column');
{
  const r = parseDrillholeCSV(readCorpus('04-thousands-comma-decimal-dot.csv'));
  eq('delimiter detected', r.delimiter, ';');
  eq('"1,234.56" -> 1234.56 (thousands comma stripped, dot kept as decimal)',
     r.rows[0].tonnage_kg, 1234.56);
  eq('"12,345.60" -> 12345.6', r.rows[1].tonnage_kg, 12345.6);
}

section('05 Indonesian headers: roundtrip, not corrupted');
{
  const r = parseDrillholeCSV(readCorpus('05-indonesian-headers.csv'));
  eq('headers preserved verbatim (schema mapping is NOT this function\'s job)',
     r.headers, ['Lubang', 'Dari', 'Sampai', 'Litho', 'Kedalaman', 'Deskripsi']);
  eq('3 rows, 0 rejected', [r.rows.length, r.rejected.length], [3, 0]);
  eq('free-text field preserved', r.rows[0].Deskripsi, 'Granit lapuk sedang');
}

section('06 Datamine-standard headers: roundtrip');
{
  const r = parseDrillholeCSV(readCorpus('06-datamine-headers.csv'));
  eq('headers preserved verbatim', r.headers,
     ['BHID', 'AT', 'AZ', 'DIP', 'XCOLLAR', 'YCOLLAR', 'ZCOLLAR']);
  eq('DIP negative number survives', r.rows[0].DIP, -60);
}

section('07 BOM + CRLF');
{
  const r = parseDrillholeCSV(readCorpus('07-bom-crlf.csv'));
  eq('BOM stripped from first header', r.headers[0], 'hole_id');
  eq('3 rows despite CRLF line endings, 0 rejected', [r.rows.length, r.rejected.length], [3, 0]);
}

section('08 newline embedded inside a quoted field -- the case Core\'s OLD parser corrupted');
{
  const r = parseDrillholeCSV(readCorpus('08-quoted-newline.csv'));
  eq('2 rows (not corrupted into 3 by the embedded newline)', r.rows.length, 2);
  assert('embedded newline preserved literally inside the field',
    typeof r.rows[0].notes === 'string' && r.rows[0].notes.includes('weathered\ngranite, moderate'));
  eq('second row unaffected', r.rows[1].notes, 'thin vein');
}

section('09 BDL / missing-value markers');
{
  const r = parseDrillholeCSV(readCorpus('09-bdl-markers.csv'));
  const row0 = r.rows[0], row1 = r.rows[1], row2 = r.rows[2], row3 = r.rows[3];
  assert('"<0.5" -> half of detection limit, flagged',
    row0.au_gpt && row0.au_gpt.wasBelowDetection === true && row0.au_gpt.value === 0.25);
  eq('"nd" -> null', row1.au_gpt, null);
  eq('"n/a" -> null', row1.cu_pct, null);
  eq('"-" -> null', row2.au_gpt, null);
  eq('"N/A" (any case) -> null', row3.au_gpt, null);
}

section('10 short row: rejected with a reason, not silently kept');
{
  const r = parseDrillholeCSV(readCorpus('10-short-row.csv'));
  eq('2 good rows, 1 rejected', [r.rows.length, r.rejected.length], [2, 1]);
  assert('rejection reason names the column-count mismatch',
    r.rejected[0] && /column/i.test(r.rejected[0].reason));
  eq('rejection cites the correct source line (1-based, header = line 1)',
     r.rejected[0].line, 3);
}

section('11 schema comment: units regex is the FIXED version (Temuan 2)');
{
  const r = parseDrillholeCSV(readCorpus('11-schema-comment.csv'));
  assert('schemaMeta captured', !!r.schemaMeta);
  eq('units.au = "g/t" (not truncated to "g")', r.schemaMeta.units.au, 'g/t');
  eq('units.cu = "pct"', r.schemaMeta.units.cu, 'pct');
  eq('schema id captured', r.schemaMeta.schema, 'composite-v1');
  eq('3 data rows (comment lines excluded from row count)', r.rows.length, 3);
}

section('12 single column, no delimiter');
{
  const r = parseDrillholeCSV(readCorpus('12-single-column.csv'));
  eq('one header column', r.headers, ['hole_id']);
  eq('3 rows', r.rows.length, 3);
}

section('granular API: multi-file combined decimal detection (Assay\'s real behaviour)');
{
  // Semicolon-delimited so the comma inside each value can't collide with
  // the column separator (same reasoning as corpus cases 02/04).
  //
  // File A alone: one moderately strong dot-decimal token (2 trailing
  // digits, not 3 -> +3 dot, per _parseDetectDecimal's scoring). No comma
  // evidence at all. Judged alone, this file says '.'.
  const fileA = parseDrillholeCSVTokens('hole_id;val\nDH001;572799.17\n', { delimiter: 'semicolon' });
  eq('file A alone: strong dot evidence -> dot', detectDecimalConvention(fileA.tokenRows), '.');

  // File B alone: two unambiguous comma-decimal values (2 trailing digits
  // each, not 3 -> +3 comma each = 6 total, outweighing file A's 3).
  const fileB = parseDrillholeCSVTokens('hole_id;val\nDH002;0,17\nDH002;0,25\n', { delimiter: 'semicolon' });
  eq('file B alone: strong comma evidence -> comma', detectDecimalConvention(fileB.tokenRows), ',');

  // Combined: file A's dot=3 vs file B's comma=6 -- comma wins overall, the
  // OPPOSITE of what file A alone would have concluded if it had been
  // detected in isolation. This is the scenario that actually distinguishes
  // "pool evidence across files" from "detect each file independently and
  // merge some other way": if detectDecimalConvention() only looked at
  // file A's own tokens (per-file detection, Core/Resource's real
  // behaviour), file A would be coerced with dot and 572799.17 would stay
  // 572799.17. Combined (Assay's real behaviour, processUploadedFiles ->
  // autodetectNumberFormat(allTokenRows)), the same token gets coerced with
  // comma instead -- see the assertion below.
  const combined = detectDecimalConvention([...fileA.tokenRows, ...fileB.tokenRows]);
  eq('combined evidence flips the decision to comma (file A alone said dot)', combined, ',');

  const coercedA = coerceTokenRows(fileA, combined);
  const coercedB = coerceTokenRows(fileB, combined);
  eq('file A coerced with the COMBINED (not standalone) decimal: comma-strips the "."',
     coercedA.rows[0].val, 57279917);
  eq('file B coerced consistently: 0,17 -> 0.17', coercedB.rows[0].val, 0.17);
}

section('granular API: single-file wrapper matches the split-call sequence exactly');
{
  // parseDrillholeCSV() is documented as tokens -> detect -> coerce chained
  // for one file. Prove that chaining the granular calls by hand for the
  // SAME file produces a byte-identical result, not just a similar one.
  const text = readCorpus('02-semicolon-euro-decimal.csv');
  const viaWrapper = parseDrillholeCSV(text);
  const tokens = parseDrillholeCSVTokens(text);
  const decimal = detectDecimalConvention(tokens.tokenRows);
  const viaSplit = coerceTokenRows(tokens, decimal);
  eq('wrapper output === manual tokens+detect+coerce chain', viaWrapper, viaSplit);
}

section('adapters: each phase\'s current contract shape');
{
  const r = parseDrillholeCSV(readCorpus('01-comma-standard.csv'));
  const asObjects = parseResultToObjectRows(r);
  assert('toObjectRows: Array<Object> keyed by header (Core shape)',
    Array.isArray(asObjects) && asObjects[0].hole_id === 'DH001');

  const asArrays = parseResultToArrayRows(r);
  assert('toArrayRows: header row at [0] (Assay shape)',
    Array.isArray(asArrays[0]) && asArrays[0][0] === 'hole_id');
  assert('toArrayRows: values stringified',
    typeof asArrays[1][3] === 'string' && asArrays[1][3] === '2.5');

  const asCols = parseResultToColsRows(r);
  assert('toColsRows: {cols, rows} shape (Resource shape)',
    Array.isArray(asCols.cols) && asCols.cols[0] === 'hole_id');
  assert('toColsRows: numeric values stay numeric',
    typeof asCols.rows[0][3] === 'number' && asCols.rows[0][3] === 2.5);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
