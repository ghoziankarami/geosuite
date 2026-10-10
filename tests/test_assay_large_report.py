"""Real large Assay report/PDF, exact support, bounded work and editable treatments.

Owns its HTTP server. ASSAY_LARGE_REPORT_SITE or OREBIT_TEST_DIST can select a
built artifact for removed-fix controls. No timing threshold or analysis thinning.
"""
import csv
import functools
import http.server
import importlib.util
import os
import tempfile
import threading
import time
from pathlib import Path

import fitz
from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").is_file())
SITE = Path(os.environ.get("ASSAY_LARGE_REPORT_SITE", os.environ.get("OREBIT_TEST_DIST", ROOT / "dist")))
# Reuse the tested first-run controls and live safeRender canary, never force tabs.
_spec = importlib.util.spec_from_file_location("large_extent_controls", Path(__file__).with_name("test_resource_large_extent.py"))
controls = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(controls)
N = 150000
PASSED = 0


def check(condition, message):
    global PASSED
    assert condition, message
    PASSED += 1
    print("PASS: " + message, flush=True)


def settled(page):
    page.wait_for_function("()=>!window._domainValidationTimer&&!_plotQueueRunning&&!_plotQueue.length", timeout=45000)


def upload(page, source, rows):
    controls.nav(page, 2)
    page.locator("#fileInput").set_input_files(str(source))
    page.wait_for_function("(n)=>DATA.rows.length===n&&currentTab===3", arg=rows, timeout=60000)


