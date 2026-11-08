"""Real uploaded apostrophe headers remain usable through Core's existing owners.

Uses four synthetic CSV uploads, real additional-track/manual-grade controls,
native master/project exports and a fresh project reopen. Inputs are ordinary
names, never executable text. CORE_LITERAL_HEADERS_SITE (or OREBIT_TEST_DIST)
can point to an immutable artifact or a single removed-fix control.
"""
import csv
import functools
import http.server
import io
import json
import math
import os
import re
import struct
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists())
SITE = Path(os.environ.get("CORE_LITERAL_HEADERS_SITE", os.environ.get("OREBIT_TEST_DIST", ROOT / "dist")))
HEADER = "O'Neil"
SECOND_HEADER = "Operator note"
PROJECT = "O'Neil-Headers"
TABLES = ["collar", "survey", "assay", "geology"]
CASE = os.environ.get("CORE_LITERAL_HEADERS_CASE", "all")
if CASE not in ("all", "headers", "identifiers", "striplog-routes", "striplog-footer", "striplog-no-collar", "striplog-depth-range", "striplog-empty-track"):
    raise ValueError("CORE_LITERAL_HEADERS_CASE must be all, headers, identifiers, striplog-routes, striplog-footer, striplog-no-collar, striplog-depth-range or striplog-empty-track")
PASSED = 0


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check(value, message):
    global PASSED
    assert value, message
    PASSED += 1
    print("PASS: " + message, flush=True)


def nav(page, number):
    target = page.locator(f'nav.tabs .tab[onclick="showTab({number})"]')
    if page.viewport_size["width"] < 1080:
        if number == 1:
            page.locator('#mobileBottomNav [data-group="home"]').click()
        elif number == 13:
            page.locator('#mobileBottomNav [data-group="export"]').click()
        else:
            group = "results" if target.get_attribute("data-workflow-advanced") == "true" else "analysis"
            page.locator(f'#mobileBottomNav [data-group="{group}"]').click()
            page.locator(f'#mobileNavDrawer [data-tab="{number}"]').click()
    else:
        if not target.is_visible():
            page.locator('nav.tabs .screening-advanced-toggle').click()
        target.click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=number)


def complete_primary_pipeline(page):
    nav(page, 7)
    page.locator('#tab7 .workflow-stage-bar-next').click()
    page.wait_for_function("()=>document.querySelector('#tab10.panel.active')")
    page.locator('#tab10 .workflow-stage-bar-next').click()
    page.wait_for_function("()=>document.querySelector('#tab11.panel.active')")
    # Merge is an explicit calculation in the product workflow; the onward
    # action remains correctly disabled until the user calculates it.
    if not page.evaluate("()=>STATE.merged?.length"):
        page.locator('#computeMergeBtn').click()
    page.wait_for_function("()=>STATE.merged?.length")
    page.locator('#tab11 .workflow-stage-bar-next').click()
    page.wait_for_function("()=>document.querySelector('#tab13.panel.active')")


def watch_renderers(page, label):
    page.evaluate("""()=>{
      window.__literalHeaderFailures=[];const owner=window.safeRender;
      window.safeRender=(name,fn)=>owner(name,()=>{
        try{const result=fn();if(result?.catch)return result.catch(error=>{__literalHeaderFailures.push(name+': '+error.message);throw error});return result}
        catch(error){__literalHeaderFailures.push(name+': '+error.message);throw error}
      });
      safeRender('literal-header-canary',()=>{throw Error('literal-header-canary')});
    }""")
    check(page.evaluate("__literalHeaderFailures.splice(0).some(x=>x.includes('literal-header-canary'))"), label + " live swallowed-render detector")


def ready(browser, base, language, width, height):
    context = browser.new_context(accept_downloads=True, service_workers="block",
                                  viewport={"width": width, "height": height},
                                  is_mobile=width < 1080, has_touch=width < 1080)
    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
    page = context.new_page()
    page.audit_errors = []
    page.on("pageerror", lambda error: page.audit_errors.append(str(error)))
    page.goto(base + "/Core.html")
    page.wait_for_function("()=>window.__i18nBooted===true")
    if not page.locator(".lang-picker-overlay").is_visible():
        page.locator("#lang-switch").click()
    page.locator(f'.lang-picker-overlay [data-pick="{language}"]').click()
    if not page.locator(".tour-skip").is_visible():
        if width < 1080:
            page.locator('#mobileTourBtn').click()
        else:
            page.locator('button.orebit-help-bubble').click()
            page.locator('.orebit-help-menu [data-action="tour"]').click()
    page.locator('.tour-skip').click()
    page.wait_for_function("()=>!window._tourActive&&!document.querySelector('.lang-picker-overlay')")
    watch_renderers(page, language)
    return context, page


def fixture(folder, missing=None, blank_extra=None):
    folder.mkdir(parents=True, exist_ok=True)
    tables = {
        "collar": [["hole_id", "x", "y", "z", "depth", "prospect"]],
        "survey": [["hole_id", "depth", "dip", "azimuth"]],
        "assay": [["hole_id", "from_m", "to_m", "ni_pct", HEADER, SECOND_HEADER]],
        "geology": [["hole_id", "from_m", "to_m", "lith1"]],
    }
    expected = []
    grades = [0, 1.5, 2.5, 4]
    extra = [10.25, 11.5, 12.75, 14]
    notes = ["north core", "south core", "east core", "west core"]
    missing_tables = set(missing[0].split("+")) if missing else set()
    for hole, (x, y, z) in enumerate([(500000, 9000000, 100), (500020, 9000030, 120)]):
        identity = f"O'Neil-{hole+1}"
        tables["collar"].append([identity, x, y, z, 2, "O'Neil field"])
        tables["survey"].extend([[identity, 0, -90, 0], [identity, 2, -90, 0]])
        for interval in range(2):
            index = hole * 2 + interval
            if "assay" not in missing_tables or missing[1] != identity:
                note = "" if blank_extra == (SECOND_HEADER, identity) else notes[index]
                tables["assay"].append([identity, interval, interval + 1, grades[index], extra[index], note])
            if "geology" not in missing_tables or missing[1] != identity:
                tables["geology"].append([identity, interval, interval + 1, "ORE"])
            # Independent exact geometry for a vertical measured survey.
            expected.append({"hole_id": identity, "from_m": interval, "to_m": interval+1,
                             "midx": x, "midy": y, "midz": z-interval-0.5,
                             "ni_pct": grades[index], HEADER: extra[index], SECOND_HEADER: notes[index]})
    paths = []
    for table in TABLES:
        path = folder / (table + ".csv")
        with path.open("w", newline="") as handle:
            csv.writer(handle).writerows(tables[table])
        paths.append(path)
    return paths, expected


