"""Nothing lost, nothing changed: the three demo deposits (gold, nickel laterite, tin placer) pushed through
Core -> Assay -> Resource, with every number checked against an independent calculation from the RAW CSV files.

For each dataset:
  RAW (Python, csv module)  rows, holes, and per grade column: count, sum, length-weighted metal sum(g*len)
  Core master export        same row count / holes; per grade column the SAME count, sum and metal
  Assay (Core master upload) same row count / holes, every sample has real coordinates
  Assay master export       composites: every hole present; contained metal (grade x length) within 2% of raw
  Resource (load of Assay)  row count == composite count, coordinates present, every export column survives

Requires servers on 8767/8768/8769 serving the built dist/*.html and data/dataset-demo/repo in the checkout.
"""

import csv
import hashlib
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from journey_test_helpers import ensure_detailed_mode, open_detailed_tab

BASE = os.environ.get("GEOSUITE_TEST_BASE", "http://localhost")
CORE, ASSAY, RESOURCE = (f"{BASE}:{p}/{n}.html" for p, n in ((os.environ.get("CORE_TEST_PORT", "8767"), "Core"), (os.environ.get("ASSAY_TEST_PORT", "8768"), "Assay"), (os.environ.get("RESOURCE_TEST_PORT", "8769"), "Resource")))
PASSED = FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    ok = bool(ok)
    PASSED += ok
    FAILED += not ok
    print(f"  {'✅' if ok else '❌'} {name}{(': ' + detail) if detail else ''}")


def close(a, b, rel=1e-6, abs_=1e-6):
    return math.isclose(a, b, rel_tol=rel, abs_tol=abs_)


def find_repo():
    for a in Path(__file__).resolve().parents:
        d = a / "data" / "dataset-demo" / "repo"
        if d.is_dir():
            return d
    return None


def raw_stats(d, assay_name="assay.csv"):
    rows = list(csv.DictReader(open(d / assay_name, encoding="utf-8")))
    hdr = list(rows[0].keys())
    hid, f, t = hdr[0], hdr[1], hdr[2]
    out = {"rows": len(rows), "holes": {r[hid] for r in rows}, "cols": {}}
    for c in hdr[3:]:
        vals = [(float(r[c]), float(r[t]) - float(r[f])) for r in rows if r[c].strip() != ""]
        out["cols"][c] = {"n": len(vals), "sum": sum(v for v, _ in vals), "metal": sum(v * l for v, l in vals)}
    density_col = next((c for c in hdr[3:] if c.lower() in ("sg", "bd_tm3", "density")), None)
    out["density_values"] = ([float(r[density_col]) if r[density_col].strip() else None
                              for r in rows] if density_col else None)
    out["length"] = sum(float(r[t]) - float(r[f]) for r in rows)
    # Length that carries at least one grade. Composite informed_length counts only
    # assayed length since 2026-09-25 (61 % of Babbit's core was never assayed and
    # used to be reported as fully informed), so that is what coverage compares to.
    grades = [c for c in hdr[3:] if c.lower() not in ("sg", "bd_tm3", "density")]
    out["assayed_length"] = sum(float(r[t]) - float(r[f]) for r in rows if any(r[c].strip() != "" for c in grades))
    return out


def table(text):
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    reader = csv.reader(lines)
    hdr = next(reader)
    return hdr, [dict(zip(hdr, row)) for row in reader]


def colstats(rows, col, f="from_m", t="to_m"):
    vals = [(float(r[col]), float(r[t]) - float(r[f])) for r in rows if r.get(col, "") not in ("", "nan")]
    return {"n": len(vals), "sum": sum(v for v, _ in vals), "metal": sum(v * length for v, length in vals)}


