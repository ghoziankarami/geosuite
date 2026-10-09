"""Native Assay master uploads retain large Resource extents and grid controls.

Uses deterministic synthetic data, actual navigation/import/export controls and
the existing calculation owners. RESOURCE_LARGE_EXTENT_SITE (or OREBIT_TEST_DIST)
can select an immutable built artifact for a removed-fix control. Owns its server.
Wall time is reported, not used as a machine-dependent performance assertion.
"""
import csv
import functools
import http.server
import math
import os
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists())
SITE = Path(os.environ.get("RESOURCE_LARGE_EXTENT_SITE", os.environ.get("OREBIT_TEST_DIST", ROOT / "dist")))
N = 150000
EXPECTED = [[0, 99 * 45.3], [-49 * 51.9, 0], [-29.5, -0.5]]
PASSED = 0


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check(condition, message):
    global PASSED
    assert condition, message
    PASSED += 1
    print("PASS: " + message, flush=True)


def nav(page, number):
    # These are main stages in both modules; never force hidden navigation.
    target = page.locator(f'nav.tabs .tab[onclick="showTab({number})"]')
    check(target.is_visible(), f"stage {number} is reachable in the main navigation")
    target.click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=number)


def ready(browser, base, module):
    context = browser.new_context(accept_downloads=True, service_workers="block", viewport={"width":1440,"height":1000})
    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
    page = context.new_page()
    page.audit_errors = []
    page.on("pageerror", lambda error: page.audit_errors.append(str(error)))
    page.goto(base + "/" + module + ".html")
    page.wait_for_function("()=>window.__i18nBooted===true")
    # Open real first-run controls when this build does not open them itself.
    if not page.locator(".lang-picker-overlay").is_visible():
        page.locator("#lang-switch").click()
    page.locator('.lang-picker-overlay [data-pick="en"]').click()
    if not page.locator(".tour-skip").is_visible():
        page.locator("button.orebit-help-bubble").click()
        page.locator('.orebit-help-menu [data-action="tour"]').click()
    page.locator(".tour-skip").click()
    page.wait_for_function("()=>!window._tourActive&&!document.querySelector('.lang-picker-overlay')")
    page.evaluate("""()=>{
      window.__largeExtentFailures=[];
      const owner=window.safeRender;
      window.safeRender=(label,fn)=>owner(label,()=>{
        try{return fn()}catch(error){__largeExtentFailures.push(String(label)+': '+error.message);throw error}
      });
      safeRender('large-extent-canary',()=>{throw Error('large-extent-canary')});
    }""")
    check(page.evaluate("__largeExtentFailures.splice(0).some(x=>x.includes('large-extent-canary'))"), module + " swallowed-render detector has a live canary")
    return context, page


