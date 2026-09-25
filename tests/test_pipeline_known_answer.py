"""Full-pipeline known-answer test: Core -> Assay -> Resource, verified
against independent from-scratch calculations, not against the app's own
functions re-run.

WHY THIS EXISTS
    known-answer-geostat.mjs already golden-tests individual pure functions
    in isolation. This test is different in kind: it drives the REAL browser
    UI end to end (real CSV file upload -> real column auto-detect -> real
    desurvey/composite/domain/variogram/kriging/tonnage), the same way a
    geologist actually uses the product, and checks the numbers it produces
    against a small hand-verifiable synthetic dataset. It is the regression
    guard for "did some later refactor silently change what a geologist's
    numbers would be" across the phase boundary, not just within one file.

DATASET
    25 holes on a 5x5 grid (50 m spacing), vertical, single 10 m interval
    each. Grade is a uniform background (2.0) except one anomalous hole at
    the grid centre (10.0) -- deliberately NOT a real exploration dataset;
    it is small and geometrically simple enough that every stage's expected
    value can be derived independently (by hand, or in the case of ordinary
    kriging, from a from-scratch linear-algebra solve written in this file,
    never by reading or calling the app's own ordinaryKriging()).

USAGE
    Requires HTTP servers on 8767 (Core), 8768 (Assay), 8769 (Resource) --
    same prerequisite as test_geology_invariants.py / test_phases.py.
    python3 test_pipeline_known_answer.py

Tolerance: 1e-4 relative, chosen to comfortably clear the Float32Array
storage precision the app's estimation arrays use internally (observed
differences were ~1e-7 in the session that authored this test) while still
catching a real formula regression, which would be off by orders of
magnitude, not float32 rounding.
"""

import json
import math
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("GEOSUITE_TEST_BASE", "http://localhost")
CORE_URL = f"{BASE}:8767/Core.html"
ASSAY_URL = f"{BASE}:8768/Assay.html"
RESOURCE_URL = f"{BASE}:8769/Resource.html"

PASSED = FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    mark = "✅" if ok else "❌"
    print(f"  {mark} {name}{(': ' + detail) if detail else ''}")
    if ok:
        PASSED += 1
    else:
        FAILED += 1
    return ok


def close_enough(a, b, rel_tol=1e-4, abs_tol=1e-6):
    return math.isclose(a, b, rel_tol=rel_tol, abs_tol=abs_tol)


# --------------------------------------------------------------------------
# Dataset: 5x5 grid, background grade 2.0, one anomaly hole (grid centre) at
# 10.0. Depth 10 m, vertical (dip=-90), single assay interval per hole.
# --------------------------------------------------------------------------
SPACING = 50
ORIGIN_X, ORIGIN_Y, Z_COLLAR, DEPTH = 1000, 1000, 100, 10
BACKGROUND_GRADE, ANOMALY_GRADE, ANOMALY_IJ = 2.0, 10.0, (2, 2)


def build_holes():
    holes = []
    for i in range(5):
        for j in range(5):
            grade = ANOMALY_GRADE if (i, j) == ANOMALY_IJ else BACKGROUND_GRADE
            holes.append({
                "hole_id": f"H{i}{j}", "x": ORIGIN_X + i * SPACING,
                "y": ORIGIN_Y + j * SPACING, "z": Z_COLLAR, "grade": grade,
            })
    return holes


def csv_content(holes):
    collar = ["hole_id,x,y,z,depth"]
    survey = ["hole_id,depth,dip,azimuth"]
    assay = ["hole_id,from_m,to_m,au_gpt"]
    geology = ["hole_id,from_m,to_m,lith1"]
    for h in holes:
        collar.append(f"{h['hole_id']},{h['x']},{h['y']},{h['z']},{DEPTH}")
        survey.append(f"{h['hole_id']},0,-90,0")
        survey.append(f"{h['hole_id']},{DEPTH},-90,0")
        assay.append(f"{h['hole_id']},0,{DEPTH},{h['grade']}")
        geology.append(f"{h['hole_id']},0,{DEPTH},GRANITE")
    return {
        "collar.csv": "\n".join(collar) + "\n",
        "survey.csv": "\n".join(survey) + "\n",
        "assay.csv": "\n".join(assay) + "\n",
        "geology.csv": "\n".join(geology) + "\n",
    }


def write_dataset(tmpdir, holes):
    files = csv_content(holes)
    paths = {}
    for name, content in files.items():
        p = tmpdir / name
        p.write_text(content, encoding="utf-8")
        paths[name] = str(p)
    return paths


# --------------------------------------------------------------------------
# Independent ordinary kriging (textbook formulation, not a port of the
# app's ordinaryKriging()/gammaAniso() -- see docstring).
# --------------------------------------------------------------------------
def spherical_gamma_unit(h):
    if h <= 0:
        return 0.0
    if h >= 1:
        return 1.0
    return 1.5 * h - 0.5 * h ** 3


def rotate_aniso(dx, dy, dz, az_deg, dip_deg):
    az, dip = math.radians(az_deg), math.radians(dip_deg)
    cos_a, sin_a = math.cos(az), math.sin(az)
    x_maj = sin_a * dx + cos_a * dy
    y_semi = cos_a * dx - sin_a * dy
    cos_d, sin_d = math.cos(dip), math.sin(dip)
    return cos_d * x_maj + sin_d * dz, y_semi, -sin_d * x_maj + cos_d * dz


def gamma(dx, dy, dz, model, search):
    maj, semi, mn = rotate_aniso(dx, dy, dz, search["azDeg"], search["dipDeg"])
    h = math.sqrt((maj / search["rMaj"]) ** 2 + (semi / search["rSemi"]) ** 2 + (mn / search["rMin"]) ** 2)
    return model["nugget"] + (model["sill"] - model["nugget"]) * spherical_gamma_unit(h)