def check_sg_composite_readback(source_rows, composite_rows):
    """Independently verify exported SG against raw interval overlap and lineage."""
    sg_col = next((c for c in source_rows[0] if c.lower() in ("sg", "specific_gravity")), None)
    if not sg_col or not composite_rows or "specific_gravity" not in composite_rows[0]:
        return False, "SG source or composite output column missing"
    raw_ids = {}
    raw_by_hole = {}
    for index, row in enumerate(source_rows):
        hole = str(row["hole_id"])
        raw_by_hole.setdefault(hole, []).append((index, row))
        raw_ids[f"assay:{index}:{hole}:{row['from_m']}:{row['to_m']}"] = (
            hole, float(row["from_m"]), float(row["to_m"])
        )
    for comp in composite_rows:
        hole, start, end = str(comp["hole_id"]), float(comp["from_m"]), float(comp["to_m"])
        support = weighted = 0.0
        expected_parents = {}
        for index, row in raw_by_hole.get(hole, []):
            raw_start, raw_end = float(row["from_m"]), float(row["to_m"])
            overlap = max(0.0, min(end, raw_end) - max(start, raw_start))
            if overlap <= 0:
                continue
            parent_id = f"assay:{index}:{hole}:{row['from_m']}:{row['to_m']}"
            expected_parents[parent_id] = overlap
            value = row.get(sg_col, "")
            if value not in ("", None):
                support += overlap
                weighted += float(value) * overlap
        actual_value = comp.get("specific_gravity", "")
        expected_value = round(weighted / support, 4) if support else None
        if expected_value is None:
            if actual_value not in ("", None):
                return False, f"{hole} {start}-{end}: expected null SG, got {actual_value}"
        elif actual_value in ("", None) or not math.isclose(float(actual_value), expected_value, abs_tol=1e-9):
            return False, f"{hole} {start}-{end}: expected overlap-weighted SG {expected_value}, got {actual_value}"
        try:
            contributions = json.loads(comp.get("parent_contributions", "[]"))
        except (TypeError, json.JSONDecodeError) as exc:
            return False, f"{hole} {start}-{end}: invalid parent_contributions: {exc}"
        actual_parents = {p.get("parentObservationId"): float(p.get("supportLength", 0))
                          for p in contributions}
        if actual_parents.keys() != expected_parents.keys():
            return False, f"{hole} {start}-{end}: parent observation identities differ"
        if any(not math.isclose(actual_parents[k], v, abs_tol=1e-6) for k, v in expected_parents.items()):
            return False, f"{hole} {start}-{end}: parent overlap support differs"
        if any(parent not in raw_ids for parent in actual_parents):
            return False, f"{hole} {start}-{end}: export references an unknown raw row identity"
    return True, f"{len(composite_rows)} composites matched independent SG overlap and parent-row oracle"


def ready(page):
    page.wait_for_function("() => typeof showTab === 'function' && typeof safeRender === 'function'", timeout=25000)
    picker = page.locator(".lang-picker-overlay")
    if picker.is_visible():
        page.locator('.lang-picker-overlay [data-pick="en"]').click()
    overlay = page.locator("#tourOverlay.open")
    for _ in range(40):
        if not overlay.is_visible():
            ensure_detailed_mode(page)
            return
        page.locator("#tourNext").click()
        page.wait_for_timeout(80)
    raise AssertionError("Native introduction tour did not close after its visible Next/Done actions")


def export_text(page, tmp, selector, name):
    with page.expect_download(timeout=180000) as dl:
        page.locator(selector).click()
    out = Path(tmp) / name
    dl.value.save_as(str(out))
    return out.read_text(encoding="utf-8")


def same_col(header, raw_col):
    """header == raw column, or the raw column plus a unit suffix the phase attached (FE -> fe_pct, S -> s_pct)."""
    h, r = header.lower(), raw_col.lower()
    # Density is structural in the schema; Core normalises these standard
    # fixture headers to density, preserving their measured values.
    return h == r or h.startswith(r + "_") or (h == "density" and r in ("sg", "bd_tm3"))


DATASETS = {
    "01-emas-epitermal": ("collar.csv", "survey.csv", "assay.csv", "litho.csv"),
    "02-nikel-laterit": ("collar.csv", "survey.csv", "assay.csv", "litho.csv"),
    "03-timah-placer": ("collar.csv", "survey.csv", "assay.csv", "litho.csv"),
    # A real deposit: upper-case bare element headers (CU, NI, S, FE are percent), BHID/FROM/TO, 35,616 rows.
    "Babbit": ("collar_BABBITT_m.csv", "survey_BABBITT_m.csv", "assay_BABBITT_m.csv"),
}

PROJECT_COMMODITIES = {
    '01-emas-epitermal': ('au_gpt', 'g/t'),
    '02-nikel-laterit': ('ni_pct', '%'),
    '03-timah-placer': ('sn_kgm3', 'kg/m³'),
}


def verify_public_fixture_hashes(repo, name):
    manifest = json.loads(Path(__file__).with_name('corpus-fixtures.json').read_text(encoding='utf-8'))
    entries = {e['path']: e['sha256'] for e in manifest['files']}
    for filename in DATASETS[name]:
        relative = f'{name}/{filename}'
        assert relative in entries and hashlib.sha256((repo / relative).read_bytes()).hexdigest() == entries[relative], relative


