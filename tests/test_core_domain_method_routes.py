"""Native uploaded Domain routes: both method entrances preserve drafts and review gates."""
import functools
import hashlib
import http.server
import json
import os
import sys
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright
from domain_native_fixture import write_domain_fixture as fixtures

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'build/build.mjs').exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST', ROOT / 'dist'))
CAPTURE = os.environ.get('OREBIT_DOMAIN_METHOD_EVIDENCE')
AXE = os.environ.get('OREBIT_AXE_PATH')
handler = functools.partial(type('Quiet', (http.server.SimpleHTTPRequestHandler,),
                                {'log_message': lambda *_: None}), directory=str(DIST))
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
passed = 0


def check(value, message):
    global passed
    assert value, message
    passed += 1
    print('PASS:', message, flush=True)


def navigate(page, stage):
    if page.locator('#mobileBottomNav').is_visible():
        page.locator('#mobileBottomNav [data-group="analysis"]').click()
        page.locator(f'#mobileNavDrawer .sub-tab[data-tab="{stage}"]').click()
    else:
        page.locator('nav.tabs .tab').nth(stage - 1).click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=stage)


def step(page, name):
    page.locator(f'.domain-steps [data-domain-step="{name}"]').click()


def raw(page):
    return page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')


def audit(page, tag):
    if not AXE:
        return None
    page.evaluate('''async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const finite=document.getAnimations().filter(a=>{
        const timing=a.effect?.getComputedTiming();
        return a.playState==='running' && timing && Number.isFinite(timing.iterations);
      });
      await Promise.race([Promise.all(finite.map(a=>a.finished.catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,2500))]);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }''')
    result = page.evaluate('''async()=>{
      const r=await axe.run({include:[['#tab14']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
      return {version:axe.version,passes:r.passes.length,incomplete:r.incomplete.map(v=>v.id),
        violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))};
    }''')
    severe = [v for v in result['violations'] if v['impact'] in ('critical', 'serious')]
    if severe:
        print('A11Y STATE',tag,page.evaluate("""()=>({theme:document.documentElement.dataset.theme,inline:document.documentElement.getAttribute('style'),tree:document.getElementById('domainTree').outerHTML,buttons:[...document.querySelectorAll('#domainViewerPanel button[aria-pressed=true]')].map(e=>({id:e.id,label:e.textContent,color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}))})"""),flush=True)
    check(not severe, tag+': scoped axe has no critical/serious finding: '+str(severe))
    return result


