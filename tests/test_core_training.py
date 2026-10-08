"""Validate the imperfect default, download source CSVs and repair by real import.

This tests the UI/import boundary, not just a synthetic object written into STATE.
"""

import csv, functools, http.server, io, tempfile, threading, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = next(
    p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists()
)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "dist"))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
passed = 0


def check(value, message):
    global passed
    assert value, message
    passed += 1
    print("PASS:", message, flush=True)


try:
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(accept_downloads=True)
        page.goto(f"http://127.0.0.1:{server.server_port}/Core.html")
        page.wait_for_function("() => window.__i18nBooted===true")
        page.evaluate(
            "document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove());applyLanguage('en');window.orebitConfirm=async()=>true;"
        )
        pristine = page.evaluate("JSON.stringify(SAMPLE_DATA)")
        original = page.evaluate("JSON.stringify({collar:STATE.collar,survey:STATE.survey,assay:STATE.assay,geology:STATE.geology})")
        page.locator('#tab1 [data-action-role="next"]').click()
        check(page.locator('#tab7').evaluate('e=>e.classList.contains("active")'), 'Default review goes directly to Validation')
        checks = page.evaluate('_p1RunValidationChecks()')
        check(sum(c['severity']=='fail' for c in checks)>=4, 'Default sample exposes real linkage failures without a mode or button')
        check(any('without Geology' in c['name'] and c['value']=='1 hole' for c in checks), 'Default validation distinguishes a missing geology log')
        check(page.locator('#tab7 [data-workflow-next]').is_disabled(), 'Unresolved default failures block Desurvey')
        check(page.locator('#coreTryValidation,#coreTrainingExercises,.workflow-training').count()==0, 'No separate imperfect-data mode remains')
        with page.expect_download() as download:
            page.locator('#tab7 .workflow-actions').get_by_role('button',name='Download source CSVs',exact=True).click()
        dest=Path(tmp)/'source.zip';download.value.save_as(dest)
        with zipfile.ZipFile(dest) as z:
            check(set(z.namelist())=={'collar.csv','survey.csv','assay.csv','geology.csv','README.txt'},'Source ZIP contains four importable originals with provenance')
            z.extractall(tmp)
        check(original==page.evaluate("JSON.stringify({collar:STATE.collar,survey:STATE.survey,assay:STATE.assay,geology:STATE.geology})"), 'Downloading sources never repairs or changes project data')
        data=page.evaluate('SAMPLE_SOURCE_DATA')
        paths=[str(Path(tmp)/(name+'.csv')) for name in ('collar','survey','assay','geology')]
        page.evaluate('STATE.desurvey={canary:true};STATE.merged=[{canary:true}];showTab(2)')
        page.locator('#fileInput').set_input_files(paths)
        page.wait_for_function('() => STATE.collar.length===350 && STATE.assay.length===8896')
        check(page.evaluate('STATE.desurvey===null && STATE.merged===null'), 'Source CSV corrections invalidate all prior derived geometry')
        page.evaluate('showTab(7)')
        check(not any(c['severity']=='fail' for c in page.evaluate('_p1RunValidationChecks()')), 'Original source CSV upload resolves every blocking linkage fault')
        check(page.locator('#tab7 [data-workflow-next]').is_enabled(), 'Corrected default can continue to Desurvey')
        # Additional malformed input fixtures use the ordinary file upload. There
        # is no special runtime exercise owner and no silent synthetic repair.
        for kind in ('missing-survey','overlapping-assay','missing-collar-and-geology'):
            import copy
            tables=copy.deepcopy({n:data[n] for n in ('collar','survey','assay','geology')})
            hole,missing_log,mismatch=[r['hole_id'] for r in tables['collar'][:3]]
            if kind=='missing-survey':tables['survey']=[r for r in tables['survey'] if r['hole_id']!=hole]
            elif kind=='overlapping-assay':
                first=next(r for r in tables['assay'] if r['hole_id']==hole)
                tables['assay'].append({**first,'from_m':(first['from_m']+first['to_m'])/2})
            else:
                tables['collar']=[r for r in tables['collar'] if r['hole_id']!=hole]
                tables['geology']=[r for r in tables['geology'] if r['hole_id']!=missing_log]
                next(r for r in tables['geology'] if r['hole_id']==mismatch)['hole_id']+='-MISMATCH'
            bad=Path(tmp)/kind;bad.mkdir()
            for name,rows in tables.items():
                with (bad/(name+'.csv')).open('w',newline='') as f:
                    writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
            page.evaluate('showTab(2)')
            page.locator('#fileInput').set_input_files([str(bad/(n+'.csv')) for n in tables])
            page.wait_for_function('(counts)=>Object.entries(counts).every(([n,k])=>STATE[n].length===k)',arg={n:len(rows) for n,rows in tables.items()})
            page.evaluate('showTab(7)');checks=page.evaluate('_p1RunValidationChecks()')
            if kind=='missing-survey':
                check(not page.evaluate('coreGeometryReady()'),'Missing measured survey blocks geometry readiness')
                check(any(c['value']=='1 hole' and 'without measured' in c['name'] for c in checks),'Validation identifies missing measured survey')
            elif kind=='overlapping-assay':
                check(any(c['name']=='Assay interval overlaps' and c['severity']=='fail' and c['value']=='1 overlap' for c in checks),'Validation rejects double-counted interval support')
            else:check(sum(c['severity']=='fail' for c in checks)>=4,'CSV linkage faults reproduce the default sample failures')
            check(page.evaluate('STATE.assay.some(r=>r.ni_pct===null)'), 'Missing grades stay missing through real CSV upload')
            check(page.evaluate('STATE.assay.every(r=>r.density!==null&&Number.isFinite(r.density))'), 'Measured density survives CSV upload')
            page.evaluate('showTab(2)');page.locator('#fileInput').set_input_files(paths)
            page.wait_for_function('() => STATE.collar.length===350 && STATE.survey.length===700 && STATE.assay.length===8896')
            check(page.evaluate('coreGeometryReady()') and not any(c['severity']=='fail' for c in page.evaluate('_p1RunValidationChecks()')), 'Reimporting originals clears '+kind+' through normal import')
        # An arbitrary header uses the existing manual mapping UI, not a new alias.
        density_csv = (
            Path(paths[2]).read_text().replace("density,", "Measured rock value,", 1)
        )
        page.locator("#fileInput").set_input_files(
            {
                "name": "assay.csv",
                "mimeType": "text/csv",
                "buffer": density_csv.encode(),
            }
        )
        page.wait_for_function(
            "() => STATE.rawHeaders.assay.includes('Measured rock value')"
        )
        page.evaluate("showTab(7)")
        page.locator("#map_assay_density").select_option("Measured rock value")
        page.locator("button[onclick=\"applyColumnMapping('assay')\"]").click()
        expected_density = [r["density"] for r in data["assay"]]
        check(
            page.evaluate("STATE.assay.map(r=>r.density)") == expected_density,
            "Manual density assignment of an arbitrary header preserves every measured value",
        )
        check(
            "density" not in page.evaluate("getActualGradeColumns()"),
            "Density never appears among detected grade columns",
        )
        check(
            page.locator("button[onclick*=\"markAsGradeColumn('density')\"]").count()
            == 0,
            "Validation does not offer measured density as an unrecognized grade",
        )
        page.evaluate("showTab(2)")
        zero_csv = io.StringIO()
        w = csv.DictWriter(zero_csv, fieldnames=list(data["assay"][0]))
        w.writeheader()
        w.writerows({**r, "ni_pct": 0} for r in data["assay"])
        page.locator("#fileInput").set_input_files(
            {
                "name": "assay.csv",
                "mimeType": "text/csv",
                "buffer": zero_csv.getvalue().encode(),
            }
        )
        page.wait_for_function(
            "() => STATE.assay.length>8000 && STATE.assay.every(r=>r.ni_pct===0)"
        )
        check(
            "ni_pct" in page.evaluate("getActualGradeColumns()"),
            "Core retains a measured all-zero grade column",
        )
        check(
            "au_gpt" not in page.evaluate("getActualGradeColumns()"),
            "Core does not activate an unmeasured schema grade",
        )
        check(
            page.evaluate("JSON.stringify(SAMPLE_DATA)") == pristine,
            "Source downloads and CSV corrections never mutate the default reference",
        )
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print("CORE TRAINING:", passed, "passed", flush=True)
