#!/usr/bin/env node
/**
 * csv-import-regression.mjs — Regression tests for a HAND-WRITTEN CSV parser
 * modelled on Core's parsing style, NOT the real shipped code.
 *
 * CORRECTION (2026-09-02): this file's original docstring claimed to test
 * "the REAL CSV parsing that ships in the production vault HTML", citing
 * "01-Core/Core.html ~line 5300". That was never true and had drifted
 * further since: Core's real upload entry point is readCSV() (currently at
 * a different line), and its behaviour differs from the parseCSV() below in
 * ways that matter -- e.g. this version silently drops rows with fewer
 * fields than the header, which the real readCSV() does not do. A
 * hand-copy that looks extracted is worse than no test: it creates false
 * confidence that production behaviour is covered when it is not.
 *
 * The test that actually characterizes production behaviour is
 * csv-parser-characterization.py, which drives a real headless browser
 * against dist/*.html and calls window.readCSV / window.parseCSV directly
 * -- see PLAN-arsitektur-4.2-4.3.md Langkah 0a for why. This file is kept
 * as a lightweight, dependency-free sanity check of CSV-quoting edge cases
 * in general (useful on its own merits), not as evidence about the shipped
 * parsers. Don't cite it as proof of production behaviour.
 *
 * Run: node csv-import-regression.mjs
 * Exit: 0 = all pass, 1 = any failure
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ── Fixture generator ──
// Create realistic CSV samples with known edge cases
function writeFixtures() {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // 1. Normal valid CSV (standard DH survey)
  fs.writeFileSync(path.join(FIXTURES_DIR, 'valid-survey.csv'),
    'HOLEID,FROM,TO,X,Y,Z\n' +
    'DH001,0,1,1000,2000,500\n' +
    'DH001,1,2,1000.5,2000.3,499\n' +
    'DH001,2,3,1001,2000.6,498\n'
  );

  // 2. CSV with BOM + Windows CRLF
  fs.writeFileSync(path.join(FIXTURES_DIR, 'bom-crlf.csv'),
    '\ufeffHOLEID,FROM,TO,X,Y,Z\r\n' +
    'DH001,0,1,1000,2000,500\r\n' +
    'DH001,1,2,1000.5,2000.3,499\r\n'
  );

  // 3. CSV with empty lines in middle
  fs.writeFileSync(path.join(FIXTURES_DIR, 'empty-lines.csv'),
    'HOLEID,FROM,TO,X,Y,Z\n' +
    'DH001,0,1,1000,2000,500\n' +
    '\n' +
    'DH001,1,2,1000.5,2000.3,499\n' +
    '   \n' +
    'DH001,2,3,1001,2000.6,498\n'
  );

  // 4. CSV with trailing commas + spaces
  fs.writeFileSync(path.join(FIXTURES_DIR, 'trailing-spaces.csv'),
    'HOLEID,FROM,TO,X,Y,Z\n' +
    'DH001,0,1,1000,2000,500,\n' +
    'DH001, 1 , 2 , 1000.5 , 2000.3 , 499\n'
  );

  // 5. CSV with quotes (grade data)
  fs.writeFileSync(path.join(FIXTURES_DIR, 'quoted-fields.csv'),
    'HOLEID,FROM,TO,AU,CU\n' +
    'DH001,0,1,2.5,"3.0"\n' +
    'DH001,1,2,"4,0",5.5\n'
  );

  // 6. CSV with NaN/missing values
  fs.writeFileSync(path.join(FIXTURES_DIR, 'missing-values.csv'),
    'HOLEID,FROM,TO,AU,CU\n' +
    'DH001,0,1,2.5,\n' +
    'DH001,1,2,,5.5\n' +
    'DH001,2,3,N/A,3.0\n' +
    'DH001,3,4,0,0\n'
  );

  // 7. Large file (simulate big dataset — 1000 rows)
  let bigCsv = 'HOLEID,FROM,TO,AU,CU\n';
  for (let i = 0; i < 1000; i++) {
    bigCsv += `DH001,${i},${i+1},${Math.random()*10},${Math.random()*5}\n`;
  }
  fs.writeFileSync(path.join(FIXTURES_DIR, 'big-dataset.csv'), bigCsv);

  // 8. Single row (minimum valid)
  fs.writeFileSync(path.join(FIXTURES_DIR, 'single-row.csv'),
    'HOLEID,FROM,TO,AU\nDH001,0,1,2.5\n'
  );

  return Object.fromEntries(
    fs.readdirSync(FIXTURES_DIR).map(f => [f, fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')])
  );
}

// ── Parse function (hand-written, modelled on Core's style -- NOT extracted
// from production; see the corrected file-level docstring above) ──
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let headers = null;
  let rowErrors = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    // Parse with CSV quoting support
    const fields = [];
    let current = '';
    let inQuote = false;

    for (let c = 0; c < raw.length; c++) {
      const ch = raw[c];
      if (inQuote) {
        if (ch === '"') {
          if (c + 1 < raw.length && raw[c + 1] === '"') {
            current += '"'; c++;  // escaped quote ""
          } else {
            inQuote = false;      // close quote
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;          // open quote
        } else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());  // last field

    if (!headers) {
      headers = fields;
      continue;
    }

    // Skip rows with wrong column count (too few or too many)
    if (fields.length < headers.length) {
      rowErrors++;
      continue;
    }

    const row = {};
    for (let j = 0; j < headers.length; j++) {
      const val = fields[j] || '';
      // Handle "N/A", empty, NaN as null
      row[headers[j]] = (val === '' || val.toUpperCase() === 'N/A' || val === 'NaN' || val === 'null')
        ? null : val;
    }
    rows.push(row);
  }

  return { headers, rows, rowErrors, totalLines: lines.length };
}

// ── Test runner ──
let passed = 0, failed = 0;

function assert(desc, ok) {
  if (ok) { passed++; console.log(`  ✅ ${desc}`); }
  else    { failed++; console.log(`  ❌ ${desc}`); }
}
function section(s) { console.log(`\n── ${s} ──`); }

// ═══════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════
const fixtures = writeFixtures();

section('1. Valid standard CSV');
{
  const r = parseCSV(fixtures['valid-survey.csv']);
  assert('3 data rows parsed', r.rows.length === 3);
  assert('5 headers found', r.headers.length === 6);
  assert('HOLEID=DH001 on first row', r.rows[0]['HOLEID'] === 'DH001');
  assert('X=1000.5 on second row', r.rows[1]['X'] === '1000.5');
  assert('0 row errors', r.rowErrors === 0);
}

section('2. BOM + Windows CRLF');
{
  const r = parseCSV(fixtures['bom-crlf.csv']);
  assert('2 data rows parsed (BOM filtered)', r.rows.length === 2);
  assert('HOLEID=DH001 on row 1', r.rows[0]['HOLEID'] === 'DH001');
  assert('0 row errors', r.rowErrors === 0);
}

section('3. Empty lines in middle');
{
  const r = parseCSV(fixtures['empty-lines.csv']);
  assert('3 data rows parsed (empty lines skipped)', r.rows.length === 3);
  assert('0 row errors', r.rowErrors === 0);
}

section('4. Trailing commas + spaces');
{
  const r = parseCSV(fixtures['trailing-spaces.csv']);
  assert('2 data rows parsed', r.rows.length === 2);
  // Row with trailing comma — extra field for last header (Z) = ' ', trimmed
  // Row with spaces — values trimmed
  assert('Z=500 on row 1 (trailing comma ignored)', r.rows[0]['Z'] === '500');
  assert('Y=2000.3 on row 2 (spaces trimmed)', r.rows[1]['Y'] === '2000.3');
  assert('0 row errors', r.rowErrors === 0);
}

section('5. Quoted fields');
{
  const r = parseCSV(fixtures['quoted-fields.csv']);
  assert('2 data rows parsed', r.rows.length === 2);
  assert('CU=3.0 on row 1 (quoted)', r.rows[0]['CU'] === '3.0');
  // "4,0" in quotes should parse as "4,0" (commas inside quotes preserved)
  assert('AU=4,0 on row 2 (comma preserved in quotes)', r.rows[1]['AU'] === '4,0');
  assert('0 row errors', r.rowErrors === 0);
}

section('6. Missing/NaN values');
{
  const r = parseCSV(fixtures['missing-values.csv']);
  assert('4 data rows parsed', r.rows.length === 4);
  assert('Row 1 CU=null (empty)', r.rows[0]['CU'] === null);
  assert('Row 2 AU=null (empty)', r.rows[1]['AU'] === null);
  assert('Row 3 AU=null (N/A)', r.rows[2]['AU'] === null);
  assert('Row 4 AU=0 (preserved)', r.rows[3]['AU'] === '0');
  assert('0 row errors', r.rowErrors === 0);
}

section('7. Large dataset (1000 rows)');
{
  const r = parseCSV(fixtures['big-dataset.csv']);
  assert('1000 data rows parsed', r.rows.length === 1000);
  assert('5 headers', r.headers.length === 5);
  assert('0 row errors', r.rowErrors === 0);
  assert('First row AU is number', !isNaN(parseFloat(r.rows[0]['AU'])));
  assert('Last row CU is number', !isNaN(parseFloat(r.rows[999]['CU'])));
}

section('8. Single row (minimum valid)');
{
  const r = parseCSV(fixtures['single-row.csv']);
  assert('1 data row parsed', r.rows.length === 1);
  assert('AU=2.5', r.rows[0]['AU'] === '2.5');
  assert('0 row errors', r.rowErrors === 0);
}

// ── Summary ──
console.log(`\n═══════════════════════════════════`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
console.log(`═══════════════════════════════════`);
process.exit(failed > 0 ? 1 : 0);
