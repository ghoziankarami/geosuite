"""Uploaded labels stay literal through Resource preview, calculation and project reopen.

Uses only synthetic data and harmless in-page markers, blocks external requests,
and owns its temporary server. RESOURCE_SECURITY_TEST_SITE supports an immutable
artifact or a removed-fix control; the default is the canonical built dist/.
"""
import csv
import functools
import http.server
import json
import os
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists())
SITE = Path(os.environ.get("RESOURCE_SECURITY_TEST_SITE", ROOT / "dist"))
PAYLOAD = '</textarea><img src=x onerror="window.__resourceInputMarker=(window.__resourceInputMarker||0)+1">DOMAIN<&\'"'
PASSED = 0
FAILURES = []


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check(condition, message):
    global PASSED
    if condition:
        PASSED += 1
        print("PASS: " + message, flush=True)
    else:
        FAILURES.append(message)
        print("FAIL: " + message, flush=True)


def nav(page, number):
    target = page.locator(f'nav.tabs .tab[onclick="showTab({number})"]')
    if not target.is_visible():
        page.locator("nav.tabs .screening-advanced-toggle").click()
    target.click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=number)


def ready(context, base):
    page = context.new_page()
    page.audit_errors = []
    page.on("pageerror", lambda err: page.audit_errors.append(str(err)))
    page.goto(base + "/Resource.html")
    page.wait_for_function("()=>window.__i18nBooted===true")
    if page.locator(".lang-picker-overlay").count():
        page.locator('.lang-picker-overlay [data-pick="en"]').click()
    page.evaluate("""()=>{
      window.__resourceInputMarker=0;window.__resourceInputFailures=[];
      const owner=window.safeRender;
      window.safeRender=(name,fn)=>owner(name,()=>{
        try{return fn();}catch(e){window.__resourceInputFailures.push(name+': '+e.message);throw e;}
      });
      safeRender('resource-input-canary',()=>{throw Error('resource-input-canary');});
    }""")
    check(page.evaluate("window.__resourceInputFailures.splice(0).some(x=>x.includes('resource-input-canary'))"), "swallowed-render detector has a live canary")
    return page


def literal_boundary(page, selector, marker, message):
    page.wait_for_timeout(150)
    result = page.locator(selector).evaluate("""el=>({
      elements:el.querySelectorAll('img,script,iframe').length,
      text:el.tagName==='TEXTAREA'?el.value:el.textContent,
      marker:window.__resourceInputMarker
    })""")
    check(result["elements"] == 0 and PAYLOAD in result["text"] and result["marker"] == marker, message)


def select_domain(page):
    nav(page, 3)
    marker = page.evaluate("window.__resourceInputMarker")
    page.locator("#setupDomain").select_option(PAYLOAD)
    literal_boundary(page, "#elementSummary", marker, "selected domain remains literal text without executing markup")


