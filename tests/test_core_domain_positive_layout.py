"""Positive Core Domain panels from raw CSVs and native build/review, both methods."""
import csv
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright
from domain_native_fixture import write_domain_fixture

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'build/build.mjs').exists())
DIST=Path(os.environ.get('OREBIT_TEST_DIST',ROOT/'dist'))
CAPTURE=os.environ.get('OREBIT_DOMAIN_POSITIVE_EVIDENCE')
AXE=os.environ.get('OREBIT_AXE_PATH')
passed=0

def check(condition,message):
    global passed
    assert condition,message
    passed+=1
    print('PASS:',message,flush=True)

def stage(page,n):
    if page.locator('#mobileBottomNav').is_visible():
        page.locator('#mobileBottomNav [data-group="analysis"]').click()
        page.locator(f'#mobileNavDrawer .sub-tab[data-tab="{n}"]').click()
    else:
        target=page.locator(f'nav.tabs .tab[onclick="showTab({n})"]')
        if not target.is_visible():page.locator('nav.tabs .screening-advanced-toggle').click()
        target.click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")',arg=n)

def task(page,name):
    button=page.locator(f'.domain-steps [data-domain-step="{name}"]')
    button.focus();page.keyboard.press('Enter')

def accepted(page):
    return page.evaluate('()=>{const s=OrebitCoreDomain.exportState();return JSON.stringify({source:s.source,domains:s.domains,codebook:s.codebook})}')

def insight(page,state,text=None):
    page.wait_for_function("([state,text])=>{const p=document.querySelector('#tab14 .assay-workflow-card .workflow-insight > p');return p?.dataset.domainInsight===state&&(!text||p.textContent.includes(text))}",arg=[state,text])
    return page.locator('#tab14 .assay-workflow-card .workflow-insight > p').inner_text()

