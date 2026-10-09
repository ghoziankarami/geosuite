"""Validate the imperfect default, download source CSVs and repair by real import.

This tests the UI/import boundary, not just a synthetic object written into STATE.
"""

import csv
import json
import functools
import http.server
import io
import os
import tempfile
import threading
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout

ROOT = next(
    p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists()
)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0),
    functools.partial(
        Quiet, directory=str(Path(os.environ.get("OREBIT_TEST_DIST", ROOT / "dist")))
    ),
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
            """() => {window.renderFailures=[];const original=window.safeRender;if(original)window.safeRender=function(name,fn){return original(name,()=>{try{return fn()}catch(e){renderFailures.push(String(e));throw e}})}}"""
        )
        page.evaluate(
            "safeRender('core-training-canary',()=>{throw new Error('training-canary')})"
        )
        check(
            page.evaluate("renderFailures.some(s=>s.includes('training-canary'))"),
            "Core training detector catches swallowed renderer errors",
        )
        page.evaluate("renderFailures=[]")
        page.evaluate(
            "document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove());applyLanguage('en');window.orebitConfirm=async()=>true;"
        )
        page.evaluate("showTab(7)")
        before_repair = page.evaluate("JSON.stringify([STATE.assay,STATE.survey])")
        check(
            page.locator("#coreRepairSource").is_visible(),
            "Known synthetic source repair is visible beside actual failures",
        )
        page.evaluate("window.orebitConfirm=async()=>false")
        page.locator("#coreRepairSource").click()
        check(
            page.evaluate("STATE.collar.length===349"),
            "Cancelling repair preserves the actual missing collar",
        )
        page.evaluate("window.orebitConfirm=async()=>true")
        page.locator("#coreRepairSource").click()
        page.wait_for_function(
            "() => STATE.collar.length===350 && STATE.geology.length===1372"
        )
        check(
            not any(
                c["severity"] == "fail"
                for c in page.evaluate("_p1RunValidationChecks()")
            ),
            "Reviewed known-source restoration resolves blocking findings",
        )
        check(
            before_repair
            == page.evaluate("JSON.stringify([STATE.assay,STATE.survey])"),
            "Restoration never invents or changes grades and survey measurements",
        )
        check(
            page.evaluate(
                "STATE.CHANGE_LOG.some(e=>e.table==='validation') && _pipelineLog.some(e=>e.action==='Validation repair')"
            ),
            "Repair is recorded in activity and PDF pipeline owners",
        )
        saved = page.evaluate("OrebitProject.save('synthetic-repair-record')")
        check(
            any(
                e["action"] == "Validation repair"
                for e in saved["metadata"]["audit"]["pipeline"]
            ),
            "Project export contains the recorded correction",
        )
        check(
            saved["geologicalDomain"]["schemaVersion"] == 1,
            "Core exports additive S0 Domain interpretation without altering legacy CSV tables",
        )
        page.locator("#undoBtn").click()
        check(
            page.evaluate("STATE.collar.length===349"),
            "Native Undo reverses the correction before further edits",
        )
        check(
            page.locator("#tab7 [data-workflow-next]").is_disabled(),
            "Undo reinstates the real downstream validation gate",
        )
        invalid_saved = page.evaluate("OrebitProject.save('unresolved-source')")
        check(
            page.evaluate("STATE.merged===null")
            and not invalid_saved["phase1"]["merged_csv"],
            "Saving an invalid project does not fabricate a ready Merge handoff",
        )
        page.evaluate("applyBundle", saved)
        page.wait_for_function(
            "() => _pipelineLog.some(e=>e.action==='Validation repair')"
        )
        check(
            page.evaluate("STATE.CHANGE_LOG.some(e=>e.table==='validation')"),
            "Repair audit survives project reopen",
        )
        check(
            not page.evaluate("OrebitCoreRepair.candidate()"),
            "A reopened or uploaded project never offers synthetic source replacement",
        )
        domain_before = page.evaluate(
            "JSON.stringify([STATE.collar,STATE.assay,STATE.geology])"
        )
        source_stamp = page.evaluate("OrebitCoreDomain.capture()")
        check(
            len(source_stamp["sha256"]) == 64 and source_stamp["rows"] == 8896,
            "Domain source uses actual Core data and SHA256",
        )
        check(
            domain_before
            == page.evaluate(
                "JSON.stringify([STATE.collar,STATE.assay,STATE.geology])"
            ),
            "Domain source hashing preserves raw zero, null and interval values",
        )
        page.evaluate("setUnit('ni_pct','ppm')")
        changed_stamp = page.evaluate("OrebitCoreDomain.capture()")
        check(
            changed_stamp["sha256"] != source_stamp["sha256"],
            "Domain source context includes the analyst grade-unit assignment",
        )
        unit_saved = page.evaluate("OrebitProject.save('assigned-unit-record')")
        page.evaluate("applyBundle", unit_saved)
        check(
            page.evaluate("_exportUnit('ni_pct')==='ppm'"),
            "Explicit grade units survive actual Core project save and reopen",
        )
        audit_markup = '<img src="broken" onerror="window.auditInjected=1">'
        unit_saved["metadata"]["audit"]["changes"] = [
            {
                "table": audit_markup,
                "timestamp": "2026-10-08",
                "summary": audit_markup,
                "diffs": [
                    None,
                    {"idx": audit_markup, "col": "test", "old": 0, "new": None},
                ],
            }
        ]
        page.evaluate("applyBundle", unit_saved)
        page.evaluate("showTab(1);renderActivityPanel()")
        check(
            page.locator("#activityPanel img").count() == 0
            and page.evaluate("!window.auditInjected"),
            "Reopened audit strings are text, never executable markup",
        )

        check(
            page.evaluate("OrebitCoreDomain.readiness()")["status"] == "none",
            "S0 foundation never masquerades as a validated geological solid",
        )
        page.evaluate("resetToSample({notify:false});showTab(1)")
        pristine = page.evaluate("JSON.stringify(SAMPLE_DATA)")
        original = page.evaluate(
            "JSON.stringify({collar:STATE.collar,survey:STATE.survey,assay:STATE.assay,geology:STATE.geology})"
        )
        page.locator('#tab1 [data-action-role="next"]').click()
        check(
            page.locator("#tab7").evaluate('e=>e.classList.contains("active")'),
            "Default review goes directly to Validation",
        )
        checks = page.evaluate("_p1RunValidationChecks()")
        check(
            sum(c["severity"] == "fail" for c in checks) >= 4,
            "Default sample exposes real linkage failures without a mode or button",
        )
        check(
            any(
                "without Geology" in c["name"] and c["value"] == "1 hole"
                for c in checks
            ),
            "Default validation distinguishes a missing geology log",
        )
        check(
            page.locator("#tab7 [data-workflow-next]").is_disabled(),
            "Unresolved default failures block Desurvey",
        )
        check(
            page.evaluate("exportMasterCSV()") is False,
            "Invalid source cannot bypass Validation via direct clean CSV export",
        )
        check(
            page.locator(
                "#coreTryValidation,#coreTrainingExercises,.workflow-training"
            ).count()
            == 0,
            "No separate imperfect-data mode remains",
        )
        with page.expect_download() as download:
            page.locator("#tab7 .workflow-actions").get_by_role(
                "button", name="Download source CSVs", exact=True
            ).click()
        dest = Path(tmp) / "source.zip"
        download.value.save_as(dest)
        with zipfile.ZipFile(dest) as z:
            check(
                set(z.namelist())
                == {
                    "collar.csv",
                    "survey.csv",
                    "assay.csv",
                    "geology.csv",
                    "README.txt",
                },
                "Source ZIP contains four importable originals with provenance",
            )
            z.extractall(tmp)
        check(
            original
            == page.evaluate(
                "JSON.stringify({collar:STATE.collar,survey:STATE.survey,assay:STATE.assay,geology:STATE.geology})"
            ),
            "Downloading sources never repairs or changes project data",
        )
        data = page.evaluate("SAMPLE_SOURCE_DATA")
        paths = [
            str(Path(tmp) / (name + ".csv"))
            for name in ("collar", "survey", "assay", "geology")
        ]
        page.evaluate(
            "STATE.desurvey={canary:true};STATE.merged=[{canary:true}];showTab(2)"
        )
        page.locator("#fileInput").set_input_files(paths)
        page.wait_for_function(
            "() => STATE.collar.length===350 && STATE.assay.length===8896"
        )
        check(
            page.evaluate("STATE.desurvey===null && STATE.merged===null"),
            "Source CSV corrections invalidate all prior derived geometry",
        )
        page.evaluate("showTab(7)")
        check(
            not any(
                c["severity"] == "fail"
                for c in page.evaluate("_p1RunValidationChecks()")
            ),
            "Original source CSV upload resolves every blocking linkage fault",
        )
        check(
            page.locator("#tab7 [data-workflow-next]").is_enabled(),
            "Corrected default can continue to Desurvey",
        )
        page.evaluate("showTab(4)")
        dip = page.evaluate("STATE.survey[0].dip")
        cell = page.locator(
            "#tab4 td[onclick=\"editCell(this, 'survey', 0, 'dip', false)\"]"
        )
        cell.click()
        cell.locator("input").fill("91")
        cell.locator("input").press("Enter")
        page.locator("#tab4 button[onclick=\"applyChanges('survey')\"]").click()
        page.evaluate("showTab(7)")
        check(
            page.locator("#tab7 [data-workflow-next]").is_disabled()
            and not page.evaluate("coreGeometryReady()"),
            "An invalid measured dip blocks downstream geometry after normal Apply changes",
        )
        check(
            page.locator("#coreValidationResults")
            .get_by_role("button", name="Open affected cell")
            .count()
            >= 1,
            "Measured-data failure offers an actionable manual correction",
        )
        page.evaluate("showTab(4)")
        cell = page.locator(
            "#tab4 td[onclick=\"editCell(this, 'survey', 0, 'dip', false)\"]"
        )
        cell.click()
        cell.locator("input").fill(str(dip))
        cell.locator("input").press("Enter")
        page.locator("#tab4 button[onclick=\"applyChanges('survey')\"]").click()
        page.evaluate("showTab(7)")
        check(
            page.locator("#tab7 [data-workflow-next]").is_enabled(),
            "Verified manual correction reopens the real Desurvey path",
        )
        check(
            page.evaluate("STATE.CHANGE_LOG.filter(e=>e.table==='survey').length>=2"),
            "Manual defect and correction are both recorded",
        )
        # Additional malformed input fixtures use the ordinary file upload. There
        # is no special runtime exercise owner and no silent synthetic repair.
        for kind in (
            "missing-survey",
            "overlapping-assay",
            "missing-collar-and-geology",
        ):
            import copy

            tables = copy.deepcopy(
                {n: data[n] for n in ("collar", "survey", "assay", "geology")}
            )
            hole, missing_log, mismatch = [r["hole_id"] for r in tables["collar"][:3]]
            if kind == "missing-survey":
                tables["survey"] = [r for r in tables["survey"] if r["hole_id"] != hole]
            elif kind == "overlapping-assay":
                first = next(r for r in tables["assay"] if r["hole_id"] == hole)
                tables["assay"].append(
                    {**first, "from_m": (first["from_m"] + first["to_m"]) / 2}
                )
            else:
                tables["collar"] = [r for r in tables["collar"] if r["hole_id"] != hole]
                tables["geology"] = [
                    r for r in tables["geology"] if r["hole_id"] != missing_log
                ]
                next(r for r in tables["geology"] if r["hole_id"] == mismatch)[
                    "hole_id"
                ] += "-MISMATCH"
            bad = Path(tmp) / kind
            bad.mkdir()
            for name, rows in tables.items():
                with (bad / (name + ".csv")).open("w", newline="") as f:
                    writer = csv.DictWriter(f, fieldnames=list(rows[0]))
                    writer.writeheader()
                    writer.writerows(rows)
            page.evaluate("showTab(2)")
            page.locator("#fileInput").set_input_files(
                [str(bad / (n + ".csv")) for n in tables]
            )
            page.wait_for_function(
                "(counts)=>Object.entries(counts).every(([n,k])=>STATE[n].length===k)",
                arg={n: len(rows) for n, rows in tables.items()},
            )
            page.evaluate("showTab(7)")
            checks = page.evaluate("_p1RunValidationChecks()")
            if kind == "missing-survey":
                check(
                    not page.evaluate("coreGeometryReady()"),
                    "Missing measured survey blocks geometry readiness",
                )
                check(
                    any(
                        c["value"] == "1 hole" and "without measured" in c["name"]
                        for c in checks
                    ),
                    "Validation identifies missing measured survey",
                )
            elif kind == "overlapping-assay":
                check(
                    any(
                        c["name"] == "Assay interval overlaps"
                        and c["severity"] == "fail"
                        and c["value"] == "1 overlap"
                        for c in checks
                    ),
                    "Validation rejects double-counted interval support",
                )
            else:
                check(
                    sum(c["severity"] == "fail" for c in checks) >= 4,
                    "CSV linkage faults reproduce the default sample failures",
                )
            check(
                page.evaluate("STATE.assay.some(r=>r.ni_pct===null)"),
                "Missing grades stay missing through real CSV upload",
            )
            check(
                page.evaluate(
                    "STATE.assay.every(r=>r.density!==null&&Number.isFinite(r.density))"
                ),
                "Measured density survives CSV upload",
            )
            page.evaluate("showTab(2)")
            page.locator("#fileInput").set_input_files(paths)
            page.wait_for_function(
                "() => STATE.collar.length===350 && STATE.survey.length===700 && STATE.assay.length===8896"
            )
            check(
                page.evaluate("coreGeometryReady()")
                and not any(
                    c["severity"] == "fail"
                    for c in page.evaluate("_p1RunValidationChecks()")
                ),
                "Reimporting originals clears " + kind + " through normal import",
            )
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
        page.locator("#coreValidationMapping > summary").click()
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
        # Real regional upload: an invalid survey outside a reviewed boundary
        # remains a finding, while the genuinely usable selected population can
        # be exported. Invalid measurements never produce plausible geometry.
        small = {
            "collar": "hole_id,x,y,z,depth\nH1,1000,2000,300,10\nH2,1100,2100,300,10\n",
            "survey": "hole_id,depth,dip,azimuth\nH1,0,-90,0\nH1,10,-90,0\nH2,0,-90,0\nH2,10,132,0\n",
            "assay": "hole_id,from_m,to_m,ni_pct\nH1,0,10,1\nH2,0,10,2\n",
            "geology": "hole_id,from_m,to_m,lithology\nH1,0,10,SAP\nH2,0,10,SAP\n",
        }
        files = []
        for name, text in small.items():
            path = Path(tmp) / (name + ".csv")
            path.write_text(text)
            files.append(str(path))
        page.evaluate("showTab(2)")
        page.locator("#fileInput").set_input_files(files)
        page.wait_for_function("()=>STATE.assay.length===2 && STATE.survey.length===4")
        raw = page.evaluate(
            "JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])"
        )
        check(
            not page.evaluate("coreGeometryReady()"),
            "Invalid regional survey blocks full-population clean handoff",
        )
        page.evaluate("showTab(11)")
        check(
            page.evaluate(
                'STATE.desurvey.invalidHoleIds.includes("H2") && STATE.desurvey.holes.H2.trace.length===0'
            ),
            "Out-of-range survey quarantines the whole affected trace",
        )
        check(
            page.evaluate('STATE.merged.find(r=>r.hole_id==="H2").midx===null'),
            "Unusable surveyed geometry stays missing rather than becoming a plausible position",
        )
        boundary = {
            "type": "Polygon",
            "coordinates": [
                [[990, 1990], [1010, 1990], [1010, 2010], [990, 2010], [990, 1990]]
            ],
        }
        path = Path(tmp) / "selected.geojson"
        path.write_text(json.dumps(boundary))
        page.evaluate("showTab(13)")
        page.locator("#constraintFile").set_input_files(str(path))
        page.wait_for_function("()=>CROP.polys.length===1")
        check(
            page.evaluate("_cropStats().noCoord===1 && _croppedMerged().length===1"),
            "Crop counts disclose missing XYZ and never coerce null coordinates to origin",
        )
        with page.expect_download() as selected:
            page.evaluate("exportCroppedMaster()")
        result = Path(tmp) / "selected-master.csv"
        selected.value.save_as(result)
        rows = list(
            csv.DictReader(
                line
                for line in result.read_text().splitlines()
                if not line.startswith("#")
            )
        )
        check(
            len(rows) == 1
            and rows[0]["hole_id"] == "H1"
            and float(rows[0]["ni_pct"]) == 1,
            "Scoped clean export contains only the measured, validated selected interval",
        )
        check(
            page.evaluate('_pipelineLog.some(e=>e.action==="Scoped validation")'),
            "Boundary export records its selected validation scope",
        )
        check(
            raw
            == page.evaluate(
                "JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])"
            ),
            "Scoped validation never changes original regional source rows",
        )
        # A duplicate inside that same scope must block every cleaned exporter.
        page.evaluate("showTab(2)")
        duplicate = small["collar"] + "H1,1000,2000,300,10\n"
        page.locator("#fileInput").set_input_files(
            {"name": "collar.csv", "mimeType": "text/csv", "buffer": duplicate.encode()}
        )
        page.wait_for_function("()=>STATE.collar.length===3")
        page.evaluate("showTab(11)")
        check(
            page.evaluate("exportCroppedMaster()") is False,
            "Duplicate selected collar blocks cropped clean export",
        )
        check(
            page.evaluate("exportCroppedAssay()") is False,
            "Duplicate selected collar cannot bypass the gate through cropped assay export",
        )
        check(
            page.evaluate("exportIndustryDrillholeCSV()") is False,
            "Industry clean export shares the full-population validation gate",
        )
        # S1 analytical quarter-circle: upload all four actual source tables.
        arc_tables = {
            "collar": "hole_id,x,y,z,depth\nARC,500000,9000000,300,100\nSTART,501000,9000000,300,50\n",
            "survey": "hole_id,depth,dip,azimuth\nARC,0,-90,90\nARC,100,0,90\nSTART,10,-90,0\nSTART,50,-60,0\n",
            "assay": "hole_id,from_m,to_m,ni_pct\nARC,0,100,1\nSTART,0,50,0\n",
            "geology": "hole_id,from_m,to_m,lithology\nARC,0,100,SAP\nSTART,0,50,SAP\n",
        }
        arc_files = []
        for name, text in arc_tables.items():
            path = Path(tmp) / (name + ".csv")
            path.write_text(text)
            arc_files.append(str(path))
        page.evaluate("showTab(2)")
        page.locator("#fileInput").set_input_files(arc_files)
        page.wait_for_function(
            '()=>STATE.assay.length===2 && STATE.collar[0].hole_id==="ARC"'
        )
        arc_raw = page.evaluate(
            "JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])"
        )
        page.evaluate("showTab(10)")
        import math

        radius = 100 / (math.pi / 2)
        expected = {
            "x": 500000 + radius * (1 - math.cos(math.pi / 4)),
            "y": 9000000,
            "z": 300 - radius * math.sin(math.pi / 4),
        }
        actual = page.evaluate('getXYZAtDepth("ARC",50)')
        check(
            sum((actual[k] - expected[k]) ** 2 for k in expected) ** 0.5 < 0.1,
            "Actual Core midpoint follows the minimum-curvature arc, not its station chord",
        )
        check(
            page.evaluate('getXYZAtDepth("ARC",null)===null'),
            "An absent requested measured depth does not become the collar",
        )
        endpoints = page.evaluate("OrebitCoreDomain.intervalGeometry()")
        check(
            len(endpoints["intervals"]) == 2
            and endpoints["intervals"][0]["status"] == "measured",
            "S1 endpoints preserve source interval count and distinguish measured geometry",
        )
        check(
            abs(endpoints["intervals"][0]["end"]["x"] - (500000 + radius)) < 0.1,
            "Core interpretation endpoint matches independent analytical EOH",
        )
        check(
            endpoints["intervals"][1]["status"] == "assumed"
            and "ASSUMED_VERTICAL_START" in endpoints["intervals"][1]["assumptions"],
            "A missing zero-depth station remains an explicit derived assumption",
        )
        check(
            page.locator("#desurveyPanel")
            .inner_text()
            .find("Trace assumptions to inspect")
            >= 0,
            "Trace assumption review is visible in the actual main Desurvey stage",
        )
        arc_saved = page.evaluate("OrebitProject.save('s1-curved-survey')")
        check(
            arc_saved["metadata"]["geometry"]["algorithm"]
            == "minimum-curvature-arc-v1",
            "Project records the actual geometry algorithm version",
        )
        check(
            any(
                x["hole_id"] == "START"
                for x in arc_saved["metadata"]["geometry"]["assumptions"]
            ),
            "Project retains hole-specific assumption provenance",
        )
        page.evaluate("applyBundle", arc_saved)
        reopened = page.evaluate("OrebitCoreDomain.intervalGeometry()")
        check(
            reopened["intervals"] == endpoints["intervals"],
            "Raw-source project reopen reconstructs the same endpoints and assumptions",
        )
        page.evaluate("showTab(11)")
        core_mid = page.evaluate('STATE.merged.find(r=>r.hole_id==="ARC")')
        check(
            sum((core_mid["mid" + k] - expected[k]) ** 2 for k in expected) ** 0.5
            < 0.1,
            "Actual Core Merge uses the same exact arc owner",
        )
        check(
            arc_raw
            == page.evaluate(
                "JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])"
            ),
            "Arc positions, endpoint inspection and project reopen leave measured source values unchanged",
        )
        page.evaluate("setCoreProvidedXYZ(true)")
        check(
            page.evaluate("OrebitCoreDomain.intervalGeometry().status")
            == "endpoints-unavailable",
            "Supplied midpoints never become invented survey endpoints",
        )
        page.evaluate("setCoreProvidedXYZ(false)")
        # The same four files enter Assay directly; no Core result is injected.
        assay = browser.new_page()
        assay.goto(f"http://127.0.0.1:{server.server_port}/Assay.html")
        assay.wait_for_function("()=>window.__i18nBooted===true")
        assay.evaluate(
            "document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove());applyLanguage('en');showTab(2)"
        )
        assay.evaluate(
            """() => {window.renderFailures=[];const original=window.safeRender;if(original)window.safeRender=function(name,fn){return original(name,()=>{try{return fn()}catch(e){renderFailures.push(String(e));throw e}})}}"""
        )
        assay.evaluate(
            "safeRender('assay-training-canary',()=>{throw new Error('assay-training-canary')})"
        )
        check(
            assay.evaluate(
                "renderFailures.some(s=>s.includes('assay-training-canary'))"
            ),
            "Assay detector catches swallowed renderer errors",
        )
        assay.evaluate("renderFailures=[]")
        assay.locator("#fileInput").set_input_files(arc_files)
        assay.wait_for_function(
            '()=>DATA.rows.length===2 && DATA.rows.some(r=>r[colIdx("hole_id")]==="ARC")'
        )
        direct = assay.evaluate(
            '()=>{const row=DATA.rows.find(r=>r[colIdx("hole_id")]==="ARC");return {x:row[colIdx("midx")],y:row[colIdx("midy")],z:row[colIdx("midz")]}}'
        )
        check(
            sum((direct[k] - expected[k]) ** 2 for k in expected) ** 0.5 < 0.1,
            "Direct Assay four-table upload uses the same analytical arc midpoint as Core",
        )
        # Mathematically undefined bend: retain the raw survey, block clean handoff.
        opposite = arc_tables["survey"].replace("ARC,100,0,90", "ARC,100,90,90")
        page.evaluate("showTab(2)")
        page.locator("#fileInput").set_input_files(
            {"name": "survey.csv", "mimeType": "text/csv", "buffer": opposite.encode()}
        )
        page.wait_for_function(
            '()=>STATE.survey.some(r=>r.hole_id==="ARC"&&Number(r.depth)===100&&Number(r.dip)===90)'
        )
        check(
            not page.evaluate("coreGeometryReady()")
            and page.evaluate("exportMasterCSV()") is False,
            "Opposite station directions cannot bypass clean-export readiness",
        )
        page.evaluate("showTab(10)")
        check(
            page.evaluate("STATE.desurvey.holes.ARC.trace.length===0"),
            "An undefined curvature segment is quarantined rather than producing huge coordinates",
        )
        check(
            page.evaluate(
                '_p1RunValidationChecks().some(c=>c.name.includes("conflicting or opposite")&&c.severity==="fail")'
            ),
            "The mathematical ambiguity has an actionable validation finding",
        )
        check(
            page.evaluate(
                'STATE.survey.some(r=>r.hole_id==="ARC"&&Number(r.dip)===90)'
            ),
            "Rejecting impossible geometry preserves the raw opposite direction for manual correction",
        )
        badpath = Path(tmp) / "survey.csv"
        badpath.write_text(opposite)
        assay.evaluate("showTab(2)")
        assay.locator("#fileInput").set_input_files(
            [arc_files[0], str(badpath), arc_files[2], arc_files[3]]
        )
        try:
            assay.wait_for_function(
                '()=>DATA.rows.length===2 && window._lastImportReport!==window._beforeReimportReport && window._lastUploadedFiles.some(f=>f.name==="survey.csv"&&f.text.includes("ARC,100,90,90"))'
            )
        except BrowserTimeout as error:
            raise AssertionError(
                "Corrected same-name Assay survey import never reached its import report"
            ) from error
        badpos = assay.evaluate(
            '()=>{const row=DATA.rows.find(r=>r[colIdx("hole_id")]==="ARC");return [row[colIdx("midx")],row[colIdx("midy")],row[colIdx("midz")]]}'
        )
        check(
            badpos == [None, None, None],
            "Direct Assay import quarantines the same unusable geometry; it never substitutes collar XYZ: "
            + repr(badpos),
        )
        page.evaluate("showTab(2);window._beforeSameNameCollar=STATE.collar")
        page.locator("#fileInput").set_input_files(arc_files[0])
        page.wait_for_function("()=>STATE.collar!==window._beforeSameNameCollar")
        Path(arc_files[0]).write_text(
            arc_tables["collar"].replace(
                "ARC,500000,9000000,300", "ARC,500000,9000000,301"
            )
        )
        page.locator("#fileInput").set_input_files(arc_files[0])
        try:
            page.wait_for_function(
                '()=>Number(STATE.collar.find(r=>r.hole_id==="ARC").z)===301'
            )
        except BrowserTimeout as error:
            raise AssertionError(
                "Corrected same-name Core collar import never updated its source value"
            ) from error
        check(
            page.evaluate("STATE.desurvey===null && STATE.merged===null"),
            "Same-name source reimport applies the actual corrected value and invalidates stale geometry",
        )
        check(
            page.evaluate("renderFailures.length===0"),
            "Real validation, editor, projection and project flows have no swallowed Core renderer errors",
        )
        check(
            assay.evaluate("renderFailures.length===0"),
            "Real direct-upload and same-name Assay corrections have no swallowed renderer errors",
        )
        assay.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print("CORE TRAINING:", passed, "passed", flush=True)
