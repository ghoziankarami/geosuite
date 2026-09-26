#!/usr/bin/env python3
"""Vignette 01 -- Thalanga VMS (Zn-Pb-Cu-Ag-Au), real public data, end to end.

Drives the real GeoSuite build (dist/) in Chromium exactly as a user would and
records every number docs/vignettes/01-thalanga-vms*.md quotes, plus the
screenshots it shows. Key numbers are also recomputed here from the CSV files
the app exports, independently of the app's own code.

Data: Geological Survey of Queensland, "NEQ Deposit Atlas - Thalanga" (ds100103),
CC BY 4.0 -- the same dataset GeoSuite ships as its Core sample.

Usage: node build/build.mjs && python3 docs/vignettes/tools/run_thalanga.py [--no-shots]
Writes docs/vignettes/data/thalanga.json (+ img/thalanga-*.png unless --no-shots).
"""

from __future__ import annotations

import statistics as st
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vignette_kit as K  # noqa: E402

SHOTS = "--no-shots" not in sys.argv
BOUNDARY = K.DATA / "thalanga-deposit-area.geojson"
CUTOFF = (
    1.0  # % Zn grade shell -- chosen from the log-probability break (see vignette §5)
)
COMP_LEN = 1.0  # m -- the dominant raw sample length
GT_CUTOFFS = [0.0, 1.0, 2.0, 3.0, 5.0, 8.0]
BLOCK = (
    25,
    25,
    10,
)  # m -- about 1/4 of the ~90 m median between-hole spacing the app reports; 10 m benches
# Constrained search (run B): major along the E-W strike found from the data (98 deg),
# radius = half the along-strike drill spacing; small across-strike and vertical radii
# because the lens geometry cannot be resolved from 11 holes (see vignette section 7);
# at least 4 composites so no block is informed by a single intercept.
SEARCH_B = {
    "srMaj": 100,
    "srSemi": 50,
    "srMin": 25,
    "sAz": 98,
    "sDip": 0,
    "sMinN": 4,
    "sMaxN": 12,
}


def shot(pg, name, sel=None):
    return K.shot(pg, f"thalanga-{name}", sel) if SHOTS else f"thalanga-{name}.png"


def settle(pg, ms=800):
    pg.wait_for_timeout(ms)