def test_striplog_empty_source_routes(browser, base, folder, language, width, height):
    label = f"{language} {width}px"
    for table in ("assay", "geology"):
        paths, _ = fixture(folder / f"missing-{table}", missing=(table, "O'Neil-2"))
        context, page = ready(browser, base, language, width, height)
        try:
            nav(page, 2)
            page.locator('#fileInput').set_input_files([str(path) for path in paths])
            page.wait_for_function("()=>STATE.collar.length===2&&STATE.survey.length===4")
            nav(page, 8)
            page.locator('#stripLogHole').select_option("O'Neil-2")
            before = page.evaluate("()=>JSON.stringify({source:['collar','survey','assay','geology'].map(t=>STATE[t]),derived:[STATE.desurvey,STATE.merged,STATE.composite]})")
            route = page.locator(f'#stripLogPanel [data-strip-source-table="{table}"]')
            route.wait_for()
            expected_label = {"en": {"assay": "Open Assay table", "geology": "Open Geology table"}, "id": {"assay": "Buka tabel Assay", "geology": "Buka tabel Geology"}}[language][table]
            check(route.is_visible() and route.inner_text() == expected_label, label + f" missing {table} shows a visible localized source route")
            route.click()
            tab = {"assay": 5, "geology": 6}[table]
            page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=tab)
            page.wait_for_function('(table,hole)=>STATE.filter[table]===hole', arg=[table, "O'Neil-2"])
            check(page.locator(f'#tab{tab} input[type="search"]').input_value() == "O'Neil-2", label + f" missing {table} route opens its actual filtered source table")
            check(page.evaluate('args=>STATE[args[0]].every(row=>row.hole_id!==args[1])', [table, "O'Neil-2"]), label + f" source route preserves the actual missing-{table} condition")
            check(page.evaluate("()=>JSON.stringify({source:['collar','survey','assay','geology'].map(t=>STATE[t]),derived:[STATE.desurvey,STATE.merged,STATE.composite]})") == before, label + f" missing {table} route preserves source and derived data")
            check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + f" missing {table} source route has no renderer errors")
        finally:
            context.close()


def test_striplog_hole_missing_both_logs_routes(browser, base, folder, language, width, height):
    label = f"{language} {width}px"
    hole = "O'Neil-2"
    paths, _ = fixture(folder / "missing-assay-geology", missing=("assay+geology", hole))
    context, page = ready(browser, base, language, width, height)
    try:
        nav(page, 2)
        page.locator('#fileInput').set_input_files([str(path) for path in paths])
        page.wait_for_function("()=>STATE.collar.length===2&&STATE.survey.length===4&&STATE.assay.length===2&&STATE.geology.length===2")
        nav(page, 8)
        page.locator('#stripLogHole').select_option(hole)
        page.wait_for_function('(hole)=>STATE.stripLogUI.holeId===hole', arg=hole)
        source_before = snapshot(page)
        routes = page.locator(f'#stripLogPanel [data-strip-source-hole="{hole}"]')
        check(routes.count() == 2 and routes.all_text_contents() == [
            {"en": "Open Geology table", "id": "Buka tabel Geology"}[language],
            {"en": "Open Assay table", "id": "Buka tabel Assay"}[language]],
            label + " a hole missing both logs exposes separate localized routes to both source owners")
        details = page.locator('#stripLogPanel details').first
        if details.get_attribute('open') is None:
            details.locator(':scope > summary').click()
        optional_track = page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(SECOND_HEADER, exact=True))
        check(optional_track.is_visible(), label + " dataset-level optional track remains selectable for a hole with no Assay rows")
        optional_track.click()
        page.wait_for_function("()=>STATE.stripLogUI.extraCols.includes('assay.'+" + repr(SECOND_HEADER) + ")")
        no_assay_message = {"en": "No assay data for this hole", "id": "Tidak ada data assay untuk hole ini"}[language]
        check(page.evaluate("text=>document.querySelector('#stripLogPlot')?.layout?.annotations?.some(a=>a.text===text)", no_assay_message),
              label + " empty optional track gives localized no-source feedback")
        for table, tab, expected_label in (
            ("assay", 5, {"en": "Open Assay table", "id": "Buka tabel Assay"}[language]),
            ("geology", 6, {"en": "Open Geology table", "id": "Buka tabel Geology"}[language]),
        ):
            page.locator(f'#stripLogPanel [data-strip-source-table="{table}"][data-strip-source-hole="{hole}"]').click()
            page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=tab)
            page.wait_for_function('(table,hole)=>STATE.filter[table]===hole', arg=[table, hole])
            check(page.locator(f'#tab{tab} input[type="search"]').input_value() == hole
                  and page.locator(f'#tab{tab} [data-idx]').count() == 0,
                  label + f" missing {table} route opens its source owner filtered to the exact hole without fabricating rows")
            nav(page, 8)
            page.wait_for_function('(hole)=>STATE.stripLogUI.holeId===hole', arg=hole)
            check(snapshot(page) == source_before, label + f" {table} route and return preserve all raw source tables")
        check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + " missing-both-log routes have no browser or swallowed-render errors")
    finally:
        context.close()


