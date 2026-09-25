// Shared column classifier (docs/PLAN-refactor-dataset-kolom.md Tahap 1 --
// NOT wired into any phase yet, same convention as parse.js's Tahap 4.2
// Commit #3: this file gets @orebit-inline'd raw into a classic <script>, no
// export statement, tested from Node via vm.runInContext like
// shared-parse-boundary.mjs does for parse.js).
//
// Why this exists: docs/PLAN-integritas-data-assay.md §11-12 traced 88 fix
// commits to the same root cause, repeated three times with independent
// drift -- "what role does this column play?" was answered by a different
// alias table / regex / skip-list in Core, Assay, and Resource. Two of the
// three had already converged byte-for-byte by 2026-08-18/19 (their own
// comments say "Kept in sync with ...", "mirrors the identical fix in ..."),
// which is itself evidence FOR one shared copy rather than three that must
// be remembered to update together -- and the copies still missed something:
// the converged grade regex's unit-suffix group is
//   (_gpt|_ppm|_pct|_ppb|_kg)
// which does not match `_kgm3` or `_gm3` at all ('_kg' needs the string to
// END there). A volumetric commodity's grade column (placer tin, SN_KGM3)
// silently fails EVERY phase's detection because of this one shared gap --
// confirmed empirically (docs/PLAN-integritas-data-assay.md D10): Core,
// Assay and Resource all return zero grade columns for the real tin-placer
// fixture at _meta/tests/fixtures/columns/tin-placer/, and
// test_history_independence.py's core_drops_grade_and_density section
// proves it against the built app, not just by reading this regex.
//
// Contract (the actual fix, not a restatement of what already existed):
//   - EVERY header gets EXACTLY ONE role. Nothing is silently dropped --
//     a header nothing else recognises becomes other_text/other_numeric,
//     never omitted from the ColumnMap. This is what D15 (alteration column
//     dropped by Core's export) and D10/D11 need structurally, not as a
//     patch to one export function.
//   - Original header spelling is preserved (`header` field) alongside the
//     role, so schema v2 (Tahap 2) can round-trip the name a geologist
//     actually typed rather than a canonicalised one (D16: Core lowercases
//     only FE_PCT because it happens to be in an alias list, Assay
//     lowercases NI_PCT but not CO_PCT -- inconsistent partial renaming).
//   - density is a role of its own, not folded into "not a grade" and
//     discarded (D11). category covers lithology-adjacent columns beyond
//     the hardcoded lith1/lith2/weathering triple (D15's ALT/alteration).
//
// Usage (once wired, Tahap 3+): classifyColumns(headers, sampleRows) returns
// a ColumnMap; role(map, name) and byRole(map, role) are the read side.

// ---- roles -----------------------------------------------------------
const COLUMN_ROLES = Object.freeze([
  'hole_id', 'from', 'to', 'x', 'y', 'z', 'at', 'az', 'dip',
  'domain', 'category', 'grade', 'density', 'qc',
  'other_numeric', 'other_text', 'ignored',
]);

