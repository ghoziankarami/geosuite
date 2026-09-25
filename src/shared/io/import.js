// Shared import pipeline (docs/PLAN-refactor-dataset-kolom.md Tahap 3 --
// NOT wired into any phase yet, same convention as parse.js/columns.js/
// schema.js). Depends on parseDrillholeCSVTokens/coerceTokenRows (parse.js)
// and classifyColumns (columns.js) being loaded into the same script scope.
//
// Why this exists: every phase currently answers "did this upload work?"
// with a DIFFERENT, incomplete rule, all three findable by defect ID:
//   - D17: parse.js already returns `rejected: [{line, reason, raw}]` for
//     malformed rows -- no phase reads it. A 10-row file with one short row
//     loads as 9 with zero message, in Core, Assay AND Resource alike.
//   - D18: Assay shows "Upload sukses" for a file with zero grade columns
//     (the mapper it should have triggered is rendered but the success
//     banner does not wait on it), and Resource shows the right mapper but
//     leaves the PREVIOUS dataset fully active and displayed while it is
//     open, with nothing telling the user that.
//   - D7: at least one failure shape (no recognisable columns at all) is
//     already handled correctly today in Assay, but that safety is one
//     `if (!merged)` in one function, not a rule the other two phases share.
//
// buildImportReport() answers all three with ONE rule instead of three ad
// hoc ones: an import is not "successful" or "failed", it produces a report
// naming exactly what loaded, what was rejected and why, and whether every
// REQUIRED role for this phase was found. Whether that report is enough to
// activate the dataset is a gate the caller applies (Tahap 3's activation
// gate proper, wired per phase); this module only produces the evidence the
// gate and the on-screen report both need, so they can never disagree.

// Each phase's own non-negotiable roles -- what it cannot compute anything
// without. Not every role columns.js knows about is required everywhere:
// Resource can operate on grade alone with no domain (falls back to 'All'),
// but hole_id/from/to/x/y/z are load-bearing everywhere composites or block
// models exist.
const REQUIRED_ROLES = Object.freeze({
  Core: ['hole_id'],
  Assay: ['hole_id', 'from', 'to'],
  Resource: ['hole_id', 'from', 'to', 'x', 'y', 'z'],
});

/**
 * @param {string[]} headers
 * @param {Array<Array>} tokenRows - positional rows matching `headers` order
 *   (parseDrillholeCSVTokens' shape), already coerced to typed values.
 * @param {Array<{line:number, reason:string, raw:string}>} rejected - passed
 *   through from parse.js verbatim; this module's only job with it is to
 *   make sure it reaches the report instead of being thrown away (D17).
 * @param {string} phase - 'Core' | 'Assay' | 'Resource', selects REQUIRED_ROLES.
 * @returns {{
 *   rowCount: number,
 *   rejected: Array<{line:number, reason:string, raw:string}>,
 *   columnMap: object,
 *   missingRequired: string[],
 *   warnings: string[],
 *   ready: boolean,
 * }}
 *   `ready` is the activation-gate condition: true iff every required role
 *   for `phase` was found AND at least one row survived parsing. A caller
 *   that activates the dataset only when `ready` is true, and otherwise
 *   keeps the previous dataset active while showing this same report, is
 *   Tahap 3's whole gate -- there is no second, separately-typed check
 *   anywhere else to drift out of sync with this one.
 */
function buildImportReport(headers, tokenRows, rejected, phase, opts) {
  const o = opts || {};
  const columnMap = classifyColumns(headers, tokenRows);
  // A phase whose real requirement differs from REQUIRED_ROLES says so here rather
  // than the table growing per-caller exceptions: Resource treats from/to as SOFT
  // (composite exports without intervals are valid) and cannot run without a grade.
  //   opts.required     roles that must be present (default REQUIRED_ROLES[phase])
  //   opts.requireGrade the phase cannot use a file with no grade column at all
  const required = o.required || REQUIRED_ROLES[phase] || [];
  const missingRequired = required.filter(role => !(columnMap.byRole[role] || []).length);
  const hasGrade = (columnMap.byRole.grade || []).length > 0;

  const warnings = [];
  if (!hasGrade) {
    // Not fatal (a lithology-only geology file has no grade column and that is
    // fine) but always worth saying, because D18's silent "Upload sukses" on a
    // zero-grade-column file is exactly what this warning replaces.
    warnings.push('no_grade_columns');
  }
  if (rejected && rejected.length) {
    warnings.push(`rejected_rows:${rejected.length}`);
  }

  return {
    rowCount: tokenRows.length,
    rejected: rejected || [],
    columnMap,
    missingRequired,
    warnings,
    gradeRequired: !!o.requireGrade,
    ready: missingRequired.length === 0 && tokenRows.length > 0 && (!o.requireGrade || hasGrade),
  };
}

/**
 * One human-readable line per finding, in the language-neutral form a phase's
 * own t()/i18n layer wraps -- this module has no UI or DOM dependency, so it
 * hands back structured facts (role names, counts, line numbers) for the
 * caller to translate and lay out, never pre-built prose.
 */
function summarizeImportReport(report) {
  const lines = [];
  lines.push({ kind: 'rows', count: report.rowCount });
  if (report.rejected.length) {
    lines.push({ kind: 'rejected', count: report.rejected.length, entries: report.rejected.slice(0, 20) });
  }
  if (report.missingRequired.length) {
    lines.push({ kind: 'missing_required', roles: report.missingRequired.slice() });
  }
  report.warnings.forEach(w => lines.push({ kind: 'warning', code: w }));
  lines.push({ kind: report.ready ? 'ready' : 'not_ready' });
  return lines;
}