def watch_errors(page, label):
    page.corpus_errors = []
    page.on('pageerror', lambda error: page.corpus_errors.append(str(error)))
    page.evaluate('''()=>{window.__corpusRenderErrors=[];const original=window.safeRender;
      window.safeRender=(name,fn)=>original(name,()=>{try{return fn()}catch(e){window.__corpusRenderErrors.push(name+':'+e.message);throw e}});
      safeRender('corpus-canary',()=>{throw Error('corpus-canary')});}''')
    check(f'{label}: swallowed-render detector canary',
          page.evaluate('()=>window.__corpusRenderErrors.splice(0).some(e=>e.includes("corpus-canary"))'))


def project_mapping_roundtrip(page, name, tmp):
    element, unit = PROJECT_COMMODITIES[name]
    before = page.evaluate('()=>JSON.stringify({cols:DATA.cols,rows:DATA.rows})')
    page.on('dialog', lambda dialog: dialog.accept())
    page.locator('.orebit-avatar').click()
    with page.expect_download(timeout=90000) as download:
        page.locator('.orebit-profile-menu [data-act="export"]').click()
    exported = Path(tmp) / f'{name}-resource.orebit'
    download.value.save_as(str(exported))
    project = json.loads(exported.read_text(encoding='utf-8'))
    columns = project['data'].pop('cols')
    assert element in columns and all(c in columns for c in ('midx','midy','midz')), (name, columns)
    project['data']['columns'] = [{'midx':'axis_a','midy':'axis_b','midz':'axis_c'}.get(c,c) for c in columns]
    project['name'] = f'corpus-mapping-{name}'
    project['schemaVersion'] = 2
    project.pop('sourceCapsule', None)
    project.pop('resourceDecision', None)
    page.locator('nav.tabs .tab').nth(1).click()
    with page.expect_file_chooser() as chooser:
        page.locator('#tab2 button[onclick="importBundle()"]') .click()
    chooser.value.set_files({'name':'legacy-corpus.orebit', 'mimeType':'application/json',
                             'buffer':json.dumps(project).encode('utf-8')})
    page.locator('#p3ApplyMapping').wait_for(state='visible', timeout=90000)
    for target, source in (('midx','axis_a'),('midy','axis_b'),('midz','axis_c')):
        page.locator(f'.colmap-sel[data-target="{target}"]').select_option(source)
    page.locator('#colmapGrade').select_option(element)
    page.locator('#colmapUnit').select_option(unit)
    page.locator('#p3ApplyMapping').click()
    page.wait_for_function('async n=>!!(await dbGet(n))', arg=project['name'], timeout=90000)
    page.locator('.orebit-avatar').click()
    page.locator('.orebit-profile-menu [data-act="open"]').click()
    page.locator('#projectManagerModal button[onclick^="loadProjectFromDB"]').filter(has_text='Load from Stage 03').last.click()
    page.locator('#projectManagerModal').wait_for(state='detached', timeout=90000)
    check(f'{name}: native mapped project reopens without re-mapping', page.locator('#p3ApplyMapping').count() == 0)
    check(f'{name}: project preserves complete uploaded population and columns',
          page.evaluate('()=>JSON.stringify({cols:DATA.cols,rows:DATA.rows})') == before)
    check(f'{name}: project preserves selected grade and unit',
          page.evaluate('e=>setupState.element===e && gradeUnitFor(e)', element) == unit)
    check(f'{name}: project actions have no page or swallowed-render errors',
          not page.corpus_errors and not page.evaluate('__corpusRenderErrors.length'))


