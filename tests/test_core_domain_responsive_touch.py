"""Missing Domain viewport/input dimensions, over native raw-CSV interpretations."""
import functools
import hashlib
import http.server
import json
import os
import time
import traceback
from importlib.metadata import version
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright, Page
import test_core_domain_positive_layout as native
from domain_native_fixture import write_domain_fixture

ROOT=native.ROOT
DIST=Path(os.environ.get('OREBIT_TEST_DIST',ROOT/'dist'))
AXE=os.environ.get('OREBIT_AXE_PATH')
EVIDENCE=os.environ.get('OREBIT_DOMAIN_TOUCH_EVIDENCE')
passed=0
DIAGNOSTICS=os.environ.get('OREBIT_DOMAIN_TOUCH_DIAGNOSTICS')
active_diagnostic={}

def capture_failure(condition,error):
    if not DIAGNOSTICS:return
    out=Path(DIAGNOSTICS);out.mkdir(parents=True,exist_ok=True)
    page=active_diagnostic.get('page');record={k:v for k,v in active_diagnostic.items()if k!='page'}
    record.update(condition=condition,error=str(error),traceback=traceback.format_exc())
    path=out/('failure-'+str(time.time_ns())+'.json')
    path.write_text(json.dumps(record,indent=2)+'\n')
    if page:
        try:
            record['state']=page.evaluate('''()=>{const c=document.getElementById('domainViewerCanvas');return {view:window.OrebitCoreDomainViewer?.state(),cssZoom:document.documentElement.style.zoom||'1',theme:document.documentElement.getAttribute('data-theme'),dpr:devicePixelRatio,step:document.querySelector('.domain-steps [aria-current=step]')?.dataset.domainStep,active:document.activeElement?.id,scroll:[scrollX,scrollY],viewport:[innerWidth,innerHeight],canvas:c?{bitmap:[c.width,c.height],layout:[c.clientWidth,c.clientHeight]}:null,animations:document.getAnimations().map(a=>({state:a.playState,iterations:a.effect?.getComputedTiming().iterations,target:a.effect?.target?.id})),cameraInputs:window.__domainCameraInputs||[],errors:window.__positiveErrors||[]};}''')
            page.screenshot(path=str(path.with_suffix('.png')),timeout=5000)
            page.context.tracing.stop(path=str(path.with_suffix('.trace.zip')));record['trace_saved']=True
        except Exception as diagnostic_error:record['capture_error']=str(diagnostic_error)
    path.write_text(json.dumps(record,indent=2)+'\n')
    print('DOMAIN_TOUCH_FAILURE',json.dumps({k:v for k,v in record.items()if k not in ['state','traceback']}),flush=True)


def check(value,message):
    global passed
    if not value:capture_failure(message,AssertionError(message))
    assert value,message
    passed+=1
    print('PASS:',message,flush=True)

def activate(locator,touch):
    if touch:locator.tap()
    else:locator.click()

