"""Real fresh-start, responsive navigation and complete tour journeys.

No forced showTab before initial layout. Keep the actual tour overlay and use
real bottom-nav/drawer buttons. Check rendered controls, not merely overflow
hidden on the page root. OREBIT_TEST_DIST can replay the previous artifact.
"""

import functools, http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = next(
    p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists()
)
DIST = Path(os.environ.get("OREBIT_TEST_DIST", ROOT / "dist"))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(Quiet, directory=str(DIST))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
passed = 0
STAGES = {
    "Core": [2, 7, 10, 11],
    "Assay": [2, 3, 8, 11, 7],
    "Resource": [2, 3, 4, 5, 6, 7, 10],
}
TOUR = {
    "Core": [1, 1, 2, 7, 7, 13],
    "Assay": [1, 2, 3, 8, 11, 13],
    "Resource": [1, 2, 3, 4, 5, 12],
}


def check(ok, msg):
    global passed
    assert ok, msg
    passed += 1
    print("PASS:", msg, flush=True)


def active(page):
    return page.evaluate(
        'Array.from(document.querySelectorAll("nav.tabs .tab")).findIndex(b=>b.classList.contains("active"))+1'
    )


def fits(page, locator):
    r = locator.bounding_box()
    v = page.viewport_size
    return bool(
        r
        and r["width"] > 0
        and r["height"] > 0
        and r["x"] >= -1
        and r["y"] >= -1
        and r["x"] + r["width"] <= v["width"] + 1
        and r["y"] + r["height"] <= v["height"] + 1
    )


def raw(page):
    return page.evaluate(
        'JSON.stringify(typeof DATA!=="undefined"?DATA.rows:[STATE.collar,STATE.survey,STATE.assay,STATE.geology])'
    )