def run_dataset(browser, repo, name, tmp):
    print(f"\n=== {name} ===")
    if name in PROJECT_COMMODITIES:
        verify_public_fixture_hashes(repo, name)
    d = repo / name
    names = DATASETS[name]
    raw = raw_stats(d, names[2])
    files = [str(d / n) for n in names]

    # ---- Core
    pg = browser.new_page(accept_downloads=True)
    pg.goto(CORE, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_function("() => typeof STATE !== 'undefined' && typeof computeComposites === 'function'", timeout=25000)
    ready(pg)
    watch_errors(pg, 'Core')
    pg.locator("nav.tabs .tab").nth(1).click()
    pg.locator("#fileInput").set_input_files(files)
    pg.wait_for_function(f"() => STATE.assay.length === {raw['rows']}", timeout=90000)
    time.sleep(1.0)
    # Complete the same visible, gated Core route a user takes before export.
    pg.locator("nav.tabs .tab").nth(6).click()  # Validation
    pg.wait_for_function('() => !!document.querySelector("#tab7.panel.active")')
    pg.locator(".workflow-stage-bar-next").click()
    pg.wait_for_function("() => !!STATE.desurvey?.holes")
    pg.locator(".workflow-stage-bar-next").click()
    pg.wait_for_function('() => !!document.querySelector("#tab11.panel.active")')
    if not pg.evaluate("() => STATE.merged?.length"):
        pg.locator('#computeMergeBtn').click()
    pg.wait_for_function("() => !!STATE.merged?.length")
    pg.locator(".workflow-stage-bar-next").click()
    pg.wait_for_function('() => !!document.querySelector("#tab13.panel.active")')
    pg.locator("nav.tabs .tab").nth(12).click()
    hdr, rows = table(export_text(pg, tmp, '#tab13 button[onclick="exportMasterCSV()"]', f"{name}-core.csv"))
    check('Core: no page or swallowed-render errors', not pg.corpus_errors and not pg.evaluate('__corpusRenderErrors.length'))
    pg.close()
    check("Core: every assay row reaches the master export", len(rows) == raw["rows"], f"{len(rows)} vs {raw['rows']}")
    check("Core: every hole reaches the master export", {r["hole_id"] for r in rows} == raw["holes"])
    for rc, rs in raw["cols"].items():
        col = next((h for h in hdr if same_col(h, rc)), None)
        if col is None:
            check(f"Core: field {rc} present in export", False, f"header={hdr}")
            continue
        got = colstats(rows, col)
        check(f"Core: {rc} count/sum/support integral unchanged",
              got["n"] == rs["n"] and close(got["sum"], rs["sum"], 1e-5) and close(got["metal"], rs["metal"], 1e-5),
              f"got={got} raw={rs}")
    if raw["density_values"] is not None:
        source_col = "SG" if "SG" in raw["cols"] else "BD_TM3" if "BD_TM3" in raw["cols"] else "density"
        output_col = "density" if source_col == "BD_TM3" else source_col
        exported = [float(r[output_col]) if r.get(output_col, "") else None for r in rows]
        check(f"Core: measured {source_col} values retain their source column unchanged",
              output_col in hdr and exported == raw["density_values"])
    check("Core: coordinates present on every exported row",
          all(r.get("midx") not in ("", None) and r.get("midz") not in ("", None) for r in rows))

    # ---- Assay: consume the actual Core download, not a second raw import.
    pg = browser.new_page(accept_downloads=True)
    pg.goto(ASSAY, wait_until="domcontentloaded", timeout=60000)
    ready(pg)
    watch_errors(pg, 'Assay')
    pg.locator("nav.tabs .tab").nth(1).click()
    pg.locator("#fileInput").set_input_files(str(Path(tmp) / f"{name}-core.csv"))
    pg.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {raw['rows']}", timeout=90000)
    time.sleep(1.0)
    if "SG" in raw["cols"]:
        imported_sg = pg.evaluate("() => { const sg = colIdx('specific_gravity'); return {sg, density: colIdx('density'), values: sg < 0 ? [] : DATA.rows.map(r => r[sg])}; }")
        expected_sg = [float(r["SG"]) if r.get("SG", "").strip() else None for r in rows]
        check("Assay: raw SG values/nulls survive Core import without a density role",
              imported_sg["sg"] >= 0 and imported_sg["density"] < 0 and imported_sg["values"] == expected_sg)
    holes = pg.evaluate("(() => { const i = colIdx('hole_id'); return [...new Set(DATA.rows.map(r => r[i]))]; })()")
    check("Assay: every row and every hole loaded", set(map(str, holes)) == raw["holes"])
    xyz = pg.evaluate("(() => { const x = colIdx('midx'), z = colIdx('midz');"
                      " return x >= 0 && DATA.rows.every(r => Number.isFinite(+r[x]) && Number.isFinite(+r[z])); })()")
    check("Assay: every sample has real coordinates", xyz is True)
    pg.locator("nav.tabs .tab").nth(10).click()
    ahdr, arows = table(export_text(pg, tmp, '#tab11 button[onclick="exportMasterForEstimation()"]', f"{name}-assay.csv"))
    check('Assay: no page or swallowed-render errors', not pg.corpus_errors and not pg.evaluate('__corpusRenderErrors.length'))
    pg.close()
    total_len = sum(float(r["informed_length"]) for r in arows)
    check("Assay: no hole silently dropped from the master export", {r["hole_id"] for r in arows} == raw["holes"],
          f"missing={sorted(raw['holes'] - {r['hole_id'] for r in arows})[:5]}")
    check("Assay: composites cover >= 98% of the assayed length (rest is reported tail/gap)",
          total_len >= 0.98 * raw["assayed_length"], f"{total_len:.1f} vs {raw['assayed_length']:.1f}")
    check("Assay: composites never claim more informed length than was assayed",
          total_len <= raw["assayed_length"] * 1.0001, f"{total_len:.1f} vs {raw['assayed_length']:.1f}")
    for rc, rs in raw["cols"].items():
        if rc.lower() in ("sg", "bd_tm3", "density"):
            continue
        # pct/ppm grades are renamed by Assay (e.g. cu_ppm -> cu_pct): accept the canonical name
        col = next((h for h in ahdr if same_col(h, rc) or h.lower().split("_")[0] == rc.lower().split("_")[0]), None)
        if col is None:
            check(f"Assay: grade {rc} reaches the master export", False, f"header={ahdr}")
            continue
        metal = sum(float(r[col]) * float(r["informed_length"]) for r in arows if r.get(col, "") not in ("", "nan"))
        rel = abs(metal - rs["metal"]) / rs["metal"] if rs["metal"] else 0
        # A column with fewer than 100 samples (Babbit FE: 24 samples in 6 holes) loses a visible share to the
        # reported discarded composite tail at each hole end, so it gets a wider band than a dense column.
        tol = 0.05 if rs["n"] < 100 else 0.02
        check(f"Assay: {rc} contained metal (grade x length) preserved through compositing", rel <= tol,
              f"{metal:.3f} vs raw {rs['metal']:.3f} ({rel * 100:.2f}% off)")
    if "SG" in raw["cols"]:
        check("Assay: dimensionless SG reaches its auxiliary export column",
              "specific_gravity" in ahdr and "density" not in ahdr, f"header={ahdr}")
        sg_ok, sg_detail = check_sg_composite_readback(rows, arows)
        check("Assay: exported SG equals independent interval-overlap composites with raw row lineage",
              sg_ok, sg_detail)
    if "BD_TM3" in raw["cols"]:
        check("Assay: explicit BD_TM3 retains its dry-density role", "density" in ahdr, f"header={ahdr}")

    # ---- Resource
    apath = Path(tmp) / f"{name}-assay.csv"
    pg = browser.new_page(accept_downloads=True)
    pg.goto(RESOURCE, wait_until="domcontentloaded", timeout=60000)
    ready(pg)
    watch_errors(pg, 'Resource')
    pg.locator("nav.tabs .tab").nth(1).click()
    pg.locator("#fileInput").set_input_files(str(apath))
    pg.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(arows)}", timeout=90000)
    time.sleep(1.0)
    res = pg.evaluate("""(() => { const h = DATA.columns || DATA.cols; return { n: DATA.rows.length, cols: h,
        xyz: DATA.rows.every(r => Number.isFinite(+r[h.indexOf('midx')]) && Number.isFinite(+r[h.indexOf('midz')])) }; })()""")
    check("Resource: every Assay composite loads (none lost)", res["n"] == len(arows), f"{res['n']} vs {len(arows)}")
    check("Resource: every composite keeps its coordinates", res["xyz"] is True)
    for c in ahdr:
        if c in ("hole_id", "from_m", "to_m", "informed_length", "coverage", "midx", "midy", "midz", "domain", "lithology"):
            continue
        check(f"Resource: column {c} survives the handoff", c in res["cols"], f"cols={res['cols']}")
    if name in PROJECT_COMMODITIES:
        project_mapping_roundtrip(pg, name, tmp)
    check('Resource: no page or swallowed-render errors', not pg.corpus_errors and not pg.evaluate('__corpusRenderErrors.length'))
    pg.close()