def main():
    started=time.monotonic()
    handler=functools.partial(type('Quiet',(http.server.SimpleHTTPRequestHandler,),{'log_message':lambda *_:None}),directory=str(DIST))
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    metrics={'cases':{},'scope':'Additional320/1024/1280 plus844×390 landscape; coarse-touch browser emulation is not a physical device/OS/AT acceptance.'}
    original_wait=Page.wait_for_function
    def observed_wait(page,expression,*args,**kwargs):
        try:return original_wait(page,expression,*args,**kwargs)
        except Exception as error:
            active_diagnostic['page']=page;capture_failure(expression,error);raise
    if DIAGNOSTICS:Page.wait_for_function=observed_wait
    try:
        with tempfile.TemporaryDirectory(prefix='domain-touch-') as folder,sync_playwright() as pw:
            paths=write_domain_fixture(Path(folder),measured_ends=True)
            metrics['fixtures']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
            browser=pw.chromium.launch()
            metrics['runtime']={'playwright':version('playwright'),'chromium':browser.version}
            metrics['sourceSha256']={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('src/shared/ui/core-domain-viewer.js','src/ui/core/styles.css','tests/geosuite/test_core_domain_responsive_touch.py','tests/geosuite/test_core_domain_positive_layout.py','tests/geosuite/domain_native_fixture.py')}
            for method in ('contacts','loft'):
                for lang in ('en','id'):
                    for width,height,touch in ((320,844,True),(844,390,True),(1024,768,False),(1280,900,False)):
                        tag=f'{method}:{lang}:{width}x{height}'
                        if os.environ.get('OREBIT_DOMAIN_TOUCH_CASE') and os.environ['OREBIT_DOMAIN_TOUCH_CASE']!=tag:continue
                        page=browser.new_page(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch)
                        active_diagnostic.clear();active_diagnostic.update(page=page,case=tag,stage='native-model')
                        if DIAGNOSTICS:page.context.tracing.start(screenshots=False,snapshots=True)
                        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                        page.goto(f'http://127.0.0.1:{server.server_port}/Core.html')
                        raw,volume=native.native_model(page,paths,method,lang);model=native.accepted(page)
                        if AXE:page.add_script_tag(path=AXE)
                        states=[]
                        for task in ('book','contacts','solid','handoff'):
                            activate(page.locator(f'.domain-steps [data-domain-step="{task}"]'),touch)
                            for theme,zoom in (('light',1),('light',2),('dark',1),('dark',2)):
                                active_diagnostic.update(stage='layout',task=task,theme=theme,zoom=zoom)
                                if page.evaluate('(document.documentElement.getAttribute("data-theme")||"light")')!=theme:page.evaluate('toggleTheme()')
                                page.wait_for_function("()=>document.getAnimations().every(a=>a.effect?.getComputedTiming().iterations===Infinity||a.playState!=='running')")
                                page.evaluate('(z)=>{document.documentElement.style.zoom=String(z);window.scrollTo(0,0)}',zoom)
                                page.wait_for_function("()=>{const c=document.getElementById('domainViewerCanvas');return Math.abs(c.width/(devicePixelRatio||1)-c.clientWidth)<1&&Math.abs(c.height/(devicePixelRatio||1)-c.clientHeight)<1}")
                                layout=page.evaluate("""()=>{const panel=document.getElementById('tab14'),view=document.getElementById('domainViewerPanel'),bar=panel.querySelector('.workflow-stage-bar');
                                  const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
                                  const controls=[...panel.querySelectorAll('input:not([type=hidden]),select,textarea,button')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('.workflow-step-links'));
                                  return {overflow:document.documentElement.scrollWidth-innerWidth,view:box(view),bar:box(bar),outside:controls.filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).map(e=>e.id||e.textContent.trim())};}""")
                                if task=='book' and theme=='light':
                                    links=page.locator('#tab14 .workflow-step-links button');links.first.focus()
                                    for index in range(links.count()):
                                        if index:page.keyboard.press('Tab')
                                        page.wait_for_function("""index=>{const e=document.querySelectorAll('#tab14 .workflow-step-links button')[index],r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return document.activeElement===e&&r.left>=p.left-1&&r.right<=p.right+1&&r.left>=-1&&r.right<=innerWidth+1}""",arg=index)
                                    check(True,tag+f'/zoom{zoom}: native Tab reveals every complete related-stage link')
                                check(layout['overflow']<=1 and not layout['outside'],tag+f'/{task}/{theme}/{zoom}: all current controls fit '+str(layout))
                                check(layout['view']['width']>100 and layout['view']['height']>100 and layout['bar']['top']>=layout['view']['bottom']-1,tag+f'/{task}/{theme}/{zoom}: scene stays visible with footer below it')
                                check(native.accepted(page)==model and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==raw,tag+f'/{task}/{theme}/{zoom}: view/input changes preserve raw and accepted interpretation')
                                entry={'task':task,'theme':theme,'cssZoom':zoom,'layout':layout}
                                if touch and task=='book' and theme=='light' and zoom==1:
                                    targets=page.evaluate("""()=>[...document.querySelectorAll('#tab14 button')].filter(e=>e.getClientRects().length&&!e.disabled&&!e.hidden).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,label:e.textContent.trim(),width:r.width,height:r.height}})""")
                                    check(all(t['width']>=43.9 and t['height']>=43.9 for t in targets),tag+': actual coarse-pointer command targets reach44px '+str(targets));entry['touchTargets']=targets
                                if AXE and zoom==1:
                                    audit=page.evaluate("""async()=>{const r=await axe.run({include:[['#tab14']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {version:axe.version,incomplete:r.incomplete.map(x=>x.id),violations:r.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))};}""")
                                    check(not audit['violations'],tag+f'/{task}/{theme}: no automatic scoped violations '+str(audit));entry['axe']=audit
                                if EVIDENCE and theme=='light' and zoom==1:
                                    out=Path(EVIDENCE);out.mkdir(parents=True,exist_ok=True);image=out/f'{method}-{lang}-{width}-{height}-{task}.png'
                                    page.screenshot(path=str(image),full_page=True,animations='disabled');entry['image']=image.name;entry['sha256']=hashlib.sha256(image.read_bytes()).hexdigest()
                                states.append(entry)
                            page.evaluate("document.documentElement.style.zoom='1'")
                        # A real tap/click of the footer uses the same existing owner.
                        activate(page.locator('.domain-steps [data-domain-step="book"]'),touch)
                        activate(page.locator('#tab14 .workflow-stage-bar-next'),touch)
                        page.wait_for_function("()=>document.querySelector('.domain-steps [aria-current=step]')?.dataset.domainStep==='contacts'")
                        check(native.accepted(page)==model,tag+': native touch/mouse footer reaches interpretation without accepting or changing geometry')
                        activate(page.locator('#domainToolNavigate'),touch)
                        activate(page.locator('[data-mode="3d"]'),touch)
                        page.wait_for_function("()=>OrebitCoreDomainViewer.state().mode==='3d'||!!document.querySelector('#domain3dFallback:not([hidden])')")
                        if page.evaluate("OrebitCoreDomainViewer.state().mode==='3d'"):
                            page.wait_for_function("()=>!!document.getElementById('domainViewer3d')._fullLayout?.scene?._scene")
                            plot=page.locator('#domainViewer3d');plot.scroll_into_view_if_needed();box=plot.bounding_box()
                            page.wait_for_function("()=>{const c=JSON.stringify(document.getElementById('domainViewer3d')._fullLayout.scene._scene.getCamera());if(window.__domainLastCamera!==c){window.__domainLastCamera=c;return false}return true}")
                            camera=page.evaluate('JSON.stringify(document.getElementById("domainViewer3d")._fullLayout.scene._scene.getCamera())')
                            active_diagnostic.update(stage='native-3d-gesture',task='contacts',zoom=1)
                            page.evaluate("()=>{window.__domainCameraInputs=[];const plot=document.getElementById('domainViewer3d');for(const type of ['pointerdown','pointermove','pointerup','touchmove'])plot.addEventListener(type,e=>{if(e.isTrusted)__domainCameraInputs.push({type:e.type,pointer:e.pointerType||(e.type==='touchmove'?'touch':null)});},true);}")
                            x=box['x']+box['width']*.45;y=max(90,min(height-100,box['y']+box['height']*.5))
                            check(page.evaluate('([x,y])=>!!document.elementFromPoint(x,y)?.closest("#domainViewer3d")',[x,y]),tag+': native gesture starts on the actual3D view')
                            if touch:
                                session=page.context.new_cdp_session(page)
                                session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':1}]})
                                for step in range(1,6):
                                    session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+step*6,'y':y+step*2,'id':1}]})
                                    page.evaluate('()=>new Promise(requestAnimationFrame)')
                                # Plotly's 3D controller consumes touchmove, not
                                # pointermove. Confirm delivery before ending
                                # the gesture; keep the camera assertion below.
                                page.wait_for_function("()=>__domainCameraInputs.some(e=>e.type==='touchmove'&&e.pointer==='touch')")
                                session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});session.detach()
                            else:
                                page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+30,y+10,steps=5);page.mouse.up()
                            if os.environ.get('OREBIT_DOMAIN_TOUCH_DEBUG'):print('CAMERA INPUT',tag,page.evaluate('([x,y])=>({hit:document.elementFromPoint(x,y)?.outerHTML?.slice(0,300),events:__domainCameraInputs,camera:document.getElementById("domainViewer3d")._fullLayout.scene._scene.getCamera(),scrollY})',[x,y]),'before',camera,flush=True)
                            page.wait_for_function('(before)=>JSON.stringify(document.getElementById("domainViewer3d")._fullLayout.scene._scene.getCamera())!==before',arg=camera)
                            page.wait_for_function("()=>__domainCameraInputs.some(e=>e.type==='pointermove')")
                            check(page.evaluate('(pointer)=>__domainCameraInputs.some(e=>e.type==="pointermove"&&e.pointer===pointer)', 'touch' if touch else 'mouse') and native.accepted(page)==model and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==raw,tag+': trusted native pointer/camera input preserves raw and reviewed mesh')
                        else:check(native.accepted(page)==model,tag+': honest graphics fallback retains accepted model')
                        active_diagnostic.update(stage='pointer-and-digitize')
                        digitize=None
                        if touch:
                            page.locator('#domainBuildMethod').select_option('loft')
                            activate(page.locator('.domain-steps [data-domain-step="contacts"]'),True)
                            activate(page.locator('#domainLoftNewDomain'),True)
                            dialog=page.locator('[role="dialog"][aria-modal="true"]:not(#mobileNavDrawer):visible')
                            if dialog.is_visible():
                                activate(dialog.get_by_role('button',name='Continue' if lang=='en' else 'Lanjutkan',exact=True),True)
                            page.wait_for_function("()=>document.querySelector('.domain-steps [aria-current=step]')?.dataset.domainStep==='book'")
                            activate(page.locator('.domain-steps [data-domain-step="contacts"]'),True)
                            activate(page.locator('#domainToolDigitize'),True)
                            page.locator('#domainLoftSnap').fill('0');page.locator('#domainLoftSnap').press('Tab')
                            page.evaluate("document.documentElement.style.zoom='2'")
                            page.wait_for_function("()=>{const c=document.getElementById('domainViewerCanvas');return Math.abs(c.width/(devicePixelRatio||1)-c.clientWidth)<1}")
                            canvas=page.locator('#domainViewerCanvas');canvas.scroll_into_view_if_needed();bounds=canvas.bounding_box()
                            screen=page.evaluate("""()=>{const c=document.getElementById('domainViewerCanvas'),p=OrebitCoreDomainViewer.toScreen(-10,90),h=OrebitCoreDomainViewer.toScreen(-9,90),v=OrebitCoreDomainViewer.toScreen(-10,91);return {p,h,v,width:c.clientWidth,height:c.clientHeight}}""")
                            sx=bounds['width']/screen['width'];sy=bounds['height']/screen['height']
                            x=bounds['x']+screen['p'][0]*sx;y=bounds['y']+screen['p'][1]*sy
                            page.evaluate('(y)=>window.scrollBy(0,y-innerHeight/2)',y)
                            bounds=canvas.bounding_box();x=bounds['x']+screen['p'][0]*sx;y=bounds['y']+screen['p'][1]*sy
                            hit=page.evaluate('([x,y])=>({id:document.elementFromPoint(x,y)?.id,tag:document.elementFromPoint(x,y)?.outerHTML?.slice(0,200),x,y,scrollY,innerWidth,innerHeight})',[x,y])
                            check(hit['id']=='domainViewerCanvas',tag+': zoomed digitizing target is hit on the actual canvas '+str({'hit':hit,'canvas':bounds,'screen':screen}))
                            page.touchscreen.tap(x,y)
                            page.wait_for_function('()=>__domainLoft.draft.length===1')
                            point=page.evaluate('__domainLoft.draft[0]')
                            h_tolerance=1.01/(abs(screen['h'][0]-screen['p'][0])*sx)
                            v_tolerance=1.01/(abs(screen['v'][1]-screen['p'][1])*sy)
                            digitize={'expected':[-10,90],'actual':point,'oneRenderedPixelTolerance':[h_tolerance,v_tolerance],'cssZoom':2}
                            check(abs(point['h']+10)<=h_tolerance and abs(point['rl']-90)<=v_tolerance,tag+': native scaled tap records declared world point within one rendered pixel '+str(digitize))
                            check(native.accepted(page)==model and page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==raw,tag+': new working point never modifies the prior accepted solid or raw data')
                            def tap_world(h,rl):
                                canvas.scroll_into_view_if_needed();rect=canvas.bounding_box()
                                pixel=page.evaluate('([h,rl])=>({point:OrebitCoreDomainViewer.toScreen(h,rl),w:document.getElementById("domainViewerCanvas").clientWidth,h:document.getElementById("domainViewerCanvas").clientHeight})',[h,rl])
                                y=rect['y']+pixel['point'][1]*rect['height']/pixel['h']
                                page.evaluate('(y)=>window.scrollBy(0,y-innerHeight/2)',y)
                                rect=canvas.bounding_box()
                                page.touchscreen.tap(rect['x']+pixel['point'][0]*rect['width']/pixel['w'],rect['y']+pixel['point'][1]*rect['height']/pixel['h'])
                            for count,(h,rl) in enumerate(((10,90),(0,92)),2):
                                tap_world(h,rl);page.wait_for_function('(n)=>__domainLoft.draft.length===n',arg=count)
                            tap_world(point['h'],point['rl'])
                            page.wait_for_function('()=>__domainLoft.sections.length===1&&!__domainLoft.draft.length')
                            check(native.accepted(page)==model,tag+': scaled tap of the first vertex closes only the new working ring')
                            activate(page.locator('#domainToolEdit'),True);tap_world(point['h'],point['rl'])
                            page.wait_for_function('()=>__domainLoft.selected?.kind==="section"&&__domainLoft.selected.index===0')
                            check(native.accepted(page)==model,tag+': scaled Edit tap selects the actual first vertex without altering accepted geometry')
                            activate(page.locator('#domainLoftUndo'),True);page.wait_for_function('()=>!__domainLoft.sections.length&&__domainLoft.draft.length===3')
                            activate(page.locator('#domainToolDigitize'),True)
                            activate(page.locator('#domainLoftClear'),True);page.wait_for_function('()=>!__domainLoft.draft.length')
                            page.evaluate("document.documentElement.style.zoom='1'")
                        metrics['cases'][tag]={'volume':volume,'touch':touch,'states':states,'digitize':digitize}
                        check(not errors and not page.evaluate('__positiveErrors.length'),tag+': no page/swallowed renderer errors '+str({'page':errors,'render':page.evaluate('__positiveErrors')}))
                        if DIAGNOSTICS:page.context.tracing.stop()
                        page.close()
            browser.close()
    finally:
        Page.wait_for_function=original_wait
        server.shutdown();server.server_close()
    metrics['checks']=passed;metrics['nativeBuilderChecks']=native.passed;metrics['wallSeconds']=round(time.monotonic()-started,2)
    if EVIDENCE:(Path(EVIDENCE)/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps({'suite':'Core Domain responsive touch','checks':passed,'nativeBuilderChecks':native.passed,'cases':len(metrics['cases'])}),flush=True)

if __name__=='__main__':main()