// ---- alias tables, merged from the three phases' independent copies --
// (Core.html ~4084-4132, Assay.html ~3547/4636, Resource.html ~4461-4636)
// plus every Indonesian synonym any of the three already had.
const ALIASES = {
  hole_id: ['hole_id', 'holeid', 'hole_id_', 'bhid', 'dhid', 'hole', 'hole_no', 'holename',
    'holeid_', 'drillhole', 'dh_id', 'boreholeid', 'borehole_id', 'no_lubang', 'kode_lubang',
    'nama_lubang', 'lubang', 'id_lubang'],
  from: ['from_m', 'from', 'depth_from', 'from_depth', 'dari', 'kedalaman_dari'],
  to: ['to_m', 'to', 'depth_to', 'to_depth', 'sampai', 'kedalaman_sampai'],
  x: ['midx', 'x', 'xcollar', 'easting', 'east', 'x_collar', 'koordinat_x'],
  y: ['midy', 'y', 'ycollar', 'northing', 'north', 'y_collar', 'koordinat_y'],
  z: ['midz', 'z', 'zcollar', 'elevation', 'elev', 'rl', 'z_collar', 'koordinat_z', 'elevasi', 'ketinggian'],
  at: ['at', 'depth', 'survey_depth', 'kedalaman'],
  az: ['az', 'azimuth', 'azimut', 'bearing'],
  dip: ['dip', 'inclination', 'kemiringan'],
  domain: ['domain', 'domain_id', 'zona', 'zone'],
  // Lithology + the columns Core's fixed alias table hardcodes as its ONLY
  // recognised geology fields (lith1/lith2/weathering/lith_desc/color) --
  // named here so they classify as `category` rather than falling through
  // to other_text, but this list is deliberately NOT exhaustive: any header
  // that looks categorical (a `qc`-detector rejects, low-cardinality text)
  // and isn't consumed elsewhere still resolves to `category` via the
  // fallback pass below, so a commodity-specific field (ALT/alteration,
  // weathering grade, structure) is never silently dropped (D15).
  category: ['lithology', 'lith', 'lith1', 'lithology1', 'rock_type', 'batuan', 'litologi',
    'lith2', 'sub_lith', 'litologi2', 'sub_litologi', 'weathering', 'weather', 'wx',
    'pelapukan', 'tingkat_pelapukan', 'alt', 'alteration', 'alterasi', 'lith_desc', 'color',
    'structure', 'texture'],
  // Density is its own role -- the three phases' grade regex already
  // excludes anything matching /density|berat|volume/i from being
  // mis-typed as a grade, but nothing on the other side ever captured it
  // as a role of its own (D11: measured SG/BD never reaches tonnage).
  density: ['density', 'sg', 'bd', 'bd_tm3', 'density_t_m3', 'density_tm3', 'berat_jenis',
    'bobot_isi', 'bulk_density', 'specific_gravity'],
  qc: ['qc', 'qaqc', 'sample_type', 'batch', 'standard_id', 'is_standard', 'is_blank',
    'is_duplicate', 'field_dup', 'lab_dup', 'sample_id', 'sample'],
};

// Element symbols the three phases already agreed on (Assay.html:4109,
// Resource.html:3971, Core.html:5359 -- byte-identical alternation), so a
// commodity list already proven sufficient for the corpus in production.
const ELEMENT_SYMBOLS = ['au', 'cu', 'pb', 'zn', 'ag', 'ni', 'fe', 'sn', 'w', 'mo', 'co', 'pt',
  'pd', 'as', 'sb', 'bi', 'cr', 'mn', 'ti', 'v', 'u', 'th', 're', 'li', 'be', 'ta', 'nb', 'zr',
  'hf', 'sc', 'y', 'la', 'ce', 'nd', 'pr', 'sm', 'eu', 'gd', 'tb', 'dy', 'ho', 'er', 'tm', 'yb',
  'lu', 'mg', 'si', 'al',
  // Common assay analytes the list above never had: sulfur (S) alone dropped a whole column from real
  // sulfide-deposit files (Babbitt: Cu, Ni, S, Fe); the rest are routine multi-element ICP suite members.
  's', 'p', 'k', 'ca', 'na', 'ba', 'se', 'te', 'hg', 'cd', 'ga', 'ge', 'sr', 'tl', 'rb', 'cs'];

