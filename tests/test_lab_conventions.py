#!/usr/bin/env python3
"""Lab and database conventions a geologist's real files carry, end to end in the browser.

Audit 2026-09-25 (docs/audits/kredibilitas-dan-opensource-2026-09-25.md). Every
check below failed on v2.9.5 and was measured in Chromium, not read from code:

  1. Negative grade codes. -0.005 is a detection limit; -99/-999/-9999 are missing
     samples. Core halved every negative (-9999 g/t Au -> 4,999.5 g/t; a 6-hole file
     averaged 47.69 g/t instead of 1.50), Assay kept them raw (mean -91 g/t).
  2. Over-limit ">10" was dropped (Core) or left as text (Assay): the highest-grade
     samples vanished.
  3. Unit-notation headers "Au (g/t)", "Cu (%)": Assay reported "Import complete" with
     zero grade elements; Core kept "Cu (%)" as an unrecognised column.
  4. Collar X/Y in latitude/longitude degrees loaded with no warning.
  5. The bundled Thalanga sample showed -995000 ppm Pb codes as 497,500 ppm (49.75 % Pb).
  6. (added with the Babbitt vignette) Lengths in feet had no import option -- read as
     metres every volume is 35.3x too large -- and a collar file with no depth column
     stacked every sample below the last survey station on that station: a hole with
     one survey record had all its samples at the collar (Babbitt: 97 samples).

The expected numbers are computed here from the generated CSV, independently of the app.
Requires HTTP servers on 8767 (Core), 8768 (Assay), 8769 (Resource) serving dist/ + vendor/,
as run-tier.sh pr starts them.
"""

import csv
import os
import random
import statistics
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("GEOSUITE_TEST_BASE", "http://localhost")
CORE, ASSAY, RESOURCE = f"{BASE}:8767/Core.html", f"{BASE}:8768/Assay.html", f"{BASE}:8769/Resource.html"
PASSED = FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ✅ {name}")
    else:
        FAILED += 1
        print(f"  ❌ {name}  {detail}")