def test_striplog_optional_track_with_only_missing_values(browser, base, folder, language, width, height):
    label = f"{language} {width}px"
    hole = "O'Neil-2"
    paths, _ = fixture(folder / "optional-track-empty-values", blank_extra=(SECOND_HEADER, hole))
    context, page = ready(browser, base, language, width, height)
    try:
        nav(page, 2)
        page.locator('#fileInput').set_input_files([str(path) for path in paths])
        page.wait_for_function("()=>STATE.collar.length===2&&STATE.assay.length===4&&STATE.geology.length===4")
        source_before = snapshot(page)
        nav(page, 8)
        page.locator('#stripLogHole').select_option(hole)
        page.wait_for_function('(hole)=>STATE.stripLogUI.holeId===hole', arg=hole)
        details = page.locator('#stripLogPanel details').first
        if details.get_attribute('open') is None:
            details.locator(':scope > summary').click()
        chip = page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(SECOND_HEADER, exact=True))
        check(chip.is_visible(), label + " optional column remains selectable when its values are empty only for this hole")
        chip.click()
        page.wait_for_function("()=>STATE.stripLogUI.extraCols.includes('assay.'+" + repr(SECOND_HEADER) + ")")
        expected = {"en": "No values for this track in this hole", "id": "Tidak ada nilai untuk track ini pada lubang ini"}[language]
        empty_notice = page.evaluate("expected=>document.querySelector('#stripLogPlot')?.layout?.annotations?.some(a=>a.text===expected)", expected)
        check(empty_notice, label + " rendered track explains that the selected hole has no values")
        check(page.evaluate("header=>Object.keys(document.querySelector('#stripLogPlot').layout).some(k=>/^xaxis\\d*$/.test(k)&&document.querySelector('#stripLogPlot').layout[k].title?.text===header)", SECOND_HEADER),
              label + " empty-value track retains its exact uploaded header")
        check(snapshot(page) == source_before and not page.audit_errors and not page.evaluate('__literalHeaderFailures'),
              label + " empty-value track preserves all source data with no render errors")
    finally:
        context.close()


def test_striplog_no_collar_import_recovery(browser, base, folder, language, width, height):
    label = f"{language} {width}px"
    paths, _ = fixture(folder / "no-collar-recovery")
    context, page = ready(browser, base, language, width, height)
    try:
        nav(page, 2)
        page.locator('#fileInput').set_input_files([str(path) for path in paths])
        page.wait_for_function("()=>STATE.collar.length===2&&STATE.survey.length===4&&STATE.assay.length===4&&STATE.geology.length===4")
        nav(page, 3)
        for _ in range(2):
            page.locator('#collarPanel tbody tr:not(.row-deleted) button.btn.danger').first.click()
        check(page.evaluate("()=>STATE.deletedIdx.collar.size===2&&STATE.collar.length===2"), label + " removing Collar rows is an unapplied table draft")
        page.locator('#collarPanel button').filter(has_text=re.compile(r'Apply changes|Terapkan perubahan', re.I)).click()
        page.wait_for_function("()=>STATE.collar.length===0&&STATE.deletedIdx.collar.size===0")
        source_before = page.evaluate("()=>JSON.stringify(['survey','assay','geology'].map(t=>STATE[t]))")
        nav(page, 8)
        route = page.locator('#stripLogPanel [data-strip-no-collar-import]')
        route.wait_for()
        expected = {"en": "Open Import", "id": "Buka Import"}[language]
        check(route.is_visible() and route.inner_text() == expected, label + " empty Strip Log offers a visible localized Import recovery route")
        check("No collar" in page.locator('#stripLogPanel .hint.warn').inner_text() or "Tidak ada collar" in page.locator('#stripLogPanel .hint.warn').inner_text(), label + " empty Strip Log explains why no plot is available")
        route.click()
        page.wait_for_function("()=>document.querySelector('#tab2.panel.active')")
        check(page.evaluate("()=>STATE.collar.length===0&&STATE.survey.length===4&&STATE.assay.length===4&&STATE.geology.length===4")
              and page.evaluate("()=>JSON.stringify(['survey','assay','geology'].map(t=>STATE[t]))") == source_before,
              label + " Import recovery keeps the applied empty-collar state and every unaffected source table")
        check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + " no-collar recovery has no browser or swallowed-render errors")
    finally:
        context.close()


