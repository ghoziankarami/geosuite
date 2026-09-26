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

Two more from the same work (2026-09-25):

  4. The down-hole variogram paired "any two samples under 5 m apart horizontally"
     on a random 2,000-sample subset, so inclined holes lost their along-hole pairs.
     It now pairs samples of the same hole at their 3D distance; checked here pair
     for pair against a count and a gamma computed in this file. Auto-fit then holds
     the nugget at that value.
  5. Auto-fit searched the nugget only up to 60 % of the sill, and Thalanga, Babbitt
     and an epithermal-gold set all "had" a 60 % nugget: the edge of the search.
     A fit on an edge of the search is now flagged, checked on pure noise.

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


def write_two_domains(path):
    """10 x 10 vertical holes at 50 m, 20 x 2 m composites. M1 = the central 3 x 3 holes, 10-30 m
    deep in a checkerboard of them and only 10-18 m in the others, so the M1 bounding box (which
    the block model covers) holds ground whose nearest composite is M0. Grade ~5 in M1, ~0.2 in M0."""
    rows = []
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "domain", "cu_pct"])
        for i in range(10):
            for j in range(10):
                x, y = 1000 + i * 50, 5000 + j * 50
                for k in range(20):
                    d = k * 2 + 1
                    m1 = 3 <= i <= 5 and 3 <= j <= 5 and 10 <= d <= (30 if (i + j) % 2 == 0 else 18)
                    g = (5.0 + 0.3 * ((i + j + k) % 5)) if m1 else (0.2 + 0.02 * ((i * j + k) % 5))
                    dom = "M1" if m1 else "M0"
                    w.writerow([f"H{i}{j}", k * 2, k * 2 + 2, x, y, 400 - d, dom, g])
                    rows.append((x, y, 400 - d, dom))
    return rows