def core_stage(br, site, tmp, R):
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(site.base + "/Core.html", wait_until="load")
    K.ready(pg)
    pg.wait_for_function(
        "() => STATE.assay.length > 9000 && STATE.collar.length > 700", timeout=90000
    )
    settle(pg, 2500)
    R["core"] = c = {}
    c["tables"] = pg.evaluate(
        "({collar: STATE.collar.length, survey: STATE.survey.length, assay: STATE.assay.length, geology: STATE.geology.length})"
    )
    c["grade_codes"] = pg.evaluate("window._lastGradeCodes")
    c["grade_columns"] = pg.evaluate("getActualGradeColumns()")
    c["drill_types"] = pg.evaluate(
        """(() => { const m = {}; STATE.collar.forEach(r => { m[r.drill_type] = (m[r.drill_type] || 0) + 1; }); return m; })()"""
    )
    pg.evaluate("showTab(1)")
    c["img_dashboard"] = shot(pg, "01-core-dashboard")

    # Validation before any fix
    pg.evaluate("showTab(7)")
    settle(pg, 1500)
    c["checks_before"] = pg.evaluate("_p1RunValidationChecks()")
    c["img_validation"] = shot(pg, "02-core-validation")

    # Two data fixes a geologist makes and records (both go to CHANGE_LOG):
    #  (1) TH37 190.0-190.2 m spot sample inside the routine 1 m sample 190-191 m -> remove
    #  (2) TH35 100.0-100.2 m Au 1380 g/t, ~800x the next-highest value, Ag below detection -> blank
    fixes = pg.evaluate("""() => {
        const out = {};
        // Spot/check samples: an interval lying wholly inside another interval of the same
        // hole (TH37 190.0-190.2 m inside the routine 190-191 m, and 490.0-490.2 m inside
        // 490-491 m). The routine sample is the sampling of record; the spot sample would
        // be counted twice by compositing. Rule applied to the deposit holes only.
        const deposit = new Set(['TH1','TH2','TH3','TH4','TH5','TH6','TH31','TH35','TH37','TH38','TH39','TH40','TE-1','TE-2']);
        const byHole = {};
        STATE.assay.forEach((r, i) => { if (deposit.has(r.hole_id)) (byHole[r.hole_id] = byHole[r.hole_id] || []).push(i); });
        const spots = [];
        Object.values(byHole).forEach(idx => idx.forEach(i => {
            const a = STATE.assay[i], fa = Number(a.from_m), ta = Number(a.to_m);
            const inside = idx.some(j => j !== i && Number(STATE.assay[j].from_m) <= fa && Number(STATE.assay[j].to_m) >= ta
                                   && (Number(STATE.assay[j].to_m) - Number(STATE.assay[j].from_m)) > (ta - fa));
            if (inside) spots.push(i);
        }));
        out.spot_samples = spots.map(i => ({hole: STATE.assay[i].hole_id, from: STATE.assay[i].from_m, to: STATE.assay[i].to_m,
                                            sample_id: STATE.assay[i].sample_id, zn_ppm: STATE.assay[i].zn_ppm}));
        const au = STATE.assay.findIndex(r => r.hole_id === 'TH35' && Number(r.from_m) === 100 && Number(r.au_gpt) === 1380);
        out.au = au >= 0 ? {hole: 'TH35', from: 100, to: 100.2, au_gpt: STATE.assay[au].au_gpt, ag_gpt: STATE.assay[au].ag_gpt, zn_ppm: STATE.assay[au].zn_ppm} : null;
        if (au >= 0) setCellValue('assay', au, 'au_gpt', null, false);
        spots.sort((p, q) => q - p).forEach(i => deleteRow('assay', i, false));
        applyChanges('assay');
        out.change_log = STATE.CHANGE_LOG.map(e => ({table: e.table, summary: e.summary, diffs: (e.diffs || []).length}));
        return out;
    }""")
    c["fixes"] = fixes
    settle(pg, 1200)
    c["checks_after"] = pg.evaluate("_p1RunValidationChecks()")

    # Desurvey (minimum curvature)
    pg.evaluate("showTab(10)")
    settle(pg, 2500)
    c["desurvey"] = pg.evaluate("""(() => {
        const d = STATE.desurvey; const tr = id => { const h = d.holes[id]; return h && h.trace && h.trace.length ? h.trace : null; };
        const end = id => { const t = tr(id); return t ? t[t.length - 1] : null; };
        return {convention: d.dipConvention, holes: Object.keys(d.holes).length, bad_survey: d.badSurvey.length,
                TH5_end: end('TH5'), TH1_end: end('TH1'), TH40_end: end('TH40')};
    })()""")
    c["img_desurvey"] = shot(pg, "03-core-desurvey")

    pg.evaluate("showTab(11)")
    settle(pg, 2500)
    c["merged_rows"] = pg.evaluate("STATE.merged.length")

    # Crop to the deposit area and export
    pg.evaluate("showTab(13)")
    settle(pg, 2000)
    pg.locator("#constraintFile").set_input_files(str(BOUNDARY))
    settle(pg, 2500)
    c["crop"] = pg.evaluate("_cropStats()")
    c["img_crop"] = shot(pg, "04-core-crop", "#cropPanel")
    master = K.download(
        pg, "exportCroppedMaster()", tmp / "thalanga-master-cropped.csv"
    )
    hdr, rows = K.read_csv(master)
    c["export"] = {
        "rows": len(rows),
        "columns": hdr,
        "holes": sorted({r["hole_id"] for r in rows}),
    }
    c["page_errors"] = errs
    pg.close()
    return master, rows


def independent_cropped(rows, R):
    """Recomputed from the exported CSV with plain Python -- not the app's code."""
    zn = [
        (K.num(r["zn_ppm"]) or 0) / 1e4 for r in rows if K.num(r["zn_ppm"]) is not None
    ]
    L = [K.num(r["to_m"]) - K.num(r["from_m"]) for r in rows]
    tot = sum(z * ln for z, ln in zip(zn, L))
    shares = {}
    for cut in (0.5, 1.0, 2.0, 5.0):
        m = sum(z * ln for z, ln in zip(zn, L) if z >= cut)
        shares[str(cut)] = round(100 * m / tot, 1)
    inside = [z for z in zn if z >= CUTOFF]
    outside = [z for z in zn if z < CUTOFF]
    cv = lambda v: st.pstdev(v) / st.mean(v)  # noqa: E731
    sv = sorted(zn)
    pct = lambda q: sv[min(len(sv) - 1, int(q * len(sv)))]  # noqa: E731
    R["independent"] = {
        "samples": len(zn),
        "zn_mean_pct": round(st.mean(zn), 3),
        "zn_median_pct": round(st.median(zn), 3),
        "zn_cv": round(cv(zn), 2),
        "zn_p95": round(pct(0.95), 2),
        "zn_p99": round(pct(0.99), 2),
        "zn_max": max(zn),
        "sample_length_median_m": round(st.median(L), 2),
        "sample_length_mode_m": max(
            set(round(x, 1) for x in L), key=[round(x, 1) for x in L].count
        ),
        "metal_share_above_cutoff_pct": shares,
        "shell": {
            "n_in": len(inside),
            "cv_in": round(cv(inside), 2),
            "mean_in": round(st.mean(inside), 2),
            "n_out": len(outside),
            "cv_out": round(cv(outside), 2),
            "mean_out": round(st.mean(outside), 3),
        },
    }


