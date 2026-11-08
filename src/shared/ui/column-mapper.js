// Shared import-report renderer + canonical-name planner (docs/PLAN-refactor-
// dataset-kolom.md Tahap 3). Classic script, no export -- inlined verbatim by
// build/build.mjs like parse.js/columns.js/import.js. Depends on escapeHtml
// (shared/io/index.js) and on a ColumnMap/ImportReport from columns.js/import.js.
//
// Deliberately STRING-in / STRING-out (no document access): the DOM wiring --
// where the panel goes, which buttons exist, what "apply" does to the phase's
// own dataset -- is phase-specific and stays in the phase. What must be the
// same in every phase is WHAT THE USER IS TOLD, so that lives here and is
// unit-testable in Node (shared-column-mapper-boundary.mjs) without a browser.
//
// Every fact shown comes from the ImportReport (D18: no fixed "upload OK"
// text). Strings go through `opts.tr(key, vars)` (the phase's own i18n); when
// it returns the key unchanged (no entry) the English default below is used,
// so a phase that has not translated a key yet still says something true.

const _IMPORT_TEXT = {
  'import.title.ready': 'Import complete',
  'import.title.warn': 'Import complete — check the notes below',
  'import.title.blocked': 'Import not applied — required columns are missing',
  'import.rows': 'Rows loaded: {n}',
  'import.rejected': '{n} row(s) rejected by the parser and NOT loaded:',
  'import.rejectedLine': 'line {line}: {reason}',
  'import.rejectedMore': '… and {n} more',
  'import.missing': 'Required columns not identified: {roles}. Map them below.',
  'import.warn.no_grade_columns': 'No grade column was recognised. The file loads, but nothing can be estimated from it until one is mapped.',
  'import.warn.no_grade_columns_required': 'No grade column was recognised. This module cannot work without one — choose the commodity column below.',
  'import.sampleName': 'the bundled sample dataset',
  'import.noDataset': 'no dataset',
  'import.uploadedName': 'your uploaded dataset ({n} rows)',
  'import.roles': 'How each column was read',
  'import.gradeCodes': '{bdl} below-detection value(s) (negative = detection limit) set to half the limit; {missing} missing-sample code(s) (e.g. -99, -999, -9999) set to blank and excluded.',
  'import.pending': 'Not applied yet — still showing: {name}',
  'import.role.hole_id': 'hole ID',
  'import.role.from': 'from (depth)',
  'import.role.to': 'to (depth)',
  'import.role.x': 'X / easting',
  'import.role.y': 'Y / northing',
  'import.role.z': 'Z / elevation',
};

function _importText(opts, key, vars) {
  let s = opts && typeof opts.tr === 'function' ? opts.tr(key, vars || {}) : key;
  if (!s || s === key) {
    s = _IMPORT_TEXT[key] || key;
    Object.keys(vars || {}).forEach(k => { s = s.split('{' + k + '}').join(String(vars[k])); });
  }
  return s;
}

function _importRoleLabel(opts, role) {
  const k = 'import.role.' + role;
  const s = _importText(opts, k);
  return s === k ? role : s;
}

/**
 * HTML for the report panel. `report` is buildImportReport()'s result.
 * opts: { tr, pendingName } -- pendingName set means the OLD dataset is still
 * the active one (activation gate closed).
 * The root element carries data-import-* attributes so tests (and any future
 * tooling) read the verdict from structure, not from translated prose.
 */
