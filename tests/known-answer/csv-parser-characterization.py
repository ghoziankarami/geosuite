#!/usr/bin/env python3
"""csv-parser-characterization.py — locks the CURRENT behaviour of the three
phases' real CSV-upload entry points before PLAN-arsitektur-4.2-4.3.md's
Tahap 4.2 unifies them into src/shared/io/parse.js.

WHY THIS EXISTS (Langkah 0a of the plan)
    "Characterize, don't judge." This test does not assert what the parsers
    SHOULD do -- it snapshots what they ACTUALLY do today, including the odd
    parts, against a corpus in fixtures/csv-corpus/. After the shared parser
    lands, re-running this must produce byte-identical JSON for every
    fixture except where a commit deliberately fixes a known bug (e.g.
    Resource's unit-regex truncation, PLAN-arsitektur-4.2-4.3.md Temuan 2)
    -- and that exception must be named in the commit that causes it.

WHY THIS CALLS THE REAL PRODUCTION FUNCTIONS, NOT A REWRITE
    _meta/tests/known-answer/csv-import-regression.mjs claims in its own
    comment to contain "REAL production logic extracted from vault HTML"
    for Core. It does not: it's a hand-written reimplementation that has
    already drifted from Core's actual parser (wrong line number in its own
    comment, and materially different logic -- e.g. it silently drops rows
    with fewer fields than the header, which the real readCSV() does not
    do). A hand-copy that looks extracted is worse than no test, because it
    creates false confidence. This script instead drives a real headless
    Chromium against the built dist/*.html and calls window.readCSV /
    window.parseCSV directly, so there is no copy to drift.

WHY THE THREE PHASES ARE CHARACTERIZED DIFFERENTLY
    They do not have the same contract (PLAN-arsitektur-4.2-4.3.md Temuan 1):
      - Core's readCSV(file) is async (FileReader-based) and returns the
        FULL pipeline result already numerically coerced.
      - Assay's parseCSV(text) is sync and returns ONLY raw string rows --
        decimal coercion happens later, via autodetectNumberFormat() run
        over parseCSV's own output. Both stages are characterized here so
        Assay's effective behaviour is comparable to the other two.
      - Resource's parseCSV(text) is sync and does the full 2-pass pipeline
        (tokenize, then detect-and-coerce) internally, like Core's readCSV.
    Forcing a uniform call shape here would hide real contract differences
    that Tahap 4.2 has to design around, not paper over.

WHICH ENTRY POINTS THIS CALLS AND WHY THEY ARE THE RIGHT ONES
    See PLAN-arsitektur-4.2-4.3.md's "Koreksi 2026-09-02" note. The first
    inventory pass picked Core's parseCSVText, which turned out to be
    private inside a `.orebit`-bundle IIFE and unreachable from outside --
    `typeof parseCSVText` is `undefined` on a real page. Every function
    called below was verified reachable (`typeof fn === 'function'`) against
    dist/*.html before being wired in here.

USAGE
    node build/build.mjs Core Assay Resource   # build dist/ first
    py -3 _meta/tests/known-answer/csv-parser-characterization.py
    py -3 _meta/tests/known-answer/csv-parser-characterization.py --record

    Without --record: compares fresh output against the committed snapshots
    in fixtures/csv-parser-baseline/ and fails (exit 1) on any difference.
    With --record: (re)writes the snapshots. Only ever run --record in the
    SAME commit as a parser change, with the diff reviewed and the change
    explained -- an unreviewed --record defeats the entire point of this
    test.

NOT A FAST-GATE CHECK
    Needs a served dist/ and a browser. Runs in the `pr` tier, same reasoning
    as ops/scripts/i18n-coverage.py.
"""

import argparse
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingTCPServer

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "fixtures"
CORPUS_DIR = FIXTURES / "csv-corpus"
BASELINE_DIR = FIXTURES / "csv-parser-baseline"


def _repo_root() -> Path:
    p = HERE
    for _ in range(10):
        if (p / "build" / "build.mjs").is_file():
            return p
        p = p.parent
    raise RuntimeError("could not find repo root (no build/build.mjs found above)")


REPO_ROOT = _repo_root()
DIST = REPO_ROOT / "dist"
VENDOR = REPO_ROOT / "exe-wrapper" / "pywebview" / "vendor"
PORT = 8804


class _Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(DIST), **k)

    def translate_path(self, path):
        if path.startswith("/vendor/"):
            return str(VENDOR / path[len("/vendor/"):])
        return super().translate_path(path)

    def log_message(self, *a):
        pass


class _Server(ThreadingTCPServer):
    allow_reuse_address = True


# All three probes take a single {text, name} object -- never a bare array --
# so there is no ambiguity about whether Playwright spreads a list arg across
# JS parameters (it does not; a multi-param JS function called with a list
# `arg` binds the whole list to its first parameter, silently leaving the
# rest undefined, which is exactly the bug this shape avoids).