def solve_linear(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        M[col], M[piv] = M[piv], M[col]
        if abs(M[col][col]) < 1e-14:
            raise ValueError("singular matrix")
        for r in range(col + 1, n):
            f = M[r][col] / M[col][col]
            for c in range(col, n + 1):
                M[r][c] -= f * M[col][c]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = M[i][n] - sum(M[i][j] * x[j] for j in range(i + 1, n))
        x[i] = s / M[i][i]
    return x


def independent_ok(block, neighbors, model, search):
    n = len(neighbors)
    dim = n + 1
    A = [[0.0] * dim for _ in range(dim)]
    b = [0.0] * dim
    for i in range(n):
        si = neighbors[i]
        for j in range(n):
            if i != j:
                sj = neighbors[j]
                A[i][j] = gamma(si["x"] - sj["x"], si["y"] - sj["y"], si["z"] - sj["z"], model, search)
        A[i][n] = 1.0
        b[i] = gamma(si["x"] - block["cx"], si["y"] - block["cy"], si["z"] - block["cz"], model, search)
    for j in range(n):
        A[n][j] = 1.0
    b[n] = 1.0
    w = solve_linear(A, b)
    estimate = sum(w[i] * neighbors[i]["v"] for i in range(n))
    variance = w[n] + sum(w[i] * b[i] for i in range(n))
    return estimate, variance, w[:n]


# --------------------------------------------------------------------------
# D11 (docs/PLAN-integritas-data-assay.md, docs/PLAN-refactor-dataset-kolom.md
# §2.5/Tahap 5): measured density never reached tonnage -- Resource always
# used one scalar SG per session. Added case, NOT a modification of the
# scalar-density assertions above (raw["density"] / blockState.density stays
# locked to the uniform-SG behaviour that predates this fix).
#
# Separate small dataset (6 samples, one interval each) with a real `density`
# column that varies per sample. Uploaded as collar+survey+assay (same shape
# the main 25-hole dataset above uses) rather than a single combined file --
# Resource's block-setup panel (tab 5) needs real midx/midy/midz to render its
# bmX/bmY/bmZ inputs at all, and a single-file upload with no collar/survey
# leaves those columns empty (found the hard way: generateBlocks() throws on
# a null #bmX read when the panel has nothing to size a grid against, not a
# density bug). Verifies, independently at each hop:
#   Assay:    computeComposites() length-weights density the same way it
#             length-weights grade (trivial here: one interval per hole, so
#             density_comp must equal that hole's raw density exactly).
#   Assay:    exportMasterForEstimation() actually writes it to the CSV
#             (previously hard-coded '' -- see the removed comment this
#             replaced).
#   Resource: assignBlockDensities() picks tier 1 (per-sample) automatically
#             -- blockState.densitySource == 'sample' -- and each block's
#             density is its nearest sample's OWN value, not a lithology-
#             table guess or the uniform bmDens default. Checked against an
#             independent brute-force nearest-neighbour recomputation in
#             Python (same technique already used for the NN grade check
#             above), for EVERY generated block, not just one -- against the
#             REAL midx/midy/midz Resource actually loaded (read back from its
#             own DATA rows), not a hand-assumed desurveyed position, so this
#             stays correct regardless of exactly how the app places a
#             composite's midpoint.
#   Resource: total tonnage summed from real per-block density matches the
#             same formula computed independently in Python from the known
#             sample densities.
#   Resource: the report note (_estimationParamsNote, feeds every CSV/PDF
#             export) names the real source instead of a uniform SG.
# --------------------------------------------------------------------------
D11_SAMPLES = [
    {"hole_id": "S1", "x": 1000, "y": 1000, "density": 2.50, "grade": 2.0},
    {"hole_id": "S2", "x": 1000, "y": 1050, "density": 2.60, "grade": 2.2},
    {"hole_id": "S3", "x": 1000, "y": 1100, "density": 2.70, "grade": 2.4},
    {"hole_id": "S4", "x": 1050, "y": 1000, "density": 3.10, "grade": 2.6},
    {"hole_id": "S5", "x": 1050, "y": 1050, "density": 3.20, "grade": 2.8},
    {"hole_id": "S6", "x": 1050, "y": 1100, "density": 3.30, "grade": 3.0},
]
D11_Z_COLLAR, D11_DEPTH = 100, 10


def test_d11_per_sample_density(tmpdir):
    print("─── D11: per-sample density -> tonnage (Assay composite, Resource block model) ───")
    collar = ["hole_id,x,y,z,depth"]
    survey = ["hole_id,depth,dip,azimuth"]
    assay_csv = ["hole_id,from_m,to_m,au_gpt,density"]
    for s in D11_SAMPLES:
        collar.append(f"{s['hole_id']},{s['x']},{s['y']},{D11_Z_COLLAR},{D11_DEPTH}")
        survey.append(f"{s['hole_id']},0,-90,0")
        survey.append(f"{s['hole_id']},{D11_DEPTH},-90,0")
        assay_csv.append(f"{s['hole_id']},0,{D11_DEPTH},{s['grade']},{s['density']}")
    d11_files = {}
    for name, content in [("d11-collar.csv", collar), ("d11-survey.csv", survey), ("d11-assay.csv", assay_csv)]:
        p = tmpdir / name
        p.write_text("\n".join(content) + "\n", encoding="utf-8")
        d11_files[name] = str(p)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(ASSAY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(
            [d11_files["d11-collar.csv"], d11_files["d11-survey.csv"], d11_files["d11-assay.csv"]])
        page.wait_for_timeout(2500)

        comp = page.evaluate("computeComposites(10, 0.5, false)")
        by_hole = {c["hole_id"]: c for c in comp["composites"]}
        check("D11/Assay: all 6 samples produced exactly one composite each, no drops",
              len(comp["composites"]) == 6 and not comp["droppedHoles"],
              f"n={len(comp['composites'])} dropped={comp['droppedHoles']}")
        mismatches = [s["hole_id"] for s in D11_SAMPLES
                      if not close_enough((by_hole.get(s["hole_id"]) or {}).get("density_comp", -1), s["density"])]
        check("D11/Assay: computeComposites length-weights density (single interval -> density_comp == raw density)",
              not mismatches, f"mismatches={mismatches}")

        with page.expect_download(timeout=15000) as dl:
            page.evaluate("exportMasterForEstimation()")
        assay_export = str(tmpdir / "d11-assay-export.csv")
        dl.value.save_as(assay_export)
        with open(assay_export, encoding="utf-8") as f:
            export_lines = [ln for ln in f.read().splitlines() if ln and not ln.startswith("#")]
        header = export_lines[0].split(",")
        check("D11/Assay: exported CSV carries a density column (was hard-coded blank before this fix)",
              "density" in header, f"header={header}")
        if "density" in header:
            hole_i, dens_i = header.index("hole_id"), header.index("density")
            exported_dens = {row.split(",")[hole_i]: float(row.split(",")[dens_i]) for row in export_lines[1:]}
            dens_mismatches = [s["hole_id"] for s in D11_SAMPLES
                                if not close_enough(exported_dens.get(s["hole_id"], -1), s["density"])]
            check("D11/Assay: exported density values match the raw input for all 6 holes",
                  not dens_mismatches, f"mismatches={dens_mismatches}")
        browser.close()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(RESOURCE_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(assay_export)
        page.wait_for_timeout(2000)
        page.evaluate("window.orebitConfirm = async () => true; window.confirm = () => true;")

        def show(n):
            page.evaluate(f"showTab({n})")
            page.wait_for_timeout(500)

        # Ground truth for the nearest-neighbour check below: Resource's own
        # loaded x/y/z/density per hole, not a hand-assumed desurveyed
        # position -- see the D11 block comment above for why.
        loaded_samples = page.evaluate("""() => {
            const xi=colIdx('midx'), yi=colIdx('midy'), zi=colIdx('midz'), densi=colIdx('density'), hi=colIdx('hole_id');
            const byHole = {};
            DATA.rows.forEach(r => { byHole[r[hi]] = {x:r[xi], y:r[yi], z:r[zi], density:r[densi]}; });
            return byHole;
        }""")
        check("D11/Resource: all 6 holes carried real midx/midy/midz through the import (block panel needs it)",
              len(loaded_samples) == 6 and all(
                  isinstance(v.get("x"), (int, float)) and isinstance(v.get("y"), (int, float))
                  and isinstance(v.get("z"), (int, float)) for v in loaded_samples.values()),
              f"loaded_samples={loaded_samples}")

        show(4)
        page.evaluate("""async () => { await computeVariogram(); await autoFitVariogram(false); }""")
        # This 6-point/2-row grid is too sparse and regular for auto-fit to
        # converge on a real model (unrelated to D11 -- runEstimation() just
        # needs SOME model to not early-return so the density-driven tonnage
        # note and per-block densities can be exercised through a real
        # estimation pass, not only through direct blockState reads).
        if not page.evaluate("!!variogramState.model"):
            page.evaluate("""() => {
                variogramState.model = { type: 'spherical', nugget: 0, sill: 0.2, range: 150 };
            }""")
        show(5)
        bmx_present = page.evaluate("!!document.getElementById('bmX')")
        check("D11/Resource: block-setup panel rendered its size inputs", bmx_present)
        if not bmx_present:
            browser.close()
            return
        page.evaluate("""() => {
            const setv=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
            setv('bmX',10); setv('bmY',10); setv('bmZ',5);
            const d=document.getElementById('bmDens'); if(d) d.value=2.7;
        }""")
        page.wait_for_timeout(300)
        page.evaluate("""async () => { await generateBlocks(); }""")
        show(6)
        page.evaluate("""async () => { await runEstimation(); }""")
        for _ in range(60):
            if page.evaluate("estimState.done === true"):
                break
            page.wait_for_timeout(500)
        check("D11/Resource: estimation completed on the density-bearing dataset", page.evaluate("estimState.done === true"))

        src = page.evaluate("blockState.densitySource")
        check("D11/Resource: tier 1 (per-sample density) auto-selected -- a density column exists and no domain table was applied",
              src == "sample", f"densitySource={src!r}")

        raw = page.evaluate("""() => ({
          blockSize: blockState.size,
          blocks: blockState.blocks.map(b => ({cx:b.cx, cy:b.cy, cz:b.cz})),
          blockDensities: blockState.blockDensities ? Array.from(blockState.blockDensities) : null,
          note: (typeof _estimationParamsNote === 'function') ? _estimationParamsNote() : '',
        })""")
        check("D11/Resource: per-block densities were actually assigned (blockDensities is populated)",
              bool(raw["blockDensities"]) and len(raw["blockDensities"]) == len(raw["blocks"]),
              f"blocks={len(raw['blocks'])} densities={raw['blockDensities'] and len(raw['blockDensities'])}")

        if raw["blockDensities"]:
            # Independent nearest-neighbour recomputation in Python, against the
            # REAL positions Resource loaded (loaded_samples, read back from its
            # own DATA rows above) -- not a hand-assumed desurveyed position --
            # paired with the known density each hole was given, mirroring the
            # existing NN-grade check's "closest = min(..., key=euclidean
            # distance)" pattern.
            def nearest_density(cx, cy, cz):
                best, best_d2 = None, math.inf
                for s in loaded_samples.values():
                    d2 = (s["x"] - cx) ** 2 + (s["y"] - cy) ** 2 + (s["z"] - cz) ** 2
                    if d2 < best_d2:
                        best_d2, best = d2, s["density"]
                return best

            expected = [nearest_density(b["cx"], b["cy"], b["cz"]) for b in raw["blocks"]]
            per_block_mismatches = sum(
                1 for a, e in zip(raw["blockDensities"], expected) if not close_enough(a, e)
            )
            check("D11/Resource: every block's density matches its nearest sample's OWN value (not a table lookup)",
                  per_block_mismatches == 0, f"{per_block_mismatches}/{len(expected)} blocks mismatched")

            bx, by, bz = raw["blockSize"]
            vol = bx * by * bz
            app_tons = sum(raw["blockDensities"]) * vol / 1e6
            expected_tons = sum(expected) * vol / 1e6
            check("D11/Resource: total tonnage from real per-block density matches independent recomputation",
                  close_enough(app_tons, expected_tons), f"app={app_tons}, expected={expected_tons}")

        note_text = "\n".join(raw["note"]) if isinstance(raw["note"], list) else str(raw["note"])
        check("D11/Resource: the density source is named in the report/PDF note, not left as a plain uniform SG",
              "per-sample density" in note_text, f"note={note_text!r}")
        page.evaluate("showTab(9)"); page.wait_for_timeout(600)
        page.evaluate("runClassification()"); page.evaluate("showTab(12)"); page.wait_for_timeout(600)
        kcmi = page.evaluate("document.getElementById('kcmiContent').innerText")
        check("D11/Resource: KCMI report names per-sample density as the basis (was 'variable by lithology')",
              "Per sample (each block takes its nearest composite" in kcmi, kcmi[:200])

        browser.close()


# --------------------------------------------------------------------------
# Assay multi-file merge used to stamp every sample with its hole's COLLAR
# x/y/z (survey ignored, depth ignored): midz never fell with depth and an
# inclined hole's X/Y never moved. Now the sample sits at its interval
# MIDPOINT on the minimum-curvature trace (same shared/geostat/desurvey.js
# Core uses). Hand-computed: straight hole (two identical surveys), dip -60
# az 90 => inclination from vertical 30 deg, heading east; at measured depth d
# x = x0 + d*sin(30), y = y0, z = z0 - d*cos(30). Vertical hole: z = z0 - d.
# --------------------------------------------------------------------------
def test_assay_midpoint_desurvey(tmpdir):
    print("─── Assay: sample midpoints follow the survey (not the collar) ───")
    collar = ["hole_id,x,y,z,depth", "V1,2000,3000,100,10", "I1,1000,1000,100,10"]
    survey = ["hole_id,depth,dip,azimuth", "V1,0,-90,0", "V1,10,-90,0", "I1,0,-60,90", "I1,10,-60,90"]
    assay = ["hole_id,from_m,to_m,au_gpt", "V1,0,5,1.0", "V1,5,10,1.5", "I1,0,5,2.0", "I1,5,10,2.5"]
    files = []
    for name, content in [("m-collar.csv", collar), ("m-survey.csv", survey), ("m-assay.csv", assay)]:
        fp = tmpdir / name
        fp.write_text("\n".join(content) + "\n", encoding="utf-8")
        files.append(str(fp))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(ASSAY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(files)
        page.wait_for_timeout(2500)
        rows = page.evaluate("""() => {
          const hi=colIdx('hole_id'), fi=colIdx('from_m'), xi=colIdx('midx'), yi=colIdx('midy'), zi=colIdx('midz');
          return DATA.rows.map(r => ({h:r[hi], f:r[fi], x:r[xi], y:r[yi], z:r[zi]}));
        }""")
        browser.close()
    s30, c30 = math.sin(math.radians(30)), math.cos(math.radians(30))
    bad = []
    for r in rows:
        d = r["f"] + 2.5
        if r["h"] == "V1":
            exp = (2000, 3000, 100 - d)
        else:
            exp = (1000 + d * s30, 1000, 100 - d * c30)
        got = (r["x"], r["y"], r["z"])
        if not all(isinstance(g, (int, float)) and close_enough(g, e, abs_tol=1e-3) for g, e in zip(got, exp)):
            bad.append({"row": r, "expected": exp})
    check("Assay: all 4 sample midpoints match the hand-computed desurvey (vertical + inclined)",
          len(rows) == 4 and not bad, f"rows={len(rows)} bad={bad}")



# --------------------------------------------------------------------------
# D15/D16: a geology file's own category columns (alteration, oxidation) used
# to be dropped from Core's merge and master export, while lith2/weathering --
# which the file did not have -- were written as EMPTY columns. Now every
# geology column rides along under its original name, and a column with no
# value in any row is not written.
# --------------------------------------------------------------------------
def test_core_export_category_columns(tmpdir):
    print("─── Core: category columns reach the master export (D15/D16) ───")
    contents = {
        "c-collar.csv": "hole_id,x,y,z,depth\nA1,1000,1000,100,10\n",
        "c-survey.csv": "hole_id,depth,dip,azimuth\nA1,0,-90,0\nA1,10,-90,0\n",
        "c-assay.csv": "hole_id,from_m,to_m,au_gpt\nA1,0,5,1.0\nA1,5,10,2.0\n",
        "c-geology.csv": "hole_id,from_m,to_m,lith1,alteration,oxidation\n"
                         "A1,0,5,GRANITE,SERICITE,OX\nA1,5,10,GRANITE,CHLORITE,FRESH\n",
    }
    paths = []
    for name, text in contents.items():
        fp = tmpdir / name
        fp.write_text(text, encoding="utf-8")
        paths.append(str(fp))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(CORE_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof STATE !== 'undefined' && typeof computeComposites === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(paths)
        page.wait_for_timeout(2500)
        with page.expect_download(timeout=15000) as dl:
            page.evaluate("exportMasterCSV()")
        out = str(tmpdir / "c-master.csv")
        dl.value.save_as(out)
        browser.close()
    with open(out, encoding="utf-8") as f:
        lines = [ln for ln in f.read().splitlines() if ln and not ln.startswith("#")]
    header = lines[0].split(",")
    rows = [dict(zip(header, ln.split(","))) for ln in lines[1:]]
    check("Core export: alteration and oxidation columns are kept under their original names",
          "alteration" in header and "oxidation" in header, f"header={header}")
    check("Core export: their values are correct per interval",
          [r.get("alteration") for r in rows] == ["SERICITE", "CHLORITE"]
          and [r.get("oxidation") for r in rows] == ["OX", "FRESH"], f"rows={rows}")
    check("Core export: lith2/weathering (absent from the file) are NOT written as empty columns",
          "lith2" not in header and "weathering" not in header, f"header={header}")


def test_tin_volumetric_end_to_end(tmpdir):
    print("─── Tin placer (kg/m³): Assay → Resource, density role + volumetric guard ───")
    from pathlib import Path
    here = Path(__file__).resolve()
    corpus = next((a / "data" / "dataset-demo" / "repo" / "03-timah-placer" for a in here.parents
                   if (a / "data" / "dataset-demo" / "repo" / "03-timah-placer").is_dir()), None)
    if corpus is None:
        print("  SKIP: tin corpus not present in this checkout")
        return
    files = [str(corpus / n) for n in ("collar.csv", "survey.csv", "assay.csv", "litho.csv")]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(ASSAY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(files)
        page.wait_for_timeout(6000)
        with page.expect_download(timeout=60000) as dl:
            page.evaluate("exportMasterForEstimation()")
        out = str(tmpdir / "tin-master.csv")
        dl.value.save_as(out)

        with open(out, encoding="utf-8") as f:
            lines = [ln for ln in f.read().splitlines() if ln and not ln.startswith("#")]
        header = lines[0].split(",")
        check("Tin Assay export: BD_TM3 reaches the export as canonical 'density'",
              "density" in header, f"header={header}")
        if "density" in header:
            di = header.index("density")
            vals = [float(r.split(",")[di]) for r in lines[1:] if r.split(",")[di] not in ("", "nan")]
            check("Tin Assay export: density values are populated and physical",
                  len(vals) > 0 and all(0.5 < v < 6 for v in vals), f"n={len(vals)}")

        page.goto(RESOURCE_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(out)
        page.wait_for_timeout(4000)
        page.evaluate("window.orebitConfirm = async () => true; window.confirm = () => true;")
        check("Tin Resource: grade unit detected as volumetric",
              page.evaluate("isVolumetricGrade(setupState.element)") is True)
        page.evaluate("showTab(4)")
        page.wait_for_timeout(500)
        page.evaluate("async () => { await computeVariogram(); await autoFitVariogram(false); }")
        page.evaluate("showTab(5)")
        page.wait_for_timeout(600)
        page.evaluate("() => { bmX.value = 40; bmY.value = 40; bmZ.value = 10; }")
        page.evaluate("async () => { await generateBlocks(); }")
        check("Tin Resource: density ignored for volumetric grade (uniform 1, no per-block table, no source)",
              page.evaluate("blockState.density") == 1
              and page.evaluate("!!blockState.blockDensities") is False
              and page.evaluate("blockState.densitySource") is None)
        if page.evaluate("!!variogramState.model"):
            page.evaluate("showTab(6)")
            page.wait_for_timeout(500)
            page.evaluate("async () => { await runEstimation(); }")
            for _ in range(240):
                if page.evaluate("estimState.done === true"):
                    break
                page.wait_for_timeout(500)
            check("Tin Resource: estimation completes", page.evaluate("estimState.done === true"))
            page.evaluate("showTab(9)"); page.wait_for_timeout(600)
            page.evaluate("runClassification()"); page.evaluate("showTab(12)"); page.wait_for_timeout(600)
            kcmi = page.evaluate("document.getElementById('kcmiContent').innerText")
            check("Tin Resource: KCMI report bulk-density basis says not applied (volumetric), not 'uniform'",
                  "Not applied (volumetric grade" in kcmi and "Uniform (apply domain" not in kcmi, kcmi[:200])
            note = "\n".join(page.evaluate("_estimationParamsNote()"))
            check("Tin Resource: report note says density is not applied (no misleading 'uniform 1 t/m³')",
                  "not applied" in note and "uniform 1 t/m" not in note, note[:300])
        else:
            check("Tin Resource: variogram model fitted", False)
        browser.close()


def test_indonesian_headers_multifile(tmpdir):
    print("─── Indonesian headers (Lubang/Dari/Sampai/Litho/Elevasi): Core + Assay must not lose files ───")
    contents = {
        "f1.csv": "Lubang,Easting,Northing,Elevasi,Kedalaman\nA1,1000,1000,100,10\nA2,1050,1000,100,10\n",
        "f2.csv": "Lubang,Kedalaman,Dip,Azimuth\nA1,0,-90,0\nA1,10,-90,0\nA2,0,-90,0\nA2,10,-90,0\n",
        "f3.csv": "Lubang,Dari,Sampai,Cu_ppm,Zn_ppm\nA1,0,5,100,50\nA1,5,10,200,60\nA2,0,5,150,70\nA2,5,10,250,80\n",
        "f4.csv": "Lubang,Dari,Sampai,Litho,Alterasi\nA1,0,10,GRN,SER\nA2,0,10,GRN,CHL\n",
    }
    paths = []
    for name, text in contents.items():
        fp = tmpdir / ("id-" + name)
        fp.write_text(text, encoding="utf-8")
        paths.append(str(fp))
    # neutral filenames (f1..f4): classification must come from the headers alone
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(CORE_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof STATE !== 'undefined' && typeof computeComposites === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.locator("#fileInput").set_input_files(paths)
        page.wait_for_timeout(3000)
        counts = page.evaluate("[STATE.collar.length, STATE.survey.length, STATE.assay.length, STATE.geology.length]")
        check("Core: all four Indonesian-header files land in their tables (2/4/4/2)", counts == [2, 4, 4, 2], f"counts={counts}")
        with page.expect_download(timeout=20000) as dl:
            page.evaluate("exportMasterCSV()")
        out = str(tmpdir / "id-core.csv")
        dl.value.save_as(out)
        with open(out, encoding="utf-8") as f:
            header = [ln for ln in f.read().splitlines() if ln and not ln.startswith("#")][0].split(",")
        check("Core export: lithology and the original 'Alterasi' column are kept",
              "lithology" in header and "Alterasi" in header, f"header={header}")

        page.goto(ASSAY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.locator("#fileInput").set_input_files(paths)
        page.wait_for_timeout(4000)
        mid = page.evaluate("""(() => { const x = colIdx('midx'), z = colIdx('midz');
            return x < 0 ? null : DATA.rows.map(r => [r[x], r[z]]); })()""")
        check("Assay: collar with Easting/Elevasi headers gives every sample real coordinates",
              mid is not None and len(mid) == 4 and all(isinstance(a, (int, float)) and isinstance(b, (int, float)) for a, b in mid),
              f"mid={mid}")
        check("Assay: hole with A1 vertical hole: midz of first sample = 100 - 2.5",
              mid is not None and abs(mid[0][1] - 97.5) < 1e-6, f"mid={mid}")
        browser.close()


def test_auto_domain_host_k1(tmpdir):
    print("─── Assay auto-domain (K1): host = smallest lithology set carrying >= 80% of the metal ───")
    # A: 1 thin very rich interval (highest MEAN, the old rule's host); B/C: bulk of the metal; D: barren.
    litho = [("A", 1, 10.0), ("B", 10, 2.0), ("C", 10, 1.5), ("D", 10, 0.1)]
    lines = ["hole_id,from_m,to_m,midx,midy,midz,lithology,au_gpt"]
    metal, hi = {}, 0
    for lith, n, g in litho:
        for _ in range(n):
            hi += 1
            lines.append(f"H{hi},0,1,{1000 + hi},1000,100,{lith},{g}")
            metal[lith] = metal.get(lith, 0) + g
    fp = tmpdir / "k1.csv"
    fp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    total = sum(metal.values())
    ranked = sorted(metal.items(), key=lambda kv: -kv[1])
    host, acc = [], 0
    for l, m in ranked:
        host.append(l)
        acc += m
        if acc / total >= 0.8:
            break
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(ASSAY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.locator("#fileInput").set_input_files(str(fp))
        page.wait_for_timeout(3000)
        page.evaluate("renderDomain()")
        rows = page.evaluate("""(() => { const d = colIdx('domain'), l = colIdx('lithology'), g = colIdx('au_gpt');
            return d < 0 ? null : DATA.rows.map(r => [r[l], r[d], r[g]]); })()""")
        browser.close()
    check("Assay auto-domain: domain column materialised", rows is not None and len(rows) == 31)
    if rows:
        per = {}
        for l, d, g in rows:
            per.setdefault(l, set()).add(d)
        peri = sum(g for l, d, g in rows if d == "D4-Peripheral")
        check(f"K1: every lithology of the host set {sorted(host)} is outside D4-Peripheral",
              all("D4-Peripheral" not in per[l] or len(per[l]) > 1 for l in host if l in per) and
              all(per[l] != {"D4-Peripheral"} for l in host), f"per={per}")
        check("K1: barren lithology D is entirely D4-Peripheral", per.get("D") == {"D4-Peripheral"}, f"per={per}")
        check("K1: <= 20% of the metal is left in D4-Peripheral (old highest-mean rule left ~78%)",
              peri / total <= 0.2 + 1e-9, f"peripheral share={peri / total:.3f}")


def test_safe_render_reports_failures():
    print("─── safeRender: a failing render is recorded, not only logged ───")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        for name, url in (("Core", CORE_URL), ("Assay", ASSAY_URL), ("Resource", RESOURCE_URL)):
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_function("() => typeof safeRender === 'function'", timeout=15000)
            rec = page.evaluate("""(() => { safeRender('probe', () => { throw new Error('boom'); });
                return window._renderFailures; })()""")
            check(f"{name}: safeRender records the failure for tests/UI", rec == [{"label": "probe", "message": "boom"}], f"rec={rec}")
            page.close()
        browser.close()


def test_assay_3d_exports_restored(tmpdir):
    print("─── Assay: 3D drill trace (.str) and domain-solid DXF exports (K2, restored) ───")
    pts = [(0, 0, 0), (10, 0, 0), (0, 10, 0), (0, 0, 10), (10, 10, 10), (10, 10, 0), (5, 5, 5), (10, 0, 10)]
    lines = ["hole_id,from_m,to_m,midx,midy,midz,lithology,au_gpt"]
    for i, (x, y, z) in enumerate(pts):
        lines.append(f"H{i % 2 + 1},{i},{i + 1},{1000 + x},{2000 + y},{100 + z},GRN,1.0")  # uniform grade: one domain holds all 8 points
    fp = tmpdir / "solids.csv"
    fp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(ASSAY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.locator("#fileInput").set_input_files(str(fp))
        page.wait_for_timeout(3000)
        with page.expect_download(timeout=15000) as dl:
            page.evaluate("export3DCompositeTraceStr()")
        tp = str(tmpdir / "trace.str")
        dl.value.save_as(tp)
        with page.expect_download(timeout=15000) as dl:
            page.evaluate("exportDomainSolidsDXF()")
        dp = str(tmpdir / "solids.dxf")
        dl.value.save_as(dp)
        page.evaluate("showTab(6)")
        page.wait_for_timeout(3000)
        png_ok = None
        if page.evaluate("typeof Plotly !== 'undefined' && !!document.getElementById('densityMap')"):
            with page.expect_download(timeout=30000) as dl:
                page.evaluate("exportDensityMap()")
            pp = str(tmpdir / "map.png")
            dl.value.save_as(pp)
            with open(pp, "rb") as f:
                png_ok = f.read(4)[1:] == b"PNG"
        browser.close()
    check("Collar density map exports a real PNG (Plotly available on the Spacing tab)", png_ok is True, f"png_ok={png_ok}")
    trace = open(tp, encoding="utf-8").read().splitlines()
    check("3D trace: one string per hole (2) with all 8 sample midpoints", trace.count("*** string ***") == 2 and sum(1 for l in trace if l.count(",") == 2) == 8, f"n={len(trace)}")
    check("3D trace: exact coordinates written (1010.000,2010.000,110.000 present)", "1010.000,2010.000,110.000" in trace)
    dxf = open(dp, encoding="utf-8").read().splitlines()
    faces = dxf.count("3DFACE")
    # Convex hull of these 8 points (cube minus one corner, plus an interior point): closed
    # triangulated surface, V - E + F = 2 with E = 3F/2 -> F = 2V - 4 for V hull vertices (V=7 here).
    check("DXF: closed solid triangulation, 10 triangles for the 7-vertex hull (F = 2V - 4)", faces == 10, f"faces={faces}")
    check("DXF: a DOMAIN_ layer names the domain", any(l.startswith("DOMAIN_") for l in dxf))


def main():
    import tempfile
    from pathlib import Path

    tmpdir = Path(tempfile.mkdtemp(prefix="pipeline-known-answer-"))
    holes = build_holes()
    files = write_dataset(tmpdir, holes)

    print("─── CORE: import, desurvey, composite ───")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(CORE_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof STATE !== 'undefined' && typeof computeComposites === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files([files["collar.csv"], files["survey.csv"], files["assay.csv"], files["geology.csv"]])
        page.wait_for_timeout(2500)

        counts = page.evaluate("({collar: STATE.collar.length, assay: STATE.assay.length})")
        check("Core: all 25 holes imported", counts["collar"] == 25, str(counts))

        # Desurvey: vertical hole H22 (the anomaly, at 1100,1100) at depth=5m
        # should sit at exactly (1100, 1100, 95) -- collar Z=100, straight down.
        page.evaluate("showTab(10)")
        page.wait_for_timeout(1000)
        pt = page.evaluate("""() => {
          const t = STATE.desurvey.holes['H22'].trace;
          for (let i=0;i<t.length-1;i++) if (5>=t[i].depth && 5<=t[i+1].depth) {
            const f=(5-t[i].depth)/(t[i+1].depth-t[i].depth);
            return {x:t[i].x+(t[i+1].x-t[i].x)*f, y:t[i].y+(t[i+1].y-t[i].y)*f, z:t[i].z+(t[i+1].z-t[i].z)*f};
          }
          return null;
        }""")
        check("Core: desurvey H22 @5m == (1100,1100,95)", pt and close_enough(pt["x"], 1100) and close_enough(pt["y"], 1100) and close_enough(pt["z"], 95), str(pt))

        # Composite: whole-hole average (compLen=10) must equal the raw grade
        # (single uniform 10 m interval per hole -- trivial but exercises the
        # real lengthWeightedComposite() extracted in Tahap 4.1).
        comp = page.evaluate("computeComposites(10, ['au_gpt']).map(r => ({hole_id:r.hole_id, au_gpt:r.au_gpt}))")
        by_hole = {c["hole_id"]: c["au_gpt"] for c in comp}
        ok = all(close_enough(by_hole.get(h["hole_id"], -1), h["grade"]) for h in holes)
        check("Core: composite grade matches raw input for all 25 holes", ok, f"mismatches={[h['hole_id'] for h in holes if not close_enough(by_hole.get(h['hole_id'],-1), h['grade'])]}")

        page.evaluate("showTab(13)")
        page.wait_for_timeout(1000)
        with page.expect_download(timeout=15000) as dl:
            page.evaluate("exportMasterCSV()")
        core_export = str(tmpdir / "core-master-export.csv")
        dl.value.save_as(core_export)
        browser.close()

    print("─── ASSAY: import, domain auto-tagging, export ───")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(ASSAY_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(core_export)
        page.wait_for_timeout(2000)
        page.evaluate("showTab(11)")
        page.wait_for_timeout(1500)

        # docs/PLAN-domain-aware-dan-dokumentasi.md I3: of this file's 13
        # assertions, only 1 used to touch Assay, and it was structural
        # ("file exists"), not a number. That left the module with 19
        # unreleased commits the thinnest-covered link in the end-to-end
        # chain. These check the actual handoff Resource depends on: does
        # the composite/export step preserve every hole and every grade
        # value exactly, byte-for-byte through the real CSV Resource reads.
        composites = page.evaluate("computeComposites(10, 0.5, false)")
        check("Assay: composites (10m, whole-hole) produce exactly 25 rows, no holes dropped",
              len(composites["composites"]) == 25 and not composites["droppedHoles"],
              f"n={len(composites['composites'])} dropped={composites['droppedHoles']}")
        comp_by_hole = {c["hole_id"]: c["au_gpt_comp"] for c in composites["composites"]}
        mismatches = [h["hole_id"] for h in holes
                      if not close_enough(comp_by_hole.get(h["hole_id"], -1), h["grade"])]
        check("Assay: composite grades match Core's raw input for all 25 holes",
              not mismatches, f"mismatches={mismatches}")

        with page.expect_download(timeout=15000) as dl:
            page.evaluate("exportMasterForEstimation()")
        assay_export = str(tmpdir / "assay-domain-export.csv")
        dl.value.save_as(assay_export)
        check("Assay: domain-tagged export produced", os.path.exists(assay_export))

        # Round-trip through the actual FILE Resource will read next -- not
        # through in-memory state, which the assertions above already cover.
        # This is the one place a CSV-writing bug (wrong column order, a
        # dropped decimal, a comma inside an unquoted field) would show up.
        with open(assay_export, encoding="utf-8") as f:
            export_lines = [ln for ln in f.read().splitlines()
                            if ln and not ln.startswith("#")]
        header = export_lines[0].split(",")
        hole_i, grade_i = header.index("hole_id"), header.index("au_gpt")
        exported = {row.split(",")[hole_i]: float(row.split(",")[grade_i])
                    for row in export_lines[1:]}
        check("Assay: exported CSV has exactly 25 composite rows",
              len(exported) == 25, f"{len(exported)} rows")
        file_mismatches = [h["hole_id"] for h in holes
                            if not close_enough(exported.get(h["hole_id"], -1), h["grade"])]
        check("Assay: grades in the exported CSV match raw input for all 25 holes",
              not file_mismatches, f"mismatches={file_mismatches}")

        # This synthetic dataset carries no domain column (geology.csv only
        # supplies lith1) -- exercising exportMasterForEstimation()'s domain
        # assignment for exactly that case. First attempt at this assertion
        # assumed the 'Waste' fallback would fire and was wrong: renderDomain()
        # auto-tags every row via grade percentile before the fallback is ever
        # reached, and on THIS dataset (24/25 rows at background grade 2.0)
        # the 80th-percentile threshold still sits at 2.0, so all 25 holes --
        # background and anomaly alike -- clear it into 'D1-Core-HighGrade'.
        # The invariant Resource actually depends on is not which label wins,
        # it's that no composite reaches Resource with an empty one.
        domain_i = header.index("domain")
        domains = [row.split(",")[domain_i] for row in export_lines[1:]]
        check("Assay: every composite gets a non-empty domain label, even with no domain column in the source",
              all(d for d in domains), f"blank count={sum(1 for d in domains if not d)}, values={set(domains)}")

        browser.close()

    print("─── RESOURCE: variogram, blocks, estimation, tonnage, units ───")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(RESOURCE_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => typeof showTab === 'function'", timeout=15000)
        page.wait_for_timeout(1000)
        page.evaluate("showTab(2)")
        page.wait_for_timeout(500)
        page.locator("#fileInput").set_input_files(assay_export)
        page.wait_for_timeout(2000)
        page.evaluate("window.orebitConfirm = async () => true; window.confirm = () => true;")

        def show(n):
            page.evaluate(f"showTab({n})")
            page.wait_for_timeout(500)

        show(4)
        page.evaluate("""async () => { await computeVariogram(); await autoFitVariogram(false); }""")
        model = page.evaluate("variogramState.model")
        check("Resource: variogram fitted a model", bool(model), str(model))

        show(5)
        page.evaluate("""() => {
            if (typeof autoSuggestBlockSize === 'function') autoSuggestBlockSize();
            const setv=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
            setv('bmX',10); setv('bmY',10); setv('bmZ',5);
            const d=document.getElementById('bmDens'); if(d) d.value=2.7;
        }""")
        page.wait_for_timeout(300)
        page.evaluate("""async () => { await generateBlocks(); }""")

        show(6)
        page.evaluate("""async () => { await runEstimation(); }""")
        for _ in range(60):
            if page.evaluate("estimState.done === true"):
                break
            page.wait_for_timeout(500)
        check("Resource: estimation completed (estimState.done)", page.evaluate("estimState.done === true"))

        # ---- IDW / NN / OK at the block nearest the anomaly ----
        target = {"cx": 1110, "cy": 1110, "cz": 95}
        full = page.evaluate(f"""() => {{
          const r = estimState.results;
          let best=-1, bestD=Infinity;
          blockState.blocks.forEach((b,i) => {{
            const d = Math.sqrt((b.cx-{target['cx']})**2+(b.cy-{target['cy']})**2+(b.cz-{target['cz']})**2);
            if (d<bestD) {{ bestD=d; best=i; }}
          }});
          const b = blockState.blocks[best];
          const samples = getSamples();
          const cellSize = Math.max(searchState.rMaj, searchState.rSemi, searchState.rMin)/2;
          const idx = buildSampleIndex(samples, cellSize);
          const nb = neighborsAround(idx, b.cx, b.cy, b.cz, samples, searchState);
          return {{
            block: {{cx:b.cx, cy:b.cy, cz:b.cz}},
            ok: r.ok[best], idw: r.idw[best], nn: r.nn[best], variance: r.variance[best],
            model: variogramState.model,
            search: {{rMaj:searchState.rMaj, rSemi:searchState.rSemi, rMin:searchState.rMin, azDeg:searchState.azDeg, dipDeg:searchState.dipDeg}},
            neighbors: nb.map(n => ({{x:samples[n.idx].x, y:samples[n.idx].y, z:samples[n.idx].z, v:samples[n.idx].v}})),
          }};
        }}""")

        # Independent IDW (power=2).
        num = sum((1 / n["v"]) if False else (1 / (math.hypot(n["x"] - full["block"]["cx"], n["y"] - full["block"]["cy"], n["z"] - full["block"]["cz"]) ** 2 or 1e-18)) * n["v"] for n in full["neighbors"])
        den = sum(1 / (math.hypot(n["x"] - full["block"]["cx"], n["y"] - full["block"]["cy"], n["z"] - full["block"]["cz"]) ** 2 or 1e-18) for n in full["neighbors"])
        idw_expected = num / den
        check("Resource: IDW matches independent recomputation", close_enough(full["idw"], idw_expected), f"app={full['idw']}, expected={idw_expected}")

        # Independent NN: value of the single closest neighbor.
        closest = min(full["neighbors"], key=lambda n: math.hypot(n["x"] - full["block"]["cx"], n["y"] - full["block"]["cy"], n["z"] - full["block"]["cz"]))
        check("Resource: NN matches nearest neighbor's grade", close_enough(full["nn"], closest["v"]), f"app={full['nn']}, expected={closest['v']}")

        # Independent Ordinary Kriging (from-scratch solver above).
        ok_expected, var_expected, _ = independent_ok(full["block"], full["neighbors"], full["model"], full["search"])
        check("Resource: OK kriging estimate matches independent solve", close_enough(full["ok"], ok_expected), f"app={full['ok']}, expected={ok_expected}")
        check("Resource: kriging variance matches independent solve", close_enough(full["variance"], var_expected), f"app={full['variance']}, expected={var_expected}")

        # ---- Grade-tonnage curve ----
        show(10)
        page.wait_for_timeout(500)
        page.evaluate("""() => {
            const setv=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v;};
            setv('gtMin',0); setv('gtMax',10); setv('gtSteps',11);
            const cb=document.getElementById('gtClass'); if(cb) cb.checked=false;
        }""")
        page.evaluate("computeGT()")
        page.wait_for_timeout(1000)
        gt = page.evaluate("""() => {
          const gd = document.getElementById('gtPlot');
          return { cutoffs: gd.data[0].x, tonnage_Mt: gd.data[0].y, mean_grade: gd.data[1].y };
        }""")
        raw = page.evaluate("""() => ({
          blockSize: blockState.size, density: blockState.density,
          okValues: Array.from(estimState.results.ok),
        })""")
        bx, by, bz = raw["blockSize"]
        vol = bx * by * bz
        ok_vals = [v for v in raw["okValues"] if v is not None and not (isinstance(v, float) and math.isnan(v))]
        gt_ok = True
        for i, cut in enumerate(gt["cutoffs"]):
            above = [v for v in ok_vals if v >= cut]
            expected_tons = len(above) * vol * raw["density"] / 1e6
            # No tonnage above a cut-off -> no mean grade (null), not 0: a 0 drew the
            # grade line diving to zero at the right edge (changed 2026-09-25).
            expected_grade = (sum(above) / len(above)) if above else None
            grade_ok = (gt["mean_grade"][i] is None) if expected_grade is None \
                else (gt["mean_grade"][i] is not None and close_enough(gt["mean_grade"][i], expected_grade, abs_tol=1e-9))
            if not (close_enough(gt["tonnage_Mt"][i], expected_tons, abs_tol=1e-9) and grade_ok):
                gt_ok = False
        check("Resource: grade-tonnage curve matches independent recomputation (11 cutoffs)", gt_ok)

        # ---- Contained-metal unit handling (g/t, ppm, %, kg/m^3) ----
        n_blocks = len(ok_vals)
        tons_mt = n_blocks * vol * raw["density"] / 1e6
        mean_grade = sum(ok_vals) / n_blocks
        vol_mm3 = (n_blocks * vol) / 1e6
        expected_metal = {
            "g/t": tons_mt * mean_grade,
            "ppm": tons_mt * mean_grade,
            "%": tons_mt * mean_grade * 1e4,
            "kg/m³": vol_mm3 * 1e6 * mean_grade / 1000,
        }
        units_ok = True
        for unit, expected in expected_metal.items():
            page.evaluate(f"setupState.gradeUnit = {json.dumps(unit)};")
            actual = page.evaluate(f"containedMetalTonnes({tons_mt!r}, {mean_grade!r}, setupState.element, {vol_mm3!r})")
            if not close_enough(actual, expected):
                units_ok = False
                print(f"    unit {unit!r} mismatch: app={actual}, expected={expected}")
        check("Resource: contained-metal formula correct for all 4 grade units", units_ok)
        page.evaluate("setupState.gradeUnit = null;")  # restore auto-detect

        browser.close()

    test_d11_per_sample_density(tmpdir)
    test_assay_midpoint_desurvey(tmpdir)
    test_core_export_category_columns(tmpdir)
    test_tin_volumetric_end_to_end(tmpdir)
    test_indonesian_headers_multifile(tmpdir)
    test_auto_domain_host_k1(tmpdir)
    test_safe_render_reports_failures()
    test_assay_3d_exports_restored(tmpdir)

    print("\n" + "=" * 50)
    print(f"  PIPELINE KNOWN-ANSWER: {PASSED} passed, {FAILED} failed")
    print("=" * 50)
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
