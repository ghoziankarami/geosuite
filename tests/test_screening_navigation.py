"""Browser evidence for a consistent, focused dashboard and real calculation actions."""
import functools, http.server, os, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'build/build.mjs').exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST', ROOT / 'dist'))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(DIST)))
threading.Thread(target=server.serve_forever, daemon=True).start()
passed = 0
def check(condition, message):
    global passed
    assert condition, message
    passed += 1
    print('PASS:', message, flush=True)
try:
    with sync_playwright() as pw, tempfile.TemporaryDirectory() as tmp:
        browser = pw.chromium.launch()
        for name in ('Core', 'Assay', 'Resource'):
            page = browser.new_page(viewport={'width':1440, 'height':1000})
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/{name}.html')
            page.wait_for_function('() => window.__i18nBooted===true')
            page.evaluate("document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove());applyLanguage('en');showTab(1)")
            hero=page.locator('#tab1 .workflow-dashboard')
            check(hero.is_visible(), name+' has the same focused dashboard pattern')
            check(hero.locator('[data-action-role="next"]').count()==1, name+' dashboard has one primary start action')
            check(hero.locator('.workflow-notes,.action-key,.workflow-eyebrow').count()==0, name+' dashboard removes stage-only distractions')
            check(hero.bounding_box()['height']<300, name+' dashboard leaves space for actual results')
            rail=page.locator('nav.tabs')
            check(abs(rail.bounding_box()['width']-216)<2, name+' workflow rail uses a compact shared width')
            check(rail.locator('.workflow-nav-heading:visible').count()==1, name+' groups the main workflow below Dashboard')
            sequence=rail.locator('.tab[data-workflow-step]').evaluate_all('(els)=>els.map(e=>Number(e.dataset.workflowStep)).sort((a,b)=>a-b)')
            check(sequence==list(range(1,len(sequence)+1)), name+' sidebar numbers describe every main stage in order')
            check(rail.locator('.tab[aria-current="page"]').count()==1, name+' announces only the actual current page')
            check(rail.locator('.tab[data-workflow-step]').first.evaluate("e=>getComputedStyle(e,'::after').content===JSON.stringify(e.dataset.workflowStep) && getComputedStyle(e,'::after').display==='grid'"), name+' sequence remains visible without claiming analyst approval')
            toggle=page.locator('#assayAdvancedToggle' if name=='Assay' else '.screening-advanced-toggle')
            check(toggle.is_visible() and toggle.get_attribute('aria-expanded')=='false', name+' offers a collapsed Advanced tools sidebar')
            before=page.evaluate('JSON.stringify(typeof DATA!=="undefined"?DATA.rows:STATE.assay)')
            toggle.click()
            check(toggle.get_attribute('aria-expanded')=='true', name+' Advanced tools are directly accessible')
            check(toggle.evaluate("e=>e.getAttribute('aria-controls').split(' ').every(id=>document.getElementById(id)?.dataset.workflowAdvanced==='true')"), name+' disclosure identifies the actual advanced navigation controls')
            check(before==page.evaluate('JSON.stringify(typeof DATA!=="undefined"?DATA.rows:STATE.assay)'), name+' navigation preserves every raw value')
            hero.locator('[data-action-role="next"]').click()
            target=page.locator('.panel.active .assay-workflow-card')
            check(target.is_visible() and page.evaluate('typeof currentTab!=="undefined"?currentTab:7')!=1, name+' start enters the actual review')
            check(target.locator('.workflow-step-links').is_visible(), name+' stage actions stay at the top')
            check(rail.locator('.tab[aria-current="page"]').evaluate('e=>e.classList.contains("active")'), name+' primary action updates the current-page navigation state')
            if name=='Resource':
                check(page.locator('#tab3 button[data-action-role="next"]:visible').count()==1, 'Setup presents exactly one visible next action')
                page.evaluate('showTab(4)')
                check(not page.locator('#variogramAdvanced').evaluate('(e)=>e.open'), 'Continuity diagnostics are optional and initially collapsed')
                check(not page.locator('#variogramSampling').evaluate('(e)=>e.open'), 'Sampling controls do not compete with the main action')
                page.locator('#variogramSampling>summary').click()
                page.locator('#varLag').fill('75')
                page.locator('#varN').fill('12')
                page.locator('#varLag').press('Tab')
                page.wait_for_timeout(1200)
                check(page.locator('#varLag').input_value()=='75', 'Custom lag remains editable')
                page.locator('#varComputeBtn').click()
                page.wait_for_function('() => variogramState.model && variogramState.experimental',timeout=60000)
                check(page.evaluate('variogramState.experimental.lags[0]===37.5'), 'Main action really computes using the custom 75 m lag')
                check(page.locator('#tab4 .workflow-insight').inner_text().find('undefined')<0, 'Fitted-model insight displays actual parameters')
                model_before_inspect=page.evaluate('JSON.stringify(variogramState.model)')
                page.locator('#tab4 .workflow-actions').get_by_role('button',name='Inspect results',exact=True).click()
                check(page.evaluate('document.activeElement.id')=='varPlot', 'Inspect results focuses the actual fitted chart')
                check(page.evaluate('JSON.stringify(variogramState.model)')==model_before_inspect, 'Inspect results never changes model parameters')
                check(page.locator('#varPlot').is_visible(), 'One experimental/fitted chart is immediately visible')
                page.locator('#variogramAdvanced>summary').click()
                check(page.locator('#variogramAdvanced #nmStruct2Box').count()==1, 'Nested model is contained inside the optional tools disclosure')
                check(page.locator('#variogramAdvanced #dhPlot').count()==1, 'Downhole plot remains inside optional tools')
                active_model=page.evaluate('JSON.stringify(variogramState.model)')
                page.locator('#variogramAdvanced details').evaluate_all('(els)=>els.forEach(e=>e.open=true)')
                check(page.evaluate('JSON.stringify(variogramState.model)')==active_model, 'Opening advanced investigations preserves the active model')
                page.locator('button[onclick="computeVariogramMap()"]').click()
                page.wait_for_function("() => document.getElementById('vmapPlot').classList.contains('js-plotly-plot')", timeout=60000)
                check(page.locator('#vmapPlot').is_visible(), 'Variogram map computes through its real UI action')
                page.locator('button[onclick="computeDirectionalScan()"]').click()
                page.wait_for_function('() => variogramState.directionalScan.results', timeout=60000)
                check(page.locator('#dsAdoptBtn').is_enabled(), 'Directional scan exposes a separate adoption action')
                page.locator('button[onclick="computeDownholeVariogram()"]').click()
                page.wait_for_function('() => variogramState.downhole.lags', timeout=60000)
                check(page.locator('#dhApplyBtn').is_enabled(), 'Downhole computation exposes the nugget application action')
                check(page.evaluate('JSON.stringify(variogramState.model)')==active_model, 'Diagnostic computation preserves the current fitted model until application')
                for grid in page.locator('#variogramContent .grid-2').all():
                    check(grid.evaluate("e=>getComputedStyle(e).gridTemplateColumns.split(' ').length===1"), 'Advanced plots use one full-width reading column')
                if os.environ.get('OREBIT_UX_EVIDENCE'):
                    evidence=Path(os.environ['OREBIT_UX_EVIDENCE']);evidence.mkdir(parents=True,exist_ok=True)
                    page.screenshot(path=str(evidence/'Resource-variography-advanced.png'),full_page=True)
                page.locator('#variogramAdvanced>summary').click()
                page.locator('#tab4 [data-workflow-next]').click()
                check(page.locator('#blockModelContent').is_visible(), 'Next opens the real block model stage')
                check(not page.locator('#blockAdvanced').evaluate('(e)=>e.open'), 'Advanced density and extent are available without overwhelming the form')
                check(page.locator('#tab5 .assay-workflow-card #bmGenBtn').is_visible(), 'Create-grid action stays in the top action area')
                page.evaluate('showTab(12);showTab(3);showTab(12)')
                check(page.locator('#pdf-export-btn').count()==1 and page.locator('#pdf-export-btn').is_visible(), 'Report action survives revisits without deletion or duplicate IDs')
            for language in ('id','en'):
                page.evaluate('(language)=>{applyLanguage(language);showTab(1)}',language)
                check(page.locator('#tab1 .workflow-dashboard').is_visible(), name+' dashboard works in '+language)
            for width in (390,320):
                page.set_viewport_size({'width':width,'height':844})
                page.evaluate('showTab(1)')
                check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'), name+' dashboard fits '+str(width)+' px')
                check(hero.locator('[data-action-role="next"]').is_visible(), name+' start is available on mobile')
            if os.environ.get('OREBIT_UX_EVIDENCE'):
                path=Path(os.environ['OREBIT_UX_EVIDENCE']);path.mkdir(parents=True,exist_ok=True)
                page.set_viewport_size({'width':1440,'height':1000});page.evaluate('showTab(1);window.scrollTo(0,0)');page.screenshot(path=str(path/(name+'-dashboard.png')))
            page.evaluate('() => {if(typeof DATA!=="undefined")DATA.rows=[];else {STATE.collar=[];STATE.assay=[];}showTab(1)}')
            page.locator('#tab1 .workflow-dashboard [data-action-role="next"]').click()
            check(page.locator('#tab2').evaluate('(e)=>e.classList.contains("active")'), name+' empty-project primary action goes directly to Import')
            check(not errors, name+' has no page errors: '+str(errors))
            page.close()
        browser.close()
finally:
    server.shutdown();server.server_close()
print('SCREENING NAVIGATION:',passed,'passed',flush=True)
