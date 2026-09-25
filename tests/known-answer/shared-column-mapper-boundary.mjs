/**
 * Boundary test for src/shared/ui/column-mapper.js (docs/PLAN-refactor-dataset-
 * kolom.md Tahap 3). The module is string-in/string-out on purpose, so the part
 * that must be identical in every phase -- WHAT THE USER IS TOLD -- is testable
 * here without a browser. Loaded through vm from the real source, never a copy.
 *
 *   D17 - every rejected row appears in the HTML with its line number.
 *   D18 - the verdict/warnings come from the report: a file with no grade
 *         column is never rendered as a plain green success.
 *   D7  - a blocked report names the missing roles and, when the old dataset
 *         is still active, says so ("not applied yet -- still showing: X").
 *   jebakan #9 - planCanonicalRenames() only renames when exactly one header
 *         holds a role and the canonical name is absent; never on ambiguity.
 *
 * Run: node shared-column-mapper-boundary.mjs   Exit: 0 pass, 1 fail
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
    dir = path.dirname(dir);
  }
  throw new Error('repo root not found above ' + start);
}
const SHARED = path.join(findRepoRoot(__dirname), 'src', 'shared');
const sandbox = {};
vm.createContext(sandbox);
for (const f of ['io/index.js', 'io/parse.js', 'io/columns.js', 'io/import.js', 'ui/column-mapper.js']) {
  const p = path.join(SHARED, f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
}
const { parseDrillholeCSVTokens, coerceTokenRows, buildImportReport, renderImportReportHtml, planCanonicalRenames, classifyColumns } = sandbox;
for (const [n, fn] of Object.entries({ renderImportReportHtml, planCanonicalRenames, buildImportReport })) {
  if (typeof fn !== 'function') { console.error('FATAL: ' + n + ' did not load'); process.exit(2); }
}

let passed = 0, failed = 0;
const assert = (d, ok) => { ok ? passed++ : failed++; console.log(`  ${ok ? '✅' : '❌'} ${d}`); return ok; };
const attr = (html, name) => { const m = new RegExp(name + '="([^"]*)"').exec(html); return m ? m[1] : null; };

function report(csv, phase) {
  const tk = parseDrillholeCSVTokens(csv, {});
  return buildImportReport(tk.headers, tk.tokenRows, tk.rejected, phase);
}

console.log('\nD17 -- rejected rows are named');
{
  const rows = Array.from({ length: 10 }, (_, i) => `H${i},${i},${i + 1},AND,5.0`);
  rows[4] = 'H4,4';
  const rep = report('hole_id,from_m,to_m,lithology,au_gpt\n' + rows.join('\n') + '\n', 'Assay');
  const html = renderImportReportHtml(rep, {});
  assert('rejected count is in the data attribute', attr(html, 'data-import-rejected') === '1');
  assert('the rejected line number is in the text', html.includes('line ' + rep.rejected[0].line + ':'));
  assert('not rendered as a green success', !html.includes('class="hint good"'));
}

console.log('\nD18 -- verdict comes from the report');
{
  const litho = report('hole_id,from_m,to_m,lithology\nH1,0,1,AND\nH2,0,1,AND\n', 'Assay');
  const h1 = renderImportReportHtml(litho, {});
  assert('no grade column -> no_grade_columns warning attribute', attr(h1, 'data-import-warnings') === 'no_grade_columns');
  assert('...and not a green success', !h1.includes('class="hint good"'));
  const clean = report('hole_id,from_m,to_m,au_gpt\nH1,0,1,1.5\nH2,0,1,2.5\n', 'Assay');
  const h2 = renderImportReportHtml(clean, {});
  assert('clean file IS a green success', h2.includes('class="hint good"') && attr(h2, 'data-import-ready') === 'true');
  assert('clean file has no warnings', attr(h2, 'data-import-warnings') === '');
}

console.log('\nD7 -- blocked report + pending notice');
{
  const rep = report('hole_id,d_start,d_end,au_gpt\nH1,0,1,1.5\n', 'Assay');
  const h = renderImportReportHtml(rep, { pendingName: 'the bundled sample dataset' });
  assert('ready=false', attr(h, 'data-import-ready') === 'false');
  assert('missing roles listed', attr(h, 'data-import-missing') === 'from,to');
  assert('pending flag set', attr(h, 'data-import-pending') === '1');
  assert('old dataset is named', h.includes('still showing: the bundled sample dataset'));
  const noPending = renderImportReportHtml(rep, {});
  assert('no pending flag when the caller gives no pendingName', attr(noPending, 'data-import-pending') === null);
}

console.log('\ni18n hook -- tr() wins, English default fills gaps');
{
  const rep = report('hole_id,d_start,d_end\nH1,0,1\n', 'Assay');
  const tr = (k, v) => k === 'import.title.blocked' ? 'JUDUL-ID' : k;   // returns the key when it has no entry
  const h = renderImportReportHtml(rep, { tr });
  assert('translated key used', h.includes('JUDUL-ID'));
  assert('untranslated key falls back to English, never to a raw key', h.includes('Rows loaded: 1') && !h.includes('import.rows'));
}

console.log('\nHTML is escaped');
{
  const rep = buildImportReport(['hole_id', '<img onerror=x>', 'to_m'], [['H1', 1, 2]], [{ line: 3, reason: '<b>bad</b>', raw: '' }], 'Assay');
  const h = renderImportReportHtml(rep, {});
  assert('header text escaped', !h.includes('<img onerror=x>') && h.includes('&lt;img onerror=x&gt;'));
  assert('reason escaped', !h.includes('<b>bad</b>'));
}

console.log('\njebakan #9 -- planCanonicalRenames');
{
  const canon = { hole_id: 'hole_id', from: 'from_m', to: 'to_m' };
  const cm = (headers, rows) => classifyColumns(headers, rows);
  const one = ['hole_id', 'depth_from', 'depth_to', 'au_gpt'];
  const r1 = planCanonicalRenames(cm(one, [['H1', 0, 1, 2]]), canon, one);
  assert('one holder per role -> renamed to the canonical name', r1.depth_from === 'from_m' && r1.depth_to === 'to_m');
  const have = ['hole_id', 'from_m', 'to_m', 'au_gpt'];
  assert('canonical name already present -> nothing renamed',
    Object.keys(planCanonicalRenames(cm(have, [['H1', 0, 1, 2]]), canon, have)).length === 0);
  const amb = ['hole_id', 'depth_from', 'from', 'to', 'au_gpt'];
  const cmAmb = cm(amb, [['H1', 0, 0, 1, 2]]);
  const rAmb = planCanonicalRenames(cmAmb, canon, amb);
  assert('two holders of the same role -> left for the manual mapper (never guess)',
    !('depth_from' in rAmb) && !('from' in rAmb));
}

console.log('\nResource options -- own required roles, grade required');
{
  const opts = { required: ['hole_id', 'x', 'y', 'z'], requireGrade: true };
  const tk = (csv) => parseDrillholeCSVTokens(csv, {});
  const run = (csv, o) => { const k = tk(csv); return buildImportReport(k.headers, k.tokenRows, k.rejected, 'Resource', o); };
  const composite = 'hole_id,midx,midy,midz,au_gpt\nH1,1,2,3,1.5\n';
  assert('from/to are SOFT for Resource: a coordinate-only composite export is ready', run(composite, opts).ready === true);
  assert('...whereas the default Resource table (from/to required) would have blocked it', run(composite).ready === false);
  const nograde = run('hole_id,midx,midy,midz,lithology\nH1,1,2,3,AND\n', opts);
  assert('no grade column blocks when the phase requires one', nograde.ready === false && nograde.gradeRequired === true);
  const h = renderImportReportHtml(nograde, {});
  assert('...and the text says the module cannot work without it (not "the file loads")',
    h.includes('cannot work without one') && !h.includes('The file loads'));
  const nocoord = run('hole_id,cx,cy,cz,au_gpt\nH1,1,2,3,1.5\n', opts);
  assert('unrecognised coordinates name x, y, z', JSON.stringify(nocoord.missingRequired) === '["x","y","z"]');
}

console.log('\nactive-dataset label');
{
  sandbox.isSampleDataset = (d) => !!d && d.source === 'sample';
  const label = (d) => sandbox.importActiveDatasetLabel(d, {});
  assert('sample dataset is named as the bundled sample', label({ source: 'sample', rows: [1, 2, 3] }) === 'the bundled sample dataset');
  assert('an upload with a name uses the name', label({ source: 'upload', name: 'a.csv', rows: [1] }) === 'a.csv');
  assert('an unnamed upload says how many rows', label({ source: 'upload', rows: [1, 2] }) === 'your uploaded dataset (2 rows)');
  assert('no dataset', label(null) === 'no dataset');
}

console.log(`\nCOLUMN-MAPPER BOUNDARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
