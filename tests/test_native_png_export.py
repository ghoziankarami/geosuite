"""Native PNGs keep title clearance and leave live plots/data unchanged.

Real four-table upload and Core -> Assay -> Resource controls. No forced tabs,
deleted tour overlay or invented calculation state. OREBIT_TEST_DIST selects a
frozen artifact for negative controls; OREBIT_PNG_PROOF_DIR retains downloads.
"""

import csv
import functools
import hashlib
import http.server
import importlib.util
import json
import math
import os
import tempfile
import threading
import zipfile
from pathlib import Path

import fitz
from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").is_file())
SITE = Path(os.environ.get("OREBIT_TEST_DIST", ROOT / "dist"))
spec = importlib.util.spec_from_file_location("png_controls", Path(__file__).with_name("test_resource_large_extent.py"))
controls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controls)
PASSED = 0
RAW = "()=>JSON.stringify(typeof DATA!=='undefined'?DATA.rows:[STATE.collar,STATE.survey,STATE.assay,STATE.geology])"
SNAPSHOT = """id=>{const g=document.getElementById(id);return JSON.stringify({data:g.data,layout:g.layout,
  camera:g._fullLayout?.scene?.camera,tab:document.querySelector('.panel.active')?.id,raw:(typeof DATA!=='undefined'?DATA.rows:
  [STATE.collar,STATE.survey,STATE.assay,STATE.geology]),settings:window._blockViewSettings});}"""


def check(value, message):
    global PASSED
    assert value, message
    PASSED += 1
    print("PASS: " + message, flush=True)