def native_model(page,paths,method,lang):
    page.wait_for_function('()=>window.__i18nBooted===true')
    picker=page.locator('.lang-picker-overlay')
    if picker.count():picker.locator(f'[data-pick="{lang}"]').click()
    if page.locator('.tour-skip').is_visible():page.locator('.tour-skip').click()
    page.evaluate('(l)=>applyLanguage(l)',lang)
    page.evaluate("""()=>{window.__positiveErrors=[];const original=safeRender;
      window.safeRender=(name,fn)=>original(name,()=>{try{const value=fn();if(value?.catch)return value.catch(e=>{__positiveErrors.push(String(e));throw e;});return value;}catch(e){__positiveErrors.push(String(e));throw e;}});
      safeRender('positive-canary',()=>{throw Error('positive-canary')});}""")
    check(page.evaluate("__positiveErrors.splice(0).some(e=>e.includes('positive-canary'))"),'Live swallowed-render canary')
    page.evaluate("window._renderFailures=(window._renderFailures||[]).filter(e=>e.label!=='positive-canary');document.querySelectorAll('.toast').forEach(e=>e.remove())")
    stage(page,2);page.locator('#fileInput').set_input_files([str(p) for p in paths[:2]])
    page.wait_for_function('()=>STATE.collar.length===25&&STATE.survey.length===50&&!STATE.assay.length&&!STATE.geology.length')
    stage(page,14);empty=insight(page,'empty')
    check(bool(empty) and page.locator('#tab14 .workflow-insight').get_attribute('role')=='status',method+': actual missing-interval upload has a live empty Domain explanation')
    stage(page,2);page.locator('#fileInput').set_input_files([str(p) for p in paths])
    page.wait_for_function('()=>STATE.collar.length===25&&STATE.survey.length===50&&STATE.assay.length===75&&STATE.geology.length===75')
    page.locator('#coreCRS').fill('EPSG:32748');page.locator('#coreCRS').press('Tab')
    original=page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')
    stage(page,14);task(page,'book')
    group_label='Geological groups: ' if lang=='en' else 'Kelompok geologi: '
    check(group_label+'0' in insight(page,'draft',group_label+'0'),method+': uploaded interval data starts with zero interpreted groups and no reviewed solid')
    page.locator('#domainCodebookCode').fill('SAP');page.locator('#domainCodebookLabel').fill('Synthetic saprolite')
    for d in page.locator('#domainCodebookDensity').locator('xpath=ancestor::details').all():
        if not d.evaluate('e=>e.open'):d.locator(':scope > summary').click()
    page.locator('#domainCodebookDensity').fill('1.6');page.locator('#domainCodebookLithologies').get_by_label('SAP', exact=True).check();page.locator('#domainCodebookApply').click()
    check(group_label+'1' in insight(page,'draft',group_label+'1'),method+': explicit codebook Apply updates the current geological-group count')
    task(page,'contacts');page.locator('#domainContactTarget').select_option('book:SAP')
    if method=='loft':
        page.locator('#domainBuildMethod').select_option('loft');page.locator('#domainToolDigitize').click()
        page.locator('#domainLoftSnap').fill('0');page.locator('#domainLoftSnap').press('Tab')
        for offset,label in ((0,'XS +00'),(50,'XS +01')):
            task(page,'contacts');page.locator('#domainSectionList .domain-section',has_text=label).click()
            page.wait_for_function('(offset)=>OrebitCoreDomainViewer.state().offset===offset',arg=offset)
            for h,rl in ((-40,80),(40,80),(40,96),(-40,96)):
                task(page,'contacts');page.locator('#domainLoftH').fill(str(h));page.locator('#domainLoftRL').fill(str(rl));page.locator('#domainLoftAdd').click()
            page.locator('#domainLoftClose').click()
        task(page,'solid');page.locator('#domainLoftEnd').select_option('zero');page.locator('#domainLoftTopo').select_option('collars');page.locator('#domainLoftBuild').click()
        want=80*16*50
    else:
        task(page,'solid');page.locator('#domainSolidTopo').select_option('collars');page.locator('#domainSolidBuild').click();want=100*100*6
    page.wait_for_function('()=>!!window.__domainSolid')
    check(abs(page.evaluate('__domainSolid.volume')-want)<1e-6,f'{method}: native build matches independent prism volume {want}')
    check(page.locator('#domainSolidAcceptBtn').is_disabled(),method+': Build does not approve itself')
    volume_text=f'{want:,}' if lang=='en' else f'{want:,}'.replace(',','.')
    candidate=insight(page,'candidate',volume_text)
    check(volume_text in candidate and page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status!=='validated'"),method+': real candidate volume is distinguished from reviewed geometry in the insight')
    page.locator('#tab14 .workflow-stage-bar-next').click()
    check(page.evaluate("document.querySelector('.domain-steps [aria-current=step]').dataset.domainStep==='solid'&&document.activeElement?.id==='domainSolidReviewer'")
          and page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status!=='validated'"),method+': unreviewed footer focuses the actual review form and never approves or skips it')
    page.locator('#domainSolidCode').fill('SAP');page.locator('#domainSolidReviewer').fill('Synthetic layout reviewer')
    page.locator('#domainSolidReason').fill('Synthetic test: native source, explicit contacts/rings and independent prism volume reviewed.')
    page.locator('#domainSolidReview').check();page.locator('#domainSolidAcceptBtn').click()
    try:page.wait_for_function('()=>document.querySelector("#domainReadiness [aria-current=true]")?.dataset.state==="validated"')
    except Exception:
        print('REVIEW DIAGNOSTIC',page.locator('#domainSolidAccept').inner_text(),page.locator('#domainSolidNote').inner_text(),page.locator('.toast').all_text_contents(),flush=True);raise
    reviewed=insight(page,'ready',volume_text)
    check(group_label+'1' in reviewed and volume_text in reviewed,method+': actual review produces the current group/volume insight without implying Resource estimation')
    check(page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,method+': actual build/review preserves every uploaded row')
    return original,want

def invalid_candidate(page,original,tag):
    # The existing native New-domain journey leaves an empty working loft and
    # the old reviewed SAP geometry stale. Build a genuinely above-ground draft.
    geometry="JSON.stringify(OrebitCoreDomain.exportState().domains.map(d=>({code:d.code,mesh:d.build.mesh,volume:d.build.volume,review:d.build.review})))"
    previous=page.evaluate(geometry)
    evidence={}
    def capture_state(state):
        entry={}
        if AXE:
            audit=page.evaluate("""async()=>{const r=await axe.run({include:[['#tab14']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {version:axe.version,incomplete:r.incomplete.map(x=>x.id),violations:r.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};}""")
            check(not audit['violations'],tag+': '+state+' has no automatic scoped accessibility violations '+str(audit));entry['axe']=audit
        if CAPTURE:
            out=Path(CAPTURE);out.mkdir(parents=True,exist_ok=True);image=out/(tag.replace(':','-')+'-'+state+'.png')
            page.screenshot(path=str(image),full_page=True,animations='disabled');entry['image']=image.name;entry['sha256']=hashlib.sha256(image.read_bytes()).hexdigest()
        evidence[state]=entry
    task(page,'contacts');page.locator('#domainToolDigitize').click()
    page.locator('#domainLoftSnap').fill('0');page.locator('#domainLoftSnap').press('Tab')
    for offset,label in ((0,'XS +00'),(50,'XS +01')):
        page.locator('#domainSectionList .domain-section',has_text=label).click()
        page.wait_for_function('(offset)=>OrebitCoreDomainViewer.state().offset===offset',arg=offset)
        for h,rl in ((-40,80),(40,80),(40,120),(-40,120)):
            page.locator('#domainLoftH').fill(str(h));page.locator('#domainLoftRL').fill(str(rl));page.locator('#domainLoftAdd').click()
        page.locator('#domainLoftClose').click()
    task(page,'solid');page.locator('#domainLoftTopo').select_option('collars');page.locator('#domainLoftEnd').select_option('zero');page.locator('#domainLoftBuild').click()
    text=insight(page,'invalid');candidate=page.evaluate('__domainSolid')
    check(candidate['above']>0 and candidate['validation']['topography'] is False and abs(candidate['volume']-160000)<1e-6,
          tag+': actual 80×40×50m draft crosses the declared100m collar surface and fails its ground check')
    check(bool(text) and page.locator('#domainSolidChecks [data-check="topography"]').get_attribute('class')=='is-fail',
          tag+': invalid-candidate insight agrees with the actual failed inspector check')
    page.locator('#domainSolidReviewer').fill('Synthetic invalid-candidate reviewer')
    page.locator('#domainSolidReason').fill('A review identity cannot override the measured ground-surface failure.')
    page.locator('#domainSolidReview').check()
    check(page.locator('#domainSolidAcceptBtn').is_disabled(),tag+': even explicit reviewer/reason/tick cannot approve the above-ground candidate')
    page.locator('#tab14 .workflow-stage-bar-next').click()
    check(page.evaluate("document.querySelector('.domain-steps [aria-current=step]')?.dataset.domainStep==='solid'&&document.activeElement?.id==='domainLoftTopo'")
          and page.locator('#domainSolidAcceptBtn').is_disabled(),tag+': invalid onward focuses the actual ground-source control without handoff or approval')
    check(page.evaluate(geometry)==previous and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,
          tag+': invalid build/review/navigation preserves prior reviewed mesh, volume, record and every raw row')
    capture_state('invalid-candidate')
    task(page,'contacts');page.locator('#domainToolEdit').click()
    for offset,label in ((0,'XS +00'),(50,'XS +01')):
        page.locator('#domainSectionList .domain-section',has_text=label).click()
        page.wait_for_function('(offset)=>OrebitCoreDomainViewer.state().offset===offset',arg=offset)
        for index,h in ((2,40),(3,-40)):
            page.locator('#domainLoftVertex').select_option('section:'+str(index))
            page.locator('#domainLoftH').fill(str(h));page.locator('#domainLoftRL').fill('96');page.locator('#domainLoftVertexApply').click()
    task(page,'solid');page.locator('#domainLoftBuild').click()
    recovered=insight(page,'candidate');result=page.evaluate('__domainSolid')
    check(result['above']==0 and result['validation']['topography'] is True and abs(result['volume']-64000)<1e-6,
          tag+': native vertex corrections recover the independent80×16×50m candidate and its ground check')
    check(bool(recovered) and page.locator('#domainSolidAcceptBtn').is_disabled() and page.evaluate(geometry)==previous
          and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,
          tag+': repaired geometry needs a fresh explicit review and never replaces prior acceptance or raw measurements')
    capture_state('recovered-candidate')
    return {'invalidInsight':text,'invalidCandidate':candidate,'recoveredInsight':recovered,'recoveredCandidate':result,'evidence':evidence}

def main():
    handler=functools.partial(type('Quiet',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *_:None}),directory=str(DIST))
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    metrics={'cases':{},'scope':'Native raw CSV and explicit build/review for both methods; four panels, EN/ID1440/768/390; CSS zoom is emulation, not OS/device acceptance.'}
    try:
        with tempfile.TemporaryDirectory(prefix='domain-positive-') as folder,sync_playwright() as pw:
            paths=write_domain_fixture(Path(folder),measured_ends=True)
            metrics['fixtures']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
            browser=pw.chromium.launch()
            for method in ('contacts','loft'):
                for lang,width in (('en',1440),('en',768),('en',390),('id',1440),('id',768),('id',390)):
                    tag=f'{method}:{lang}:{width}'
                    if os.environ.get('OREBIT_DOMAIN_CASE') and os.environ['OREBIT_DOMAIN_CASE']!=tag:continue
                    page=browser.new_page(viewport={'width':width,'height':1000 if width>768 else 844});errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)));page.goto(f'http://127.0.0.1:{server.server_port}/Core.html')
                    original,want=native_model(page,paths,method,lang);model=accepted(page)
                    # The stage footer delegates the same task and final owner controls.
                    task(page,'book')
                    for next_step in ('contacts','solid','handoff'):
                        if method=='loft' and next_step=='solid':
                            check(page.locator('#domainLoftReview').is_visible() and not page.locator('#domainLoftReview').is_disabled()
                                  and page.locator('#tab14 .workflow-stage-bar-next').inner_text()==page.locator('#domainLoftReview').inner_text().rstrip(' →'),
                                  tag+': interpretation footer mirrors the actual available loft-review route')
                        page.locator('#tab14 .workflow-stage-bar-next').click()
                        page.wait_for_function("step=>document.querySelector('.domain-steps [aria-current=step]')?.dataset.domainStep===step",arg=next_step)
                        check(accepted(page)==model,tag+': native footer advances to '+next_step+' without changing accepted geometry')
                    own_export=page.locator('#domainContinueExport').inner_text()
                    check(page.locator('#tab14 .workflow-stage-bar-next').inner_text()==own_export.rstrip(' →'),tag+': standalone handoff footer names the actual Core Export owner')
                    page.locator('#tab14 .workflow-stage-bar-next').click()
                    page.wait_for_function("()=>document.getElementById('tab13').classList.contains('active')")
                    check(page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original and accepted(page)==model,
                          tag+': native handoff footer opens Core Export with raw and reviewed geometry intact')
                    stage(page,14)
                    inspector=page.locator('#domainInspectorTitle');was_open=inspector.locator('xpath=..').evaluate('e=>e.open')
                    inspector.focus();page.keyboard.press('Enter')
                    check(inspector.locator('xpath=..').evaluate('e=>e.open')!=was_open and page.locator('#domainInspector dt').count()>0,tag+': native Enter toggles the actual current-view facts')
                    page.keyboard.press('Enter')
                    check(inspector.locator('xpath=..').evaluate('e=>e.open')==was_open and accepted(page)==model
                          and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,tag+': closing current-view facts preserves raw and reviewed state')
                    if AXE:page.add_script_tag(path=AXE)
                    cases=[]
                    for name in ('book','contacts','solid','handoff'):
                        task(page,name)
                        for theme,zoom in (('light',1),('light',2),('dark',1),('dark',2)):
                            if page.evaluate('(document.documentElement.getAttribute("data-theme")||"light")')!=theme:page.evaluate('toggleTheme()')
                            page.wait_for_function("(theme)=>(document.documentElement.getAttribute('data-theme')||'light')===theme",arg=theme)
                            # Poll live finite animations with the normal bounded wait.
                            # A detached transition can leave its old finished promise pending.
                            page.wait_for_function("()=>document.getAnimations().every(a=>a.effect?.getComputedTiming().iterations===Infinity||a.playState!=='running')")
                            page.evaluate('(z)=>{document.documentElement.style.zoom=String(z);window.scrollTo(0,0)}',zoom)
                            page.wait_for_function('()=>!!document.getElementById("domainViewerCanvas")')
                            layout=page.evaluate("""()=>{const panel=document.getElementById('tab14'),workspace=panel.querySelector('.domain-workspace'),viewer=panel.querySelector('#domainViewerPanel'),bar=panel.querySelector('.workflow-stage-bar');
                              const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
                              const controls=[...panel.querySelectorAll('input:not([type=hidden]),select,textarea,button')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('.workflow-step-links'));
                              return {pageOverflow:document.documentElement.scrollWidth-innerWidth,workspace:box(workspace),viewer:box(viewer),bar:box(bar),outside:controls.filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).map(e=>e.id||e.textContent.trim()),current:panel.querySelector('.domain-steps [aria-current=step]')?.dataset.domainStep,tree:panel.querySelectorAll('#domainTree [role=listitem]').length};}""")
                            if name=='book' and theme=='light':
                                links=page.locator('#tab14 .workflow-step-links button')
                                links.first.focus()
                                for index in range(links.count()):
                                    if index:page.keyboard.press('Tab')
                                    page.wait_for_function("""index=>{const e=document.querySelectorAll('#tab14 .workflow-step-links button')[index],r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return document.activeElement===e&&r.left>=p.left-1&&r.right<=p.right+1&&r.left>=-1&&r.right<=innerWidth+1}""",arg=index)
                                    fit=links.nth(index).evaluate("e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {focused:document.activeElement===e,left:r.left,right:r.right,parentLeft:p.left,parentRight:p.right,width:innerWidth,scroll:e.parentElement.scrollLeft}}")
                                    check(fit['focused'] and fit['left']>=fit['parentLeft']-1 and fit['right']<=fit['parentRight']+1 and fit['left']>=-1 and fit['right']<=fit['width']+1,f'{tag}/zoom{zoom}: native Tab reveals complete related-stage link {index}: {fit}')
                            check(layout['pageOverflow']<=1 and not layout['outside'],f'{tag}/{name}/{theme}/{zoom}: visible controls fit viewport {layout}')
                            check(layout['viewer']['width']>100 and layout['viewer']['height']>100 and layout['bar']['top']>=layout['viewer']['bottom']-1,f'{tag}/{name}/{theme}/{zoom}: scene remains dominant and footer does not cover it')
                            check(layout['current']==name and accepted(page)==model and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,f'{tag}/{name}/{theme}/{zoom}: native task/theme/zoom preserves reviewed geometry and raw source')
                            result={'task':name,'theme':theme,'cssZoom':zoom,'layout':layout}
                            if AXE and zoom==1:
                                audit=page.evaluate("""async()=>{const r=await axe.run({include:[['#tab14']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {version:axe.version,incomplete:r.incomplete.map(x=>x.id),violations:r.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};}""")
                                check(not audit['violations'],f'{tag}/{name}: no automatic scoped accessibility violations {audit}');result['axe']=audit
                            if CAPTURE and theme=='light' and zoom==1:
                                out=Path(CAPTURE);out.mkdir(parents=True,exist_ok=True);image=out/f'{method}-{lang}-{width}-{name}.png'
                                page.screenshot(path=str(image),full_page=True,animations='disabled');result['image']=image.name;result['sha256']=hashlib.sha256(image.read_bytes()).hexdigest()
                            cases.append(result)
                        page.evaluate("document.documentElement.style.zoom='1'")
                    task(page,'solid')
                    race=lang=='en' and width==1440
                    if race:
                        # One delayed read-only projection of the actual prior review.
                        # Replace only its paragraph to request an uncached projection;
                        # no scientific state/result or approval is injected.
                        page.evaluate("""async()=>{
                          const owner=OrebitCoreDomain,previous=await owner.readiness(),original=owner.readiness;
                          const old=document.querySelector('#tab14 .assay-workflow-card .workflow-insight > p'),target=old.cloneNode(true);old.replaceWith(target);
                          let release;owner.readiness=()=>new Promise(resolve=>{release=resolve});
                          try{window.__heldInsight=OrebitCoreDomainViewer.updateInsight(target);}finally{owner.readiness=original;}
                          window.__releaseInsight=()=>release(previous);window.__heldInsightTarget=target;
                        }""")
                    page.locator('#domainLoftBuild' if method=='loft' else '#domainSolidBuild').click()
                    candidate_text=insight(page,'candidate',f'{want:,}' if lang=='en' else f'{want:,}'.replace(',','.'))
                    prior_phrase='Earlier reviewed geometry:' if lang=='en' else 'Geometri direview sebelumnya:'
                    check(prior_phrase in candidate_text and accepted(page)==model and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,
                          tag+': native rebuild remains an unreviewed candidate while prior accepted geometry and raw source stay intact')
                    if race:
                        stable=page.evaluate("""async()=>{const p=document.querySelector('#tab14 .assay-workflow-card .workflow-insight > p'),before=p.textContent;__releaseInsight();await __heldInsight;
                          const stable=p===__heldInsightTarget&&p.dataset.domainInsight==='candidate'&&p.textContent===before;
                          delete window.__heldInsight;delete window.__releaseInsight;delete window.__heldInsightTarget;return stable;}""")
                        check(stable,tag+': delayed prior-ready projection cannot overwrite the new candidate on the same live paragraph')
                    if method=='loft':
                        task(page,'contacts');sections=page.evaluate('JSON.stringify(OrebitCoreDomain.exportState().sections)')
                        draft=page.evaluate('JSON.stringify(__domainLoft)')
                        page.locator('#domainLoftNewDomain').click()
                        dialog=page.locator('[role="dialog"][aria-modal="true"]:not(#mobileNavDrawer)');cancel=dialog.get_by_role('button',name='Cancel' if lang=='en' else 'Batal',exact=True)
                        cancel.focus();page.keyboard.press('Enter');dialog.wait_for(state='hidden')
                        check(page.evaluate('JSON.stringify(__domainLoft)')==draft and accepted(page)==model
                              and page.evaluate("document.activeElement?.id==='domainLoftNewDomain'"),tag+': native Cancel retains all current rings, accepted geometry and opener focus')
                        page.locator('#domainLoftNewDomain').click();dialog=page.locator('[role="dialog"][aria-modal="true"]:not(#mobileNavDrawer)')
                        confirm=dialog.get_by_role('button',name='Continue' if lang=='en' else 'Lanjutkan',exact=True);confirm.focus();page.keyboard.press('Enter')
                        page.wait_for_function("()=>!__domainLoft.sections.length&&!__domainLoft.draft.length&&document.querySelector('.domain-steps [aria-current=step]')?.dataset.domainStep==='book'")
                        check(accepted(page)==model and page.evaluate('JSON.stringify(OrebitCoreDomain.exportState().sections)')==sections
                              and page.evaluate("document.activeElement?.id==='domainCodebookCode'&&!document.getElementById('domainCodebookCode').readOnly&&document.getElementById('domainCodebookSelect').value===''")
                              and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,
                              tag+': native New domain confirm clears only working rings, retains accepted sections/mesh/raw and focuses the new definition')
                        # The fresh draft has no active code. Explicitly return to
                        # the saved group before changing that model's ground decision.
                        page.locator('#domainCodebookSelect').select_option('SAP');page.locator('#domainCodebookApply').click()
                        check(accepted(page)==model,tag+': selecting and reapplying the unchanged saved group retains its accepted model')
                        task(page,'solid')
                    # An actual ground-source decision invalidates the stored review,
                    # while source replacement may retire that interpretation entirely.
                    page.locator('#domainLoftTopo' if method=='loft' else '#domainSolidTopo').select_option('')
                    stale_text=insight(page,'stale')
                    check(bool(stale_text) and page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status==='stale'")
                          and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==original,
                          tag+': actual ground-source change shows stale review without changing raw measurements')
                    invalid=None
                    if method=='loft' and width in (1440,390):
                        invalid=invalid_candidate(page,original,tag)
                    # A real related-collar correction retires the previous review.
                    with paths[0].open(newline='') as source:
                        reader=csv.DictReader(source);fields=list(reader.fieldnames);collars=list(reader)
                    collars[0]['z']=str(float(collars[0]['z'])+1)
                    corrected=Path(folder)/f'collar-corrected-{method}-{lang}-{width}.csv'
                    with corrected.open('w',newline='') as target:
                        writer=csv.DictWriter(target,fieldnames=fields);writer.writeheader();writer.writerows(collars)
                    related=page.evaluate('JSON.stringify([STATE.survey,STATE.assay,STATE.geology])')
                    stage(page,2);page.locator('#fileInput').set_input_files(str(corrected))
                    page.wait_for_function('()=>STATE.collar.length===25&&STATE.collar[0].z===101')
                    stage(page,14)
                    source_readiness=page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status")
                    expected={'none':'draft','stale':'stale','invalid':'invalid'}.get(source_readiness)
                    check(expected is not None,tag+': corrected source cannot retain a current approved model')
                    after_source=insight(page,expected)
                    check(bool(after_source) and page.evaluate('JSON.stringify([STATE.survey,STATE.assay,STATE.geology])')==related
                          and 'm³' not in after_source,
                          tag+': actual collar correction projects the owner retirement state and preserves related raw tables without old candidate volume')
                    metrics['cases'][tag]={'volume':want,'states':cases,'invalidCandidateRecovery':invalid,'rebuildInsight':candidate_text,'groundDecisionStaleInsight':stale_text,'correctedSourceReadiness':source_readiness,'correctedSourceInsight':after_source,'delayedPriorReadyGuard':'same-live-paragraph negative exercised' if race else 'covered once per method on EN1440'}
                    check(not errors and not page.evaluate('__positiveErrors.length'),tag+': no page or swallowed render failures')
                    page.close()
            browser.close()
    finally:server.shutdown();server.server_close()
    metrics['assertions']=passed
    if CAPTURE:(Path(CAPTURE)/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps({'suite':'Core positive Domain layout','checks':passed,'cases':len(metrics['cases'])}),flush=True)

if __name__=='__main__':main()