def run_sg_null_density_regression(browser, tmp):
    """Synthetic regression only: keep unitless SG, nulls and density distinct."""
    stage = "fixture creation"
    fixture = Path(tmp) / "synthetic-sg-density.csv"
    fixture.write_text(
        "hole_id,from_m,to_m,au_gpt,sg,density,midx,midy,midz,domain\n"
        "SYN-1,0,0.4,1.0,2.0,2.5,100,200,300,D1\n"
        "SYN-1,0.4,1.0,,,2.7,100,200,299.5,D1\n"
        "SYN-1,1.0,1.5,3.0,2.4,2.9,100,200,299,D1\n"
        "SYN-1,1.5,2.0,4.0,2.8,3.1,100,200,298.5,D1\n"
        "SYN-2,0,1.0,,,2.4,110,210,300,D1\n",
        encoding="utf-8",
    )
    page = None
    try:
        stage = "open Assay and finish native introduction"
        page = browser.new_page(accept_downloads=True)
        # This real-import journey runs after the deposit integration checks,
        # and parallel PR shards can keep the browser renderer busy. Give the
        # navigation into the detailed Assay estimator room to finish under
        # that load; row count and exported values remain exact assertions.
        page.set_default_timeout(180000)
        page.goto(ASSAY, wait_until="domcontentloaded", timeout=60000)
        ready(page)
        stage = "select import and upload synthetic rows"
        page.locator("nav.tabs .tab").nth(1).click()
        page.locator("#fileInput").set_input_files(str(fixture))
        stage = "wait for five uploaded rows"
        page.wait_for_function("() => DATA?.rows?.length === 5", timeout=90000)
        stage = "check imported SG and density values"
        imported = page.evaluate("""() => {
          const sg=colIdx('specific_gravity'), density=colIdx('density');
          return {sg,density,rows:DATA.rows.map(r=>({hole:r[colIdx('hole_id')],from:r[colIdx('from_m')],to:r[colIdx('to_m')],sg:sg<0?null:r[sg],density:density<0?null:r[density]}))};
        }""")
        check("SG fixture: import keeps raw row order, null, and distinct SG/density roles",
              imported["sg"] >= 0 and imported["density"] >= 0
              and [r["sg"] for r in imported["rows"]] == [2.0, None, 2.4, 2.8, None]
              and [r["density"] for r in imported["rows"]] == [2.5, 2.7, 2.9, 3.1, 2.4]
              and [r["from"] for r in imported["rows"]] == [0, 0.4, 1, 1.5, 0])
        stage = "open detailed Assay estimation export"
        open_detailed_tab(page, 11)
        page.wait_for_function("() => document.querySelector('#tab11 button[onclick=\"exportMasterForEstimation()\"]')?.getClientRects().length > 0")
        stage = "download estimation export"
        with page.expect_download(timeout=60000) as download:
            page.evaluate("exportMasterForEstimation()")
        out = Path(tmp) / "synthetic-sg-density-export.csv"
        download.value.save_as(str(out))
        stage = "check exported schema and overlap-weighted values"
        exported_text = out.read_text(encoding="utf-8")
        headers, exported = table(exported_text)
        check("SG fixture: actual browser export/readback documents unitless SG and separate density",
              "specific_gravity" in headers and "density" in headers
              and "# auxiliary units: specific_gravity=unitless (dimensionless; not bulk density)" in exported_text)
        expected = [(2.0, 2.62), (2.6, 3.0), (None, 2.4)]
        values = [(float(r["specific_gravity"]) if r["specific_gravity"] else None,
                   float(r["density"]) if r["density"] else None) for r in exported]
        check("SG fixture: export uses overlap-weighted SG and leaves all-null SG support distinct from density",
              len(values) == 3
              and all((got[0] is None if want[0] is None else got[0] is not None and math.isclose(got[0], want[0], abs_tol=1e-9))
                      and got[1] is not None and math.isclose(got[1], want[1], abs_tol=1e-9)
                      for got, want in zip(values, expected)), f"got={values} expected={expected}")
    except Exception:
        print(f"  SG null-density regression failed during: {stage}", flush=True)
        raise
    finally:
        if page is not None:
            page.close()


def main():
    repo = find_repo()
    if repo is None:
        print("FAIL: pinned data/dataset-demo/repo corpus is missing")
        return 1
    tmp = tempfile.mkdtemp()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        selected_names = os.environ.get('OREBIT_CORPUS_DATASETS')
        selected = [name for name in DATASETS if not selected_names or name in selected_names.split(',')]
        if not selected:
            raise ValueError('No named corpus datasets selected')
        for name in selected:
            try:
                run_dataset(browser, repo, name, tmp)
            except Exception as e:  # noqa: BLE001 -- the exception text IS the finding
                check(f"{name} completed without aborting", False, str(e).splitlines()[0][:220])
        run_sg_null_density_regression(browser, tmp)
        browser.close()
    print(f"\n  CORPUS INTEGRITY: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
