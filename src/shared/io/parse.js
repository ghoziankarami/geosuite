// Shared CSV parse boundary (PLAN-arsitektur-4.2-4.3.md Tahap 4.2, Commit #3
// of 7 -- NOT wired into any phase yet). One place to parse and validate an
// imported drillhole CSV; everything downstream of parseDrillholeCSV() is
// meant to trust its output instead of re-guarding itself.
//
// Design constraint that shaped every choice below (user's own words, kept
// verbatim because it is the actual product requirement): "solusinya bukan
// ganti data saya, tapi gimana cara software ini bisa handle semua data" --
// this is not a chance to narrow what's accepted. It has to keep handling
// semicolon/tab/comma delimiters, thousands-comma mixed with decimal-dot in
// the same column, Indonesian and Datamine-standard headers, BOM+CRLF, and a
// newline embedded inside a quoted field -- all of which the corpus at
// _meta/tests/fixtures/csv-corpus/ has a case for.
//
// Everything here is synthesized from the three phases' current
// implementations (readCSV/Core, parseCSV/Assay, parseCSV/Resource), taking
// whichever behaviour was already proven correct by inventory + the Langkah
// 0a characterization run against production, not invented fresh:
//   - tokenizer: Assay's char-level state machine, run over the WHOLE text
//     rather than split-by-line-first (Core and Resource's line-first
//     splitting is what breaks on a newline inside a quoted field --
//     confirmed broken by the characterization baseline itself, corpus case
//     08 on Core).
//   - decimal-convention detection: the scoring algorithm all three phases
//     had already independently converged on (_coreDetectDecimal,
//     detectDecimalSeparator, _p3DetectDecimal -- byte-for-byte identical
//     weights once diffed side by side). Kept as-is; there is no design
//     choice to make here, only a name to give the shared copy.
//   - BDL/null markers: Resource's set, the most complete of the three.
//   - delimiter detection: NEW logic, not copied from any phase. Temuan 3
//     found that Core's priority-based pick (";" wins if present at all)
//     and Assay/Resource's frequency-based pick (most characters on the
//     header line) each fail on files the other handles fine. This version
//     tokenizes a small sample of rows with each candidate delimiter and
//     picks whichever yields the header's column count most consistently
//     across that sample -- evidence from actual row shape, not a guess
//     from one line.
//   - short/malformed rows: rejected with a human-readable reason instead of
//     silently becoming an empty object (the bug in Core's parseCSVText,
//     Temuan 5) or silently dropped (the old csv-import-regression.mjs
//     reimplementation, corrected 2026-09-02 -- see that file's docstring).

// ── BDL / missing-value markers (Resource's set -- the most complete of the
// three phases' current parsers) ──
const _PARSE_NULL_TOKENS = new Set([
  'na', 'n/a', 'null', 'nd', 'n.d.', 'bdl', 'lod', '<lod', '<dl', '-',
]);

function _parseStripBOM(text) {
  if (text && text.charCodeAt(0) === 0xFEFF) return text.slice(1);
  return text;
}