function renderImportReportHtml(report, opts) {
  const o = opts || {};
  const esc = escapeHtml;
  const blocked = !report.ready;
  // report.gradeCodes: resolveNegativeGrades()'s counts (shared/io/grades.js), set by the phase.
  const gc = report.gradeCodes && (report.gradeCodes.bdl || report.gradeCodes.missing) ? report.gradeCodes : null;
  const noteworthy = report.rejected.length > 0 || !!gc || report.warnings.some(w => w.indexOf('rejected_rows') !== 0);
  const cls = blocked ? 'warn' : (noteworthy ? 'warn' : 'good');
  const title = blocked ? 'import.title.blocked' : (noteworthy ? 'import.title.warn' : 'import.title.ready');

  const parts = [];
  parts.push(`<strong>${esc(_importText(o, title))}</strong>`);
  const li = [];
  li.push(esc(_importText(o, 'import.rows', { n: report.rowCount })));
  if (report.rejected.length) {
    const shown = report.rejected.slice(0, 20).map(r =>
      `<li>${esc(_importText(o, 'import.rejectedLine', { line: r.line, reason: r.reason }))}</li>`).join('');
    const more = report.rejected.length > 20
      ? `<li>${esc(_importText(o, 'import.rejectedMore', { n: report.rejected.length - 20 }))}</li>` : '';
    li.push(`${esc(_importText(o, 'import.rejected', { n: report.rejected.length }))}<ul style="margin:2px 0 0 16px;">${shown}${more}</ul>`);
  }
  if (report.missingRequired.length) {
    const roles = report.missingRequired.map(r => _importRoleLabel(o, r)).join(', ');
    li.push(esc(_importText(o, 'import.missing', { roles })));
  }
  if (gc) li.push(esc(_importText(o, 'import.gradeCodes', { bdl: gc.bdl, missing: gc.missing })));
  report.warnings.filter(w => w.indexOf('rejected_rows') !== 0).forEach(w => {
    // A phase that cannot run without a grade column says so, instead of "the file loads".
    const key = (w === 'no_grade_columns' && report.gradeRequired) ? 'import.warn.no_grade_columns_required' : 'import.warn.' + w;
    li.push(esc(_importText(o, key)));
  });
  parts.push(`<ul style="margin:6px 0 0 16px;">${li.map(x => `<li>${x}</li>`).join('')}</ul>`);

  const cols = report.columnMap && report.columnMap.columns ? report.columnMap.columns : [];
  if (cols.length) {
    const rows = cols.map(c => `<tr><td><code>${esc(c.header)}</code></td><td>${esc(c.role)}${c.unit ? ' · ' + esc(c.unit) : ''}</td></tr>`).join('');
    parts.push(`<details style="margin-top:6px;"><summary>${esc(_importText(o, 'import.roles'))}</summary>` +
      `<table style="font-size:12px;margin-top:4px;">${rows}</table></details>`);
  }
  if (o.pendingName != null) {
    parts.push(`<div style="margin-top:6px;font-weight:600;">${esc(_importText(o, 'import.pending', { name: o.pendingName }))}</div>`);
  }

  const attrs = [
    'data-import-report',
    `data-import-ready="${report.ready ? 'true' : 'false'}"`,
    `data-import-rows="${report.rowCount}"`,
    `data-import-rejected="${report.rejected.length}"`,
    `data-import-missing="${esc(report.missingRequired.join(','))}"`,
    `data-import-warnings="${esc(report.warnings.filter(w => w.indexOf('rejected_rows') !== 0).join(','))}"`,
  ];
  if (gc) attrs.push(`data-import-bdl="${gc.bdl}"`, `data-import-missing-codes="${gc.missing}"`);
  if (o.pendingName != null) attrs.push('data-import-pending="1"');
  return `<div class="hint ${cls}" ${attrs.join(' ')}>${parts.join('')}</div>`;
}

/**
 * What the user is still looking at while a new import is pending (the activation
 * gate is closed). Needs isSampleDataset() from shared/data/dataset.js.
 */
function importActiveDatasetLabel(ds, opts) {
  if (!ds) return _importText(opts, 'import.noDataset');
  if (isSampleDataset(ds)) return _importText(opts, 'import.sampleName');
  const n = ds.rows ? ds.rows.length.toLocaleString('en-US') : '0';
  return ds.name || _importText(opts, 'import.uploadedName', { n });
}

/**
 * Renames that make auto-detected required roles readable by downstream code.
 * ColumnMap roles are abstract (`from`, `to`); each phase's downstream reads a
 * NAMED column (`from_m`, `to_m`, `midx` ...). A gate that passes because the
 * role exists, while the canonical name does not, would load a dataset whose
 * every read of that name returns nothing -- silently (jebakan #9 in
 * docs/HANDOVER-refactor-dataset-kolom.md). So: for each role in
 * `canonicalByRole`, if the canonical name is not already a header and exactly
 * one header holds that role, plan header -> canonical. Ambiguous (0 or >1)
 * roles are left for the manual mapper.
 * @returns {Object<string,string>} { originalHeader: canonicalName }
 */
function planCanonicalRenames(columnMap, canonicalByRole, headers) {
  const renames = {};
  const have = new Set(headers);
  Object.keys(canonicalByRole).forEach(role => {
    const canon = canonicalByRole[role];
    if (have.has(canon)) return;
    const holders = (columnMap.byRole && columnMap.byRole[role]) || [];
    if (holders.length === 1) renames[holders[0]] = canon;
  });
  return renames;
}