def assay_stage(br, site, tmp, master, R):
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(site.base + "/Assay.html", wait_until="load")
    K.ready(pg)
    pg.evaluate("showTab(2)")
    settle(pg, 1000)
    pg.locator("#fileInput").set_input_files(str(master))
    n = R["core"]["export"]["rows"]
    pg.wait_for_function(
        f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {n}",
        timeout=90000,
    )
    settle(pg, 2000)
    R["assay"] = a = {}
    a["columns"] = pg.evaluate("DATA.columns || DATA.cols")
    a["elements"] = pg.evaluate("availableElements()")
    a["unit_conversions"] = pg.evaluate("window._lastUnitConversions || []")
    a["first_element_before_choice"] = pg.evaluate("primaryElement()")
    pg.evaluate("setPrimaryElement('zn_pct')")

    pg.evaluate("showTab(8)")
    settle(pg, 1500)
    pg.evaluate("setStatsElement('zn_pct')")
    settle(pg, 2500)
    a["img_stats"] = shot(pg, "05-assay-stats")

    pg.evaluate("showTab(9)")
    settle(pg, 1500)
    pg.evaluate("setTopCutElement('zn_pct')")
    settle(pg, 2500)
    a["topcut"] = pg.evaluate("""(() => {
        const i = colIdx('zn_pct'); const v = DATA.rows.map(r => r[i]).filter(x => typeof x === 'number' && x > 0).sort((p, q) => p - q);
        const d = _topcutDiagnostics(v);
        return {n: v.length, disintegration: d && d.disintegration ? {value: d.disintegration.value, pct: d.disintegration.pct} : null};
    })()""")
    a["img_topcut"] = shot(pg, "06-assay-topcut")

    pg.evaluate("showTab(11)")
    settle(pg, 1500)
    pg.evaluate("setDomainMethod('cutoff')")
    settle(pg, 800)
    pg.evaluate(f"setDomainCutoff({CUTOFF})")
    settle(pg, 2500)
    a["domains"] = pg.evaluate("""(() => {
        const t = window._domainTagged || []; const m = {};
        t.forEach(x => { const d = x.domain; m[d] = m[d] || {n: 0}; m[d].n++; });
        return m;
    })()""")
    a["img_domain"] = shot(pg, "07-assay-domain")

    pg.evaluate("showTab(7)")
    settle(pg, 1500)
    pg.evaluate(
        f"() => {{ const el = document.getElementById('compLength'); if (el) {{ el.value = {COMP_LEN}; }} renderCompositing(); }}"
    )
    settle(pg, 2500)
    comp = pg.evaluate(f"""(() => {{ const r = computeComposites({COMP_LEN}, 0.5, false);
        return {{n: r.composites.length, dropped_tail_m: r.droppedTailLength, gap_m: r.gapLength, overlaps: r.overlapCount}}; }})()""")
    a["composites"] = comp
    a["img_composite"] = shot(pg, "08-assay-composite")

    comp_csv = K.download(
        pg,
        f"exportMasterForEstimation({{length: {COMP_LEN}}})",
        tmp / "thalanga-composites.csv",
    )
    hdr, rows = K.read_csv(comp_csv)
    a["export"] = {"rows": len(rows), "columns": hdr}
    dom_col = next((h for h in hdr if h == "domain"), None)
    if dom_col:
        from collections import Counter

        a["export"]["domains"] = dict(Counter(r[dom_col] for r in rows))
    cov = [K.num(r.get("coverage")) for r in rows]
    a["export"]["under_half_informed"] = sum(
        1 for c in cov if c is not None and c < 0.5
    )
    a["page_errors"] = errs
    pg.close()
    return comp_csv, rows


