#!/usr/bin/env python3
"""Vignette 02 -- Babbitt Cu-Ni (Duluth Complex, Minnesota), real public data.

The lessons this dataset teaches and Thalanga cannot:
  * the files are in FEET (collar X/Y/Z, depths, intervals), and nothing in them
    says so -- read as metres, every volume is 3.28^3 = 35.3x too large;
  * 61 % of the drilled length was never assayed -- "unknown" vs "zero" moves
    the mean Cu grade by a factor of 2.6;
  * a few massive-sulphide assays (up to 24 % Cu) sit far above a continuous,
    low-grade disseminated population: here a top-cut IS the right call;
  * dense drilling (399 holes) -- how the answer looks when the data can carry it.

Data: the Babbitt drill database shipped with pygslib's Tutorial 1
(https://github.com/opengeostat/pygslib, MIT licence), taken from the Natural
Resources Research Institute (University of Minnesota) Duluth Complex database,
NRRI/TR-2003/21. Not redistributed here: the runner reads a local copy or
downloads it from the pinned pygslib commit below.

Usage: node build/build.mjs && python3 docs/vignettes/tools/run_babbitt.py [--no-shots]
       BABBITT_DIR=/path/to/Babbitt ... to use an existing copy.
Exit code 3 = data not available (no copy, no network); test_vignettes.py skips.
"""

from __future__ import annotations

import csv
import os
import statistics as st
import sys
import tempfile
import time
import urllib.request
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vignette_kit as K  # noqa: E402

SHOTS = "--no-shots" not in sys.argv
PYGSLIB_COMMIT = "c26c3bff20c7cc16583c94fb850e17600b9a610d"
RAW = f"https://raw.githubusercontent.com/opengeostat/pygslib/{PYGSLIB_COMMIT}/doc/source/Tutorial_1/Babbitt/"
FILES = ("collar_BABBITT.csv", "survey_BABBITT.csv", "assay_BABBITT.csv")
FT = 0.3048
COMP_LEN = 3.048        # m = 10 ft, the dominant sample length (78 % of intervals)
CUTOFF = 0.2            # % Cu grade shell -- keeps 91 % of the metal (see vignette section 3)
TOPCUT = 3.0           # % Cu: P99.5 of the 0.2 % shell, 94 assays, 1.7 % of the metal (see vignette section 4)
BLOCK = (50, 50, 15)    # m -- about 1/4 of the ~200 m hole spacing; 15 m = 50 ft bench
SEARCH = {"srMaj": 200, "srSemi": 200, "srMin": 30, "sAz": 0, "sDip": 0, "sMinN": 4, "sMaxN": 16}
GT_CUTOFFS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8]


def shot(pg, name, sel=None):
    return K.shot(pg, f"babbitt-{name}", sel) if SHOTS else f"babbitt-{name}.png"


def settle(pg, ms=800):
    pg.wait_for_timeout(ms)


def find_data() -> Path | None:
    cands = [os.environ.get("BABBITT_DIR"), "/tmp/pygslib/doc/source/Tutorial_1/Babbitt",
             str(Path.home() / ".cache" / "orebit-vignettes" / "babbitt")]
    for c in cands:
        if c and all((Path(c) / f).exists() for f in FILES):
            return Path(c)
    dest = Path.home() / ".cache" / "orebit-vignettes" / "babbitt"
    try:
        dest.mkdir(parents=True, exist_ok=True)
        for f in FILES:
            urllib.request.urlretrieve(RAW + f, dest / f)
        return dest
    except Exception as e:  # offline, proxy, ...
        print(f"Babbitt data not available ({e}). Set BABBITT_DIR or clone pygslib.")
        return None


