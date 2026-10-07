"""Download teaching ZIPs, upload all CSVs, inspect failures, restore real source.

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
        page.evaluate("showTab(2)")
        page.locator("#coreTrainingExercises>summary").click()
        original = page.evaluate(
            "JSON.stringify({collar:STATE.collar,survey:STATE.survey,assay:STATE.assay,geology:STATE.geology})"
        )
        pristine = page.evaluate("JSON.stringify(SAMPLE_DATA)")
        data = __import__("json").loads(pristine)
        paths = []
        for name in ("collar", "survey", "assay", "geology"):
            path = Path(tmp) / (name + ".csv")
            rows = data[name]
            with path.open("w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            paths.append(str(path))
        for kind in ("missing-survey", "overlapping-assay"):
            page.evaluate("showTab(2)")
            page.locator("#coreTrainingExercises").evaluate("(e)=>e.open=true")
            with page.expect_download() as download:
                page.locator(
                    f'#coreTrainingExercises button[onclick*="{kind}"]'
                ).click()
            dest = Path(tmp) / (kind + ".zip")
            download.value.save_as(dest)
            current = page.evaluate(
                "JSON.stringify({collar:STATE.collar,survey:STATE.survey,assay:STATE.assay,geology:STATE.geology})"
            )
            check(
                current == original,
                "Downloading " + kind + " leaves project data unchanged",
            )
            exercise = Path(tmp) / kind
            exercise.mkdir()
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
                    kind + " ZIP has four importable tables and instructions",
                )
                z.extractall(exercise)
            page.locator("#fileInput").set_input_files(
                [
                    str(exercise / (n + ".csv"))
                    for n in ("collar", "survey", "assay", "geology")
                ]
            )
            expected_survey = len(data["survey"]) - (
                2 if kind == "missing-survey" else 0
            )
            expected_assay = len(data["assay"]) + (
                1 if kind == "overlapping-assay" else 0
            )
            page.wait_for_function(
                f"() => STATE.survey.length==={expected_survey} && STATE.assay.length==={expected_assay}"
            )
            page.evaluate("showTab(7)")
            page.wait_for_timeout(300)
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
                    "Validation identifies the missing survey hole",
                )
            else:
                check(
                    any(
                        c["name"] == "Assay interval overlaps"
                        and c["severity"] == "fail"
                        and c["value"] == "1 overlap"
                        for c in checks
                    ),
                    "Validation flags the deliberately overlapping interval as a failure",
                )
            check(
                page.evaluate(
                    "STATE.assay.every(r=>Number.isFinite(Number(r.density)) && r.density!==null)"
                ),
                "CSV import retains measured density alongside grades",
            )
            check(
                page.evaluate("STATE.assay.some(r=>r.ni_pct===null)"),
                "Missing grades stay missing after exercise upload",
            )
            page.evaluate("showTab(2)")
            page.locator("#fileInput").set_input_files(paths)
            page.wait_for_function(
                f'() => STATE.assay.length==={len(data["assay"])} && STATE.survey.length==={len(data["survey"])}'
            )
            check(
                page.evaluate("coreGeometryReady()"),
                "Restoring original measured source makes geometry ready",
            )
            check(
                not any(
                    c["severity"] == "fail"
                    for c in page.evaluate("_p1RunValidationChecks()")
                ),
                "Corrected re-upload clears validation failures",
            )
            original = page.evaluate(
                "JSON.stringify({collar:STATE.collar,survey:STATE.survey,assay:STATE.assay,geology:STATE.geology})"
            )
        check(
            page.evaluate("JSON.stringify(SAMPLE_DATA)") == pristine,
            "Exercise downloads and uploads never mutate the embedded source",
        )
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print("CORE TRAINING:", passed, "passed", flush=True)