def source_files(folder):
    paths = {}
    tables = {
        "collar": (["hole_id", "x", "y", "z", "depth"], []),
        "survey": (["hole_id", "depth", "dip", "azimuth"], []),
        "assay": (["hole_id", "from_m", "to_m", "au_gpt"], []),
        "geology": (["hole_id", "from_m", "to_m", "lithology", "domain"], []),
    }
    for h in range(6):
        hole = "H" + str(h + 1)
        tables["collar"][1].append([hole, 100 + h % 3 * 10, 200 + h // 3 * 10, 300, 8])
        tables["survey"][1].extend([[hole, 0, -90, 0], [hole, 8, -90, 0]])
        tables["geology"][1].append([hole, 0, 8, "HOST", "ORE"])
        for depth in range(8):
            tables["assay"][1].append([hole, depth, depth + 1, 1 + (h + depth) % 5])
    for name, (header, rows) in tables.items():
        path = folder / (name + ".csv")
        with path.open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            writer.writerows(rows)
        paths[name] = path
    return paths


def download(page, selector, target):
    with page.expect_download(timeout=60000) as result:
        page.locator(selector).click()
    result.value.save_as(str(target))
    return target


def observe(page):
    page.evaluate("""()=>{
      window.__pngLiveRelayout=0;window.__pngInputs=[];
      const relayout=Plotly.relayout;Plotly.relayout=function(...args){
        __pngLiveRelayout++;return relayout.apply(this,args);
      };
      const owner=Plotly.toImage;Plotly.toImage=async function(graph,opts){
        __pngInputs.push({detached:!(graph instanceof HTMLElement),width:opts.width,height:opts.height,scale:opts.scale,margin:structuredClone(graph.layout?.margin),sceneColors:['xaxis','yaxis','zaxis'].map(k=>graph.layout?.scene?.[k]?.color)});
        return owner.call(this,graph,opts);
      };
    }""")


def export_png(page, chart, selector, path, clearance=True):
    page.locator(selector).scroll_into_view_if_needed()
    page.wait_for_function("id=>!!document.getElementById(id)?._fullLayout", arg=chart)
    before = page.evaluate(SNAPSHOT, chart)
    calls = page.evaluate("__pngLiveRelayout")
    download(page, selector, path)
    page.wait_for_function("selector=>!document.querySelector(selector).disabled", arg=selector)
    data = path.read_bytes()
    if os.environ.get("OREBIT_PNG_PROOF_DIR"):
        out = Path(os.environ["OREBIT_PNG_PROOF_DIR"])
        out.mkdir(parents=True, exist_ok=True)
        (out / path.name).write_bytes(data)
    check(data.startswith(b"\x89PNG\r\n\x1a\n"), chart + " real native action completes a PNG download")
    pix = fitz.Pixmap(str(path))
    check(pix.width == 2800 and pix.height == 1800, chart + " fixed 2800x1800 native image dimensions")
    if clearance:
        top = pix.samples[:pix.stride * 12]
        white = all(all(top[i + c] >= 245 for c in range(3)) for i in range(0, len(top), pix.n))
        check(white, chart + " native PNG has 12 clear top-edge pixels; title glyphs are not cropped")
    if chart == "d3Plot":
        bottom = pix.samples[-pix.stride * 12:]
        white = all(all(bottom[i + c] >= 245 for c in range(3)) for i in range(0, len(bottom), pix.n))
        check(white, "3D native PNG reserves a clear lower canvas margin")
        image = page.evaluate('__pngInputs[__pngInputs.length-1]')
        check(image['sceneColors'] == ['#0f172a'] * 3, "3D exported axes use readable light-theme ink independently of the active theme")
        boundary = pix.height - round(image['margin']['b'] * image['scale'])
        # Ignore the colour bar at the far right. The scene itself must have
        # clear pixels before its clipping boundary, not just outside it.
        pixels = pix.samples
        clear = all(all(pixels[y * pix.stride + x * pix.n + c] >= 245 for c in range(3))
                    for y in range(boundary - 12, boundary) for x in range(int(pix.width * .85)))
        check(clear, "3D native overview fits the model and labels inside the actual scene boundary")
    check(page.evaluate(SNAPSHOT, chart) == before, chart + " retains exact live plot/camera/filter/data after export")
    check(page.evaluate("__pngLiveRelayout") == calls, chart + " export does not relayout the live chart")
    check(page.evaluate("__pngInputs[__pngInputs.length-1].detached"), chart + " image uses an isolated data/layout snapshot")
    return {"file": path.name, "sha256": hashlib.sha256(data).hexdigest(), "pixels": [pix.width, pix.height]}


def resource_view(page):
    page.locator("#tab1 .workflow-actions [data-action-role='next']").first.click()
    page.locator("#resourceSetupNext").click()
    page.locator('#variogramSampling > summary').click()
    for selector, value in [("#varLag", "2"), ("#varN", "12"), ("#varMaxH", "30")]:
        page.locator(selector).fill(value)
    page.locator('#varMaxH').press('Tab')
    page.locator("#tab4 .workflow-actions [data-workflow-next]").click()
    page.wait_for_selector("#bmX")
    extents = page.evaluate("_resourceExtents(getSamples())")
    sizes = [max(1, math.ceil((high - low) / 4)) for low, high in extents]
    for selector, value in zip(["#bmX", "#bmY", "#bmZ"], sizes):
        page.locator(selector).fill(str(value))
    page.locator("#bmEnvelopeRadius").fill(str(math.ceil(math.hypot(*sizes))))
    page.locator("#bmEnvelopeRadius").press("Tab")
    page.locator("#bmDens").fill("2.7")
    page.locator("#bmDens").press("Tab")
    page.locator("#bmGenBtn").click()
    page.wait_for_function("()=>blockState.blocks?.length>0")
    controls.nav(page, 6)
    for selector in ["#srMaj", "#srSemi", "#srMin"]:
        page.locator(selector).fill("50")
    for selector, value in [("#sMinN", "3"), ("#sMaxN", "12"), ("#sMaxHole", "4")]:
        page.locator(selector).fill(value)
    page.locator("#sOctant").uncheck()
    page.locator("#sSecondPass").uncheck()
    page.locator("#resourceRunEstimate").click()
    page.wait_for_function("()=>estimState.done===true", timeout=60000)
    page.locator("#tab6 .workflow-related [data-related-stage='11']").click()
    page.wait_for_selector("#d3PlotExportPngBtn")
    page.locator("#d3Scale").select_option("linear")
    page.locator("#d3Palette").select_option("viridis")
    page.locator("#d3Rep").select_option("surface")
    page.wait_for_function("()=>d3Plot.data?.some(t=>t.type==='mesh3d')&&blockSectionPlot._fullLayout")


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(controls.Quiet, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    proof = []
    if os.environ.get("OREBIT_PNG_PROOF_DIR"):
        out = Path(os.environ["OREBIT_PNG_PROOF_DIR"])
        out.mkdir(parents=True, exist_ok=True)
        (out / "native-png-proof.json").write_text(json.dumps({"status": "incomplete", "site": str(SITE)}) + "\n")
    try:
        with tempfile.TemporaryDirectory(prefix="native-png-") as temp, sync_playwright() as pw:
            folder = Path(temp)
            files = source_files(folder)
            browser = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                base = f"http://127.0.0.1:{server.server_port}"
                context, core = controls.ready(browser, base, "Core")
                controls.nav(core, 2)
                core.locator("#fileInput").set_input_files([str(p) for p in files.values()])
                core.wait_for_function("()=>STATE.assay.length===48&&!STATE.isSample.assay")
                controls.nav(core, 7)
                core.locator("#tab7 .workflow-actions [data-workflow-next]").click()
                core.wait_for_function("()=>document.getElementById('tab10').classList.contains('active')&&STATE.desurvey")
                core.locator("#tab10 .workflow-actions [data-workflow-next]").click()
                core.wait_for_function("()=>document.getElementById('tab11').classList.contains('active')&&STATE.merged?.length===48")
                core.locator("#tab11 .workflow-actions [data-workflow-next]").click()
                master = download(core, '#tab13 button[onclick="exportMasterCSV()"]', folder / "core-master.csv")
                observe(core)
                check(core.evaluate("typeof plotlyToImageWhiteBg==='function'"), "Core loads the shared export owner")
                # Core's ZIP is the native vector-chart route; panel captures use html2canvas.
                before = core.evaluate(RAW)
                plots = core.evaluate("()=>_orebitGetPlotIds('core').filter(id=>document.getElementById(id)?.data)")
                live = {chart: core.evaluate(SNAPSHOT, chart) for chart in plots}
                archive = download(core, '#tab13 button[onclick="saveAllPlotsZip()"]', folder / "core-plots.zip")
                check(archive.read_bytes().startswith(b"PK") and core.evaluate("__pngInputs.length>0&&__pngInputs.every(x=>x.detached)"), "Core native plot ZIP uses private snapshots")
                check(core.evaluate(RAW) == before and core.evaluate("__pngLiveRelayout===0"), "Core plot ZIP preserves raw sources and live plot layout")
                check(all(core.evaluate(SNAPSHOT, chart) == value for chart, value in live.items()), "Core ZIP retains exact live data/layout for every exported chart")
                with zipfile.ZipFile(archive) as packed:
                    images = [name for name in packed.namelist() if name.endswith('.png')]
                    check(len(images) == len(plots) and all(packed.read(name).startswith(b'\x89PNG') for name in images), "Core native ZIP contains every rendered candidate PNG")
                check(not core.audit_errors and not core.evaluate('__largeExtentFailures.length'), "Core native exports have no page or swallowed-render failure")
                context.close()

                context, assay = controls.ready(browser, base, "Assay")
                controls.nav(assay, 2)
                assay.locator("#fileInput").set_input_files(str(master))
                assay.wait_for_function("()=>DATA.rows.length===48&&currentTab===3")
                controls.nav(assay, 8)
                assay.wait_for_function("()=>statHist._fullLayout&&!_plotQueueRunning&&!_plotQueue.length")
                observe(assay)
                proof.append(export_png(assay, "statHist", "#statHistExportPngBtn", folder / "assay-histogram.png"))
                controls.nav(assay, 13)
                composites = download(assay, "#tab13 button[onclick='exportMasterForEstimation()']", folder / "assay-composites.csv")
                check(not assay.audit_errors and not assay.evaluate('__largeExtentFailures.length'), "Assay native exports have no page or swallowed-render failure")
                context.close()

                for language, width in [("en", 1440), ("id", 390)]:
                    context, page = controls.ready(browser, base, "Resource", {"width": width, "height": 1000}, language)
                    controls.nav(page, 2)
                    page.locator("#fileInput").set_input_files(str(composites))
                    page.wait_for_function("()=>DATA.rows.length===48")
                    if width < 1080:
                        page.locator('#mobileBottomNav [data-group="home"]').click()
                        page.wait_for_selector('#tab1.active')
                    else:
                        controls.nav(page, 1)
                    if width < 1080:
                        page.locator('.orebit-avatar').click()
                        page.locator('.orebit-profile-menu [data-act="theme"]').click()
                        page.wait_for_function("()=>document.documentElement.dataset.theme==='dark'")
                    resource_view(page)
                    observe(page)
                    check(page.evaluate("DATA.rows.length===48&&gradeUnitFor(setupState.element)==='g/t'&&estimState.results.estimated>0"), "Resource viewer retains uploaded full population and physical gold units")
                    for chart in ["d3Plot", "blockSectionPlot"]:
                        proof.append(export_png(page, chart, "#" + chart + "ExportPngBtn", folder / f"{chart}-{language}-{width}.png"))
                    before = page.evaluate(SNAPSHOT, "blockSectionPlot")
                    page.evaluate("()=>{window.__pngImageOwner=Plotly.toImage;Plotly.toImage=()=>Promise.reject(new Error('png-failure-probe'));}")
                    page.locator("#blockSectionPlotExportPngBtn").click()
                    page.get_by_text(page.evaluate("t('res.exportChartPNG.exportFailed')"), exact=True).last.wait_for()
                    check(page.evaluate(SNAPSHOT, "blockSectionPlot") == before, "Failed native export retains plot/filter/data and permits retry")
                    check(not page.locator("#blockSectionPlotExportPngBtn").is_disabled(), "Failed export restores the actual export button")
                    page.evaluate("()=>{Plotly.toImage=__pngImageOwner;}")
                    check(not page.audit_errors and not page.evaluate("__largeExtentFailures.length"), "Resource native exports have no page or swallowed-render failure")
                    context.close()
            finally:
                browser.close()
            if os.environ.get("OREBIT_PNG_PROOF_DIR"):
                out = Path(os.environ["OREBIT_PNG_PROOF_DIR"])
                out.mkdir(parents=True, exist_ok=True)
                for record in proof:
                    (out / record["file"]).write_bytes((folder / record["file"]).read_bytes())
                (out / "native-png-proof.json").write_text(json.dumps({"status": "passed", "site_hashes": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in SITE.glob("*.html")}, "checks": PASSED, "native_images": proof, "source": "Synthetic six-hole four-table CSV; actual UI handoff/estimation", "site": str(SITE)}, indent=2) + "\n")
    finally:
        server.shutdown()
        server.server_close()
    print("NATIVE PNG EXPORT:", PASSED, "passed", flush=True)


if __name__ == "__main__":
    main()