def independent_raw(src: Path, R):
    """Everything here is computed from the published CSVs in plain Python."""
    A = list(csv.DictReader(open(src / "assay_BABBITT.csv", encoding="utf-8")))
    C = list(csv.DictReader(open(src / "collar_BABBITT.csv", encoding="utf-8")))
    S = list(csv.DictReader(open(src / "survey_BABBITT.csv", encoding="utf-8")))
    L = [float(a["TO"]) - float(a["FROM"]) for a in A]
    ass = [(a, ln) for a, ln in zip(A, L) if a["CU"] != ""]
    tl = sum(ln for _, ln in ass)
    metal = sum(float(a["CU"]) * ln for a, ln in ass)
    xs = [float(c["XCOLLAR"]) for c in C]
    ys = [float(c["YCOLLAR"]) for c in C]
    cu = sorted(float(a["CU"]) for a, _ in ass)
    pairs = [(float(a["CU"]), float(a["NI"])) for a, _ in ass if a["NI"] != ""]
    share = {}
    for c in (0.1, 0.2, 0.3, 0.5):
        sel = [(float(a["CU"]), ln) for a, ln in ass if float(a["CU"]) >= c]
        share[str(c)] = {"metal_pct": round(100 * sum(v * ln for v, ln in sel) / metal, 1),
                         "length_pct": round(100 * sum(ln for _, ln in sel) / tl, 1),
                         "mean_cu": round(sum(v * ln for v, ln in sel) / sum(ln for _, ln in sel), 3)}
    nst = Counter(s["BHID"] for s in S)
    R["raw"] = {
        "holes": len(C), "surveys": len(S), "assay_rows": len(A),
        "collar_columns": list(C[0].keys()),
        "assay_columns": list(A[0].keys()),
        "length_mode_ft": Counter(round(x, 1) for x in L).most_common(1)[0][0],
        "length_mode_share_pct": round(100 * Counter(round(x, 1) for x in L).most_common(1)[0][1] / len(L), 1),
        "extent_ft": [round(max(xs) - min(xs)), round(max(ys) - min(ys))],
        "extent_m": [round((max(xs) - min(xs)) * FT), round((max(ys) - min(ys)) * FT)],
        "volume_factor_if_read_as_m": round(1 / FT ** 3, 1),
        "drilled_m": round(sum(L) * FT), "assayed_m": round(tl * FT),
        "unassayed_m": round((sum(L) - tl) * FT), "unassayed_pct": round(100 * (sum(L) - tl) / sum(L), 1),
        "cu_mean_assayed": round(metal / tl, 4),
        "cu_mean_zero_filled": round(metal / sum(L), 4),
        "cu_p50": cu[len(cu) // 2], "cu_p99": cu[int(len(cu) * 0.99)], "cu_p999": cu[int(len(cu) * 0.999)],
        "cu_max": cu[-1], "cu_n": len(cu),
        "metal_share": share,
        "cu_ni_r": round(st.correlation([p[0] for p in pairs], [p[1] for p in pairs]), 3),
        "ni_cu_ratio_median": round(st.median([b / a for a, b in pairs if a > 0.1]), 3),
        "single_station_holes": sum(1 for c in C if nst[c["BHID"]] <= 1),
        "topcut_check": _topcut_check(ass, metal),
        "B1_001_expected_deepest_midz": _b1_001_expected(A, C, S),
        "holes_without_collar_depth": len(C) if "DEPTH" not in (k.upper() for k in C[0]) else 0,
    }


def _topcut_check(ass, metal):
    """Length-weighted effect of the 3 % Cu cap on the raw assays, and on the 0.2 % shell's CV."""
    m1 = [v for v, _ in ((float(a["CU"]), ln) for a, ln in ass) if v >= CUTOFF]
    cv = lambda x: st.pstdev(x) / st.mean(x)  # noqa: E731
    return {"cut": TOPCUT, "assays_above": sum(1 for a, _ in ass if float(a["CU"]) > TOPCUT),
            "metal_removed_length_weighted_pct": round(100 * sum((float(a["CU"]) - TOPCUT) * ln for a, ln in ass if float(a["CU"]) > TOPCUT) / metal, 2),
            "m1_cv_raw": round(cv(m1), 2), "m1_cv_capped": round(cv([min(v, TOPCUT) for v in m1]), 2),
            "m1_p995": sorted(m1)[int(len(m1) * 0.995)]}


def _b1_001_expected(A, C, S):
    """B1-001: one survey station (-60 towards 327), no collar depth. Straight-line position of
    its deepest sample's mid-point, in metres."""
    import math
    c = next(x for x in C if x["BHID"] == "B1-001")
    last = max((a for a in A if a["BHID"] == "B1-001"), key=lambda a: float(a["FROM"]))
    mid = (float(last["FROM"]) + float(last["TO"])) / 2 * FT
    dip = float(next(x for x in S if x["BHID"] == "B1-001")["DIP"])
    return round(float(c["ZCOLLAR"]) * FT - mid * math.sin(math.radians(dip)), 2)


def core_stage(br, site, src, tmp, R):
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(site.base + "/Core.html", wait_until="load")
    K.ready(pg)
    pg.wait_for_function("() => STATE.assay.length > 9000", timeout=90000)
    settle(pg, 1500)
    pg.evaluate("() => { showTab(2); document.getElementById('coreLengthUnit').value = 'ft'; applyLengthUnit('ft'); }")
    pg.locator("#fileInput").set_input_files([str(src / f) for f in FILES])
    pg.wait_for_function(f"() => STATE.assay.length === {R['raw']['assay_rows']} && STATE.collar.length === {R['raw']['holes']}", timeout=120000)
    settle(pg, 2500)
    R["core"] = c = {}
    c["tables"] = pg.evaluate("({collar: STATE.collar.length, survey: STATE.survey.length, assay: STATE.assay.length, geology: STATE.geology.length})")
    c["length_unit_source"] = pg.evaluate("STATE.lengthUnitSource")
    c["collar_first"] = pg.evaluate("(() => { const r = STATE.collar[0]; return {hole_id: r.hole_id, x: r.x, y: r.y, z: r.z}; })()")
    c["grade_columns"] = pg.evaluate("getActualGradeColumns()")
    c["img_import"] = shot(pg, "01-core-import-feet", "#uploadStatus")
    pg.evaluate("showTab(7)")
    settle(pg, 2500)
    c["checks"] = pg.evaluate("_p1RunValidationChecks().map(x => ({name: x.name, value: x.value, severity: x.severity}))")
    c["img_validation"] = shot(pg, "02-core-validation")
    pg.evaluate("showTab(10)")
    settle(pg, 3000)
    c["desurvey"] = pg.evaluate("""(() => { const d = STATE.desurvey; const h = d.holes['B1-001'];
        const tr = h.trace, end = tr[tr.length - 1];
        return {convention: d.dipConvention, holes: Object.keys(d.holes).length, bad_survey: d.badSurvey.length,
                B1_001_trace_end: {depth: end.depth, z: end.z}}; })()""")
    c["img_desurvey"] = shot(pg, "03-core-desurvey")
    pg.evaluate("showTab(11)")
    settle(pg, 3000)
    master = K.download(pg, "exportMasterCSV()", tmp / "babbitt-master.csv")
    head = [ln for ln in master.read_text(encoding="utf-8").splitlines() if ln.startswith("#")]
    c["export_lengths_line"] = next((ln for ln in head if ln.startswith("# lengths:")), None)
    hdr, rows = K.read_csv(master)
    c["export"] = {"rows": len(rows), "columns": hdr}
    # B1-001 has one survey station and the collar file has no depth: the deepest
    # sample must lie 60 deg down-dip of the collar, not on it (fixed 2026-09-25).
    last = max((r for r in rows if r["hole_id"] == "B1-001"), key=lambda r: float(r["from_m"]))
    c["B1_001_deepest_midz"] = round(float(last["midz"]), 2)
    c["page_errors"] = errs
    pg.close()
    return master, rows


def assay_stage(br, site, master, tmp, R):
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(site.base + "/Assay.html", wait_until="load")
    K.ready(pg)
    pg.evaluate("showTab(2)")
    settle(pg, 1000)
    pg.locator("#fileInput").set_input_files(str(master))
    pg.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {R['core']['export']['rows']}", timeout=120000)
    settle(pg, 2500)
    R["assay"] = a = {}
    a["elements"] = pg.evaluate("availableElements()")
    a["unit_conversions"] = pg.evaluate("window._lastUnitConversions || []")
    pg.evaluate("setPrimaryElement('cu_pct')")
    settle(pg, 800)

    pg.evaluate("showTab(8)")
    settle(pg, 2000)
    pg.evaluate("() => { if (typeof setStatsElement === 'function') setStatsElement('cu_pct'); }")
    settle(pg, 1500)
    a["img_stats"] = shot(pg, "04-assay-stats")

    pg.evaluate("showTab(9)")
    settle(pg, 1500)
    pg.evaluate("setTopCutElement('cu_pct')")
    settle(pg, 2000)
    a["topcut"] = pg.evaluate("""(() => { const v = DATA.rows.map(r => r[colIdx('cu_pct')]).filter(x => typeof x === 'number' && x > 0).sort((p, q) => p - q);
        const d = _topcutDiagnostics(v); return {n: v.length, disintegration: d && d.disintegration ? {value: d.disintegration.value, pct: d.disintegration.pct} : null,
        p99: v[Math.floor(v.length * 0.99)], p999: v[Math.floor(v.length * 0.999)], max: v[v.length - 1]}; })()""")
    a["img_topcut"] = shot(pg, "05-assay-topcut", "#tc .card:has-text('Top-cut diagnostics')")

    pg.evaluate("showTab(11)")
    settle(pg, 1500)
    pg.evaluate(f"() => {{ setDomainMethod('cutoff'); setDomainCutoff({CUTOFF}); }}")
    settle(pg, 2500)
    a["domains"] = pg.evaluate("""(() => { const m = {}; (window._domainTagged || []).forEach(x => { m[x.domain] = (m[x.domain] || 0) + 1; }); return m; })()""")
    a["img_domain"] = shot(pg, "06-assay-domain")

    # Top-cut: the app finds no sparse-tail disintegration here (its departure from
    # lognormal starts inside the body -- a mixture, reported as bodyDeparture), so
    # the cut is the geologist's, justified in the vignette; applied to raw assays
    # before compositing and recorded in the export header.
    a["topcut"]["body_departure"] = pg.evaluate("""(() => { const v = DATA.rows.map(r => r[colIdx('cu_pct')]).filter(x => typeof x === 'number' && x > 0).sort((p, q) => p - q);
        const d = _topcutDiagnostics(v); return d && d.bodyDeparture ? {value: d.bodyDeparture.value, pct: d.bodyDeparture.pct} : null; })()""")
    cut = TOPCUT
    a["topcut_applied"] = None
    if cut:
        pg.evaluate("showTab(9)")
        settle(pg, 1500)
        pg.evaluate(f"() => {{ document.getElementById('customCut').value = {cut}; applyTopCut('cu_pct'); }}")
        settle(pg, 2000)
        a["topcut_applied"] = pg.evaluate("""(() => { const l = window._capLog && window._capLog['cu_pct']; if (!l) return null;
            const o = (l.original || []).filter(v => typeof v === 'number');
            const cut = l.cut, aff = o.filter(v => v > cut).length;
            const before = o.reduce((s, v) => s + v, 0), after = o.reduce((s, v) => s + Math.min(v, cut), 0);
            return {cut, affected: aff, n: o.length, metal_removed_pct: 100 * (before - after) / before}; })()""")
        a["img_topcut_applied"] = shot(pg, "05b-assay-topcut-applied")

    pg.evaluate("showTab(7)")
    settle(pg, 1500)
    pg.evaluate(f"() => {{ const el = document.getElementById('compLength'); if (el) el.value = {COMP_LEN}; renderCompositing(); }}")
    settle(pg, 3000)
    a["composites"] = pg.evaluate(f"""(() => {{ const r = computeComposites({COMP_LEN}, 0.5, false);
        return {{n: r.composites.length, dropped_tail_m: r.droppedTailLength, gap_m: r.gapLength, overlaps: r.overlapCount}}; }})()""")
    a["img_composite"] = shot(pg, "07-assay-composite")
    comp_csv = K.download(pg, f"exportMasterForEstimation({{length: {COMP_LEN}}})", tmp / "babbitt-composites.csv")
    head = [ln for ln in comp_csv.read_text(encoding="utf-8").splitlines() if ln.startswith("#")]
    hdr, rows = K.read_csv(comp_csv)
    a["export"] = {"rows": len(rows), "columns": hdr, "topcut_line": next((ln for ln in head if ln.startswith("# topcut")), None),
                   "domains": dict(Counter(r.get("domain") for r in rows))}
    cov = [K.num(r.get("coverage")) for r in rows]
    a["export"]["under_half_informed"] = sum(1 for x in cov if x is not None and x < 0.5)
    a["page_errors"] = errs
    pg.close()
    return comp_csv, rows


def independent_composites(rows, R):
    m1 = [r for r in rows if r.get("domain") == "M1-Mineralised"]
    cu = [K.num(r["cu_pct"]) for r in m1]
    cu = [v for v in cu if v is not None]
    xs, ys, zs = ([float(r[k]) for r in m1] for k in ("midx", "midy", "midz"))
    R["independent_composites"] = {
        "m1_n": len(m1), "m1_cu_mean": round(st.mean(cu), 4), "m1_cu_cv": round(st.pstdev(cu) / st.mean(cu), 2),
        "m1_cu_max": max(cu), "m1_extent_m": [round(max(xs) - min(xs)), round(max(ys) - min(ys)), round(max(zs) - min(zs))],
        "m1_z_range": [round(min(zs)), round(max(zs))],
    }


def resource_stage(br, site, comp_csv, comp_rows, R):
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(site.base + "/Resource.html", wait_until="load")
    K.ready(pg)
    pg.evaluate("showTab(2)")
    settle(pg, 1000)
    pg.locator("#fileInput").set_input_files(str(comp_csv))
    pg.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(comp_rows)}", timeout=180000)
    settle(pg, 2500)
    R["resource"] = r = {}
    pg.evaluate("showTab(3)")
    settle(pg, 1500)
    pg.evaluate("""() => { const s = document.getElementById('setupElement'); if (s) { s.value = 'cu_pct'; s.dispatchEvent(new Event('change')); }
                          const d = document.getElementById('setupDomain'); if (d) { d.value = 'M1-Mineralised'; d.dispatchEvent(new Event('change')); } }""")
    settle(pg, 2000)
    r["setup"] = pg.evaluate("({element: setupState.element, domain: setupState.domain, unit: gradeUnitFor(setupState.element), samples: getSamples().length})")
    r["img_setup"] = shot(pg, "08-resource-setup")

    pg.evaluate("showTab(4)")
    settle(pg, 1500)
    pg.evaluate("async () => { await computeVariogram(); await autoFitVariogram(false); }")
    settle(pg, 3000)
    r["variogram"] = pg.evaluate("variogramState.model")
    r["img_variogram"] = shot(pg, "09-resource-variogram")

    pg.evaluate("showTab(5)")
    settle(pg, 1500)
    r["suggested_block_size"] = pg.evaluate("""async () => { if (typeof autoSuggestBlockSize === 'function') await autoSuggestBlockSize();
        return ['bmX','bmY','bmZ'].map(id => +((document.getElementById(id) || {}).value)); }""")
    pg.evaluate(f"""() => {{ const setv = (id, v) => {{ const el = document.getElementById(id); if (el) el.value = v; }};
        setv('bmX', {BLOCK[0]}); setv('bmY', {BLOCK[1]}); setv('bmZ', {BLOCK[2]}); }}""")
    pg.evaluate("async () => { await generateBlocks(); }")
    settle(pg, 2000)
    r["blocks"] = pg.evaluate("({size: blockState.size, dims: blockState.dims, n: blockState.blocks.length, density: blockState.density})")

    pg.evaluate("showTab(6)")
    settle(pg, 1500)
    pg.evaluate("""(s) => { Object.entries(s).forEach(([id, v]) => { const el = document.getElementById(id);
        if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; }); }""", SEARCH)
    pg.evaluate("() => { estimState.done = false; }")
    t0 = time.time()
    pg.evaluate("async () => { await runEstimation(); }")
    for _ in range(1800):
        if pg.evaluate("estimState.done === true"):
            break
        pg.wait_for_timeout(1000)
    r["estimate_seconds"] = round(time.time() - t0)
    settle(pg, 2000)
    r["spacing_note"] = pg.evaluate("""(() => { const m = document.body.innerText.match(/between-hole NN: median (\\d+)\\s*m, P90 (\\d+)\\s*m/);
        return m ? {median_m: +m[1], p90_m: +m[2]} : null; })()""")
    r["estimate"] = pg.evaluate("""(() => {
        const s = a => { const v = Array.from(a || []).filter(x => x !== null && isFinite(x)); if (!v.length) return null;
            const m = v.reduce((p, q) => p + q, 0) / v.length; return {n: v.length, mean: m, min: Math.min(...v), max: Math.max(...v)}; };
        const res = estimState.results; const [bx, by, bz] = blockState.size;
        const ok = s(res.ok); const t = ok ? ok.n * bx * by * bz * blockState.density : 0;
        return {ok, idw: s(res.idw), nn: s(res.nn), tonnes_Mt: t / 1e6, cu_metal_kt: ok ? t * ok.mean / 100 / 1e3 : 0}; })()""")
    r["img_estimate"] = shot(pg, "10-resource-estimate")

    pg.evaluate("showTab(7)")
    settle(pg, 1000)
    pg.evaluate("async () => { if (typeof runCrossVal === 'function') await runCrossVal(); }")
    for _ in range(600):
        if pg.evaluate("typeof crossvalState !== 'undefined' && crossvalState && crossvalState.metrics"):
            break
        pg.wait_for_timeout(1000)
    r["crossval"] = pg.evaluate("(typeof crossvalState !== 'undefined' && crossvalState.metrics) ? {metrics: crossvalState.metrics, pairs: crossvalState.results.actual.length} : null")
    r["img_crossval"] = shot(pg, "11-resource-crossval")

    pg.evaluate("showTab(10)")
    settle(pg, 2500)
    r["gt_app"] = pg.evaluate(f"""(() => {{ const cuts = {GT_CUTOFFS}; const out = [];
        const setv = (id, v) => {{ document.getElementById(id).value = v; }};
        setv('gtMin', cuts[0]); setv('gtMax', 0.8); setv('gtSteps', 13); document.getElementById('gtClass').checked = false;
        computeGT(); const d = document.getElementById('gtPlot').data;
        return d[0].x.map((c, i) => ({{cutoff_pct: Math.round(c * 1000) / 1000, tonnes_Mt: Math.round(d[0].y[i] * 1000) / 1000,
            grade_pct: d[1].y[i] === null ? null : Math.round(d[1].y[i] * 1000) / 1000}})); }})()""")
    settle(pg, 1500)
    r["img_gt"] = shot(pg, "12-resource-grade-tonnage")
    r["page_errors"] = errs
    pg.close()