// THE FIX: unit-suffix group widened to also match volumetric units, so a
// grade genuinely reported per volume (placer tin, alluvial deposits) is
// recognised instead of silently vanishing (D10). Each alternative's own
// group captures which unit it is, read out by _unitFromSuffix() below --
// the three phases' original copies threw the match away and only used it
// as a yes/no test, which is also why STATE.units had to be guessed
// separately from column NAME elsewhere instead of coming from this match.
const GRADE_PATTERN =
  /^(au|cu|pb|zn|ag|ni|fe|sn|w|mo|co|pt|pd|as|sb|bi|cr|mn|ti|v|u|th|re|li|be|ta|nb|zr|hf|sc|y|la|ce|nd|pr|sm|eu|gd|tb|dy|ho|er|tm|yb|lu|mg|si|al|s|p|k|ca|na|ba|se|te|hg|cd|ga|ge|sr|tl|rb|cs)(\d?o\d?)?(_gpt|_ppm|_ppb|_pct|_kgm3|_gm3|_kg)?$/i;
const COMPOUND_GRADE_PATTERN =
  /\b(kadar|grade|prsn)\b.*\b(sno2|sn|fe2o3|fe|wo3|w|au|cu|pb|zn|ag|cuo|zno|pbo|moo3|mo)\b/i;

const UNIT_SUFFIX = { gpt: 'gpt', ppm: 'ppm', ppb: 'ppb', pct: 'pct', kgm3: 'kgm3', gm3: 'gm3', kg: 'kgm3' };

function _unitFromSuffix(header) {
  const m = GRADE_PATTERN.exec(header.trim());
  if (!m || !m[3]) return null;
  const key = m[3].slice(1).toLowerCase(); // drop leading '_'
  return UNIT_SUFFIX[key] || null;
}

function _norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Grade headers written the way lab certificates and spreadsheets write them:
// "Au (g/t)", "Au g/t", "Ni %", "Ni (wt%)", "Cu%", "Au ppb", "Fe2O3 (%)",
// "Sn (kg/m3)". Audit 2026-09-25: none of these matched GRADE_PATTERN, so Assay
// reported "Import complete" on such a file with ZERO grade elements, and Core
// kept "Cu (%)" as an unrecognised text column. Returns the canonical column
// name the phases' unit logic reads ("au_gpt", "ni_pct", "fe2o3_pct") or null.
// Only an explicit unit notation is accepted here; a bare "CU" stays with
// GRADE_PATTERN (unit shown as unknown), and "Au_FA"-style method suffixes are
// left to the column mapper rather than guessed.
const _GRADE_UNIT_NOTATION = [
  [/^(g\/t|gpt|g_t|gt|g\/ton|g\/tonne)$/, 'gpt'],
  [/^(%|pct|percent|persen|wt\s*%|wt\.\s*%|wt_pct)$/, 'pct'],
  [/^ppm$/, 'ppm'],
  [/^ppb$/, 'ppb'],
  [/^(kg\/m3|kgm3|kg_m3)$/, 'kgm3'],
  [/^(g\/m3|gm3|g_m3)$/, 'gm3'],
];
function canonicalGradeName(header) {
  const s = String(header == null ? '' : header).trim().toLowerCase().replace(/\u00b3/g, '3');
  const m = s.match(/^([a-z]{1,2})(\d?o\d?)?[\s_.\-]*[(\[]?\s*([^()\[\]]+?)\s*[)\]]?$/);
  if (!m || ELEMENT_SYMBOLS.indexOf(m[1]) < 0) return null;
  const unitTok = m[3].trim();
  for (const [rx, unit] of _GRADE_UNIT_NOTATION) {
    if (rx.test(unitTok)) return m[1] + (m[2] || '') + '_' + unit;
  }
  return null;
}

/**
 * Renames that bring unit-notation grade headers to their canonical names,
 * skipping any rename whose target already exists or is claimed twice (the
 * original header is then left for the column mapper -- never overwritten).
 * @returns {Object<string,string>} original header -> canonical name
 */
function planGradeRenames(headers) {
  const lower = new Set(headers.map(h => String(h).trim().toLowerCase()));
  const plan = {}, claimed = {};
  for (const h of headers) {
    const c = canonicalGradeName(h);
    if (!c || String(h).trim().toLowerCase() === c) continue;
    claimed[c] = (claimed[c] || 0) + 1;
    plan[h] = c;
  }
  for (const h of Object.keys(plan)) {
    if (lower.has(plan[h]) || claimed[plan[h]] > 1) delete plan[h];
  }
  return plan;
}