def main():
    started = time.perf_counter()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(controls.Quiet, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="assay-large-report-") as temp, sync_playwright() as pw:
            folder = Path(temp)
            small = folder / "support-known-answer.csv"
            small.write_text("hole_id,from_m,to_m,au_gpt,cu_pct,lithology,domain,density,midx,midy\n"
                             "A,0,1,0,,L1,D1,2,0,0\nA,1,2,10,2,L2,D2,4,0,0\n"
                             "B,0,0.2,8,1,L1,D1,3,10,-10\nC,0,1,2,1,L1,D1,2,20,-20\n"
                             "C,0.5,1.5,6,3,L1,D1,4,20,-20\n")
            source = folder / "synthetic-150k.csv"
            with source.open("w", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "lithology", "domain", "au_gpt", "cu_pct"])
                for i in range(N):
                    hole, depth = divmod(i, 30)
                    grade = 1 if hole % 2 else 10
                    writer.writerow([f"H{hole}", depth, depth + 1, (hole % 100) * 45.3,
                                     -(hole // 100) * 51.9, -depth - 0.5, "HOST",
                                     "A" if hole % 2 else "B", grade, grade * .2])
            browser = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                context, page = controls.ready(browser, f"http://127.0.0.1:{server.server_port}", "Assay")
                upload(page, small, 5)
                answer = page.evaluate("computeComposites(2,.5,true,false)")
                comps = answer["composites"]
                check(len(comps) == 3 and [c["au_gpt_comp"] for c in comps] == [0, 10, 4], "independent zero-grade/contact/overlap composite answers")
                check([c["density_comp"] for c in comps] == [2, 4, 3] and [c["domain_dominant"] for c in comps] == ["D1", "D2", "D1"], "density support and domain contacts retain their scientific owners")
                check(answer["droppedTailLength"] == .2 and answer["droppedHoles"] == ["B"] and answer["overlapCount"] == 1 and comps[2]["coverage"] == 1.333, "short-tail reconciliation and overlap coverage match independent answers")
                upload(page, source, N)
                page.evaluate("""()=>{
                  window.__reportRaw=JSON.stringify(DATA.rows);
                  window.__reportColCalls=0;window.__reportColOwner=colIdx;
                  window.colIdx=function(...args){
                    if(++__reportColCalls>5000000)throw Error('Report full-table work budget exceeded');
                    return __reportColOwner.apply(this,args);
                  };
                }""")
                controls.nav(page, 13)
                state = page.evaluate("""()=>({
                  rows:DATA.rows.length,holes:new Set(DATA.rows.map(r=>r[__reportColOwner('hole_id')])).size,
                  element:primaryElement(),unit:elementMeta(primaryElement()).unit,
                  count:_compositeCache?.composites.length,
                  mean:_compositeCache?.composites.reduce((s,c)=>s+c.au_gpt_comp,0)/DATA.rows.length,
                  length:_compositeCache?.length,minimum:_compositeCache?.minLength,
                  tail:_compositeCache?.droppedTailLength,gap:_compositeCache?.gapLength,
                  overlap:_compositeCache?.overlapCount,dropped:_compositeCache?.droppedHoles.length,
                  checks:runValidationChecks(),dl:_qaqcDetectionLimit('au_gpt'),calls:__reportColCalls,
                  rawUnchanged:__reportRaw===JSON.stringify(DATA.rows),failures:__largeExtentFailures,
                  kcmi:document.getElementById('kcmiCommentary')?.innerText,
                  treatment:document.getElementById('reportTreatment')?.innerText
                })""")
                page.evaluate("window.colIdx=__reportColOwner")
                check(not state["failures"], "actual large Report has no swallowed owner failure")
                check(state["calls"] <= 5000000, "Report and validation use bounded full-population column work")
                check(state["rows"] == N and state["holes"] == 5000 and state["count"] == N and state["mean"] == 5.5, "all150k native rows and composites retain5000 holes and independent mean5.5")
                check(state["length"] == 1 and state["minimum"] == .5 and state["tail"] == state["gap"] == state["overlap"] == state["dropped"] == 0, "default composite support retains every one-metre interval")
                check(state["element"] == "au_gpt" and state["unit"] == "g/t" and state["dl"] == 1 and state["rawUnchanged"], "large report retains the assigned gold unit, exact detection proxy and raw rows")
                check(len(state["checks"]) == 11 and all(c["severity"] == "pass" for c in state["checks"]), "independently complete fixture passes all11 validation checks")
                check(state["kcmi"] and "5000" in state["kcmi"] and "45" in state["kcmi"] and state["treatment"], "actual KCMI and treatment panels render the full population")
                with page.expect_download(timeout=90000) as result:
                    page.locator("#btnReportPdf").click(timeout=90000)
                pdf = folder / "native-report.pdf"
                result.value.save_as(str(pdf))
                with fitz.open(pdf) as document:
                    text = "\n".join(p.get_text() for p in document)
                    check(pdf.read_bytes().startswith(b"%PDF") and len(document) >= 3, "real report action downloads a genuine multi-page PDF")
                    check("150,000" in text and "5000 holes" in text and "5.500" in text and "Au (g/t) | All loaded rows" in text, "native PDF reports full input scope, hole count, mean and units")
                    check("11 checks passed" in text and text.count("[ OK ]") == 11 and "0 failed" in text, "PDF cover passed count matches the11 detailed validation results")
                    check("input 150000.0000m; composite 150000.0000m" in text and "Input 825000.000000; composite 825000.000000" in text, "PDF support and grade-length conservation match independent full-data answers")
                if page.locator(".support-dismiss-btn").is_visible():
                    page.locator(".support-dismiss-btn").click()
                controls.nav(page, 8)
                settled(page)
                check(page.evaluate("statCDF.data[0].x.length<=2500&&statsSummary(DATA.rows.map(r=>r[colIdx('au_gpt')])).n===150000"), "large statistics retain all grades and bound only chart display")
                page.locator("#assayAdvancedToggle").click()
                controls.nav(page, 9)
                settled(page)
                page.locator("#customCut").fill("9")
                page.locator('#tab9 button[onclick="applyTopCut(\'au_gpt\')"]').click()
                controls.nav(page, 13)
                capped = page.evaluate("""()=>({mean:_compositeCache.composites.reduce((s,c)=>s+c.au_gpt_comp,0)/150000,
                  records:dataTreatmentLog(),treatment:reportTreatment.innerText})""")
                check(capped["mean"] == 5 and len(capped["records"]) == 1 and capped["records"][0]["before"]["max"] == 10 and capped["records"][0]["after"]["max"] == 9 and capped["treatment"], "actual cap9 recomputes full composites and renders accurate before/after treatment")
                controls.nav(page, 9)
                page.locator('#tab9 button[onclick="undoTopCut(\'au_gpt\')"]:visible').first.click()
                controls.nav(page, 13)
                check(page.evaluate("__reportRaw===JSON.stringify(DATA.rows)&&_compositeCache.composites.reduce((s,c)=>s+c.au_gpt_comp,0)/150000===5.5"), "actual undo restores raw rows and rebuilds the report without stale grouping")
                controls.nav(page, 11)
                settled(page)
                page.locator("#domainMethodSelect").select_option("spatial")
                settled(page)
                check(page.evaluate("_domainAudit.method==='spatial'&&_domainTagged.length===150000&&new Set(_domainTagged.map(t=>t.domain)).size===4"), "actual spatial-domain control classifies all150k rows without argument overflow")
                page.locator("#domainMethodSelect").select_option("existing")
                settled(page)
                check(page.evaluate("__reportRaw===JSON.stringify(DATA.rows)&&new Set(_domainTagged.map(t=>t.domain)).size===2"), "existing-domain control restores both original labels and every raw value")
                check(not page.audit_errors and not page.evaluate("__largeExtentFailures"), "large report/PDF, cap undo and spatial-domain actions have no page or swallowed-render errors")
                print(f"PASS: {PASSED} large Assay checks in {time.perf_counter()-started:.1f}s", flush=True)
                context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
