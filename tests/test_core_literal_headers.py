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
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists())
SITE = Path(os.environ.get("CORE_LITERAL_HEADERS_SITE", os.environ.get("OREBIT_TEST_DIST", ROOT / "dist")))
HEADER = "O'Neil"
PROJECT = "O'Neil-Headers"
TABLES = ["collar", "survey", "assay", "geology"]
CASE = os.environ.get("CORE_LITERAL_HEADERS_CASE", "all")
if CASE not in ("all", "headers", "identifiers"):
    raise ValueError("CORE_LITERAL_HEADERS_CASE must be all, headers or identifiers")
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
    for number in (7, 10, 11):
        page.locator(f'#tab{number} .workflow-actions [data-workflow-next]').click()
        page.wait_for_function('(n)=>!document.getElementById("tab"+n).classList.contains("active")', arg=number)
    page.wait_for_function("()=>document.querySelector('#tab13.panel.active')&&STATE.merged?.length")


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


def fixture(folder):
    tables = {
        "collar": [["hole_id", "x", "y", "z", "depth", "prospect"]],
        "survey": [["hole_id", "depth", "dip", "azimuth"]],
        "assay": [["hole_id", "from_m", "to_m", "ni_pct", HEADER]],
        "geology": [["hole_id", "from_m", "to_m", "lith1"]],
    }
    expected = []
    grades = [0, 1.5, 2.5, 4]
    extra = [10.25, 11.5, 12.75, 14]
    for hole, (x, y, z) in enumerate([(500000, 9000000, 100), (500020, 9000030, 120)]):
        identity = f"O'Neil-{hole+1}"
        tables["collar"].append([identity, x, y, z, 2, "O'Neil field"])
        tables["survey"].extend([[identity, 0, -90, 0], [identity, 2, -90, 0]])
        for interval in range(2):
            index = hole * 2 + interval
            tables["assay"].append([identity, interval, interval + 1, grades[index], extra[index]])
            tables["geology"].append([identity, interval, interval + 1, "ORE"])
            # Independent exact geometry for a vertical measured survey.
            expected.append({"hole_id": identity, "from_m": interval, "to_m": interval+1,
                             "midx": x, "midy": y, "midz": z-interval-0.5,
                             "ni_pct": grades[index], HEADER: extra[index]})
    paths = []
    for table in TABLES:
        path = folder / (table + ".csv")
        with path.open("w", newline="") as handle:
            csv.writer(handle).writerows(tables[table])
        paths.append(path)
    return paths, expected


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
            page.locator('#tab7 .workflow-actions [data-workflow-next]').click()
            page.wait_for_function("()=>document.querySelector('#tab10.panel.active')&&STATE.desurvey")
            check(page.evaluate("()=>Object.keys(STATE.desurvey.holes)") == names, label + " Desurvey owns every trace including __proto__")
            check(page.evaluate("()=>Object.values(STATE.desurvey.holes).every(h=>h.assumptions.includes('LAST_DIRECTION_EXTENSION')&&h.trace.at(-1).depth===2)"), label + " every trace explicitly extends the last measured direction to final depth")
            page.locator('#d3ToggleBtn').click()
            page.wait_for_function("()=>document.getElementById('d3Plot').data?.length>0")
            check(not page.audit_errors and not page.evaluate('__literalHeaderFailures'), label + " actual 3D lithology view retains the named-hole grouping")
            page.locator('#tab10 .workflow-actions [data-workflow-next]').click()
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
                for language, width, height in ([] if CASE == "identifiers" else [("en", 1440, 1000), ("id", 1440, 1000), ("en", 390, 844), ("id", 390, 844)]):
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
                        chip = page.locator('#stripExtraColPicker > span').filter(has=page.get_by_text(HEADER, exact=True))
                        check(chip.count() == 1, label + " additional track exposes the exact uploaded apostrophe header")
                        for details in chip.locator('xpath=ancestor::details').all():
                            if details.get_attribute('open') is None:
                                details.locator(':scope > summary').click()
                        chip.click()
                        page.wait_for_function("h=>STATE.stripLogUI.extraCols.includes('assay.'+h)", arg=HEADER, timeout=5000)
                        check(page.locator('#stripLogPlot').evaluate("(plot,h)=>Object.entries(plot.layout).some(([name,axis])=>name.startsWith('xaxis')&&axis.title?.text===h)", HEADER), label + " real plotted additional track has the literal header")
                        chip = page.locator('#stripExtraColPicker > span').filter(has=page.get_by_text(HEADER, exact=True))
                        for details in chip.locator('xpath=ancestor::details').all():
                            if details.get_attribute('open') is None:
                                details.locator(':scope > summary').click()
                        chip.click()
                        check(not page.evaluate("h=>STATE.stripLogUI.extraCols.includes('assay.'+h)", HEADER), label + " second actual click removes only the requested additional track")
                        check(snapshot(page) == before, label + " track toggles preserve every source row, raw header and grade")
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
                if CASE != "headers":
                    identifier_journey(browser, base, folder)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    print(f"CORE LITERAL HEADERS: {PASSED} checks passed in {time.monotonic()-started:.3f}s", flush=True)


if __name__ == "__main__":
    main()