// Strip + capture leading "# ..." schema comments (the "orebit-schema=" /
// "source=" / "units:" / "notes:" convention emitted by GeoSuite's own P1
// exports). Returns { meta, rest } -- `rest` is the text with those lines
// removed, ready for tokenizing.
function _parseSchemaComments(text) {
  const meta = { schema: null, source: null, units: {}, notes: null, raw: [] };
  const lines = text.split(/\r?\n/);
  let cursor = 0;
  while (cursor < lines.length && lines[cursor].trim().startsWith('#')) {
    const line = lines[cursor].trim().replace(/^#\s*/, '');
    meta.raw.push(line);
    const sm = line.match(/orebit-schema=(\S+)/);
    if (sm) meta.schema = sm[1];
    const src = line.match(/source=([\w-]+)/);
    if (src) meta.source = src[1];
    if (/^units:/i.test(line)) {
      line.replace(/^units:\s*/i, '').split(',').forEach(pair => {
        // [\w/%]+ is load-bearing: a bare \w+ here is the exact bug fixed in
        // Resource (Temuan 2) -- it truncates "g/t" to "g" because \w does
        // not match "/". Do not narrow this back.
        const m = pair.trim().match(/^(\w+)\s*=\s*([\w/%]+)/);
        if (m) meta.units[m[1].toLowerCase()] = m[2].toLowerCase();
      });
    }
    if (/^notes:/i.test(line)) meta.notes = line.replace(/^notes:\s*/i, '');
    cursor++;
  }
  const hasMeta = meta.schema || meta.source || Object.keys(meta.units).length || meta.notes;
  return { meta: hasMeta ? meta : null, rest: lines.slice(cursor).join('\n') };
}

// Tokenize the FULL text (not line-by-line) with a quote-aware state
// machine, so a newline embedded inside a quoted field stays part of that
// field instead of splitting the row. Returns an array of rows, each an
// array of raw string fields (no numeric coercion yet).
function _parseTokenize(text, delim) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip -- \r\n handled by the \n branch */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

// Temuan 3: pick whichever candidate delimiter tokenizes the header PLUS a
// sample of data rows into the MOST CONSISTENT column count -- not the one
// with the most characters on the header line alone (Assay/Resource's old
// approach) and not "semicolon wins if present at all" (Core's old
// approach). Both of those fail on real files the other approach handles;
// see PLAN-arsitektur-4.2-4.3.md Temuan 3 for the failing examples.
function _parseDetectDelimiter(text, override) {
  if (override && override !== 'auto') {
    return override === 'tab' ? '\t' : (override === 'semicolon' ? ';' : ',');
  }
  const candidates = [',', ';', '\t'];
  const sampleText = text.split(/\r?\n/).slice(0, 10).join('\n');
  let best = ',', bestScore = -1;
  for (const d of candidates) {
    const rows = _parseTokenize(sampleText, d);
    if (!rows.length || rows[0].length <= 1) continue; // must split the header into >1 column
    const headerCount = rows[0].length;
    const agree = rows.filter(r => r.length === headerCount).length;
    if (agree > bestScore) { best = d; bestScore = agree; }
  }
  return best;
}

// Decimal-convention scoring -- identical algorithm to what Core
// (_coreDetectDecimal), Assay (detectDecimalSeparator) and Resource
// (_p3DetectDecimal) each already implement independently (diffed
// side-by-side, byte-for-byte identical weights). One shared copy of an
// algorithm that was already the same everywhere, not a new design.
function _parseDetectDecimal(rawValues) {
  let dot = 0, comma = 0;
  for (let i = 0; i < rawValues.length; i++) {
    const s = String(rawValues[i] == null ? '' : rawValues[i]).trim();
    if (!s || !/[0-9]/.test(s) || !/^[\d.,\s-]+$/.test(s)) continue;
    const hasDot = s.indexOf('.') >= 0, hasComma = s.indexOf(',') >= 0;
    if (hasDot && hasComma) {
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) dot += 5; else comma += 5;
    } else if (hasDot && !hasComma) {
      const p = s.split('.');
      if (p.length > 2) { /* 1.234.567 -- thousands, no decimal evidence */ }
      else if (p[1] && p[1].length !== 3) dot += 3;   // 572799.17 -- strong dot-decimal
      else dot += 0.1;                                 // 26.291 -- ambiguous
    } else if (hasComma && !hasDot) {
      const p = s.split(',');
      if (p.length > 2) { /* 1,234,567 -- thousands */ }
      else if (p[1] && p[1].length !== 3) comma += 3;  // 0,17 -- strong comma-decimal
      else comma += 0.1;                                // 26,291 -- ambiguous
    }
  }
  return comma > dot ? ',' : '.';
}

// Parse one token to a Number using a known decimal separator (the other
// character is treated as thousands grouping and stripped). Returns:
//   - null for a recognized BDL/missing marker
//   - { value: number, wasBelowDetection: true } for a "<0.5"-style marker
//     (half the detection limit, matching Resource's existing convention)
//   - { value: number, wasOverLimit: true } for a ">10"-style marker (the limit)
//   - a plain number for an ordinary numeric token
//   - the original trimmed string, unchanged, for anything non-numeric
//     (e.g. a hole_id or lithology code -- this function does not know
//     which columns are numeric, that is the caller's job via headers)
function _parseCoerceCell(raw, decimal) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const low = s.toLowerCase();
  if (_PARSE_NULL_TOKENS.has(low)) return null;
  const bdlMatch = s.match(/^<\s*([\d.,]+)$/);
  if (bdlMatch) {
    const half = _parseNumberOnly(bdlMatch[1], decimal);
    return half === null ? s : { value: half / 2, wasBelowDetection: true };
  }
  // ">10" = above the method's upper limit (over-limit, awaiting re-assay).
  // Read as the limit itself: a lower bound, so the sample stays in with a
  // conservative grade instead of being dropped -- dropping it removed the
  // highest-grade samples and biased every estimate low (audit 2026-09-25).
  const olMatch = s.match(/^>\s*([\d.,]+)$/);
  if (olMatch) {
    const lim = _parseNumberOnly(olMatch[1], decimal);
    return lim === null ? s : { value: lim, wasOverLimit: true };
  }
  const n = _parseNumberOnly(s, decimal);
  return n === null ? s : n;
}