def test_striplog_export_default_matches_hole_depth(browser, base, folder, language, width, height):
    label = f"{language} {width}px"
    paths, _ = fixture(folder / "depth-range-default")
    context, page = ready(browser, base, language, width, height)
    try:
        nav(page, 2)
        page.locator('#fileInput').set_input_files([str(path) for path in paths])
        page.wait_for_function("()=>STATE.collar.length===2&&STATE.assay.length===4&&STATE.geology.length===4")
        source_before = snapshot(page)
        nav(page, 8)
        page.wait_for_function("()=>document.querySelector('#stripLogPlot')?.data?.length")
        check(page.locator('#stripLogExportFrom').input_value() == '0', label + " PNG export starts at the hole collar")
        check(page.locator('#stripLogExportTo').input_value() == '2', label + " PNG export default ends at the selected 2m hole depth")
        page.locator('#stripLogHole').select_option("O'Neil-2")
        page.wait_for_function("()=>STATE.stripLogUI.holeId===\"O'Neil-2\"")
        check(page.locator('#stripLogExportTo').input_value() == '2', label + " changing selected holes recalculates the default range from that collar")
        page.locator('#stripLogExportFrom').fill('1')
        page.locator('#stripLogExportTo').fill('0')
        plot_range = page.evaluate("()=>JSON.stringify(document.querySelector('#stripLogPlot').layout.yaxis.range)")
        with page.expect_download() as result:
            page.locator('#striplogExportPngBtn').click()
        path = folder / f"zero-endpoint-{language}-{width}.png"
        download = result.value
        download.save_as(str(path))
        png = path.read_bytes()
        check(re.fullmatch(r'orebit-striplog-o-neil-2-1-2m-\d{4}-\d{2}-\d{2}\.png', download.suggested_filename) is not None
              and png[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', png[16:24]) == (3200, 1800),
              label + " explicit zero endpoint normalizes to the minimum 1m custom range in a valid PNG")
        check(page.evaluate("()=>JSON.stringify(document.querySelector('#stripLogPlot').layout.yaxis.range)") == plot_range
              and snapshot(page) == source_before and not page.locator('#striplogExportPngBtn').is_disabled(),
              label + " zero-endpoint export restores the live plot range and retains every source row")
        page.locator('#stripLogExportFrom').fill('0')
        page.locator('#stripLogExportTo').fill('')
        plot_range = page.evaluate("()=>JSON.stringify(document.querySelector('#stripLogPlot').layout.yaxis.range)")
        with page.expect_download() as result:
            page.locator('#striplogExportPngBtn').click()
        download = result.value
        check(re.fullmatch(r'orebit-striplog-o-neil-2-0-2m-\d{4}-\d{2}-\d{2}\.png', download.suggested_filename) is not None,
              label + " blank endpoint falls back to the selected hole's depth-aware default")
        check(page.evaluate("()=>JSON.stringify(document.querySelector('#stripLogPlot').layout.yaxis.range)") == plot_range
              and snapshot(page) == source_before and not page.locator('#striplogExportPngBtn').is_disabled(),
              label + " blank-endpoint export restores the live plot range and retains every source row")
        page.locator('#stripLogExportFrom').fill('-5')
        page.locator('#stripLogExportTo').fill('0')
        with page.expect_download() as result:
            page.locator('#striplogExportPngBtn').click()
        download = result.value
        check(re.fullmatch(r'orebit-striplog-o-neil-2-0-1m-\d{4}-\d{2}-\d{2}\.png', download.suggested_filename) is not None,
              label + " negative From is clamped to zero and still honors explicit zero To")
        check(snapshot(page) == source_before and not page.audit_errors and not page.evaluate('__literalHeaderFailures'),
              label + " range defaults do not alter source tables or raise render errors")
    finally:
        context.close()


def test_striplog_mobile_controls_clear_bottom_navigation(browser, base, language):
    context, page = ready(browser, base, language, 390, 844)
    try:
        nav(page, 8)
        overlap = page.evaluate("""() => {
          const plot = document.querySelector('#stripLogPlot').getBoundingClientRect();
          const bar = document.querySelector('#tab8 .workflow-stage-bar').getBoundingClientRect();
          return {plot:{top:plot.top,bottom:plot.bottom},bar:{top:bar.top,bottom:bar.bottom},
            overlap:plot.width>0&&plot.height>0&&bar.width>0&&bar.height>0&&plot.bottom>bar.top&&plot.top<bar.bottom};
        }""")
        check(not overlap['overlap'], f"{language} 390px Strip Log keeps its workflow footer outside the visible plot: {overlap}")
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(100)
        result = page.evaluate("""() => {
          const nav = document.querySelector('#mobileBottomNav').getBoundingClientRect();
          const blocked = [...document.querySelectorAll('#tab8 button,#tab8 input,#tab8 select,#tab8 summary')]
            .map(el => ({el, rect: el.getBoundingClientRect()}))
            .filter(({rect}) => rect.width && rect.height && rect.bottom > nav.top && rect.top < nav.bottom)
            .map(({el}) => el.innerText.trim() || el.getAttribute('aria-label') || el.id || el.outerHTML.slice(0,100));
          return {blocked, navTop: nav.top, scrollY, scrollHeight: document.documentElement.scrollHeight};
        }""")
        check(not result["blocked"], f"{language} 390px Strip Log reaches its last controls above the fixed mobile navigation: {result}")
    finally:
        context.close()
    desktop_context, desktop = ready(browser, base, language, 1440, 1000)
    try:
        nav(desktop, 8)
        overlap = desktop.evaluate("""() => {
          const plot = document.querySelector('#stripLogPlot').getBoundingClientRect();
          const bar = document.querySelector('#tab8 .workflow-stage-bar').getBoundingClientRect();
          return {plot:{top:plot.top,bottom:plot.bottom},bar:{top:bar.top,bottom:bar.bottom},
            overlap:plot.width>0&&plot.height>0&&bar.width>0&&bar.height>0&&plot.bottom>bar.top&&plot.top<bar.bottom};
        }""")
        check(not overlap['overlap'], f"{language} 1440px Strip Log keeps its workflow footer outside the visible plot: {overlap}")
    finally:
        desktop_context.close()


def snapshot(page):
    return page.evaluate("()=>JSON.stringify(['collar','survey','assay','geology'].map(t=>[STATE[t],STATE.rawRows[t],STATE.rawHeaders[t]]))")


def csv_records(text):
    return list(csv.DictReader(io.StringIO("\n".join(line for line in text.splitlines() if not line.startswith('#')))))


def assert_rows(records, expected, columns, message):
    check(len(records) == len(expected), message + " retains the full row population")
    for actual, source in zip(records, expected):
        assert actual["hole_id"] == source["hole_id"], message + " preserves exact ordinary hole names"
        for column in columns:
            assert column in actual and math.isclose(float(actual[column]), source[column], rel_tol=1e-12, abs_tol=1e-9), message + " preserves " + column
    check(True, message + " preserves exact IDs, grades, support and measured coordinates")


def identifier_fixture(folder):
    folder.mkdir()
    names = ["constructor", "toString", "__proto__", "O'Neil-1"]
    tables = {
        "collar": [["hole_id", "x", "y", "z", "depth", "prospect"]],
        "survey": [["hole_id", "depth", "dip", "azimuth"]],
        "assay": [["hole_id", "from_m", "to_m", "ni_pct"]],
        "geology": [["hole_id", "from_m", "to_m", "lith1"]],
    }
    expected, composites = [], []
    grades = [(0, 1.5), (2.5, 4), (5, 6.5), (7.5, 9)]
    means = [0.75, 3.25, 5.75, 8.25]
    for index, name in enumerate(names):
        x, y, z = 500000 + index*20, 9000000 + index*30, 100 + index*20
        tables["collar"].append([name, x, y, z, 2, name])
        # Measured vertical stations stop at 1m; the unchanged owner must
        # explicitly extend the last measured direction to the 2m collar.
        tables["survey"].extend([[name, 0, -90, 0], [name, 1, -90, 0]])
        for interval in range(2):
            tables["assay"].append([name, interval, interval+1, grades[index][interval]])
            tables["geology"].append([name, interval, interval+1, "HOST"])
            expected.append({"hole_id": name, "from_m": interval, "to_m": interval+1,
                             "midx": x, "midy": y, "midz": z-interval-0.5, "ni_pct": grades[index][interval]})
        composites.append({"hole_id": name, "from_m": 0, "to_m": 2,
                           "midx": x, "midy": y, "midz": z-1, "ni_pct": means[index]})
    paths = []
    for table in TABLES:
        path = folder / (table + ".csv")
        with path.open("w", newline="") as handle:
            csv.writer(handle).writerows(tables[table])
        paths.append(path)
    return paths, names, expected, composites


def identifier_journey(browser, base, folder):
    paths, names, expected, composites = identifier_fixture(folder / "identifiers")
    columns = ["from_m", "to_m", "midx", "midy", "midz", "ni_pct"]
    for language, width, height in [("en", 1440, 1000), ("id", 390, 844)]:
        label = f"{language} {width}px identifiers"
        context, page = ready(browser, base, language, width, height)
        try:
            nav(page, 2)
            page.locator('#fileInput').set_input_files([str(path) for path in paths])
            page.wait_for_function("()=>STATE.assay.length===8&&STATE.collar.length===4&&STATE.collar[0].hole_id==='constructor'")
            check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + " four-file upload handles every legitimate property-like ID without renderer failures")
            before = snapshot(page)
            nav(page, 1)
            check(page.locator('#dashCollarTable tbody tr td:first-child').all_text_contents() == names, label + " dashboard retains all exact named holes")
            nav(page, 7)
            validation = page.evaluate("()=>_p1RunValidationChecks()")
            check(not any(row['severity'] == 'fail' for row in validation), label + " measured source has no failed validation finding")
            check(next(row for row in validation if row.get('code') == 'geometry')['value'] == 'READY'
                  and next(row for row in validation if row['name'] == 'Linkage and geometry verdict')['value'] == 'READY',
                  label + " geometry and linkage owners both report READY")
            warning = next(row for row in validation if row['name'] == 'Coordinate source')
            check(warning['severity'] == 'warn' and warning['value'] == 'Minimum-curvature directional survey',
                  label + " validation retains the explicit measured-coordinate source disclosure")
            check(page.evaluate("()=>buildHoleStatusData().map(r=>r.hid)" ) == names, label + " existing linkage owner retains all exact named holes")
            page.locator('#tab7 .workflow-stage-bar-next').click()
            page.wait_for_function("()=>document.querySelector('#tab10.panel.active')&&STATE.desurvey")
            check(page.evaluate("()=>Object.keys(STATE.desurvey.holes)") == names, label + " Desurvey owns every trace including __proto__")
            check(page.evaluate("()=>Object.values(STATE.desurvey.holes).every(h=>h.assumptions.includes('LAST_DIRECTION_EXTENSION')&&h.trace.at(-1).depth===2)"), label + " every trace explicitly extends the last measured direction to final depth")
            page.locator('#d3ToggleBtn').click()
            page.wait_for_function("()=>document.getElementById('d3Plot').data?.length>0")
            check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + " actual 3D lithology view retains the named-hole grouping")
            page.locator('#tab10 .workflow-stage-bar-next').click()
            page.wait_for_function("()=>document.querySelector('#tab11.panel.active')")
            page.locator('#computeMergeBtn').click()
            page.wait_for_function("()=>document.querySelector('#tab11.panel.active')&&STATE.merged?.length===8")
            assert_rows(page.evaluate("()=>STATE.merged"), expected, columns, label + " actual Merge")
            nav(page, 9)
            check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + " actual Section uses all prototype-named prospects without a grouping failure")
            nav(page, 12)
            page.locator('#compLen').fill('2')
            page.locator('#btnComputeComp').click()
            page.wait_for_function("()=>STATE.composite?.length===4")
            assert_rows(page.evaluate("()=>STATE.composite"), composites, columns, label + " actual 2m Composite")
            with page.expect_download() as result:
                page.locator('#btnExportComp').click()
            composite_csv = folder / (label + '-composite.csv')
            result.value.save_as(str(composite_csv))
            assert_rows(csv_records(composite_csv.read_text()), composites, columns, label + " native Composite CSV")
            nav(page, 13)
            with page.expect_download() as result:
                page.locator('#tab13 button[onclick="exportMasterCSV()"]').click()
            master = folder / (label + '-master.csv')
            result.value.save_as(str(master))
            assert_rows(csv_records(master.read_text()), expected, columns, label + " native named-hole master")
            check(snapshot(page) == before, label + " Dashboard/Validation/Desurvey/Merge/Composite retain every original measurement")
            page.locator('button.orebit-avatar').click()
            page.once('dialog', lambda dialog: dialog.accept("named-hole-lifecycle-Core.orebit"))
            with page.expect_download() as result:
                page.locator('.orebit-profile-menu [data-act="export"]').click()
            project = folder / (label + '-project.orebit')
            result.value.save_as(str(project))
            bundle = json.loads(project.read_text())
            assert_rows(csv_records(bundle['phase1']['assay_csv']), expected, ["from_m", "to_m", "ni_pct"], label + " native named-hole raw project")
            assert_rows(csv_records(bundle['phase1']['composite_csv']), composites, columns, label + " native named-hole project composites")
            check([record['hole_id'] for record in bundle['metadata']['geometry']['assumptions']] == names, label + " native project records each named-hole extension assumption")
            reopened_context, reopened = ready(browser, base, language, width, height)
            try:
                nav(reopened, 2)
                with reopened.expect_file_chooser() as chooser:
                    reopened.locator('#tab2 #btnImportBundle').click()
                chooser.value.set_files(str(project))
                reopened.wait_for_function("()=>STATE.assay.length===8&&STATE.collar[0].hole_id==='constructor'")
                check(reopened.evaluate("()=>STATE.collar.map(c=>c.hole_id)") == names, label + " fresh native project restores every exact named hole")
                complete_primary_pipeline(reopened)
                with reopened.expect_download() as result:
                    reopened.locator('#tab13 button[onclick="exportMasterCSV()"]').click()
                reopened_master = folder / (label + '-reopened-master.csv')
                result.value.save_as(str(reopened_master))
                assert_rows(csv_records(reopened_master.read_text()), expected, columns, label + " freshly reopened named-hole master")
                for current in (page, reopened):
                    check(not current.audit_errors and not current.evaluate('__literalHeaderFailures'), label + " full named-hole lifecycle has no page or swallowed-render failure")
            finally:
                reopened_context.close()
        finally:
            context.close()