def write_dataset(d: Path, header=("hole_id", "from", "to", "au_gpt", "cu_pct"), latlon=False, codes=True):
    """6 vertical holes x 20 two-metre samples. Returns the real (non-code) Au values."""
    random.seed(7)
    holes = [f"DH{i:02d}" for i in range(1, 7)]
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "collar.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hole_id", "x", "y", "z", "depth"])
        for i, h in enumerate(holes):
            if latlon:
                w.writerow([h, round(106.8 + (i % 3) * 0.0005, 6), round(-6.2 + (i // 3) * 0.0005, 6), 250, 40])
            else:
                w.writerow([h, 500000 + (i % 3) * 50, 9100000 + (i // 3) * 50, 250, 40])
    with open(d / "survey.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hole_id", "depth", "dip", "azimuth"])
        for h in holes:
            w.writerow([h, 0, -90, 0])
    real = []
    with open(d / "assay.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for h in holes:
            for k in range(20):
                au, cu = round(random.uniform(0.2, 3.0), 3), round(random.uniform(0.05, 1.2), 3)
                cell_au, cell_cu = au, cu
                if codes:
                    code = {("DH01", 3): -0.005, ("DH02", 5): -99, ("DH03", 7): -999, ("DH04", 9): -9999}.get((h, k))
                    if code is not None:
                        cell_au = code
                    if (h, k) == ("DH05", 2):
                        cell_cu = -99
                    if (h, k) == ("DH06", 4):
                        cell_au = ">10"
                if isinstance(cell_au, float) and cell_au >= 0:
                    real.append(cell_au)
                w.writerow([h, k * 2, k * 2 + 2, cell_au, cell_cu])
    return real


def write_feet_dataset(d: Path):
    """2 holes in FEET, collar file with no depth column. FT01: one survey station
    (-60 towards 090); FT02: vertical. 10 x 10 ft samples each."""
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "collar.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["BHID", "XCOLLAR", "YCOLLAR", "ZCOLLAR"])
        w.writerow(["FT01", 1640000, 30000000, 1000])
        w.writerow(["FT02", 1640500, 30000000, 1000])
    with open(d / "survey.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["BHID", "AT", "AZ", "DIP"])
        w.writerow(["FT01", 0, 90, -60])
        w.writerow(["FT02", 0, 0, -90])
    with open(d / "assay.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["BHID", "FROM", "TO", "CU"])
        for h in ("FT01", "FT02"):
            for k in range(10):
                w.writerow([h, k * 10, k * 10 + 10, 0.5])


def ready(pg):
    pg.wait_for_function("() => typeof showTab === 'function'", timeout=30000)
    pg.evaluate("""() => { document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e => e.remove());
      window.orebitConfirm = async () => true; window.confirm = () => true; window.alert = () => {}; }""")


def upload(pg, url, d, wait_js):
    pg.goto(url, wait_until="domcontentloaded", timeout=60000)
    ready(pg)
    pg.evaluate("showTab(2)")
    time.sleep(1.0)
    pg.locator("#fileInput").set_input_files([str(d / n) for n in ("collar.csv", "survey.csv", "assay.csv")])
    pg.wait_for_function(wait_js, timeout=90000)
    time.sleep(1.5)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="lab-conventions-"))
    real = write_dataset(tmp / "codes")
    # Expected: every real Au, the -0.005 limit as 0.0025, ">10" as 10; the three codes excluded.
    expect_vals = real + [0.0025, 10.0]
    expect_mean = statistics.mean(expect_vals)
    write_dataset(tmp / "notation", header=("Hole_ID", "From", "To", "Au (g/t)", "Cu (%)"), codes=False)
    write_dataset(tmp / "latlon", latlon=True, codes=False)
    write_feet_dataset(tmp / "feet")

    with sync_playwright() as p:
        br = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])

        print("\n── Core: negative codes, over-limit ──")
        pg = br.new_page()
        upload(pg, CORE, tmp / "codes", "() => STATE.assay.length === 120 && STATE.collar.length === 6")
        au = pg.evaluate("STATE.assay.map(r => r.au_gpt).filter(v => typeof v === 'number')")
        check("Core: -99/-999/-9999 are excluded, not halved", len(au) == len(expect_vals), f"n={len(au)} expected {len(expect_vals)}")
        check("Core: no value above the real maximum (4,999.5 before)", max(au) <= 10.0, f"max={max(au)}")
        check("Core: mean Au equals the independent mean", abs(statistics.mean(au) - expect_mean) < 1e-9,
              f"{statistics.mean(au)} vs {expect_mean}")
        cu = pg.evaluate("STATE.assay.filter(r => r.hole_id === 'DH05' && r.from_m === 4).map(r => r.cu_pct)")
        check("Core: Cu % -99 is blank, not 49.5 %", cu == [None], str(cu))
        check("Core: '>10' reads as 10", pg.evaluate("STATE.assay.filter(r => r.hole_id === 'DH06' && r.from_m === 8).map(r => r.au_gpt)") == [10])
        check("Core: the code count is reported", pg.evaluate("(window._lastGradeCodes || {}).missing") == 4)
        pg.close()

        print("\n── Assay: the same file uploaded directly ──")
        pg = br.new_page()
        upload(pg, ASSAY, tmp / "codes", "() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === 120")
        a = pg.evaluate("""(() => { const c = DATA.columns || DATA.cols; const i = c.indexOf('au_gpt');
            return DATA.rows.map(r => r[i]).filter(v => typeof v === 'number'); })()""")
        check("Assay: mean Au equals the independent mean (was -91 g/t)", a and abs(statistics.mean(a) - expect_mean) < 1e-9,
              f"{statistics.mean(a) if a else None} vs {expect_mean}")
        rep = pg.evaluate("(() => { const el = document.querySelector('[data-import-report]'); return el ? [el.dataset.importBdl, el.dataset.importMissingCodes] : null; })()")
        check("Assay: import report states 1 below-detection value and 4 missing codes", rep == ["1", "4"], str(rep))
        pg.close()

        print("\n── Unit-notation headers ──")
        pg = br.new_page()
        upload(pg, CORE, tmp / "notation", "() => STATE.assay.length === 120")
        gcols = pg.evaluate("getActualGradeColumns()")
        check("Core: 'Au (g/t)' and 'Cu (%)' are grade columns", {"au_gpt", "cu_pct"} <= set(gcols), str(gcols))
        pg.close()
        pg = br.new_page()
        upload(pg, ASSAY, tmp / "notation", "() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === 120")
        els = pg.evaluate("availableElements()")
        check("Assay: 'Au (g/t)' and 'Cu (%)' are analysable elements (was none)", "au_gpt" in els and "cu_pct" in els, str(els))
        pg.close()

        print("\n── Collar coordinates ──")
        pg = br.new_page()
        upload(pg, CORE, tmp / "latlon", "() => STATE.collar.length === 6 && STATE.assay.length === 120")
        chk = pg.evaluate("_p1RunValidationChecks().filter(c => /lat\\/long/.test(c.name)).map(c => c.severity)")
        check("Core: lat/long collar fails the projected-metres check", chk == ["fail"], str(chk))
        pg.close()
        pg = br.new_page()
        upload(pg, CORE, tmp / "codes", "() => STATE.assay.length === 120 && STATE.collar.length === 6")
        chk = pg.evaluate("_p1RunValidationChecks().filter(c => /lat\\/long/.test(c.name)).map(c => c.severity)")
        check("Core: UTM collar passes it", chk == ["ok"], str(chk))
        pg.close()

        print("\n── Lengths in feet, collar without depth ──")
        import math
        pg = br.new_page(accept_downloads=True)
        pg.goto(CORE, wait_until="domcontentloaded", timeout=60000)
        ready(pg)
        pg.wait_for_function("() => STATE.assay.length > 1000", timeout=60000)
        pg.evaluate("() => { document.getElementById('coreLengthUnit').value = 'ft'; applyLengthUnit('ft'); showTab(2); }")
        pg.locator("#fileInput").set_input_files([str(tmp / "feet" / n) for n in ("collar.csv", "survey.csv", "assay.csv")])
        pg.wait_for_function("() => STATE.assay.length === 20 && STATE.collar.length === 2", timeout=90000)
        time.sleep(1.0)
        bar = pg.evaluate("(document.getElementById('dataSourceText') || {}).innerText || ''")
        check("Core: 3 of 4 tables uploaded reads as your data, not 'still built-in: geology'",
              "sample" not in bar.lower() and "contoh" not in bar.lower(), bar)
        c = pg.evaluate("STATE.collar.find(r => r.hole_id === 'FT01')")
        check("Core ft: collar X/Z converted to metres (x0.3048)", abs(c["x"] - 1640000 * 0.3048) < 1e-6 and abs(c["z"] - 304.8) < 1e-9, str(c))
        last = pg.evaluate("(() => { computeMerge(); return STATE.merged.filter(r => r.hole_id === 'FT01').sort((a, b) => a.from_m - b.from_m).pop(); })()")
        mid = (90 + 100) / 2 * 0.3048
        ex, ez = 1640000 * 0.3048 + mid * math.cos(math.radians(60)), 304.8 - mid * math.sin(math.radians(60))
        check("Core: deepest sample of a one-station hole follows the hole (was stacked on the collar)",
              abs(last["midx"] - ex) < 1e-6 and abs(last["midz"] - ez) < 1e-6,
              f"mid=({last['midx']:.3f},{last['midz']:.3f}) expected ({ex:.3f},{ez:.3f})")
        with pg.expect_download(timeout=60000) as dl:
            pg.evaluate("exportMasterCSV()")
        out = tmp / "feet-master.csv"
        dl.value.save_as(str(out))
        check("Core: master export states the feet conversion", "# lengths: metres (converted from feet" in out.read_text(encoding="utf-8"))
        pg.close()

        print("\n── Bundled sample (Thalanga) ──")
        pg = br.new_page()
        pg.goto(CORE, wait_until="domcontentloaded", timeout=60000)
        ready(pg)
        pg.wait_for_function("() => STATE.assay.length > 1000", timeout=60000)
        pb = pg.evaluate("Math.max(...STATE.assay.map(r => r.pb_ppm).filter(v => typeof v === 'number'))")
        check("Core sample: no 497,500 ppm Pb from the -995000 code", pb < 400000, f"max Pb={pb}")
        pg.close()

        br.close()
    print(f"\n  LAB CONVENTIONS: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