def resource_stage(br, site, tmp, comp_csv, comp_rows, R):
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(site.base + "/Resource.html", wait_until="load")
    K.ready(pg)
    pg.evaluate("showTab(2)")
    settle(pg, 1000)
    pg.locator("#fileInput").set_input_files(str(comp_csv))
    pg.wait_for_function(
        f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(comp_rows)}",
        timeout=120000,
    )
    settle(pg, 2000)
    R["resource"] = r = {}
    pg.evaluate("showTab(3)")
    settle(pg, 1500)
    pg.evaluate("""() => { const s = document.getElementById('setupElement'); if (s) { s.value = 'zn_pct'; s.dispatchEvent(new Event('change')); }
                          const d = document.getElementById('setupDomain'); if (d) { d.value = 'M1-Mineralised'; d.dispatchEvent(new Event('change')); } }""")
    settle(pg, 1500)
    r["setup"] = pg.evaluate(
        "({element: setupState.element, domain: setupState.domain, unit: gradeUnitFor(setupState.element), samples: getSamples().length})"
    )
    r["img_setup"] = shot(pg, "09-resource-setup")

    pg.evaluate("showTab(4)")
    settle(pg, 1500)
    # Down-hole variogram first (within-hole pairs): it fixes the nugget, then the
    # between-hole fit only searches sill and range -- the app's own pipeline order.
    pg.evaluate(
        "async () => { await computeDownholeVariogram(); await computeVariogram(); await autoFitVariogram(false); }"
    )
    settle(pg, 2500)
    r["variogram"] = pg.evaluate("variogramState.model")
    r["variogram_fit"] = (
        pg.evaluate("""({nugget_from: variogramState.fitNuggetFrom, at_bounds: variogramState.fitAtBounds || [],
        lag: variogramState.experimental.lags.length > 1 ? variogramState.experimental.lags[1] - variogramState.experimental.lags[0] : null,
        first_lag_h: variogramState.experimental.lags[0], first_lag_gamma: variogramState.experimental.gammas[0], data_variance: (() => { const v = getSamples().map(s => s.v);
            const m = v.reduce((a, b) => a + b, 0) / v.length; return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length; })()})""")
    )
    r["downhole"] = pg.evaluate("""(() => { const d = variogramState.downhole;
        return {nugget: d.suggestedNugget, pairs: d.totalPairs, lags: (d.lags || []).slice(0, 8), gammas: (d.gammas || []).slice(0, 8), lag_pairs: (d.pairs || []).slice(0, 8)}; })()""")
    r["img_variogram"] = shot(pg, "10-resource-variogram")

    pg.evaluate("showTab(5)")
    settle(pg, 1500)
    r["suggested_block_size"] = (
        pg.evaluate("""async () => { if (typeof autoSuggestBlockSize === 'function') await autoSuggestBlockSize();
        return ['bmX','bmY','bmZ'].map(id => +((document.getElementById(id) || {}).value)); }""")
    )
    settle(pg, 800)
    pg.evaluate(f"""() => {{ const setv = (id, v) => {{ const el = document.getElementById(id); if (el) el.value = v; }};
        setv('bmX', {BLOCK[0]}); setv('bmY', {BLOCK[1]}); setv('bmZ', {BLOCK[2]}); }}""")
    pg.evaluate("async () => { await generateBlocks(); }")
    settle(pg, 1500)
    r["blocks"] = pg.evaluate(
        "({size: blockState.size, dims: blockState.dims, n: blockState.blocks.length, density: blockState.density, density_user_set: !!blockState.densityUserSet})"
    )
    r["search"] = pg.evaluate(
        "({rMaj: searchState.rMaj, rSemi: searchState.rSemi, rMin: searchState.rMin, minN: searchState.minNeighbors, maxN: searchState.maxNeighbors, octant: searchState.useOctant})"
    )

    pg.evaluate("showTab(6)")
    settle(pg, 1000)
    # A: the app's default search with the domain boundary switched OFF -- what
    # every version before 2026-09-25 did. A2: same search, boundary ON (the
    # default now). B: boundary ON + a geologically constrained search.
    r["estimate_unconstrained"] = run_estimation(pg, {"sDomainBound": False})
    r["img_estimate_unconstrained"] = shot(pg, "11a-resource-estimate-unconstrained")
    r["estimate_default_bounded"] = run_estimation(pg, {"sDomainBound": True})
    r["estimate"] = run_estimation(pg, dict(SEARCH_B, sDomainBound=True))
    r["spacing_note"] = (
        pg.evaluate("""(() => { const m = document.body.innerText.match(/between-hole NN: median (\\d+)\\s*m, P90 (\\d+)\\s*m/);
        return m ? {median_m: +m[1], p90_m: +m[2]} : null; })()""")
    )
    r["search_constrained"] = pg.evaluate(
        "({rMaj: searchState.rMaj, rSemi: searchState.rSemi, rMin: searchState.rMin, az: searchState.azDeg, dip: searchState.dipDeg, minN: searchState.minNeighbors, maxN: searchState.maxNeighbors})"
    )
    r["img_estimate"] = shot(pg, "11-resource-estimate")

    pg.evaluate("showTab(7)")
    settle(pg, 1000)
    pg.evaluate(
        "async () => { if (typeof runCrossVal === 'function') await runCrossVal(); }"
    )
    for _ in range(300):
        if pg.evaluate(
            "typeof crossvalState !== 'undefined' && crossvalState && crossvalState.metrics"
        ):
            break
        pg.wait_for_timeout(1000)
    r["crossval"] = pg.evaluate(
        "(typeof crossvalState !== 'undefined' && crossvalState.metrics) ? {metrics: crossvalState.metrics, pairs: crossvalState.results.actual.length} : null"
    )
    r["img_crossval"] = shot(pg, "12-resource-crossval")

    pg.evaluate("showTab(9)")
    settle(pg, 1500)
    pg.evaluate(
        "() => { if (typeof runClassification === 'function') runClassification(); }"
    )
    settle(pg, 2000)
    r["confidence_screen"] = (
        pg.evaluate("""(() => { const l = classState && classState.labels; if (!l) return null;
        const c = {high: 0, medium: 0, low: 0, outside: 0}; Array.from(l).forEach(v => { if (v === 3) c.high++; else if (v === 2) c.medium++; else if (v === 1) c.low++; else c.outside++; });
        return c; })()""")
    )
    r["img_confidence"] = shot(pg, "12b-resource-confidence")

    pg.evaluate("showTab(10)")
    settle(pg, 2500)
    # The app's own grade-tonnage curve (computeGT) at 1 % steps, all blocks and
    # high+medium-confidence blocks only; independent_gt() re-derives the first
    # from the exported block model and the test compares the two.
    r["gt_app"] = {}
    for key, only_hm in (("all_blocks", False), ("high_medium", True)):
        r["gt_app"][key] = pg.evaluate(
            """(onlyHM) => { const setv = (id, v) => { document.getElementById(id).value = v; };
            setv('gtMin', 0); setv('gtMax', 8); setv('gtSteps', 9); document.getElementById('gtClass').checked = onlyHM;
            computeGT(); const d = document.getElementById('gtPlot').data;
            return d[0].x.map((c, i) => ({cutoff_pct: Math.round(c * 100) / 100, tonnes_Mt: Math.round(d[0].y[i] * 1000) / 1000,
                grade_pct: d[1].y[i] === null ? null : Math.round(d[1].y[i] * 100) / 100})); }""",
            only_hm,
        )
    settle(pg, 1500)
    r["img_gt"] = shot(pg, "13-resource-grade-tonnage")
    blocks_csv = K.download(
        pg, "exportBlockCSV('generic')", tmp / "thalanga-blocks.csv"
    )
    bh, brows = K.read_csv(blocks_csv)
    r["block_export_columns"] = bh
    pg.evaluate("showTab(12)")
    settle(pg, 2500)
    r["img_kcmi"] = shot(pg, "14-resource-kcmi")
    r["density_basis_text"] = pg.evaluate(
        """(() => { const t = document.body.innerText; const m = t.match(/(ASSUMED[^\\n]{0,120}|ASUMSI[^\\n]{0,120})/); return m ? m[0] : null; })()"""
    )
    r["page_errors"] = errs
    pg.close()
    return bh, brows