def codebook_lifecycle(page, folder, method, tag, source_rows):
    state=page.evaluate('OrebitCoreDomain.exportState()');domain=state['domains'][0]
    definition=next(d for d in state['codebook'] if d['code']=='SAP')
    check(domain['build']['inputs']['rules'].get('target')=='book:SAP' and domain['build']['inputs'].get('codebook')==definition,
          tag+': '+method+' review binds the explicitly chosen geological definition, not merely its displayed code')
    geometry="JSON.stringify(OrebitCoreDomain.exportState().domains.map(d=>({code:d.code,density:d.density,mesh:d.build.mesh,volume:d.build.volume,inputs:d.build.inputs,inputsHash:d.build.inputsHash,meshHash:d.build.meshHash,review:d.build.review,reviewHash:d.build.reviewHash})))"
    previous=page.evaluate(geometry)
    def save_project(suffix):
        page.locator('button.orebit-avatar').click()
        page.once('dialog',lambda dialog:dialog.accept('domain-codebook-Core.orebit'))
        with page.expect_download() as event:page.locator('.orebit-profile-menu [data-act="export"]').click()
        path=Path(folder)/f'{tag}-{method}-{suffix}.orebit';event.value.save_as(str(path));return path
    def reopen(path):
        navigate(page,2)
        with page.expect_file_chooser() as event:page.locator('#btnImportBundle').click()
        event.value.set_files(str(path))
        page.wait_for_function('()=>OrebitCoreDomain.exportState().domains.length===1')
        navigate(page,14)
    original=save_project('original')
    step(page,'book');page.locator('#domainCodebookSelect').select_option('SAP')
    advanced=page.locator('#domainCodebookForm details')
    if not advanced.evaluate('e=>e.open'):advanced.locator('summary').click()
    page.locator('#domainCodebookColour').fill('#123456');page.locator('#domainCodebookVisible').uncheck();page.locator('#domainCodebookApply').click()
    edited=page.evaluate('OrebitCoreDomain.codebook()[0]')
    check(edited['colour']=='#123456' and edited['visible'] is False and edited['lithologies']==definition['lithologies'],
          tag+': '+method+' native Apply saves color/visibility without changing geological membership')
    check(page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status==='stale'") and page.evaluate(geometry)==previous and raw(page)==source_rows,
          tag+': '+method+' changed review-bound definition retires approval while keeping mesh, review and raw measurements')
    updated=save_project('edited');reopen(updated)
    check(page.evaluate('OrebitCoreDomain.codebook()[0]')==edited and page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status==='stale'")
          and page.evaluate(geometry)==previous and raw(page)==source_rows,tag+': '+method+' actual project reopen retains edited definition and stale scientific state')
    step(page,'book');page.locator('#domainCodebookSelect').select_option('SAP')
    advanced=page.locator('#domainCodebookForm details')
    if not advanced.evaluate('e=>e.open'):advanced.locator('summary').click()
    edited_audit=audit(page,tag+': '+method+' edited codebook')
    before=page.evaluate('JSON.stringify(OrebitCoreDomain.exportState())')
    page.locator('#domainCodebookRemove').click()
    dialog=page.locator('[role="dialog"][aria-modal="true"]:not(#mobileNavDrawer):visible')
    dialog.get_by_role('button',name='Cancel' if page.locator('html').get_attribute('lang')=='en' else 'Batal',exact=True).click()
    check(page.evaluate('JSON.stringify(OrebitCoreDomain.exportState())')==before and raw(page)==source_rows,
          tag+': '+method+' Remove Cancel preserves exact definition, scientific state and raw rows')
    page.locator('#domainCodebookRemove').click()
    dialog=page.locator('[role="dialog"][aria-modal="true"]:not(#mobileNavDrawer):visible')
    dialog.get_by_role('button',name='Continue' if page.locator('html').get_attribute('lang')=='en' else 'Lanjutkan',exact=True).click()
    page.wait_for_function('()=>!OrebitCoreDomain.codebook().length')
    check(page.evaluate(geometry)==previous and raw(page)==source_rows and page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status==='stale'"),
          tag+': '+method+' confirmed removal deletes only the definition and cannot silently approve or delete its old geometry')
    removed_audit=audit(page,tag+': '+method+' removed codebook')
    removed=save_project('removed');reopen(removed)
    check(not page.evaluate('OrebitCoreDomain.codebook().length') and page.evaluate(geometry)==previous and raw(page)==source_rows
          and page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status==='stale'"),tag+': '+method+' native reopen preserves removed definition and old stale geometry')
    reopen(original)
    check(page.evaluate('OrebitCoreDomain.codebook()[0]')==definition and page.evaluate(geometry)==previous and raw(page)==source_rows
          and page.evaluate("async()=>(await OrebitCoreDomain.readiness()).status==='validated'"),tag+': '+method+' native original-project recovery restores its exact reviewed definition/source without reapproval')
    return {'reviewedDefinition':definition,'editedDefinition':edited,'volume':domain['build']['volume'],'nativeEditedAndRemovedReopen':True,'originalProjectRecovery':True,'a11y':{'edited':edited_audit,'removed':removed_audit}}


try:
    with tempfile.TemporaryDirectory(prefix='domain-methods-') as tmp, sync_playwright() as pw:
        source = fixtures(Path(tmp))
        metrics = {'fixture_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in source},
                   'comparison_scope': 'Native app methods and positive synthetic state; no mock numerical parity.',
                   'cases': {}}
        browser = pw.chromium.launch()
        for lang, width in ((lang, width) for lang in ('en', 'id') for width in (1440, 390, 768)):
            tag = f'{lang}-{width}'
            if os.environ.get('OREBIT_DOMAIN_METHOD_CASE') and os.environ['OREBIT_DOMAIN_METHOD_CASE']!=tag:continue
            page = browser.new_page(viewport={'width': width, 'height': 1000 if width > 768 else 844},
                                    has_touch=width <= 768)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/Core.html')
            page.wait_for_function('()=>window.__i18nBooted&&window.__orebitCoreProjectReady')
            if page.locator('.lang-picker-overlay').count():
                page.locator(f'.lang-picker-overlay [data-pick="{lang}"]').click()
            if page.locator('#tourOverlay.open').count():
                page.locator('#tourCard .tour-skip').click()
            if page.locator('html').get_attribute('lang') != lang:
                page.locator('#lang-switch').click()
                if page.locator('.lang-picker-overlay').count():
                    page.locator(f'.lang-picker-overlay [data-pick="{lang}"]').click()
            page.wait_for_function('(lang)=>document.documentElement.lang===lang', arg=lang)
            if AXE:
                page.add_script_tag(path=AXE)
            a11y = []
            page.evaluate('''() => {
              window.__methodRenderErrors=[];
              const render=window.safeRender;
              window.safeRender=(label,fn)=>render(label,()=>{try{return fn();}catch(e){
                window.__methodRenderErrors.push(label+': '+e.message);throw e;}});
              safeRender('method-canary',()=>{throw new Error('live');});
            }''')
            check(page.evaluate('window.__methodRenderErrors.splice(0).includes("method-canary: live")'), tag+': render detector canary')
            page.locator('.toast').filter(has_text='method-canary').evaluate_all('(els)=>els.forEach(e=>e.remove())')
            navigate(page, 2)
            page.locator('#fileInput').set_input_files([str(p) for p in source])
            page.wait_for_function('()=>STATE.collar.length===25&&STATE.survey.length===25&&STATE.assay.length===75&&STATE.geology.length===75')
            page.locator('#coreCRS').fill('EPSG:32748')
            before = raw(page)
            navigate(page, 14)
            if width <= 768:
                page.locator('#mobileBottomNav [data-group="export"]').click()
                check(page.locator('#tab13').is_visible() and raw(page) == before,
                      tag+': numbered Domain leaves the direct mobile Export route intact')
                navigate(page, 14)
            step(page, 'book')
            page.locator('#domainCodebookCode').fill('SAP')
            page.locator('#domainCodebookLabel').fill('Synthetic saprolite')
            page.locator('#domainCodebookLithologies').get_by_label('SAP', exact=True).check()
            page.locator('#domainCodebookApply').click()
            check(page.locator('#domainTree .domain-tree-row').count() == 1,
                  tag+': native codebook Apply creates the actual Domain tree row')
            step(page, 'contacts')
            page.locator('#domainContactTarget').select_option('book:SAP')
            selector = page.locator('#domainBuildMethod')
            check(selector.get_attribute('aria-describedby') == 'domainMethodGuide', tag+': method choice has connected guidance')
            selector.focus()
            if sys.platform == 'darwin':
                selector.select_option('loft')
            else:
                page.keyboard.press('End')
            page.wait_for_function('()=>document.getElementById("domainBuildMethod").value==="loft"')
            check(page.locator('#domainLoftAdd').is_visible()
                  and page.get_attribute('#domainToolDigitize', 'aria-pressed') == 'true',
                  tag+': method choice opens section digitizing')
            check(selector.evaluate('e=>e===document.activeElement'), tag+': method switch retains keyboard focus')
            page.locator('#domainLoftSnap').fill('0')
            page.locator('#domainLoftSnap').press('Tab')
            for h, rl in ((-10, 80), (10, 80), (0, 90)):
                page.locator('#domainLoftH').fill(str(h))
                page.locator('#domainLoftRL').fill(str(rl))
                page.locator('#domainLoftAdd').click()
            draft = page.evaluate('JSON.stringify(window.__domainLoft.draft)')
            check(len(json.loads(draft)) == 3, tag+': typed points form a real unclosed draft')
            selector.focus()
            if sys.platform == 'darwin':
                selector.select_option('contacts')
            else:
                page.keyboard.press('Home')
            check(page.get_attribute('#domainToolNavigate', 'aria-pressed') == 'true'
                  and page.locator('#domainContactTarget').input_value() == 'book:SAP',
                  tag+': contacts stops digitizing and retains its selected population')
            selector.select_option('loft')
            check(page.evaluate('JSON.stringify(window.__domainLoft.draft)') == draft
                  and raw(page) == before, tag+': alternate method draft and all four uploaded tables survive')
            page.locator('#domainLoftClose').click()
            page.locator('#domainSectionList .domain-section').filter(has_text='XS +01').click()
            for h, rl in ((-10, 80), (10, 80), (0, 90)):
                page.locator('#domainLoftH').fill(str(h))
                page.locator('#domainLoftRL').fill(str(rl))
                page.locator('#domainLoftAdd').click()
            page.locator('#domainLoftClose').click()
            step(page, 'solid')
            page.locator('#domainLoftEnd').select_option('zero')
            page.locator('#domainLoftTopo').select_option('collars')
            page.locator('#domainLoftBuild').click()
            loft_built = page.evaluate('window.__domainSolid')
            check(loft_built and abs(loft_built['volume'] - 5000) < 1e-6
                  and abs(loft_built['meshVolume'] - 5000) < 1e-6,
                  tag+': two native closed triangles build an independent 5,000 m³ loft')
            page.locator('#domainSolidReview').check()
            check(page.locator('#domainSolidAcceptBtn').is_disabled()
                  and page.locator('#domainSolidReviewer').is_visible()
                  and page.locator('#domainSolidReason').is_visible(),
                  tag+': a review tick without reviewer and rationale cannot accept a solid')
            page.locator('#domainSolidReviewer').fill('Synthetic reviewer')
            check(page.locator('#domainSolidAcceptBtn').is_disabled(), tag+': reviewer alone cannot accept a solid')
            page.locator('#domainSolidReason').fill('Synthetic fixture: inspected both section rings and the independent volume.')
            page.locator('#domainSolidAcceptBtn').click()
            page.wait_for_function('()=>document.querySelector("#domainReadiness [aria-current=true]")?.dataset.state==="validated"')
            check(page.evaluate("""async()=>{const packet=await window.__orebitDomainHandoff(),verified=await reviewedGeologicalSnapshot(packet);
              return !!verified&&Object.isFrozen(verified.domains[0].build.mesh.v[0])&&verified.handoff.volume===packet.handoff.volume;}"""),
                  tag+': native accepted method produces a receiving-valid immutable reviewed packet')
            provenance = page.evaluate('''async()=>{
              const state=OrebitCoreDomain.exportState(),d=state.domains.find(d=>d.code==='SAP'),b=d.build;
              const before=JSON.stringify(state),errors=[];
              const entry={code:d.code,mesh:b.mesh,volume:b.volume,density:d.density,validation:b.validation,inputs:b.inputs,review:true};
              for(const record of [null,{}, {reviewer:' ',reason:'reason'}, {reviewer:'name',reason:' '},
                                   {reviewer:'x'.repeat(121),reason:'reason'}, {reviewer:'name',reason:'x'.repeat(2001)}]){
                try{await OrebitCoreDomain.acceptSolid({...entry,reviewRecord:record});errors.push('ACCEPTED');}
                catch(e){errors.push(e.message);}
              }
              return {review:b.review,bound:b.review.sourceHash===state.source.sha256&&b.review.inputsHash===b.inputsHash&&b.review.meshHash===b.meshHash,
                hashed:await OrebitDomainState.hash(b.review)===b.reviewHash,errors,unchanged:before===JSON.stringify(OrebitCoreDomain.exportState())};
            }''')
            check(provenance['bound'] and provenance['hashed']
                  and provenance['review']['reviewer'] == 'Synthetic reviewer',
                  tag+': stored review is bound to this source, inputs and mesh')
            check(provenance['unchanged'] and provenance['errors'] == ['DOMAIN_REVIEW_REQUIRED'] * 6,
                  tag+': owner independently rejects missing/blank/oversized review without replacing accepted geometry')
            loft_codebook=codebook_lifecycle(page,tmp,'loft',tag,before)
            for name in ('book', 'contacts', 'solid', 'handoff'):
                step(page, name)
                check(raw(page) == before, tag+': loft '+name+' preserves uploaded tables')
                a11y.append({'method':'loft','panel':name,'result':audit(page,tag+': loft '+name)})
                if CAPTURE:
                    folder = Path(CAPTURE); folder.mkdir(parents=True, exist_ok=True)
                    page.evaluate('window.scrollTo({top:0,behavior:"instant"})')
                    page.screenshot(path=str(folder / f'app-{tag}-loft-{name}.png'), full_page=True)
            selector.select_option('contacts')
            check(page.get_attribute('#domainToolNavigate', 'aria-pressed') == 'true',
                  tag+': changing method from Handoff also leaves the canvas in navigation mode')
            step(page, 'solid')
            page.locator('#domainSolidTopo').select_option('collars')
            page.locator('#domainSolidBuild').click()
            built = page.evaluate('window.__domainSolid')
            check(built and abs(built['volume'] - 60000) < 1e-6
                  and abs(built['meshVolume'] - 60000) < 1e-6,
                  tag+': native uploaded contacts build the independent 60,000 m³ prism')
            check(page.locator('#domainSolidAcceptBtn').is_disabled(), tag+': build does not record review')
            page.locator('#domainSolidReview').check()
            page.locator('#domainSolidReviewer').fill('Synthetic reviewer')
            page.locator('#domainSolidReason').fill('Synthetic fixture: inspected top/base contacts and the independent prism volume.')
            page.locator('#domainSolidAcceptBtn').click()
            page.wait_for_function('()=>document.querySelector("#domainReadiness [aria-current=true]")?.dataset.state==="validated"')
            check(page.evaluate("""async()=>{const packet=await window.__orebitDomainHandoff(),verified=await reviewedGeologicalSnapshot(packet);
              return !!verified&&Object.isFrozen(verified.domains[0].build.mesh.v[0])&&verified.handoff.volume===packet.handoff.volume;}"""),
                  tag+': native accepted method produces a receiving-valid immutable reviewed packet')
            for name in ('book', 'contacts', 'solid', 'handoff'):
                step(page, name)
                check(raw(page) == before
                      and page.locator('#domainReadiness [aria-current=true]').get_attribute('data-state') == 'validated',
                      tag+': '+name+' navigation preserves the reviewed geometry and raw source')
                clipped = page.locator('.domain-inspector button:visible').evaluate_all('''buttons=>buttons
                  .filter(e=>e.scrollWidth>e.clientWidth+1)
                  .map(e=>({id:e.id,text:e.textContent,width:e.clientWidth,content:e.scrollWidth}))''')
                check(not clipped, tag+': '+name+' inspector action labels fit: '+str(clipped))
                a11y.append({'method':'contacts','panel':name,'result':audit(page,tag+': contacts '+name)})
                if CAPTURE:
                    folder = Path(CAPTURE); folder.mkdir(parents=True, exist_ok=True)
                    page.evaluate('window.scrollTo({top:0,behavior:"instant"})')
                    page.screenshot(path=str(folder / f'app-{tag}-contacts-{name}.png'), full_page=True)
            contacts_codebook=codebook_lifecycle(page,tmp,'contacts',tag,before)
            check(not errors and not page.evaluate('window.__methodRenderErrors'), tag+': no page or swallowed render errors')
            check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'), tag+': no page overflow')
            page.locator('button.orebit-avatar').click()
            page.once('dialog', lambda dialog: dialog.accept('domain-review-Core.orebit'))
            with page.expect_download() as downloaded:
                page.locator('.orebit-profile-menu [data-act="export"]').click()
            project = Path(tmp) / f'{tag}-review.orebit'
            downloaded.value.save_as(str(project))
            bundle = json.loads(project.read_text())
            saved = bundle['geologicalDomain']['domains'][0]['build']['review']
            check(saved['reviewer'] == 'Synthetic reviewer' and saved['sourceHash'] == bundle['geologicalDomain']['source']['sha256'],
                  tag+': native project export retains reviewer, rationale and source binding')
            navigate(page, 2)
            with page.expect_file_chooser() as chooser:
                page.locator('#btnImportBundle').click()
            chooser.value.set_files(str(project))
            page.wait_for_function('()=>OrebitCoreDomain.exportState().domains.length===1')
            reopened = page.evaluate('''async()=>({state:OrebitCoreDomain.exportState(),readiness:await OrebitCoreDomain.readiness()})''')
            check(reopened['readiness']['status'] == 'validated'
                  and reopened['state']['domains'][0]['build']['review'] == saved and raw(page) == before,
                  tag+': native project reopen preserves exact review and raw tables without re-approval')
            restoration = page.evaluate('''async()=>{
              const original=OrebitCoreDomain.exportState(),legacy=JSON.parse(JSON.stringify(original));
              delete legacy.domains[0].build.review;delete legacy.domains[0].build.reviewHash;
              await OrebitCoreDomain.restore(legacy);
              const legacyStatus=await OrebitCoreDomain.readiness(),legacyMesh=OrebitCoreDomain.exportState().domains[0].build.mesh;
              await OrebitCoreDomain.restore(original);
              const tampered=JSON.parse(JSON.stringify(original));tampered.domains[0].build.review.reason+=' changed';
              await OrebitCoreDomain.restore(tampered);
              const tamperedStatus=await OrebitCoreDomain.readiness(),reason=OrebitCoreDomain.exportState().domains[0].build.staleReason;
              await OrebitCoreDomain.restore(original);
              return {legacyStatus,tamperedStatus,reason,meshPreserved:JSON.stringify(legacyMesh)===JSON.stringify(original.domains[0].build.mesh),
                recovered:(await OrebitCoreDomain.readiness()).status};
            }''')
            check(restoration['legacyStatus']['status'] == 'stale' and restoration['meshPreserved']
                  and restoration['tamperedStatus']['status'] == 'stale'
                  and restoration['reason'] == 'Stored solid review changed'
                  and restoration['recovered'] == 'validated' and raw(page) == before,
                  tag+': legacy/tampered review is stale, preserves geometry/raw, and exact reviewed project recovers')
            metrics['cases'][tag] = {'codebookLifecycle':{'contacts':contacts_codebook,'loft':loft_codebook},'volume': built['volume'], 'mesh_volume': built['meshVolume'],
                                     'loft_volume': loft_built['volume'],
                                     'a11y': a11y,
                                     'source_preserved': raw(page) == before, 'page_errors': errors}
            page.close()
        browser.close()
        if CAPTURE:
            (Path(CAPTURE) / 'metrics.json').write_text(json.dumps(metrics, indent=2)+'\n')
finally:
    server.shutdown()
print(f'Core Domain native method routes: {passed} checks passed')
