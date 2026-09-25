// Shared grade-code policy: what a NEGATIVE number in a grade column means.
// Classic script, no export -- inlined verbatim into all three phases by
// build/build.mjs (@orebit-inline: shared/io/grades.js), same convention as
// parse.js/columns.js. Pure functions, no DOM; unit-tested in Node by
// _meta/tests/known-answer/shared-grades-boundary.mjs.
//
// Why this exists (audit 2026-09-25, docs/audits/kredibilitas-dan-opensource-2026-09-25.md):
// lab and database exports use negative numbers for two different things,
// and the app treated them as one.
//
//   1. Below detection: "-0.005" means "< 0.005" (ALS/SGS/Intertek style,
//      the magnitude IS the detection limit). Half the limit is the usual
//      substitution.
//   2. Missing / not sampled / not received: "-99", "-999", "-9999" are
//      database codes, not measurements. Their magnitude means nothing.
//
// Core applied rule 1 to everything, so "-9999" became 4,999.5 g/t Au and
// passed its 100 kg/t sanity ceiling; a 6-hole test file averaged 47.69 g/t
// instead of 1.50. Assay and Resource kept the raw negatives, so the same file
// averaged -91 g/t in Assay and fed -9999 into kriging in Resource.
//
// The rule, written so a geologist can check it by hand:
//   - |v| made only of nines (9, 99, 999, 9999, ...)            -> missing
//   - |v| above the column's highest measured (positive) value  -> missing
//       (a detection limit cannot exceed every value the lab actually
//        measured; -995000 ppm Pb in the bundled Thalanga sample is a code)
//   - otherwise                                                  -> below detection
// The bound is deliberately loose. A median bound was tried first and was
// wrong on real data: Thalanga's Au median is 0.0025 g/t (mostly near-limit
// values) while -0.01/-0.05/-0.1 are genuine limits from different labs/eras,
// so it misread ~1,000 real BDLs as missing.
// Missing becomes null (excluded, never invented). Below detection follows the
// caller's mode: 'half' |v|/2 (default), 'null', or 'keep' (leave negative).
// 'keep' also leaves missing codes untouched: it is the user asking for raw data.
//
// Over-limit (">10", the method's upper limit) is handled in the parsers
// (parse.js _parseCoerceCell, Assay tryNumber): the value becomes the limit
// itself -- a lower bound, so the sample is conservative instead of dropped.

const _GRADE_MISSING_CODE_RE = /^9+(\.0+)?$/;

/** Largest strictly positive finite number in `values`, or null if none. */
function positiveGradeMax(values) {
  let max = null;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && (max === null || v > max)) max = v;
  }
  return max;
}

/**
 * Classify one negative grade value.
 * @param {number} v - a negative number
 * @param {number|null} maxPositive - positiveGradeMax() of the same column
 * @returns {'missing'|'bdl'}
 */
function classifyNegativeGrade(v, maxPositive) {
  const a = Math.abs(v);
  if (_GRADE_MISSING_CODE_RE.test(String(a))) return 'missing';
  if (maxPositive !== null && a > maxPositive) return 'missing';
  return 'bdl';
}

/**
 * Resolve negative grade codes in place.
 * @param {Array<Object|Array>} rows - object rows (key = column name) or
 *   positional rows (key = column index); both are read as row[key].
 * @param {Array<string|number>} keys - the grade columns.
 * @param {'half'|'null'|'keep'} mode - what to do with below-detection values.
 * @returns {{bdl:number, missing:number, byColumn:Object<string,{bdl:number, missing:number, maxPositive:number|null}>}}
 *   Counts are reported even in 'keep' mode (nothing is changed then), so the
 *   import report can still say what the file contains.
 */
function resolveNegativeGrades(rows, keys, mode) {
  const out = { bdl: 0, missing: 0, byColumn: {} };
  for (const k of keys) {
    const maxPositive = positiveGradeMax(rows.map(r => r[k]));
    const col = { bdl: 0, missing: 0, maxPositive };
    for (const r of rows) {
      const v = r[k];
      if (typeof v !== 'number' || !(v < 0)) continue;
      const kind = classifyNegativeGrade(v, maxPositive);
      if (kind === 'missing') {
        col.missing++;
        if (mode !== 'keep') r[k] = null;
      } else {
        col.bdl++;
        if (mode === 'half') r[k] = Math.abs(v) / 2;
        else if (mode === 'null') r[k] = null;
      }
    }
    out.bdl += col.bdl;
    out.missing += col.missing;
    if (col.bdl || col.missing) out.byColumn[String(k)] = col;
  }
  return out;
}
