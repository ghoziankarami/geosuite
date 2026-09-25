#!/usr/bin/env python3
"""What reaches the estimator: composite positions, coverage, and cross-validation.

Three defects found building the Babbitt vignette (2026-09-25), each checked here
against numbers computed in this file, not by the app:

  1. Assay gave every composite the mid-point of the raw interval that contained
     it, so all composites cut from one long raw interval shared one coordinate
     (zero-distance pairs inflate the nugget; duplicates make kriging singular).
     Now interpolated along the hole at the composite's own mid-depth.
  2. Coverage counted any raw interval, so a composite inside an UNASSAYED
     interval reported coverage 1.0 with every grade blank. Now only assayed
     length counts.
  3. Resource's leave-one-out searched neighbours only inside its 200-sample
     subsample (13,464 Babbitt composites -> 10 valid pairs), and the subsample
     used Math.random(), so the same data gave different numbers on every run --
     as did the variogram above 5,000 samples (Babbitt nugget 0.063 vs 0.069).

Requires HTTP servers on 8768 (Assay) and 8769 (Resource) serving dist/ + vendor/,
as run-tier.sh pr starts them.
"""

import csv
import math
import os
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("GEOSUITE_TEST_BASE", "http://localhost")
ASSAY, RESOURCE = f"{BASE}:8768/Assay.html", f"{BASE}:8769/Resource.html"
PASSED = FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    ok = bool(ok)
    PASSED += ok
    FAILED += not ok
    print(f"  {'✅' if ok else '❌'} {name}{(': ' + detail) if detail else ''}")


def ready(pg):
    pg.wait_for_function("() => typeof showTab === 'function'", timeout=30000)
    pg.evaluate("""() => { document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e => e.remove());
      window.orebitConfirm = async () => true; window.confirm = () => true; window.alert = () => {}; }""")


def read_csv(path):
    lines = [ln for ln in Path(path).read_text(encoding="utf-8").splitlines() if ln and not ln.startswith("#")]
    return list(csv.DictReader(lines))


def write_master(path):
    """One hole inclined 60 deg towards 090 from (1000, 2000, 500): two assayed 10 m
    intervals, then a 20 m interval that was never assayed. Coordinates are the
    desurveyed interval mid-points, as Core exports them."""
    def pos(d):
        return 1000 + d * math.cos(math.radians(60)), 2000.0, 500 - d * math.sin(math.radians(60))
    rows = [(0, 10, 1.2), (10, 20, 0.8), (20, 40, None)]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "cu_pct"])
        for a, b, g in rows:
            x, y, z = pos((a + b) / 2)
            w.writerow(["DH1", a, b, round(x, 6), round(y, 6), round(z, 6), "" if g is None else g])
    return pos