def main():
    started = time.monotonic()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with tempfile.TemporaryDirectory(prefix="core-literal-headers-") as temp, sync_playwright() as pw:
            folder = Path(temp)
            paths, expected = fixture(folder)
            browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
            try:
                for language, width, height in ([] if CASE in ("identifiers", "striplog-routes", "striplog-footer", "striplog-no-collar", "striplog-depth-range", "striplog-empty-track") else [("en", 1440, 1000), ("id", 1440, 1000), ("en", 768, 900), ("id", 768, 900), ("en", 390, 844), ("id", 390, 844)]):
                    label = f"{language} {width}px"
                    context, page = ready(browser, base, language, width, height)
                    try:
                        nav(page, 2)
                        page.locator('#fileInput').set_input_files([str(path) for path in paths])
                        page.wait_for_function("h=>STATE.assay.length===4&&STATE.collar.length===2&&STATE.assay[0].hole_id===\"O'Neil-1\"&&STATE.rawHeaders.assay.includes(h)", arg=HEADER)
                        check(page.evaluate("()=>['collar','survey','assay','geology'].every(t=>STATE[t].length>0&&!STATE.isSample[t])"), label + " all four real files replace sample tables")
                        before = snapshot(page)
                        check(not page.evaluate("h=>STATE.manualGradeCols.has(h)", HEADER), label + " unfamiliar source header begins as a manual grade candidate")
                        nav(page, 8)
                        page.wait_for_function("()=>document.querySelector('#stripLogPlot')?.data?.length")
                        expected_plot_height = 640 if width > 768 else 520
                        actual_plot_height = page.locator('#stripLogPlot').evaluate("el=>el.getBoundingClientRect().height")
                        check(abs(actual_plot_height - expected_plot_height) < 1, label + " Strip Log plot height matches the Stage Mock responsive size")
                        hole_nav = page.locator('#stripLogPanel .row-controls button')
                        check(hole_nav.count() == 2, label + " Strip Log exposes Previous and Next for the sorted hole list")
                        hole_nav.nth(1).click()
                        page.wait_for_function("()=>STATE.stripLogUI.holeId===\"O'Neil-2\"")
                        check(page.locator('#stripLogPanel [data-hole-id]').inner_text() == "O'Neil-2", label + " Next changes the viewed hole")
                        hole_nav.first.click()
                        page.wait_for_function("()=>STATE.stripLogUI.holeId===\"O'Neil-1\"")
                        check(page.locator('#stripLogPanel [data-hole-id]').inner_text() == "O'Neil-1", label + " Previous returns to the prior hole")
                        page.locator('#stripLogHole').select_option("O'Neil-2")
                        page.wait_for_function("()=>STATE.stripLogUI.holeId===\"O'Neil-2\"")
                        check(page.locator('#stripLogPanel [data-hole-id]').inner_text() == "O'Neil-2", label + " native hole selector opens the requested hole")
                        check(snapshot(page) == before, label + " hole navigation preserves every uploaded source table")
                        hole_details = page.locator('#stripLogPanel details').first
                        if hole_details.get_attribute('open') is None:
                            hole_details.locator(':scope > summary').click()
                        swatch = page.locator('#stripLogPanel [data-litho-code="ORE"]')
                        default_color = swatch.input_value()
                        swatch.fill('#123456')
                        page.wait_for_function("()=>JSON.parse(localStorage.getItem('orebit-litho-colors')||'{}').ORE==='#123456'&&document.querySelector('#stripLogPlot')?.layout?.shapes?.some(s=>s.fillcolor==='#123456')")
                        page.wait_for_function("()=>document.querySelector('#stripLogPanel details')?.open&&document.activeElement?.dataset?.lithoCode==='ORE'")
                        check(True, label + " lithology recolour redraws the plot while retaining disclosure and swatch focus")
                        page.locator('#stripLogPanel .litho-reset-btn').click()
                        page.wait_for_function("()=>!localStorage.getItem('orebit-litho-colors')&&document.querySelector('#stripLogPlot')?.layout?.shapes?.every(s=>s.fillcolor!=='#123456')&&document.activeElement?.classList?.contains('litho-reset-btn')")
                        check(page.locator('#stripLogPanel details').first.get_attribute('open') is not None and page.locator('#stripLogPanel [data-litho-code="ORE"]').input_value() == default_color and snapshot(page) == before, label + " reset remains reachable and restores display colour without changing source tables")
                        chip = page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(HEADER, exact=True))
                        check(chip.count() == 1, label + " additional track exposes the exact uploaded apostrophe header")
                        for details in chip.locator('xpath=ancestor::details').all():
                            if details.get_attribute('open') is None:
                                details.locator(':scope > summary').click()
                        reset = page.locator('#lithoLegendStrip .litho-reset-btn')
                        reset.focus()
                        for _ in range(page.locator('#stripExtraColPicker > button').count() + 1):
                            page.keyboard.press('Tab')
                            if page.evaluate("h=>document.activeElement?.dataset?.extra==='assay.'+h", HEADER):
                                break
                        check(page.evaluate("el=>document.activeElement===el", chip.element_handle()), label + " native Tab reaches the additional-track toggle")
                        check(page.evaluate("el=>{const s=getComputedStyle(el);return s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0}", chip.element_handle()), label + " keyboard focus remains visibly indicated")
                        check(chip.get_attribute('aria-pressed') == 'false', label + " additional-track button exposes its unselected state")
                        page.keyboard.press('Enter')
                        chip = page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(HEADER, exact=True))
                        page.wait_for_function("h=>STATE.stripLogUI.extraCols.includes('assay.'+h)", arg=HEADER, timeout=5000)
                        page.wait_for_function("h=>document.activeElement?.dataset?.extra==='assay.'+h", arg=HEADER, timeout=5000)
                        check(chip.get_attribute('aria-pressed') == 'true' and page.evaluate("el=>document.activeElement===el", chip.element_handle()), label + " Enter selects the real track and preserves keyboard focus")
                        check(page.evaluate('el=>el.closest("details").open', chip.element_handle()), label + " additional-track rerender preserves the open hole details")
                        page.keyboard.press('Space')
                        chip = page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(HEADER, exact=True))
                        page.wait_for_function("h=>!STATE.stripLogUI.extraCols.includes('assay.'+h)&&document.activeElement?.dataset?.extra==='assay.'+h", arg=HEADER, timeout=5000)
                        check(chip.get_attribute('aria-pressed') == 'false' and page.evaluate("el=>document.activeElement===el", chip.element_handle()), label + " Space deselects the track and preserves keyboard focus")
                        check(page.evaluate('el=>el.closest("details").open', chip.element_handle()), label + " keyboard deselection keeps hole details expanded")
                        check(snapshot(page) == before, label + " keyboard track selection preserves source tables and raw headers")
                        chip.click()
                        page.wait_for_function("h=>STATE.stripLogUI.extraCols.includes('assay.'+h)", arg=HEADER, timeout=5000)
                        check(page.locator('#stripLogPlot').evaluate("(plot,h)=>Object.entries(plot.layout).some(([name,axis])=>name.startsWith('xaxis')&&axis.title?.text===h)", HEADER), label + " real plotted additional track has the literal header")
                        chip = page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(HEADER, exact=True))
                        for details in chip.locator('xpath=ancestor::details').all():
                            if details.get_attribute('open') is None:
                                details.locator(':scope > summary').click()
                        chip.click()
                        check(not page.evaluate("h=>STATE.stripLogUI.extraCols.includes('assay.'+h)", HEADER), label + " second actual click removes only the requested additional track")
                        check(snapshot(page) == before, label + " track toggles preserve every source row, raw header and grade")
                        for extra_header in (SECOND_HEADER, HEADER):
                            extra_chip = page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(extra_header, exact=True))
                            extra_chip.click()
                            page.wait_for_function("h=>STATE.stripLogUI.extraCols.includes('assay.'+h)", arg=extra_header)
                        expected_track_order = ['assay.' + SECOND_HEADER, 'assay.' + HEADER]
                        actual_track_order = page.evaluate("""()=>Object.entries(document.querySelector('#stripLogPlot').layout)
                          .filter(([name,axis])=>/^xaxis\\d*$/.test(name)&&axis.title?.text)
                          .sort((a,b)=>a[1].domain[0]-b[1].domain[0]).map(([,axis])=>axis.title.text)
                          .filter(title=>title==='Operator note'||title===\"O'Neil\")""")
                        check(page.evaluate('STATE.stripLogUI.extraCols') == expected_track_order
                              and actual_track_order == [SECOND_HEADER, HEADER],
                              label + " multiple optional tracks follow explicit selection order in state and plot")
                        page.locator('#stripLogHole').select_option("O'Neil-1")
                        page.wait_for_function("()=>STATE.stripLogUI.holeId===\"O'Neil-1\"")
                        reopened_order = page.evaluate("""()=>Object.entries(document.querySelector('#stripLogPlot').layout)
                          .filter(([name,axis])=>/^xaxis\\d*$/.test(name)&&axis.title?.text)
                          .sort((a,b)=>a[1].domain[0]-b[1].domain[0]).map(([,axis])=>axis.title.text)
                          .filter(title=>title==='Operator note'||title===\"O'Neil\")""")
                        check(reopened_order == [SECOND_HEADER, HEADER]
                              and snapshot(page) == before,
                              label + " selected-hole rerender preserves ordered optional tracks and all uploaded sources")
                        for details in page.locator('#stripLogPanel details').all():
                            if details.get_attribute('open') is None:
                                details.locator(':scope > summary').click()
                        page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(HEADER, exact=True)).click()
                        page.wait_for_function("h=>JSON.stringify(STATE.stripLogUI.extraCols)===JSON.stringify(['assay.'+h])", arg=SECOND_HEADER)
                        check(page.evaluate("()=>Object.values(document.querySelector('#stripLogPlot').layout).some(axis=>axis.title?.text==='Operator note')")
                              and not page.evaluate("()=>Object.values(document.querySelector('#stripLogPlot').layout).some(axis=>axis.title?.text===\"O'Neil\")"),
                              label + " removing the first extra track retains the second track without disturbing its owner")
                        page.locator('#stripExtraColPicker > button').filter(has=page.get_by_text(SECOND_HEADER, exact=True)).click()
                        page.wait_for_function("()=>STATE.stripLogUI.extraCols.length===0")
                        check(snapshot(page) == before, label + " removing the final optional track preserves the source rows")
                        page.locator('#stripLogHole').select_option("O'Neil-2")
                        page.wait_for_function("()=>STATE.stripLogUI.holeId===\"O'Neil-2\"")
                        page.locator('#stripLogExportFrom').fill('0')
                        page.locator('#stripLogExportTo').fill('2')
                        plot_range = page.evaluate("()=>JSON.stringify(document.querySelector('#stripLogPlot').layout.yaxis.range)")
                        with page.expect_download() as result:
                            page.locator('#striplogExportPngBtn').click()
                        strip_png = folder / (label + '-striplog.png')
                        download = result.value
                        download.save_as(str(strip_png))
                        png = strip_png.read_bytes()
                        check(re.fullmatch(r'orebit-striplog-o-neil-2-0-2m-\d{4}-\d{2}-\d{2}\.png', download.suggested_filename) is not None and png[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', png[16:24]) == (3200, 1800), label + " actual Strip Log range export is a named 3200×1800 PNG")
                        check(page.evaluate("()=>JSON.stringify(document.querySelector('#stripLogPlot').layout.yaxis.range)") == plot_range and snapshot(page) == before and not page.locator('#striplogExportPngBtn').is_disabled(), label + " PNG export restores the live plot range and preserves source tables")
                        nav(page, 7)
                        page.locator('#coreValidationMapping > summary').click()
                        grade = page.locator('#coreValidationMapping button').filter(has_text=re.compile(r'^\+\s*' + re.escape(HEADER) + r'$'))
                        check(grade.count() == 1 and grade.is_visible(), label + " manual mapping exposes the exact ordinary header")
                        grade.click()
                        page.wait_for_function("h=>STATE.manualGradeCols.has(h)&&getActualGradeColumns().includes(h)", arg=HEADER, timeout=5000)
                        check(page.locator('#coreValidationMapping button').filter(has_text=re.compile(r'^\+\s*' + re.escape(HEADER) + r'$')).count() == 0, label + " existing manual-grade owner consumes its candidate")
                        unit = page.locator(f'select[data-unit-col="{HEADER}"]')
                        for details in unit.locator('xpath=ancestor::details').all():
                            if details.get_attribute('open') is None:
                                details.locator(':scope > summary').click()
                        unit.select_option('pct')
                        check(page.evaluate("h=>STATE.units[h]==='pct'&&STATE.unitsLocked[h]", HEADER), label + " existing quoted-column unit control retains explicit assignment")
                        check(snapshot(page) == before, label + " marking a grade and assigning its unit preserve all source measurements")
                        complete_primary_pipeline(page)
                        nav(page, 9)
                        page.wait_for_function("()=>document.querySelector('#sectionPlot')?.layout?.shapes?.length")
                        section_before = page.evaluate("()=>JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology,STATE.desurvey,STATE.merged,STATE.sectionUI])")
                        page.locator('#sectionPanel [data-litho-code="ORE"]').fill('#654321')
                        page.wait_for_function("()=>JSON.parse(localStorage.getItem('orebit-litho-colors')||'{}').ORE==='#654321'&&document.querySelector('#sectionPlot')?.layout?.shapes?.some(s=>s.fillcolor==='#654321')&&document.querySelector('#stripLogPlot')?.layout?.shapes?.some(s=>s.fillcolor==='#654321')&&document.activeElement?.dataset?.lithoCode==='ORE'")
                        check(True, label + " Section lithology colour immediately redraws both consumers and retains swatch focus")
                        page.locator('#sectionPanel .litho-reset-btn').click()
                        page.wait_for_function("()=>!localStorage.getItem('orebit-litho-colors')&&document.querySelector('#sectionPlot')?.layout?.shapes?.every(s=>s.fillcolor!=='#654321')&&document.querySelector('#stripLogPlot')?.layout?.shapes?.every(s=>s.fillcolor!=='#654321')&&document.activeElement?.classList?.contains('litho-reset-btn')")
                        check(page.evaluate("()=>JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology,STATE.desurvey,STATE.merged,STATE.sectionUI])") == section_before, label + " shared colour reset leaves source, geometry, merge and Section settings unchanged")
                        nav(page, 13)
                        with page.expect_download() as result:
                            page.locator('#tab13 button[onclick="exportMasterCSV()"]').click()
                        master = folder / (label + '-master.csv')
                        result.value.save_as(str(master))
                        assert_rows(csv_records(master.read_text()), expected, ["from_m", "to_m", "midx", "midy", "midz", "ni_pct", HEADER], label + " native master")
                        check("O'Neil=pct" in master.read_text(), label + " native master records the explicit literal-column unit")
                        page.locator('button.orebit-avatar').click()
                        page.locator('.orebit-profile-menu [data-act="open"]').click()
                        page.locator('#pmNewName').fill(PROJECT)
                        page.locator('#pmCreateNew').click()
                        page.wait_for_function("name=>STATE.currentProjectName===name&&document.querySelector('.pm-row.active')?.dataset.name===name", arg=PROJECT)
                        check(page.locator('.pm-row.active .pm-name').inner_text().endswith(PROJECT), label + " actual manager persists an ordinary apostrophe project name")
                        page.once('dialog', lambda dialog: dialog.accept(PROJECT + '-Core.orebit'))
                        with page.expect_download() as result:
                            page.locator('.pm-row.active [data-action="export"]').click()
                        project = folder / (label + '-project.orebit')
                        result.value.save_as(str(project))
                        bundle = json.loads(project.read_text())
                        check(bundle['name'] == PROJECT and bundle['metadata']['units'][HEADER] == 'pct', label + " native project preserves exact name and grade-unit assignment")
                        assert_rows(csv_records(bundle['phase1']['assay_csv']), expected, ["from_m", "to_m", "ni_pct", HEADER], label + " native project raw assay")
                        page.keyboard.press('Escape')
                        check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + " original name/header/export journey has no renderer failure before reload")
                        page.reload()
                        page.wait_for_function("()=>window.__i18nBooted===true")
                        watch_renderers(page, label + " persisted reload")
                        page.wait_for_function("name=>STATE.currentProjectName===name&&STATE.assay.length===4", arg=PROJECT)
                        assert_rows(page.evaluate("()=>STATE.assay"), expected, ["from_m", "to_m", "ni_pct", HEADER], label + " actual saved-project IndexedDB reload")
                        check(page.evaluate("h=>STATE.units[h]==='pct'&&STATE.unitsLocked[h]", HEADER), label + " persisted named project retains its reviewed unit")
                        reopened_context, reopened = ready(browser, base, language, width, height)
                        try:
                            nav(reopened, 2)
                            with reopened.expect_file_chooser() as chooser:
                                reopened.locator('#tab2 #btnImportBundle').click()
                            chooser.value.set_files(str(project))
                            reopened.wait_for_function("()=>STATE.assay.length===4&&STATE.assay[0].hole_id===\"O'Neil-1\"")
                            rows = reopened.evaluate("()=>STATE.assay")
                            assert_rows(rows, expected, ["from_m", "to_m", "ni_pct", HEADER], label + " fresh native project reopen")
                            check(reopened.evaluate("h=>STATE.rawHeaders.assay.includes(h)&&STATE.units[h]==='pct'&&STATE.unitsLocked[h]", HEADER), label + " fresh reopen retains the arbitrary source column and reviewed unit")
                            check(reopened.evaluate("()=>STATE.collar.map(c=>[c.hole_id,c.x,c.y,c.z,c.depth])") == [["O'Neil-1",500000,9000000,100,2],["O'Neil-2",500020,9000030,120,2]], label + " project reopen retains independent source collar XYZ and depths")
                            for current in (page, reopened):
                                check(not current.audit_errors and not current.evaluate('__literalHeaderFailures'), label + " workflow has no page or swallowed-render failure")
                        finally:
                            reopened_context.close()
                    finally:
                        context.close()
                if CASE not in ("headers", "striplog-routes", "striplog-footer", "striplog-no-collar", "striplog-depth-range", "striplog-empty-track"):
                    identifier_journey(browser, base, folder)
                if CASE in ("all", "striplog-routes"):
                    for language, width, height in (("en", 1440, 1000), ("id", 1440, 1000), ("en", 390, 844), ("id", 390, 844)):
                        test_striplog_empty_source_routes(browser, base, folder, language, width, height)
                        test_striplog_hole_missing_both_logs_routes(browser, base, folder, language, width, height)
                        test_striplog_optional_track_with_only_missing_values(browser, base, folder, language, width, height)
                if CASE in ("all", "striplog-empty-track"):
                    for language, width, height in (("en", 1440, 1000), ("id", 1440, 1000), ("en", 390, 844), ("id", 390, 844)):
                        test_striplog_optional_track_with_only_missing_values(browser, base, folder, language, width, height)
                if CASE in ("all", "striplog-no-collar"):
                    for language, width, height in (("en", 1440, 1000), ("id", 1440, 1000), ("en", 390, 844), ("id", 390, 844)):
                        test_striplog_no_collar_import_recovery(browser, base, folder, language, width, height)
                if CASE in ("all", "striplog-depth-range"):
                    for language, width, height in (("en", 1440, 1000), ("id", 1440, 1000), ("en", 390, 844), ("id", 390, 844)):
                        test_striplog_export_default_matches_hole_depth(browser, base, folder, language, width, height)
                if CASE in ("all", "striplog-footer"):
                    for language in ("en", "id"):
                        test_striplog_mobile_controls_clear_bottom_navigation(browser, base, language)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    print(f"CORE LITERAL HEADERS: {PASSED} checks passed in {time.monotonic()-started:.3f}s", flush=True)


if __name__ == "__main__":
    main()