def calculate(page):
    nav(page, 4)
    page.locator("#variogramSampling > summary").click()
    page.locator("#varDir").select_option("vert")
    page.locator("#varLag").fill("2")
    page.locator("#varMaxH").fill("20")
    page.locator('#tab4 button[onclick="computeVariogram()"]').click()
    page.wait_for_function("()=>!!variogramState.experimental")
    for details in page.locator("#varNugget").locator("xpath=ancestor::details").all():
        if details.get_attribute("open") is None:
            details.locator(":scope > summary").click()
    for selector, value in [("#varNugget", "0.01"), ("#varSill", "0.1"), ("#varRange", "100")]:
        page.locator(selector).fill(value)
    page.locator('#tab4 button[onclick="updateModel()"]').click()
    page.wait_for_function("()=>!!variogramState.model")
    nav(page, 5)
    for selector, value in [("#bmX", "25"), ("#bmY", "25"), ("#bmZ", "5")]:
        page.locator(selector).fill(value)
    page.locator("#bmGenBtn").click()
    page.wait_for_function("()=>!!blockState.blocks?.length")
    nav(page, 6)
    for selector in ["#srMaj", "#srSemi", "#srMin"]:
        page.locator(selector).fill("100")
    page.locator("#resourceRunEstimate").click()
    page.wait_for_function("()=>estimState.done", timeout=30000)
    check(page.evaluate("estimState.results.estimated>0"), "real uploaded samples produce an estimate through existing controls")
    nav(page, 9)
    page.locator('#tab9 button[onclick="runClassification()"]').click()
    page.wait_for_function("()=>!!classState.labels")
    marker = page.evaluate("window.__resourceInputMarker")
    nav(page, 12)
    literal_boundary(page, "#kcmiNarrative", marker, "report textarea preserves the complete domain without a closing-tag injection")


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with tempfile.TemporaryDirectory(prefix="resource-input-security-") as temp, sync_playwright() as pw:
            folder = Path(temp)
            fixture = folder / "synthetic-resource-labels.csv"
            rows = []
            for hole, (x, y) in enumerate([(0, 0), (50, 0), (0, 50), (50, 50)]):
                for interval in range(10):
                    rows.append([f"AUDIT{hole + 1}<&'\"", interval, interval + 1, 500000 + x, 9000000 + y, 100 - interval, "ORE<&'\"", PAYLOAD, 1 + interval / 100 + hole / 20])
            for domain in ["__proto__", "constructor", "toString"]:
                rows.append(["OTHER", 0, 1, 500025, 9000025, 100, "ORE", domain, 1])
            with fixture.open("w", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "lithology", "domain", "ni_pct"])
                writer.writerows(rows)
            browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
            context = browser.new_context(accept_downloads=True, viewport={"width":1440,"height":1000})
            context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
            page = ready(context, base)
            nav(page, 2)
            page.locator("#fileInput").set_input_files(str(fixture))
            page.wait_for_function("()=>DATA.name==='synthetic-resource-labels.csv'&&DATA.rows.length===43")
            literal_boundary(page, "#tab2 #dataPreview", 0, "CSV upload preview shows literal labels and never executes a handler")
            preview = page.locator("#tab2 #dataPreview").inner_text()
            check(all("D" + name + "=1" in preview for name in ["__proto__", "constructor", "toString"]), "all arbitrary domain labels retain their true counts")
            check(page.evaluate("p=>DATA.rows.filter(r=>rowVal(r,'domain')===p).length===40", PAYLOAD), "import keeps every original domain value in the analytical data")
            select_domain(page)
            calculate(page)
            for language in ["id", "en"]:
                marker = page.evaluate("window.__resourceInputMarker")
                page.evaluate("lang=>applyLanguage(lang)", language)
                literal_boundary(page, "#kcmiNarrative", marker, language + " report redraw keeps the uploaded label inert")
            nav(page, 2)
            page.locator("button.orebit-avatar").click()
            page.once("dialog", lambda dialog: dialog.accept("synthetic-resource-labels.orebit"))
            with page.expect_download() as result:
                page.locator('.orebit-profile-menu [data-act="export"]').click()
            project = folder / "synthetic-resource-labels.orebit"
            result.value.save_as(str(project))
            bundle = json.loads(project.read_text())
            domain_index = bundle["data"]["cols"].index("domain")
            check(sum(row[domain_index] == PAYLOAD for row in bundle["data"]["rows"]) == 40, "native project retains exact uploaded domain values")
            reopened = ready(context, base)
            nav(reopened, 2)
            with reopened.expect_file_chooser() as chooser:
                reopened.locator('#tab2 button[onclick="importBundle()"]').click()
            chooser.value.set_files(str(project))
            reopened.wait_for_function("()=>DATA.rows.length===43&&DATA.name==='synthetic-resource-labels.csv'")
            literal_boundary(reopened, "#tab2 #dataPreview", 0, "native project reopen renders labels literally without executing markup")
            select_domain(reopened)
            check(page.evaluate("window.__resourceInputMarker===0") and reopened.evaluate("window.__resourceInputMarker===0"), "no uploaded script ran anywhere in either browser page")
            for current in [page, reopened]:
                check(not current.audit_errors and current.evaluate("window.__resourceInputFailures.length===0"), "workflow produces no page or swallowed-render failures")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f"RESOURCE INPUT SECURITY: {PASSED} passed, {len(FAILURES)} failed", flush=True)
    if FAILURES:
        raise AssertionError("; ".join(FAILURES))


if __name__ == "__main__":
    main()