// Reverse index: normalised alias -> role. Built once; every phase's old
// per-function alias table becomes one lookup here instead of N copies.
const ALIAS_INDEX = (() => {
  const idx = {};
  for (const role of Object.keys(ALIASES)) {
    for (const alias of ALIASES[role]) idx[_norm(alias)] = role;
  }
  return idx;
})();

// A column is numeric if at least one non-empty sampled value parses as a
// finite number -- the same "has real data, not just a schema slot" check
// Core/Assay/Resource already apply to grade columns (D10's comment: "only
// returns columns that actually contain non-null numeric data"), generalised
// here to every role so a 100%-empty column doesn't get miscounted as text.
function _looksNumeric(values) {
  let seen = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    seen++;
    if (!Number.isFinite(Number(v))) return false;
  }
  return seen > 0;
}

/**
 * Classify every header into exactly one role.
 * @param {string[]} headers - original header strings, in file order.
 * @param {Array<object|Array>} sampleRows - a few parsed rows (object keyed
 *   by header, or positional array matching `headers`' order) used only to
 *   tell other_numeric from other_text and to drop all-empty grade slots.
 * @returns {{columns: Array<{header:string, role:string, unit:string|null}>,
 *            byRole: Object<string, string[]>}}
 *   `byRole[role]` lists ORIGINAL header strings in that role, in file
 *   order. Every header in `headers` appears in `columns` exactly once and
 *   in exactly one `byRole` bucket -- nothing is dropped (D15).
 */
function classifyColumns(headers, sampleRows) {
  sampleRows = sampleRows || [];
  const seenNames = new Set();
  const columns = headers.map((raw, i) => {
    const header = String(raw);
    const key = _norm(header);
    const values = sampleRows.map(r => Array.isArray(r) ? r[i] : r[header]);

    let role = ALIAS_INDEX[key] || null;
    let unit = null;

    const canonGrade = role ? null : canonicalGradeName(header);
    if (!role) {
      const looksGrade = GRADE_PATTERN.test(header.trim()) || COMPOUND_GRADE_PATTERN.test(header) || !!canonGrade;
      // A column matching the grade shape but with zero real values (e.g. au_gpt in an
      // all-tin dataset, per Core/Assay/Resource's own existing rule) is not a live grade
      // column for THIS dataset -- it falls through to other_numeric/other_text below
      // rather than being reported as a commodity this data does not actually carry.
      if (looksGrade && (values.length === 0 || _looksNumeric(values))) {
        role = 'grade';
        unit = _unitFromSuffix(canonGrade || header);
      }
    }
    if (!role) {
      role = _looksNumeric(values) ? 'other_numeric' : 'other_text';
    }
    // Duplicate header names in one file are a real (if rare) input shape; keep every
    // one classified rather than silently merging them, but only the first keeps the
    // role a name-based alias implies -- later duplicates are never miscounted as a
    // second hole_id/domain/etc.
    if (seenNames.has(key) && role !== 'other_numeric' && role !== 'other_text') {
      role = _looksNumeric(values) ? 'other_numeric' : 'other_text';
    }
    seenNames.add(key);
    return { header, role, unit };
  });

  const byRole = {};
  for (const r of COLUMN_ROLES) byRole[r] = [];
  columns.forEach(c => byRole[c.role].push(c.header));
  return { columns, byRole };
}

/** Role of one original header string in a ColumnMap, or null if not present. */
function columnRole(map, header) {
  const hit = map.columns.find(c => c.header === header);
  return hit ? hit.role : null;
}

/** Original header strings classified under `role`, in file order. */
function columnsByRole(map, role) {
  return (map.byRole && map.byRole[role]) || [];
}