def write_dense_composites(path):
    """30 vertical holes on a 100 m grid, 200 x 2 m composites each: 6,000 samples, above both
    the 200-sample cross-validation limit and the 5,000-sample variogram cap. Smooth trend +
    seeded noise."""
    seed = [12345]

    def rnd():
        seed[0] = (seed[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return seed[0] / 0x7FFFFFFF
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "domain", "cu_pct"])
        for h in range(30):
            x, y = 500000 + (h % 6) * 100, 9000000 + (h // 6) * 100
            for k in range(200):
                d = k * 2 + 1
                g = 1.0 + 0.4 * math.sin(x / 150.0) + 0.3 * math.cos(y / 120.0) + 0.2 * (rnd() - 0.5)
                w.writerow([f"H{h:02d}", k * 2, k * 2 + 2, x, y, 300 - d, "M1", round(g, 4)])
    return 6000


def main():
    tmp = Path(tempfile.mkdtemp(prefix="estimation-inputs-"))
    pos = write_master(tmp / "master.csv")
    n_dense = write_dense_composites(tmp / "dense.csv")
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])

        print("\n── Assay: composite positions and coverage ──")
        pg = br.new_page(accept_downloads=True)
        pg.goto(ASSAY, wait_until="domcontentloaded", timeout=60000)
        ready(pg)
        pg.evaluate("showTab(2)")
        time.sleep(1.0)
        pg.locator("#fileInput").set_input_files(str(tmp / "master.csv"))
        pg.wait_for_function("() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === 3", timeout=60000)
        time.sleep(1.5)
        with pg.expect_download(timeout=60000) as dl:
            pg.evaluate("exportMasterForEstimation({length: 2})")
        out = tmp / "comp.csv"
        dl.value.save_as(str(out))
        comps = read_csv(out)
        check("20 composites of 2 m over 40 m", len(comps) == 20, str(len(comps)))
        errs = []
        for c in comps:
            mid = (float(c["from_m"]) + float(c["to_m"])) / 2
            ex, _, ez = pos(mid)
            errs.append(max(abs(float(c["midx"]) - ex), abs(float(c["midz"]) - ez)))
        check("every composite sits at its own mid-depth on the hole (was: its raw interval's mid-point)",
              max(errs) < 1e-3, f"max error {max(errs):.4f} m")
        zs = [c["midz"] for c in comps]
        check("no two composites share a coordinate", len(set(zs)) == len(zs), f"{len(set(zs))} distinct of {len(zs)}")
        una = [c for c in comps if float(c["from_m"]) >= 20]
        check("composites inside the unassayed interval report coverage 0 (was 1.0)",
              una and all(float(c["coverage"]) == 0 and c["cu_pct"] == "" for c in una),
              str([(c["coverage"], c["cu_pct"]) for c in una[:3]]))
        asy = [c for c in comps if float(c["to_m"]) <= 20]
        check("assayed composites keep coverage 1", all(float(c["coverage"]) == 1 for c in asy))
        pg.close()

        print("\n── Resource: leave-one-out on a dense dataset ──")
        pg = br.new_page()
        pg.goto(RESOURCE, wait_until="domcontentloaded", timeout=60000)
        ready(pg)
        pg.evaluate("showTab(2)")
        time.sleep(1.0)
        pg.locator("#fileInput").set_input_files(str(tmp / "dense.csv"))
        pg.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {n_dense}", timeout=60000)
        time.sleep(1.5)
        pg.evaluate("showTab(3)")
        time.sleep(1.0)
        pg.evaluate("() => { const s = document.getElementById('setupElement'); if (s) { s.value = 'cu_pct'; s.dispatchEvent(new Event('change')); } }")
        time.sleep(1.0)
        pg.evaluate("showTab(4)")
        time.sleep(1.0)
        vg = "async () => { await computeVariogram(); await autoFitVariogram(false); return JSON.stringify(variogramState.model); }"
        m1 = pg.evaluate(vg)
        m2 = pg.evaluate(vg)
        check("same data, same variogram above the 5,000-sample cap (was Math.random)", m1 == m2, f"{m1} vs {m2}")
        time.sleep(1.0)
        pg.evaluate("showTab(7)")
        time.sleep(1.0)

        def cv_run():
            pg.evaluate("() => { crossvalState.metrics = null; }")
            pg.evaluate("async () => { await runCrossVal(); }")
            pg.wait_for_function("() => crossvalState && crossvalState.metrics && !crossvalState._running", timeout=120000)
            return pg.evaluate("({pairs: crossvalState.results.actual.length, ok: crossvalState.metrics.ok})")
        a = cv_run()
        check("the 200 left-out samples find neighbours among ALL samples (was: only among the 200)",
              a["pairs"] >= 190, f"{a['pairs']} valid pairs of 200")
        check("cross-validation on a smooth field is informative (OK r2 > 0.5)", a["ok"]["r2"] > 0.5, f"r2={a['ok']['r2']:.3f}")
        b = cv_run()
        check("same data, same cross-validation numbers (was Math.random)",
              a["pairs"] == b["pairs"] and abs(a["ok"]["rmse"] - b["ok"]["rmse"]) < 1e-12,
              f"rmse {a['ok']['rmse']:.6f} vs {b['ok']['rmse']:.6f}")
        pg.close()
        br.close()
    print(f"\n  ESTIMATION INPUTS: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