# ── Core: readCSV(file) is async and needs a real File object ──
CORE_PROBE = """({text, name}) => (async () => {
  const file = new File([text], name, { type: 'text/csv' });
  try {
    const result = await readCSV(file);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
})()"""

# ── Assay: parseCSV(text) is sync, tokenize-only; decimal coercion is a
# separate stage (autodetectNumberFormat) run over its own output. ──
ASSAY_PROBE = """({text, name}) => {
  try {
    const rows = parseCSV(text);
    let decimal = null, formatError = null;
    try { decimal = autodetectNumberFormat(rows); }
    catch (e) { formatError = String(e && e.message || e); }
    return { ok: true, result: { rows, decimal, formatError, schemaMeta: window._lastSchemaMeta || null } };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}"""

# ── Resource: parseCSV(text) is sync and does the full 2-pass pipeline
# internally (tokenize, then detect-and-coerce). ──
RESOURCE_PROBE = """({text, name}) => {
  try {
    const result = parseCSV(text);
    return { ok: true, result, schemaMeta: window._lastSchemaMeta || null };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}"""

PHASES = {
    "Core": CORE_PROBE,
    "Assay": ASSAY_PROBE,
    "Resource": RESOURCE_PROBE,
}


def run_characterization():
    if not DIST.is_dir():
        print(f"FATAL: {DIST} does not exist -- run `node build/build.mjs "
              f"Core Assay Resource` first", file=sys.stderr)
        return None

    corpus_files = sorted(CORPUS_DIR.glob("*.csv"))
    if not corpus_files:
        print(f"FATAL: no corpus files in {CORPUS_DIR}", file=sys.stderr)
        return None

    srv = _Server(("127.0.0.1", PORT), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    snapshots = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for phase, probe_js in PHASES.items():
                page = browser.new_page()
                page.goto(f"http://127.0.0.1:{PORT}/{phase}.html",
                           wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
                phase_snap = {}
                for f in corpus_files:
                    # Corpus files can carry a real BOM / CRLF on purpose (07,
                    # see corpus case list) -- read raw bytes and decode as the
                    # browser's File API would (utf-8, BOM preserved as a
                    # leading char the parser itself is responsible for
                    # stripping, matching how a real upload arrives).
                    raw = f.read_bytes().decode("utf-8")
                    out = page.evaluate(probe_js, {"text": raw, "name": f.name})
                    phase_snap[f.name] = out
                    status = "ok" if out.get("ok") else f"ERROR: {out.get('error')}"
                    print(f"  {phase:9} {f.name:40} {status}")
                snapshots[phase] = phase_snap
                page.close()
            browser.close()
    finally:
        srv.shutdown()

    return snapshots


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--record", action="store_true",
                     help="(re)write the committed baseline instead of comparing to it")
    args = ap.parse_args()

    print("Running CSV parser characterization against dist/ ...")
    snapshots = run_characterization()
    if snapshots is None:
        return 2

    BASELINE_DIR.mkdir(parents=True, exist_ok=True)

    if args.record:
        for phase, phase_snap in snapshots.items():
            out = BASELINE_DIR / f"{phase}.json"
            out.write_text(json.dumps(phase_snap, indent=1, ensure_ascii=False, sort_keys=True),
                            encoding="utf-8")
            print(f"  wrote {out}")
        print("\nBaseline (re)recorded. Review the diff before committing.")
        return 0

    all_ok = True
    for phase, phase_snap in snapshots.items():
        baseline_path = BASELINE_DIR / f"{phase}.json"
        if not baseline_path.is_file():
            print(f"FAIL: no baseline at {baseline_path} -- run with --record first "
                  f"(and commit the result)", file=sys.stderr)
            all_ok = False
            continue
        expected = json.loads(baseline_path.read_text(encoding="utf-8"))
        actual_str = json.dumps(phase_snap, indent=1, ensure_ascii=False, sort_keys=True)
        expected_str = json.dumps(expected, indent=1, ensure_ascii=False, sort_keys=True)
        if actual_str == expected_str:
            print(f"✅ {phase}: matches baseline ({len(phase_snap)} corpus files)")
        else:
            all_ok = False
            print(f"❌ {phase}: DRIFTED from baseline")
            for fname in sorted(set(expected) | set(phase_snap)):
                e = json.dumps(expected.get(fname), sort_keys=True)
                a = json.dumps(phase_snap.get(fname), sort_keys=True)
                if e != a:
                    print(f"    {fname}:")
                    print(f"      baseline: {e[:200]}")
                    print(f"      current : {a[:200]}")

    if not all_ok:
        print("\nFAIL: parser behaviour changed. If this is a DELIBERATE fix "
              "(e.g. Temuan 2's unit-regex bug), re-run with --record and name "
              "the fix explicitly in the commit. If it is not deliberate, this "
              "is exactly the regression this test exists to catch.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