function _parseNumberOnly(s, decimal) {
  const thousands = decimal === '.' ? ',' : '.';
  let t = String(s).split(thousands).join('');
  if (decimal !== '.') t = t.split(decimal).join('.');
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// ── Granular API (added after Commit #3 landed -- see the note below) ──
//
// CORRECTION, found integrating Commit #4 (Assay): the very first version
// of this file only exposed one all-in-one function that tokenizes, detects
// the decimal convention, AND coerces every cell for a SINGLE file in one
// call. That works for Core and Resource, which upload one file at a time
// (Resource: `ev.target.files[0]`, always one) or detect the convention
// independently per file even when several are picked at once (Core:
// Promise.all(files.map(f => readCSV(f))), each readCSV call is its own
// self-contained detection). It does NOT work for Assay, which deliberately
// combines the token evidence from EVERY uploaded file before deciding the
// convention once (processUploadedFiles's allTokenRows, existing behaviour,
// there for a real reason -- see its own comment: "resolve the
// decimal/thousands convention ONCE, from the combined evidence of every
// uploaded file"). Forcing Assay through a per-file all-in-one call would
// have silently changed what evidence the decision is based on -- exactly
// the kind of undocumented behaviour change Langkah 0's characterization
// harness exists to catch, caught here before it ever reached dist/.
//
// So parsing is split into three steps that can be composed either way:
//   parseDrillholeCSVTokens(text, options) -> tokenize only, no coercion
//   detectDecimalConvention(tokenRows, override) -> decide once, over
//     however many files' tokens the caller wants to combine
//   coerceTokenRows(tokenized, decimal) -> apply a known convention
// parseDrillholeCSV() below is a convenience wrapper chaining all three for
// the single-file case; its behaviour and return shape are UNCHANGED from
// the original Commit #3 version (all 42 existing unit tests still pass
// unmodified against this version -- verified, not assumed).

// Tokenize a single file's text: BOM strip, schema-comment extraction,
// delimiter detection, quote-aware tokenizing, and row-shape validation
// (short rows rejected here, before any value is coerced). No decimal
// detection and no numeric coercion happen in this step.
//
// Returns:
//   {
//     schemaMeta,   // { schema, source, units, notes, raw } | null
//     delimiter,    // ',' | ';' | '\t'
//     headers,      // string[]
//     tokenRows,    // Array<string[]>  (raw fields, one array per accepted data row)
//     rejected,     // Array<{ line, reason, raw }>  (1-based, header = line 1)
//   }
function parseDrillholeCSVTokens(text, options) {
  const opts = options || {};
  if (!text || !text.trim()) {
    return { schemaMeta: null, delimiter: ',', headers: [], tokenRows: [], rejected: [] };
  }
  text = _parseStripBOM(text);
  const { meta, rest } = _parseSchemaComments(text);
  const delim = _parseDetectDelimiter(rest, opts.delimiter);
  const rawRows = _parseTokenize(rest, delim);
  if (!rawRows.length) {
    return { schemaMeta: meta, delimiter: delim, headers: [], tokenRows: [], rejected: [] };
  }

  const headers = rawRows[0].map(h => h.trim());
  const dataRows = rawRows.slice(1);
  const tokenRows = [];
  const rejected = [];
  for (let i = 0; i < dataRows.length; i++) {
    const lineNo = i + 2; // 1-based, header is line 1
    const fields = dataRows[i];
    if (fields.length < headers.length) {
      rejected.push({
        line: lineNo,
        reason: `expected ${headers.length} column(s), found ${fields.length}`,
        raw: fields.join(String(delim)),
      });
      continue;
    }
    tokenRows.push(fields);
  }
  return { schemaMeta: meta, delimiter: delim, headers, tokenRows, rejected };
}

// Decide the decimal convention from a flat list of token ROWS (each an
// array of raw string fields -- pass the tokenRows from ONE
// parseDrillholeCSVTokens() call, or concatenate several to combine
// evidence across multiple uploaded files, matching Assay's existing
// multi-file behaviour). `override`: 'auto' | 'dot' | 'comma'.
function detectDecimalConvention(tokenRowsList, override) {
  if (override === 'dot') return '.';
  if (override === 'comma') return ',';
  const flat = [];
  outer:
  for (let r = 0; r < tokenRowsList.length; r++) {
    for (let c = 0; c < tokenRowsList[r].length; c++) {
      flat.push(tokenRowsList[r][c]);
      if (flat.length >= 5000) break outer;
    }
  }
  return _parseDetectDecimal(flat);
}

// Apply a known decimal convention to a tokenized result, producing the
// same { headers, rows, rejected(passthrough), ... } shape
// parseDrillholeCSV() returns. Split out so a caller can detect the
// convention across multiple files first (Assay) and only then coerce each
// file's own tokenRows with that shared decision.
function coerceTokenRows(tokenized, decimal) {
  const rows = tokenized.tokenRows.map(fields => {
    const obj = {};
    for (let j = 0; j < tokenized.headers.length; j++) {
      obj[tokenized.headers[j]] = _parseCoerceCell(fields[j], decimal);
    }
    return obj;
  });
  return {
    schemaMeta: tokenized.schemaMeta,
    delimiter: tokenized.delimiter,
    decimal,
    headers: tokenized.headers,
    rows,
    rejected: tokenized.rejected,
  };
}

// The one validated entry point for the single-file case: tokenize, detect
// the decimal convention from THIS file's own tokens, coerce. text in,
// structured + coerced result out; invalid rows are rejected at the door
// with a reason naming what's wrong, never silently dropped or turned into
// an empty object (Temuan 5).
//
// For the multi-file combined-detection case (Assay), call
// parseDrillholeCSVTokens() per file, detectDecimalConvention() over their
// combined tokenRows, then coerceTokenRows() per file instead of this.
//
// options:
//   delimiter: 'auto' | 'comma' | 'semicolon' | 'tab'  (manual override)
//   decimal:   'auto' | 'dot' | 'comma'                (manual override)
//
// Returns:
//   {
//     schemaMeta,          // { schema, source, units, notes, raw } | null
//     delimiter,           // the character actually used: ',' | ';' | '\t'
//     decimal,             // the convention actually used: '.' | ','
//     headers,              // string[]
//     rows,                // Array<Record<header, CellValue>>
//     rejected,             // Array<{ line, reason, raw }>  (1-based, header = line 1)
//   }
// CellValue is: number | string | null | { value: number, wasBelowDetection: true } | { value: number, wasOverLimit: true }
function parseDrillholeCSV(text, options) {
  const opts = options || {};
  const tokenized = parseDrillholeCSVTokens(text, opts);
  if (!tokenized.headers.length) {
    return { schemaMeta: tokenized.schemaMeta, delimiter: tokenized.delimiter, decimal: '.', headers: [], rows: [], rejected: [] };
  }
  const decimal = detectDecimalConvention(tokenized.tokenRows, opts.decimal);
  return coerceTokenRows(tokenized, decimal);
}

// ── Thin adapters: each phase's CURRENT contract (Temuan 1), unchanged.
// The point of these is that when a phase is routed through
// parseDrillholeCSV() (Commits #4-6), its own downstream code does not have
// to change -- only what feeds it does. Do not "improve" a phase's shape
// here; that is a different, larger decision the plan deliberately did not
// make (see Temuan 1: "jangan diam-diam menyeragamkan bentuknya"). ──

// Core's shape: parseDrillholeCSV()'s `rows` already IS Array<Object> keyed
// by header -- named here only so a future caller reads intent, not because
// it transforms anything.
function parseResultToObjectRows(parsed) {
  return parsed.rows;
}

// Assay's shape: Array<Array<string>>, header row included at index 0,
// values stringified (Assay's parseCSV defers numeric coercion to a later
// stage -- see autodetectNumberFormat/_parseWithDecimal in Assay.html).
function parseResultToArrayRows(parsed) {
  const out = [parsed.headers.slice()];
  for (const row of parsed.rows) {
    out.push(parsed.headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return String(v.value); // BDL marker
      return String(v);
    }));
  }
  return out;
}

