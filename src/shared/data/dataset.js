// dataset.js — the one shape a loaded dataset has, and the one way to build it.
//
// docs/PLAN-refactor-dataset-kolom.md Tahap 4. Every phase had its own idea of
// what "the dataset" was: Assay aliased EMBEDDED_DATA at boot, cloned it in
// applyBundle, took `merged` straight from an upload; Resource assigned a bare
// `{name, cols, rows}` from a CSV and the embedded object from reset. That is
// why "is the active data the bundled sample?" was answered by object identity
// (`DATA === EMBEDDED_DATA`) — a question that silently changes answer the
// moment anyone copies the object, which is exactly what D12 required them to
// do.
//
// createDataset() returns a fresh, normalised copy. Callers never share the
// bundled sample's object, and never have to remember that cols/columns/headers
// are three names for one list — letting those drift apart is the root of the
// D10/D11/D15 bug family (a derived column reads DATA.cols while an uploaded
// dataset only ever set `columns`, so the write threw on undefined.indexOf
// after the tab had already painted).
//
// The source is a field, not an inference. `source` is one of DATASET_SOURCE.*,
// and phase code asks `dataset.source === DATASET_SOURCE.SAMPLE` instead of
// comparing object identity — see window.__isSampleData in each phase.
//
// This file is inlined into each phase by build/build.mjs via an
// `@orebit-inline: shared/data/dataset.js` marker, so it must stay dependency
// free and define plain functions on the shared sandbox.
//
// Loaded by: _meta/tests/known-answer/shared-dataset-boundary.mjs (gate tier,
// no browser) — which is also what proves the no-column-is-dropped property.

var DATASET_SOURCE = {
  SAMPLE: 'sample',   // the bundled demo dataset (EMBEDDED_DATA / SAMPLE_DATA)
  UPLOAD: 'upload',   // files the user picked in this session
  BUNDLE: 'bundle',   // a saved project/bundle restored from disk
  IMPORT: 'import',   // a dataset handed over by the previous phase
};

// The three names for one list, plus the two shapes the phase files actually
// produce ({cols} from the sample, {columns} from an upload's merge).
function _dsColumnList(input) {
  if (Array.isArray(input.cols)) return input.cols.slice();
  if (Array.isArray(input.columns)) return input.columns.slice();
  if (Array.isArray(input.headers)) return input.headers.slice();
  return [];
}

function _dsRows(rows) {
  if (!Array.isArray(rows)) return [];
  // Row-wise slice: a shallow copy of the array still shares row objects with
  // the caller, and the bundle path writes into rows in place.
  return rows.map(function (r) { return Array.isArray(r) ? r.slice() : r; });
}

// createDataset(input, opts) -> frozen dataset
//   input.rows | input.data.rows   the row array (required in practice)
//   input.cols | input.columns | input.headers
//   input.name, input.units, input.schemaMeta
//   opts.source   one of DATASET_SOURCE.* (defaults to UPLOAD: an
//                 unspecified dataset is user data, never the sample)
//   opts.name, opts.units, opts.schemaMeta  override the input's
//
// Always returns a NEW object with NEW rows and a NEW column array. Throws only
// when called without a row array at all — a dataset with no rows is a caller
// bug, and silently building an empty one is how "upload sukses" got shown for
// data that never loaded (D18).
function createDataset(input, opts) {
  opts = opts || {};
  if (!input || !Array.isArray(input.rows)) {
    throw new Error('createDataset: input.rows must be an array');
  }
  var cols = _dsColumnList(input);
  var ds = {
    rows: _dsRows(input.rows),
    cols: cols,
    // Aliases, deliberately pointing at the same array so they cannot drift.
    columns: cols,
    headers: cols,
    name: (opts.name !== undefined ? opts.name : input.name) || null,
    units: Object.assign({}, opts.units !== undefined ? opts.units : input.units),
    schemaMeta: (opts.schemaMeta !== undefined ? opts.schemaMeta : input.schemaMeta) || null,
    source: opts.source || DATASET_SOURCE.UPLOAD,
    rowCount: input.rows.length,
  };
  // Deliberately NOT frozen. The plan's Tahap 4 wording says "objek yang
  // dibekukan", but Assay has 19 post-load writes to DATA fields that are real
  // features, not sloppiness -- the column-rename path rewrites DATA.columns
  // after the user renames a column, and the upload path normalises
  // cols/columns/headers after load. Freezing here would turn each of those
  // into a silent no-op or a throw, a behaviour change this step must not
  // make. Freezing becomes correct once those sites rebuild through
  // setActiveDataset() instead of assigning in place -- the follow-up this
  // note marks. Until then the single-writer guard
  // (ops/scripts/guards/check-single-dataset-writer.py) protects the invariant.
  return ds;
}

// A dataset is the bundled sample when its source says so. Kept as a function
// so the phase files have one call to make, not a field name to remember.
function isSampleDataset(ds) {
  return !!ds && ds.source === DATASET_SOURCE.SAMPLE;
}