def run_estimation(pg, search):
    """Set the search inputs (None = the app's defaults) and run OK/IDW/NN; return block stats + tonnage."""
    if search:
        pg.evaluate(
            """(s) => { Object.entries(s).forEach(([id, v]) => { const el = document.getElementById(id);
            if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; }); }""",
            search,
        )
    pg.evaluate("() => { estimState.done = false; }")
    pg.evaluate("async () => { await runEstimation(); }")
    t0 = time.time()
    for _ in range(1800):
        if pg.evaluate("estimState.done === true"):
            break
        pg.wait_for_timeout(1000)
    if not pg.evaluate("estimState.done === true"):
        raise RuntimeError(
            "estimation did not finish: "
            + str(pg.evaluate("(document.getElementById('estimStatus')||{}).innerText"))
        )
    settle(pg, 1500)
    out = pg.evaluate("""(() => {
        const s = a => { const v = Array.from(a || []).filter(x => x !== null && isFinite(x)); if (!v.length) return null;
            const m = v.reduce((p, q) => p + q, 0) / v.length; return {n: v.length, mean: m, min: Math.min(...v), max: Math.max(...v)}; };
        const res = estimState.results; const [bx, by, bz] = blockState.size;
        const ok = s(res.ok); const t = ok ? ok.n * bx * by * bz * blockState.density : 0;
        return {ok, idw: s(res.idw), nn: s(res.nn), blocks_total: blockState.blocks.length,
                tonnes_Mt: t / 1e6, zn_metal_kt: ok ? t * ok.mean / 100 / 1e3 : 0,
                outside_domain: res.outsideDomain || 0, domain_boundary: !!res.domainBoundary,
                search: {rMaj: searchState.rMaj, rSemi: searchState.rSemi, rMin: searchState.rMin, az: searchState.azDeg, minN: searchState.minNeighbors, maxN: searchState.maxNeighbors}};
    })()""")
    out["seconds"] = round(time.time() - t0)
    return out