// Resource's shape: { cols, rows } with rows as Array<Array<CellValue>>
// (numeric where coercible, matching Resource's existing 2-pass contract).
function parseResultToColsRows(parsed) {
  const rows = parsed.rows.map(row => parsed.headers.map(h => {
    const v = row[h];
    return (v !== null && typeof v === 'object') ? v.value : v;
  }));
  return { cols: parsed.headers.slice(), rows };
}

// Core's ACTUAL shape (Commit #6) -- correcting the assumption above ("Core's
// rows already IS Array<Object>, no transform needed") after running readCSV
// in production against real drillhole exports and inspecting its output.
// Core's own normalizeCell() never returns a CellValue -- it ALWAYS returns a
// string: a decimal-normalized numeric string ("572799.17"), an empty string
// for a null/BDL-missing token, or the original text unchanged. remapRows()
// and every downstream consumer (edit tracking, CSV re-export, the manual
// Column Mapping panel) depend on that string shape -- a native number is
// harmless (Number() round-trips it fine), but the { value, wasBelowDetection
// } BDL marker object is NOT: remapRows' own Number(v) coercion on it yields
// NaN and silently drops the value to null in a canonical numeric column, and
// its final verbatim-preserve pass for uncannonical columns would leak the
// object itself into the UI ("[object Object]"). This adapter re-derives
// readCSV's exact string contract from parse.js's typed CellValue instead.
function parseResultToCoreStringRows(parsed) {
  return parsed.rows.map(row => {
    const out = {};
    for (const h of parsed.headers) {
      const v = row[h];
      if (v === null || v === undefined) out[h] = '';
      else if (typeof v === 'object') out[h] = String(v.value); // BDL marker, halved
      else out[h] = String(v);
    }
    return out;
  });
}
