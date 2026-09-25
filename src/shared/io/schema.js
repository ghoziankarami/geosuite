// Shared schema v2 read/write (docs/PLAN-refactor-dataset-kolom.md Tahap 2 --
// NOT wired into any phase yet, same convention as columns.js and parse.js:
// no export statement, @orebit-inline'd raw, tested from Node via
// vm.runInContext). Depends on columns.js's COLUMN_ROLES and parse.js's
// _parseSchemaComments() being loaded into the same script scope -- true
// once all three are @orebit-inline'd into one phase file, and true in this
// module's own test, which loads all three into one vm context the same way.
//
// Why this exists: every export function writes its own header lines by
// hand (Core.html's exportMasterCSV ~11124, Assay.html's
// exportMasterForEstimation ~11910 -- five call sites total across the three
// phases per the map in docs/audits/geosuite-map/). Two concrete failures
// came directly from that duplication:
//   - D16: a column's original name survives Core -> Assay only partially
//     canonicalised (Core lowercases FE_PCT because it happens to be in an
//     alias list, Assay lowercases NI_PCT but leaves CO_PCT alone) -- there
//     was never one place that carried "this is the name the geologist
//     typed AND this is its role" together.
//   - D9's export side: `# units: au=gpt, cu=pct, ...` is a HARDCODED
//     string in Assay.html's exportMasterForEstimation, not derived from
//     the columns actually present in dataset -- a placer-tin file that
//     only has sn_kgm3 still gets a units line describing au/cu/pb/zn/fe/
//     ni/ag, none of which its own file has.
//
// v1 files (the "# orebit-schema=v1" / "# units: au=gpt, ..." convention
// already emitted by every phase) are untouched: readSchema() defers to
// parse.js's own _parseSchemaComments() for meta.units/schema/source/notes,
// so a v1 file reads back byte-identically to what it always has (Tahap 2
// exit criterion: "File v1 lama tetap terbaca dengan hasil yang sama
// seperti HEAD"). v2 adds ONE more line, `# columns: ...`, that a v1-only
// reader simply ignores (it does not match `/^units:/i` or any pattern
// _parseSchemaComments already looks for) -- so a v2 file opened by
// yesterday's build degrades to exactly today's v1 behaviour, not an error.

const SCHEMA_VERSION = 'v2';

// Only these four characters can collide with the line's own delimiters
// (',' separates entries, '=' separates header from role, ':' separates
// role from unit) or with the escape marker itself. A real drillhole header
// containing one of them (an Indonesian compound name with a comma, a
// header literally named "Ratio Au:Ag") still round-trips exactly.
const _SC_ESCAPE_MAP = { '%': '%25', ',': '%2C', '=': '%3D', ':': '%3A' };
function _scEscape(s) {
  return String(s).replace(/[%,=:]/g, ch => _SC_ESCAPE_MAP[ch]);
}
function _scUnescape(s) {
  return String(s).replace(/%25|%2C|%3D|%3A/g, m => ({ '%25': '%', '%2C': ',', '%3D': '=', '%3A': ':' })[m]);
}

/** ColumnMap -> the bare content of one `# columns: ...` line (no leading '#'). */
function buildColumnsHeaderLine(columnMap) {
  const entries = columnMap.columns.map(c => {
    const head = _scEscape(c.header);
    return c.unit ? `${head}=${c.role}:${c.unit}` : `${head}=${c.role}`;
  });
  return 'columns: ' + entries.join(', ');
}

/**
 * Parse a `columns: ...` line's content (already stripped of leading '#',
 * matching what parse.js's _parseSchemaComments puts in meta.raw) back into
 * a ColumnMap: { columns: [{header, role, unit}], byRole: {role: [header]} }.
 * Returns null if the line isn't a columns: line or has no valid entries.
 */
function parseColumnsHeaderLine(line) {
  const m = /^columns:\s*(.*)$/i.exec(String(line).trim());
  if (!m || !m[1]) return null;
  const columns = [];
  m[1].split(',').forEach(raw => {
    const part = raw.trim();
    if (!part) return;
    const eq = part.indexOf('=');
    if (eq < 0) return;
    const header = _scUnescape(part.slice(0, eq).trim());
    let roleUnit = part.slice(eq + 1).trim();
    let role = roleUnit, unit = null;
    const colon = roleUnit.indexOf(':');
    if (colon >= 0) { role = roleUnit.slice(0, colon); unit = roleUnit.slice(colon + 1) || null; }
    if (!header || !role) return;
    columns.push({ header, role, unit });
  });
  if (!columns.length) return null;
  const byRole = {};
  (typeof COLUMN_ROLES !== 'undefined' ? COLUMN_ROLES : []).forEach(r => { byRole[r] = []; });
  columns.forEach(c => { (byRole[c.role] || (byRole[c.role] = [])).push(c.header); });
  return { columns, byRole };
}

/**
 * Build the full header comment block for an export: schema line, columns
 * line, and an optional free-text notes line -- replacing the by-hand
 * string-building at every export call site.
 * @param {{source: string, columnMap: object, notes?: string}} opts
 * @returns {string[]} lines, each already prefixed with '# '.
 */
function writeSchemaV2Lines(opts) {
  const lines = [`# orebit-schema=${SCHEMA_VERSION} source=${opts.source}`];
  lines.push('# ' + buildColumnsHeaderLine(opts.columnMap));
  if (opts.notes) lines.push(`# notes: ${opts.notes}`);
  return lines;
}

/**
 * Read schema info out of an uploaded file's leading comment lines.
 * Defers entirely to parse.js's _parseSchemaComments() for the v1 fields
 * (schema/source/units/notes) so a v1 file's behaviour never changes; adds
 * columnMap only when a `# columns:` (v2) line is present.
 * @returns {{version: 2|1|null, columnMap: object|null, units: object,
 *            source: string|null, notes: string|null}}
 */
function readSchema(text) {
  const { meta } = _parseSchemaComments(text);
  if (!meta) return { version: null, columnMap: null, units: {}, source: null, notes: null };
  let columnMap = null;
  for (const line of meta.raw) {
    const parsed = parseColumnsHeaderLine(line);
    if (parsed) { columnMap = parsed; break; }
  }
  return {
    version: columnMap ? 2 : (meta.schema ? 1 : (Object.keys(meta.units).length || meta.notes ? 1 : null)),
    columnMap, units: meta.units, source: meta.source, notes: meta.notes,
  };
}