def rnd_stream(seed):
    s = [seed]

    def rnd():
        s[0] = (s[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return s[0] / 0x7FFFFFFF
    return rnd


def write_inclined(path):
    """12 holes dipping 60 deg towards azimuth 90, 80 x 1 m composites. Each hole has its own
    grade level (so between-hole variance is large) plus small noise (within-hole variance is
    small). Returns {hole: [(x, y, z, grade), ...]}."""
    rnd, holes = rnd_stream(777), {}
    ch, sh = math.cos(math.radians(60)), math.sin(math.radians(60))
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "domain", "cu_pct"])
        for h in range(12):
            x0, y0, level = 2000 + (h % 4) * 80, 7000 + (h // 4) * 80, 1 + 8 * rnd()
            for k in range(80):
                d = k + 0.5
                x, y, z, g = round(x0 + d * ch, 4), float(y0), round(500 - d * sh, 4), round(level + 0.3 * (rnd() - 0.5), 4)
                w.writerow([f"I{h:02d}", k, k + 1, x, y, z, "M1", g])
                holes.setdefault(f"I{h:02d}", []).append((x, y, z, g))
    return holes


def write_noise(path):
    """36 vertical holes at 50 m, 20 x 2 m composites, independent uniform grades: no spatial
    structure at any lag, so an honest fit has nothing to find."""
    rnd = rnd_stream(4242)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "domain", "cu_pct"])
        for h in range(36):
            x, y = 3000 + (h % 6) * 50, 8000 + (h // 6) * 50
            for k in range(20):
                w.writerow([f"N{h:02d}", k * 2, k * 2 + 2, x, y, 300 - (k * 2 + 1), "M1", round(0.5 + 2 * rnd(), 4)])
    return 720


def downhole_expected(holes, lag, max_h):
    """The down-hole variogram computed here: pairs within a hole, 3D distance, the app's binning."""
    n_lag = max(8, min(60, int(max_h // lag)))
    sums, ns = [0.0] * n_lag, [0] * n_lag
    for pts in holes.values():
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                h = math.dist(pts[i][:3], pts[j][:3])
                if not (0 < h <= max_h):
                    continue
                b = int(h // lag)
                if b < n_lag:
                    sums[b] += (pts[j][3] - pts[i][3]) ** 2
                    ns[b] += 1
    gammas = [sums[b] / (2 * ns[b]) for b in range(n_lag) if ns[b] >= 5]
    return sum(ns), gammas, min(gammas[:3])


def load_resource(br, path, n):
    pg = br.new_page()
    pg.goto(RESOURCE, wait_until="domcontentloaded", timeout=60000)
    ready(pg)
    pg.evaluate("showTab(2)")
    time.sleep(1.0)
    pg.locator("#fileInput").set_input_files(str(path))
    pg.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {n}", timeout=60000)
    time.sleep(1.0)
    pg.evaluate("showTab(3)")
    time.sleep(1.0)
    pg.evaluate("() => { const s = document.getElementById('setupElement'); if (s) { s.value = 'cu_pct'; s.dispatchEvent(new Event('change')); } }")
    time.sleep(1.0)
    pg.evaluate("showTab(4)")
    time.sleep(1.0)
    return pg


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

        print("\n── Resource: domain boundary ──")
        pts = write_two_domains(tmp / "two-domains.csv")
        pg = br.new_page()
        pg.goto(RESOURCE, wait_until="domcontentloaded", timeout=60000)
        ready(pg)
        pg.evaluate("showTab(2)")
        time.sleep(1.0)
        pg.locator("#fileInput").set_input_files(str(tmp / "two-domains.csv"))
        pg.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(pts)}", timeout=60000)
        time.sleep(1.0)
        pg.evaluate("showTab(3)")
        time.sleep(1.0)
        pg.evaluate("""() => { const s = document.getElementById('setupElement'); if (s) { s.value = 'cu_pct'; s.dispatchEvent(new Event('change')); }
                              const d = document.getElementById('setupDomain'); if (d) { d.value = 'M1'; d.dispatchEvent(new Event('change')); } }""")
        time.sleep(1.0)
        pg.evaluate("showTab(4)")
        time.sleep(0.8)
        # A fixed model: this checks the boundary, not the variogram fit.
        pg.evaluate("() => { variogramState.model = {type: 'spherical', nugget: 0.1, sill: 1, range: 150}; }")
        pg.evaluate("showTab(5)")
        time.sleep(0.8)
        pg.evaluate("""async () => { ['bmX','bmY'].forEach(id => document.getElementById(id).value = 25);
                                     document.getElementById('bmZ').value = 4; await generateBlocks(); }""")
        pg.evaluate("showTab(6)")
        time.sleep(0.8)

        def run(bound):
            pg.evaluate("""(b) => { const set = (id, v) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = v; else el.value = v; };
                set('srMaj', 120); set('srSemi', 120); set('srMin', 120); set('sAz', 0); set('sDip', 0); set('sMinN', 2); set('sMaxN', 12);
                set('sDomainBound', b); estimState.done = false; }""", bound)
            pg.evaluate("async () => { await runEstimation(); }")
            pg.wait_for_function("() => estimState.done === true", timeout=120000)
            return pg.evaluate("""(() => { const r = estimState.results, out = [];
                for (let i = 0; i < blockState.blocks.length; i++) if (Number.isFinite(r.ok[i])) { const b = blockState.blocks[i]; out.push([b.cx, b.cy, b.cz, r.ok[i]]); }
                return {blocks: out, outside: r.outsideDomain || 0}; })()""")
        off, on = run(False), run(True)
        check("without the boundary, M1 grade reaches M0 ground", len(off["blocks"]) > len(on["blocks"]),
              f"{len(off['blocks'])} blocks off vs {len(on['blocks'])} on")
        wrong = 0
        for bx, by, bz, _ in on["blocks"]:
            near = min(pts, key=lambda q: (q[0] - bx) ** 2 + (q[1] - by) ** 2 + (q[2] - bz) ** 2)
            wrong += near[3] != "M1"
        check("with the boundary, every estimated block's nearest composite is M1 (computed here)",
              on["blocks"] and wrong == 0, f"{wrong} of {len(on['blocks'])} blocks sit next to M0")
        check("the boundary reports how many blocks it removed", on["outside"] > 0, str(on["outside"]))
        pg.close()

        print("\n── Resource: down-hole variogram on inclined holes ──")
        holes = write_inclined(tmp / "inclined.csv")
        pg = load_resource(br, tmp / "inclined.csv", sum(len(v) for v in holes.values()))
        pg.evaluate("async () => { await computeDownholeVariogram(); }")
        dh = pg.evaluate("(() => { const d = variogramState.downhole; return {lag: d.lagSize, maxH: d.maxDist, total: d.totalPairs, gammas: d.gammas, nug: d.suggestedNugget}; })()")
        want_total, want_g, want_nug = downhole_expected(holes, dh["lag"], dh["maxH"])
        check("every within-hole pair of the inclined holes is counted (was: <5 m horizontal only)",
              dh["total"] == want_total, f"app {dh['total']} vs {want_total} computed here")
        check("down-hole gammas match the ones computed here",
              len(dh["gammas"]) == len(want_g) and all(abs(a - b) <= 1e-9 * max(1, b) for a, b in zip(dh["gammas"], want_g)),
              f"{[round(x, 5) for x in dh['gammas'][:3]]} vs {[round(x, 5) for x in want_g[:3]]}")
        check("down-hole nugget = min of the first three lags", abs(dh["nug"] - want_nug) <= 1e-12, f"{dh['nug']:.5f}")
        fit = pg.evaluate("""async () => { await computeVariogram(); await autoFitVariogram(false);
            return {m: variogramState.model, from: variogramState.fitNuggetFrom}; }""")
        check("auto-fit holds the nugget at the down-hole value", fit["from"] == "downhole" and abs(fit["m"]["nugget"] - dh["nug"]) < 1e-12,
              f"nugget {fit['m']['nugget']:.5f} from {fit['from']}")
        pg.close()

        print("\n── Resource: a fit on an edge of the search is flagged ──")
        pg = load_resource(br, tmp / "noise.csv", write_noise(tmp / "noise.csv"))
        res = pg.evaluate("""async () => { await computeVariogram(); await autoFitVariogram(true);
            return {at: variogramState.fitAtBounds || [], m: variogramState.model,
                    note: (document.getElementById('varStatus') || {}).textContent || ''}; }""")
        check("pure noise: the fit lands on an edge of the search and says so", len(res["at"]) > 0, f"{res['at']} {res['m']}")
        check("…with a warning under the fit", "edge of what auto-fit searches" in res["note"] or "batas pencarian auto-fit" in res["note"],
              res["note"][-160:])
        pg.close()
        br.close()
    print(f"\n  ESTIMATION INPUTS: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