def independent_gt(bh, brows, R):
    """Grade-tonnage recomputed from the exported block model, independently."""
    r = R["resource"]
    size = r["blocks"]["size"]
    vol = size[0] * size[1] * size[2]
    dens = r["blocks"]["density"]
    gcol = next(
        (
            h
            for h in bh
            if h.lower() in ("ok", "zn_pct_ok", "ok_zn_pct", "grade_ok", "ok_grade")
        ),
        None,
    ) or next((h for h in bh if "ok" in h.lower()), None)
    vals = [K.num(x[gcol]) for x in brows] if gcol else []
    vals = [
        v for v in vals if v is not None and v != -999
    ]  # -999 = not estimated (export NA code)
    out = {
        "grade_column": gcol,
        "blocks_estimated": len(vals),
        "block_volume_m3": vol,
        "density_t_m3": dens,
        "curve": [],
    }
    for cut in GT_CUTOFFS:
        sel = [v for v in vals if v >= cut]
        t = len(sel) * vol * dens
        g = st.mean(sel) if sel else 0.0
        out["curve"].append(
            {
                "cutoff_pct": cut,
                "tonnes_Mt": round(t / 1e6, 3),
                "grade_pct": round(g, 2),
                "zn_metal_kt": round(t * g / 100 / 1e3, 1),
            }
        )
    # The same blocks at a massive-sulphide density instead of the assumed 2.8 t/m3 (vignette section 11).
    out["tonnes_Mt_at_3_6"] = round(len(vals) * vol * 3.6 / 1e6, 3)
    R["independent_gt"] = out


def main():
    tmp = Path(tempfile.mkdtemp(prefix="vig-thalanga-"))
    site = K.Site()
    R = {
        "vignette": "01-thalanga-vms",
        "data": {
            "name": "NEQ Deposit Atlas - Thalanga (ds100103)",
            "publisher": "Geological Survey of Queensland",
            "licence": "CC BY 4.0",
            "url": "https://geoscience.data.qld.gov.au/dataset/ds100103",
        },
        "parameters": {
            "boundary": BOUNDARY.name,
            "cutoff_pct_zn": CUTOFF,
            "composite_m": COMP_LEN,
        },
    }
    t0 = time.time()
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(
                headless=True, args=["--no-sandbox", "--disable-gpu"]
            )
            master, rows = core_stage(br, site, tmp, R)
            independent_cropped(rows, R)
            comp_csv, comp_rows = assay_stage(br, site, tmp, master, R)
            bh, brows = resource_stage(br, site, tmp, comp_csv, comp_rows, R)
            independent_gt(bh, brows, R)
            br.close()
    except BaseException as e:
        R["error"] = f"{type(e).__name__}: {e}"[:500]
        K.write_results("thalanga.partial", R)
        raise
    finally:
        site.close()
    R["runtime_s"] = round(time.time() - t0)
    out = K.write_results("thalanga", R)
    print(f"wrote {out} in {R['runtime_s']} s")


if __name__ == "__main__":
    main()