def main():
    src = find_data()
    if src is None:
        sys.exit(3)
    tmp = Path(tempfile.mkdtemp(prefix="vig-babbitt-"))
    R = {"vignette": "02-babbitt-cuni", "data": {
        "name": "Babbitt Cu-Ni drill database (pygslib Tutorial 1)", "source": "NRRI, University of Minnesota -- Duluth Complex database (NRRI/TR-2003/21)",
        "distributed_by": f"opengeostat/pygslib@{PYGSLIB_COMMIT[:7]} (MIT)", "url": "https://github.com/opengeostat/pygslib/tree/master/doc/source/Tutorial_1/Babbitt"},
        "parameters": {"length_unit": "ft", "composite_m": COMP_LEN, "cutoff_pct_cu": CUTOFF, "block_m": list(BLOCK), "search": SEARCH}}
    t0 = time.time()
    independent_raw(src, R)
    site = K.Site()
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
            master, _ = core_stage(br, site, src, tmp, R)
            comp_csv, comp_rows = assay_stage(br, site, master, tmp, R)
            independent_composites(comp_rows, R)
            resource_stage(br, site, comp_csv, comp_rows, R)
            br.close()
    except BaseException as e:
        R["error"] = f"{type(e).__name__}: {e}"[:500]
        K.write_results("babbitt.partial", R)
        raise
    finally:
        site.close()
    R["runtime_s"] = round(time.time() - t0)
    out = K.write_results("babbitt", R)
    print(f"wrote {out} in {R['runtime_s']} s")


if __name__ == "__main__":
    main()
