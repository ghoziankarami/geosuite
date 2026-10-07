"""Real-browser checks for Resource disclosure, action effects and small-screen reading."""

import functools, http.server, json, os, threading
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


evidence = (
    Path(os.environ["OREBIT_UX_EVIDENCE"])
    if os.environ.get("OREBIT_UX_EVIDENCE")
    else None
)
if evidence:
    evidence.mkdir(parents=True, exist_ok=True)
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name in ("Core", "Assay", "Resource"):
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{server.server_port}/{name}.html")
            page.wait_for_function("() => window.__i18nBooted===true")
            page.evaluate(
                "document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove());applyLanguage('en');"
            )
            page.evaluate("""() => {
              window.__uxRenderFailures=[];
              if (typeof safeRender==='function') {
                const original=safeRender;
                window.safeRender=(label,fn)=>original(label,()=>{
                  try { const value=fn(); if(value?.catch) return value.catch(e=>{window.__uxRenderFailures.push(String(label)+': '+e.message);throw e;}); return value; }
                  catch(e){window.__uxRenderFailures.push(String(label)+': '+e.message);throw e;}
                });
                safeRender('UX canary',()=>{throw new Error('UX canary');});
              }
            }""")
            if page.evaluate("typeof safeRender==='function'"):
                check(
                    "UX canary"
                    in " ".join(page.evaluate("window.__uxRenderFailures.splice(0)")),
                    name + " swallowed-render detector catches its canary",
                )
            if name == "Core":
                page.evaluate("showTab(3)")
                page.locator(
                    '.next-step button[data-action-role="next"]'
                ).first.wait_for()
                check(
                    page.locator('.next-step button[data-action-role="next"]').count()
                    > 0,
                    "Core next action has an explicit shared role",
                )
            if name == "Assay":
                page.wait_for_function(
                    '() => document.body.classList.contains("assay-guided")'
                )
                page.evaluate("showTab(8)")
                check(
                    page.locator(
                        '.assay-workflow-card button[data-action-role="inspect"]'
                    ).count()
                    > 0,
                    "Assay inspect action is separate from continue",
                )
                next_button = page.locator(
                    '#tab8 .assay-workflow-card button[data-action-role="next"]'
                )
                check(
                    next_button.count() == 1,
                    "Assay has one primary continue action in a review stage",
                )
                old = page.evaluate("JSON.stringify(window._capLog||{})")
                if evidence:
                    page.screenshot(
                        path=str(evidence / "assay-actions-desktop.png"), full_page=True
                    )
                page.locator(
                    '#tab8 .assay-workflow-card button[data-action-role="custom"]'
                ).click()
                check(
                    page.evaluate("JSON.stringify(window._capLog||{})") == old,
                    "Opening custom controls does not apply grade treatment",
                )
                check(
                    page.locator("#assayAdvancedToggle").get_attribute(
                        "data-action-role"
                    )
                    == "advanced",
                    "Advanced navigation has its own role",
                )
            if name == "Resource":
                page.evaluate("showTab(3)")
                check(
                    not page.locator("#resourceSetupInspect").evaluate("(e)=>e.open"),
                    "Resource inspection is initially collapsed",
                )
                check(
                    not page.locator("#resourceSetupAdvanced").evaluate("(e)=>e.open"),
                    "Resource advanced diagnostics are initially collapsed",
                )
                check(
                    page.locator("#setupElement").is_visible()
                    and page.locator("#setupDomain").is_visible()
                    and page.locator("#setupGradeUnit").is_visible(),
                    "Element, domain and unit remain directly editable",
                )
                check(
                    page.locator("#resourceSetupQuickInsight").inner_text().count("\n")
                    >= 2,
                    "Resource shows a compact valid-grade summary",
                )
                state = page.evaluate(
                    "JSON.stringify({element:setupState.element,domain:setupState.domain,unit:setupState.gradeUnit,decluster:setupState.decluster})"
                )
                if evidence:
                    page.screenshot(
                        path=str(evidence / "resource-setup-simple-desktop.png"),
                        full_page=True,
                    )
                page.locator("#resourceSetupInspect>summary").click()
                page.wait_for_function(
                    "() => document.getElementById('setupSpatialMap').classList.contains('js-plotly-plot')"
                )
                check(
                    page.locator("#elementSummary").is_visible(),
                    "Full statistics are available in Inspect data",
                )
                page.locator("#resourceSetupAdvanced>summary").click()
                check(
                    page.locator("#declusterCell").is_visible()
                    and page.locator("#topCutVal").is_visible(),
                    "Both optional diagnostics remain usable",
                )
                check(
                    page.evaluate(
                        "JSON.stringify({element:setupState.element,domain:setupState.domain,unit:setupState.gradeUnit,decluster:setupState.decluster})"
                    )
                    == state,
                    "Disclosure does not change effective estimation settings",
                )
                check(
                    page.locator(".resource-inspect-grid").evaluate(
                        "e=>getComputedStyle(e).gridTemplateColumns.split(' ').length===1"
                    ),
                    "Setup plots have one reading column",
                )
                if evidence:
                    page.screenshot(
                        path=str(evidence / "resource-setup-inspect-desktop.png"),
                        full_page=True,
                    )
                page.evaluate("applyLanguage('id')")
                check(
                    "Variografi" in page.locator("#resourceSetupNext").inner_text(),
                    "Primary Resource CTA is translated",
                )
                page.set_viewport_size({"width": 320, "height": 900})
                page.wait_for_timeout(300)
                check(
                    page.evaluate(
                        "document.documentElement.scrollWidth<=window.innerWidth+1"
                    ),
                    "Resource Setup does not overflow a 320px viewport",
                )
                if evidence:
                    page.screenshot(
                        path=str(evidence / "resource-setup-mobile.png"), full_page=True
                    )
                page.locator("#resourceSetupNext").click()
                check(
                    page.evaluate("currentTab") == 4,
                    "Primary next CTA opens the existing Variography stage",
                )
                page.set_viewport_size({"width": 1440, "height": 1000})
                page.wait_for_timeout(300)
                check(
                    page.locator("#varPlot").evaluate(
                        "e=>getComputedStyle(e.parentElement.parentElement).gridTemplateColumns.split(' ').length===1"
                    ),
                    "Variography uses one plot reading column before computation",
                )
                for stage in range(4, 13):
                    page.evaluate(f"showTab({stage})")
                    page.wait_for_timeout(180)
                    check(
                        page.locator(
                            ".panel.active :is(.grid-2,.grid-3,.fb-grid):has(.plot-container,.js-plotly-plot)"
                        ).evaluate_all(
                            "els=>els.every(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length===1)"
                        ),
                        f"Resource stage {stage} does not put plots side by side",
                    )
                # Keyboard disclosure and focus must remain visible independently of color.
                page.evaluate("showTab(3)")
                page.locator("#resourceSetupAdvanced>summary").focus()
                page.keyboard.press("Enter")
                check(
                    not page.locator("#resourceSetupAdvanced").evaluate("(e)=>e.open"),
                    "Advanced disclosure supports keyboard interaction",
                )
                page.evaluate("applyLanguage('en');showTab(2)")
                csv_text = "hole_id,from_m,to_m,midx,midy,midz,au_gpt,domain\nH0,0,1,100,200,10,0,D1\nH1,0,1,110,200,10,1,D1\nH2,0,1,120,200,10,,D1\n"
                page.locator("#fileInput").set_input_files(
                    {
                        "name": "missing-grade.csv",
                        "mimeType": "text/csv",
                        "buffer": csv_text.encode(),
                    }
                )
                page.wait_for_function("() => DATA.rows.length===3")
                page.evaluate("showTab(3)")
                page.locator("#resourceSetupInspect").evaluate("(e)=>e.open=true")
                page.wait_for_function(
                    "() => document.getElementById('setupSpatialMap').data?.length===2"
                )
                traces = page.evaluate(
                    "document.getElementById('setupSpatialMap').data.map(r=>({color:r.marker.color,text:r.text,x:r.x}))"
                )
                check(
                    traces[0]["color"] == [0, 1],
                    "Map retains a measured zero grade as a real numeric value",
                )
                check(
                    traces[1]["color"] == "#8794a8"
                    and traces[1]["x"] == [120]
                    and "Grade not measured" in traces[1]["text"][0],
                    "Unmeasured grades are separate gray points instead of numeric zero",
                )
            if name in ("Assay", "Resource"):
                page.evaluate("showTab(2)")
                raw = "hole_id,from_m,to_m,midx,midy,midz,ni_pct,au_gpt,domain\nZ1,0,1,100,200,10,0,,D1\nZ2,0,1,110,200,10,0,,D1\nZ3,0,1,120,200,10,0,,D1\n"
                page.locator("#fileInput").set_input_files(
                    {
                        "name": "measured-zero.csv",
                        "mimeType": "text/csv",
                        "buffer": raw.encode(),
                    }
                )
                page.wait_for_function("() => DATA.rows.length===3")
                detected = page.evaluate(
                    "availableElements()"
                    if name == "Assay"
                    else "detectActiveElements()"
                )
                check(
                    "ni_pct" in detected,
                    name + " retains a grade column containing only measured zeros",
                )
                check(
                    "au_gpt" not in detected,
                    name + " excludes an entirely unmeasured schema column",
                )
            check(
                not page.evaluate("window.__uxRenderFailures"),
                name + " has no swallowed renderer failures",
            )
            check(not errors, name + " has no page errors")
            page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print("ACTION HIERARCHY:", passed, "passed", flush=True)