def native_master(browser, base, folder):
    source = folder / "synthetic-large-assay.csv"
    with source.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "lithology", "domain", "au_gpt", "cu_pct"])
        for i in range(N):
            hole, depth = divmod(i, 30)
            grade = 1 if hole % 2 else 10
            writer.writerow([f"H{hole}", depth, depth + 1, (hole % 100) * 45.3, -(hole // 100) * 51.9, -depth - 0.5, "HOST", "A" if hole % 2 else "B", grade, grade * 0.2])
    context, page = ready(browser, base, "Assay")
    try:
        nav(page, 2)
        page.locator("#fileInput").set_input_files(str(source))
        page.wait_for_function("(n)=>DATA.rows.length===n&&currentTab===3", arg=N, timeout=60000)
        nav(page, 11)
        with page.expect_download(timeout=60000) as result:
            page.locator('#tab11 button[onclick="exportMasterForEstimation()"]:visible').click()
        master = folder / "native-assay-master.csv"
        result.value.save_as(str(master))
        text = master.read_text()
        check("orebit-schema=v1 source=phase2-eda composite=1m" in text and "# units: au_gpt=gpt, cu_pct=pct" in text, "native Assay export records its 1m composite owner and both grade units")
        count = 0
        grade_sum = 0
        holes = set()
        bounds = [[math.inf, -math.inf] for _ in range(3)]
        with master.open() as handle:
            for row in csv.DictReader(line for line in handle if not line.startswith("#")):
                count += 1
                holes.add(row["hole_id"])
                grade_sum += float(row["au_gpt"])
                for axis, column in enumerate(["midx", "midy", "midz"]):
                    value = float(row[column])
                    bounds[axis][0] = min(bounds[axis][0], value)
                    bounds[axis][1] = max(bounds[axis][1], value)
        check(count == N and len(holes) == 5000 and grade_sum / count == 5.5, "native master retains all 150,000 composites, 5,000 holes and the independent 5.5 g/t grade mean")
        check(bounds == EXPECTED, "native master retains independently generated zero and negative coordinate bounds")
        check(not page.audit_errors and not page.evaluate("__largeExtentFailures"), "large native Assay upload/export has no page or swallowed-render failure")
        return master, bounds
    finally:
        context.close()


def inspect_grid(page, bounds):
    result = page.evaluate("""()=>({
      bounds:_resourceExtents(getSamples()), rows:DATA.rows.length,samples:getSamples().length,
      unit:gradeUnitFor(setupState.element),preview:_blockGridStats(75,75,8),
      unchanged:window.__largeExtentRaw===JSON.stringify(DATA.rows),failures:__largeExtentFailures
    })""")
    check(result["bounds"] == bounds, "full Resource sample bounds match the independent oracle")
    dims = [math.ceil((hi - lo) / size) + 1 for (lo, hi), size in zip(bounds, [75, 75, 8])]
    check([result["preview"][key] for key in ["nx", "ny", "nz"]] == dims and result["preview"]["total"] == math.prod(dims), "existing grid preview uses the complete independently bounded population")
    check(result["rows"] == N and result["samples"] == N and result["unit"] == "g/t" and result["unchanged"] and not result["failures"], "extent mode changes preserve every raw row, eligible sample and assigned unit")


def main():
    started = time.perf_counter()
    complete = False
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with tempfile.TemporaryDirectory(prefix="resource-large-extent-") as temp, sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                master, bounds = native_master(browser, base, Path(temp))
                context, page = ready(browser, base, "Resource")
                nav(page, 2)
                page.locator("#fileInput").set_input_files(str(master))
                page.wait_for_function("(n)=>DATA.rows.length===n&&DATA.name==='native-assay-master.csv'", arg=N, timeout=60000)
                page.evaluate("window.__largeExtentRaw=JSON.stringify(DATA.rows)")
                # Real navigation catches failures that safeRender deliberately swallows.
                nav(page, 5)
                failures = page.evaluate("__largeExtentFailures")
                check(not failures, "Block Model main navigation renders the uploaded population: " + str(failures))
                check(page.locator("#bmX").is_visible() and page.locator("#bmGenBtn").is_visible(), "large upload exposes real editable block controls and Generate Grid")
                inspect_grid(page, bounds)
                edges = page.evaluate("""()=>{
                  const points=[{x:0,y:-30,z:0},{x:-50,y:0,z:-100},{x:15,y:-5,z:9},{x:NaN,y:Infinity,z:-Infinity},{x:undefined,y:undefined,z:undefined},{x:'-11',y:'19',z:'0'}];
                  const before=JSON.stringify(points),result=_resourceExtents(points);
                  const signed=_resourceExtents([{x:-0,y:0,z:-0},{x:0,y:-0,z:0}]);
                  const empty=_resourceExtents([]);
                  return {result,unchanged:before===JSON.stringify(points),signed:signed.every(a=>Object.is(a[0],-0)&&Object.is(a[1],0)),empty:empty.every(a=>a[0]===Infinity&&a[1]===-Infinity)};
                }""")
                check(edges["result"] == [[-50,15],[-30,19],[-100,9]] and edges["unchanged"] and edges["signed"] and edges["empty"], "extent owner retains zero, signed zero, negative and numeric-string values while filtering nonfinite fields without mutation")
                page.locator("#blockAdvanced > summary").click()
                page.locator("#bmExtentMode").select_option("buffered")
                page.locator("#blockAdvanced > summary").click()
                page.locator("#bmExtentBuffer").fill("17.5")
                page.locator("#bmExtentBuffer").press("Tab")
                inspect_grid(page, [[lo - 17.5, hi + 17.5] for lo, hi in bounds])
                page.locator("#blockAdvanced > summary").click()
                page.locator("#bmExtentMode").select_option("sample")
                inspect_grid(page, bounds)
                for selector, value in [("#bmX","75"),("#bmY","75"),("#bmZ","8")]:
                    page.locator(selector).fill(value)
                check(page.locator("#blockPreview").inner_text().strip() != "", "actual size edits refresh the visible grid preview")
                page.locator("#bmGenBtn").click()
                page.wait_for_function("()=>!!blockState.blocks?.length", timeout=60000)
                grid = page.evaluate("""()=>({
                  dims:blockState.dims,origin:blockState.origin,size:blockState.size,count:blockState.blocks.length,
                  aligned:blockState.blocks.every(b=>['cx','cy','cz'].every((k,a)=>Math.abs((b[k]-blockState.origin[a])/blockState.size[a]-.5-Math.round((b[k]-blockState.origin[a])/blockState.size[a]-.5))<1e-8)),
                  unchanged:window.__largeExtentRaw===JSON.stringify(DATA.rows),unit:gradeUnitFor(setupState.element),failures:__largeExtentFailures
                })""")
                dims = [math.ceil((hi-lo)/size)+1 for (lo,hi),size in zip(bounds,[75,75,8])]
                check(grid["dims"] == dims and grid["origin"] == [a[0] for a in bounds] and grid["size"] == [75,75,8] and 0 < grid["count"] <= math.prod(dims) and grid["aligned"], "Generate Grid executes the existing owner with the chosen dimensions, origin and cell centres")
                check(grid["unchanged"] and grid["unit"] == "g/t" and not grid["failures"] and not page.audit_errors, "grid generation retains all raw grades/coordinates and units without hidden failures")
                context.close()
                complete = True
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        print(f"RESOURCE LARGE EXTENT: {'PASS' if complete else 'FAILED'}; {PASSED} checks passed; {time.perf_counter()-started:.1f}s wall time", flush=True)


if __name__ == "__main__":
    main()