def tour(page, name, language):
    start = active(page)
    before = raw(page)
    page.locator("#mobileTourBtn").click()
    for i, stage in enumerate(TOUR[name]):
        page.wait_for_function(
            '(i)=>document.getElementById("tourStepInfo").textContent.includes(String(i+1))',
            arg=i,
        )
        page.wait_for_timeout(100)
        check(
            active(page) == stage,
            f"{name} {language} tour {i+1} opens its described stage",
        )
        check(
            fits(page, page.locator("#tourCard")),
            f"{name} {language} tour {i+1} card fits the viewport",
        )
        for control in page.locator("#tourCard button:visible").all():
            check(
                fits(page, control) and control.bounding_box()["height"] >= 43,
                f"{name} tour {i+1} controls fit and have touch-sized targets",
            )
        title = page.locator("#tourTitle").inner_text()
        body = page.locator("#tourBody").inner_text()
        check(
            title and body and "tour.p" not in title + body,
            f"{name} {language} tour {i+1} has translated copy",
        )
        target = page.evaluate("(i)=>window.TOUR_STEPS[i].target", i)
        check(
            page.locator(target).evaluate(
                "e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=-1&&r.right<=innerWidth+1}"
            ),
            f"{name} tour {i+1} stage surface fits horizontally",
        )
        check(
            page.locator(target).is_visible(),
            f"{name} tour {i+1} points to an actual visible stage control",
        )
        check(
            page.locator("#tourCard").evaluate(
                "(e)=>e.contains(document.activeElement)"
            ),
            f"{name} tour {i+1} keeps keyboard focus inside the dialog",
        )
        for gate in page.locator(".panel.active .workflow-gate:visible").all():
            check(
                gate.evaluate("e=>getComputedStyle(e).position==='static' && getComputedStyle(e).pointerEvents!=='none'"),
                f"{name} tour {i+1} validation feedback stays in the stage flow",
            )
            check(
                gate.evaluate("e=>{const r=e.getBoundingClientRect(),c=e.closest('.assay-workflow-card').getBoundingClientRect(),next=e.nextElementSibling?.getBoundingClientRect();return r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom&&(!next||next.top>=r.bottom-1)}"),
                f"{name} tour {i+1} feedback does not cover contextual checks",
            )
        if i == 2:
            page.locator("#tourPrev").click()
            check(
                active(page) == TOUR[name][1],
                name + " previous revisits the right stage",
            )
            page.locator("#tourNext").click()
            page.wait_for_timeout(100)
        page.locator("#tourNext").click()
    check(
        not page.locator("#tourOverlay").evaluate('e=>e.classList.contains("open")')
        and active(page) == start,
        name + " Done closes the tour and returns to the original stage",
    )
    check(raw(page) == before, name + " full tour preserves every raw row")
    if name == "Resource":
        check(
            page.evaluate(
                "!blockState.blocks?.length && !estimState.done && !variogramState.model"
            ),
            "Resource tour does not create a grid, fit a model or run an estimate",
        )
    if name == "Core":
        check(
            page.evaluate("STATE.desurvey===null && STATE.merged===null"),
            "Core tour does not calculate geometry or merge invalid records",
        )
    if name == "Assay":
        check(
            page.evaluate("!Object.keys(window._capLog||{}).length"),
            "Assay tour does not apply a top-cut",
        )


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name in ("Core", "Assay", "Resource"):
            for width, height in (
                (1440, 1000),
                (320, 568),
                (390, 844),
                (768, 1024),
                (1024, 768),
            ):
                page = browser.new_page(
                    viewport={"width": width, "height": height},
                    is_mobile=width < 1080,
                    has_touch=width < 1080,
                )
                page.add_init_script("localStorage.setItem('orebit.lang','en')")
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(f"http://127.0.0.1:{server.server_port}/{name}.html")
                page.wait_for_function("()=>window.__i18nBooted===true")
                page.wait_for_timeout(800)
                if page.locator(".lang-picker-overlay").count():
                    page.locator('.lang-picker-overlay [data-pick="en"]').click()
                check(
                    active(page) == 1, name + " opens Dashboard without a forced render"
                )
                check(
                    page.evaluate(
                        "Array.from(document.body.childNodes).filter(n=>n.nodeType===3).every(n=>!/@media|\\.mobile-nav-drawer/.test(n.textContent))"
                    ),
                    name + " shell styles are CSS rather than leaked page text",
                )
                if name == "Core":
                    check(
                        "Synthetic sample"
                        in page.locator("#dashQualitySub").inner_text(),
                        "Core explains default findings as synthetic validation evidence",
                    )
                    check(
                        page.locator(".toast").count() == 0,
                        "Core initial load does not cover the start action with a reset toast",
                    )
                check(
                    page.evaluate("()=>{const e=document.createElement('p');e.setAttribute('role','status');e.textContent='Live status regression';document.querySelector('.panel.active').append(e);const s=getComputedStyle(e),ok=s.position==='static'&&s.pointerEvents!=='none';e.remove();return ok}"),
                    name + " an inline live status is not styled as a floating toast",
                )
                if width == 1440:
                    rail = page.locator("nav.tabs .tab:visible").all()
                    positions = sorted([b.bounding_box()["y"] for b in rail])
                    check(
                        all(b - a < 70 for a, b in zip(positions, positions[1:])),
                        name + " fresh main-stage sidebar has no utility gap",
                    )
                    foot = page.locator(".orebit-rail-foot")
                    if foot.count():
                        check(
                            foot.bounding_box()["y"] > max(positions),
                            name + " utility footer follows all main stages",
                        )
                    check(
                        not page.locator("#mobileBottomNav").is_visible(),
                        name + " desktop uses only the sidebar",
                    )
                    page.set_viewport_size({"width": 390, "height": 844})
                check(
                    page.locator("#mobileBottomNav").is_visible(),
                    name + " mobile/tablet navigation exists after load or resize",
                )
                for button in page.locator("#mobileBottomNav button").all():
                    check(
                        fits(page, button) and button.bounding_box()["height"] >= 43,
                        name + " bottom-nav controls fit " + str(width),
                    )
                page.evaluate(
                    """() => {window.__mobileErrors=[];if(typeof safeRender==='function'){const old=safeRender;window.safeRender=(label,fn)=>old(label,()=>{try{return fn()}catch(e){__mobileErrors.push(String(e));throw e}});safeRender('mobile-canary',()=>{throw Error('mobile-canary')});}}"""
                )
                if page.evaluate('typeof safeRender==="function"'):
                    check(
                        "mobile-canary"
                        in " ".join(page.evaluate("__mobileErrors.splice(0)")),
                        name + " swallowed-render detector is live",
                    )
                check(not page.locator(".orebit-phase-pill").count(), name + " web header has no Free badge")
                # Browser install availability is an external browser event, not
                # a test-created button. Reproduce the previously untested header.
                page.evaluate("""() => {window.__installClicks=0;const event=new Event('beforeinstallprompt');event.prompt=()=>{window.__installClicks++};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);}""")
                menu=page.locator(".mobile-nav-hamburger")
                install=page.locator("[data-install-app]")
                for control in (menu,install,page.locator("#lang-switch"),page.locator(".orebit-avatar")):
                    check(fits(page,control) and control.bounding_box()["height"]>=43 and control.evaluate("e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}"),name + " header control is touch-sized and unobscured with install visible " + str(width))
                check(install.get_attribute("aria-label")=="Install app",name + " compact install icon has an accessible label")
                install.click()
                check(page.evaluate("__installClicks")==1,name + " install invokes the browser prompt exactly once")
                menu.click()
                check(page.locator("#mobileNavDrawer").evaluate('e=>e.classList.contains("show")') and menu.get_attribute("aria-expanded")=="true",name + " real header hamburger opens Steps with install visible")
                page.locator("#mobileNavDrawer .drawer-close").click()
                check(menu.get_attribute("aria-expanded")=="false",name + " closing the menu resets the real hamburger")
                before = raw(page)
                page.locator('#mobileBottomNav [data-group="analysis"]').click()
                check(
                    page.locator("#mobileNavDrawer").evaluate(
                        'e=>e.classList.contains("show")'
                    )
                    and active(page) == 1,
                    name + " Steps opens navigation without silently changing stage",
                )
                check(
                    page.locator("#mobileNavDrawer .sub-tab").evaluate_all(
                        "els=>els.map(e=>Number(e.dataset.tab))"
                    )
                    == STAGES[name],
                    name + " mobile stages match the desktop guided order",
                )
                page.wait_for_timeout(
                    250
                )  # drawer slide-in must finish before measuring bounds
                check(
                    fits(page, page.locator("#mobileNavDrawer .drawer-close")),
                    name + " drawer has an accessible close control",
                )
                page.locator("#mobileNavDrawer .sub-tab").first.click()
                check(
                    active(page) == 2
                    and not page.locator("#mobileNavDrawer").evaluate(
                        'e=>e.classList.contains("show")'
                    ),
                    name + " drawer selection navigates and closes",
                )
                page.locator('#mobileBottomNav [data-group="results"]').click()
                advanced = page.locator("#mobileNavDrawer .sub-tab").evaluate_all(
                    "els=>els.map(e=>Number(e.dataset.tab))"
                )
                expected = page.locator(
                    'nav.tabs .tab[data-workflow-advanced="true"]'
                ).evaluate_all(
                    'els=>els.map(e=>Array.from(e.parentElement.querySelectorAll(".tab")).indexOf(e)+1)'
                )
                check(
                    advanced == expected and advanced,
                    name + " Advanced lists every optional owner independently",
                )
                page.locator("#mobileNavDrawer .sub-tab").first.click()
                check(
                    active(page) == advanced[0]
                    and page.locator(
                        '#mobileBottomNav [data-group="results"]'
                    ).get_attribute("aria-current")
                    == "page",
                    name + " directly opened advanced stage stays highlighted",
                )
                page.locator('#mobileBottomNav [data-group="home"]').click()
                check(
                    before == raw(page), name + " mobile navigation preserves raw data"
                )
                for language in ("en", "id"):
                    if page.locator("html").get_attribute("lang") != language:
                        page.locator("#lang-switch").click()
                        if page.locator(".lang-picker-overlay").count():
                            page.locator(
                                f'.lang-picker-overlay [data-pick="{language}"]'
                            ).click()
                    page.wait_for_function(
                        "(lang)=>document.documentElement.lang===lang", arg=language
                    )
                    check(
                        page.locator(
                            '#mobileBottomNav [data-group="analysis"] span'
                        ).inner_text()
                        == ("Steps" if language == "en" else "Alur"),
                        name + " mobile labels follow the real language control",
                    )
                    check(install.get_attribute("aria-label")==("Install app" if language=="en" else "Install aplikasi"),name + " install accessible label follows EN/ID")
                    check(menu.get_attribute("aria-label")==("Steps" if language=="en" else "Alur"),name + " header menu accessible label follows EN/ID")
                    tour(page, name, language)
                page.locator("#mobileTourBtn").click()
                page.set_viewport_size({"width": 568, "height": 320})
                page.wait_for_timeout(100)
                check(
                    fits(page, page.locator("#tourCard")),
                    name + " active tour follows landscape resize",
                )
                page.keyboard.press("Escape")
                check(
                    not page.locator("#tourOverlay").evaluate(
                        'e=>e.classList.contains("open")'
                    ),
                    name + " Escape exits the tour",
                )
                if os.environ.get("OREBIT_UX_EVIDENCE"):
                    folder = Path(os.environ["OREBIT_UX_EVIDENCE"])
                    folder.mkdir(parents=True, exist_ok=True)
                    page.set_viewport_size({"width": width, "height": height})
                    page.screenshot(
                        path=str(folder / f"{name}-{width}-mobile-tour.png")
                    )
                page.set_viewport_size({"width": 1440, "height": 1000})
                check(
                    not page.locator("#mobileBottomNav").is_visible()
                    and page.locator("nav.tabs .tab.active").is_visible(),
                    name + " resize back restores desktop navigation",
                )
                check(
                    not errors and not page.evaluate("__mobileErrors.length"),
                    name
                    + " tour and mobile navigation have no page or swallowed failures: "
                    + str(errors),
                )
                page.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print("MOBILE AND TOUR:", passed, "passed", flush=True)
