"""Backward-compatible Core mapping and optional Resource estimation features.
Uses actual file uploads, existing mapper controls, and built product functions.
"""
import csv
import functools
import http.server
import io
import json
import math
import os
from pathlib import Path
import tempfile
import threading
from playwright.sync_api import sync_playwright
ROOT = next(p for p in Path(__file__).resolve().parents if (p/'build/build.mjs').exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST',ROOT/'dist'))
passed = 0

def check(condition, message):
    global passed
    assert condition, message
    passed += 1
    print('PASS:', message, flush=True)

def close(a,b): return abs(a-b)<1e-7

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(DIST)))
threading.Thread(target=server.serve_forever,daemon=True).start()

def page(browser,phase):
    pg=browser.new_page(accept_downloads=True,viewport={'width':1400,'height':1000})
    pg.goto(f'http://127.0.0.1:{server.server_port}/{phase}.html',wait_until='domcontentloaded')
    pg.wait_for_function("() => typeof showTab === 'function'")
    pg.wait_for_function('()=>window.__i18nBooted===true')
    if pg.locator('.lang-picker-overlay').count():
        pg.locator('.lang-picker-overlay [data-pick="en"]').click()
    return pg

def tab(pg,n):
    pg.evaluate(f'showTab({n})')
    if n == 6:
        if not pg.locator('#resourceSearchOptions').evaluate('e=>e.open'):
            pg.locator('#resourceSearchOptions>summary').click()
        check(pg.locator('#resourceSearchOptions').evaluate('e=>e.open'), 'Search edits follow native task Options')

def assign(pg,table,mapping):
    tab(pg,7)
    panel=pg.locator('#coreValidationMapping')
    if panel.get_attribute('open') is None:
        panel.locator(':scope > summary').click()
    group=pg.locator(f'#map_{table}_hole_id').locator('xpath=ancestor::details[1]')
    if group.get_attribute('open') is None:
        group.locator(':scope > summary').click()
    for key,val in mapping.items():
        pg.locator(f'#map_{table}_{key}').select_option(val)
    action=group.locator(f"button[onclick=\"applyColumnMapping('{table}')\"]")
    action.scroll_into_view_if_needed()
    check(action.evaluate("e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===e||e.contains(hit)}"), 'Mapping Apply has a real pointer target in task Options')
    action.click()

with tempfile.TemporaryDirectory() as temp:
    tmp=Path(temp)
    def file(name,text):
        p=tmp/name;p.write_text(text);return str(p)
    collar=file('collar.csv','hole_id,E_custom,N_custom,Z_custom,TD_custom,note\nH1,100,200,300,100,retained\n')
    assay=file('assay.csv','hole_id,from_m,to_m,ni_pct,mx_custom,my_custom,mz_custom,custom_note\nH1,0,10,1.5,1000,2000,3000,keep-me\n')
    survey=file('survey.csv','hole_id,depth,dip,azimuth\nH1,0,-90,0\nH1,100,-90,0\n')
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
            c=page(browser,'Core');tab(c,2)
            c.locator('#fileInput').set_input_files([collar,survey,assay])
            c.wait_for_function("() => STATE.assay.length===1 && !STATE.isSample.assay")
            c.wait_for_timeout(500)
            check(c.evaluate("STATE.collar[0].x===null && STATE.rawHeaders.collar.includes('E_custom')"),'unknown headers remain available without adding aliases')
            assign(c,'collar',{'x':'E_custom','y':'N_custom','z':'Z_custom','depth':'TD_custom'})
            c.evaluate('computeMerge()')
            xyz=c.evaluate('STATE.merged.map(r=>[r.midx,r.midy,r.midz])[0]')
            check(all(close(a,b) for a,b in zip(xyz,[100,200,295])),'existing survey merge stays default; extra supplied coordinates ignored')
            check(c.evaluate("STATE.assay[0].ni_pct===1.5 && STATE.assay[0].custom_note==='keep-me'"),'grade and extra metadata survive import/manual assignment')
            tab(c,2);c.locator('#coreProvidedXYZ').check()
            assign(c,'assay',{'midx':'mx_custom','midy':'my_custom','midz':'mz_custom'})
            c.evaluate('computeMerge()')
            check(c.evaluate("JSON.stringify([STATE.merged[0].midx,STATE.merged[0].midy,STATE.merged[0].midz])==='[1000,2000,3000]'"),'manual assignment accepts arbitrary midpoint headers')
            c.evaluate("() => { STATE.assay[0].midx=''; STATE.merged=null; computeMerge(); }")
            check(c.evaluate('STATE.merged[0].midx===null'),'blank coordinates remain missing, never zero')
            assign(c,'assay',{'midx':'mx_custom','midy':'my_custom','midz':'mz_custom'})
            c.evaluate("async () => { await OrebitProject.save('coordinate-roundtrip'); window._testBundle=await dbGet('coordinate-roundtrip'); }")
            bundle=c.evaluate('window._testBundle')
            check(bundle['metadata']['coordinate_mode']=='supplied-assay-midpoints' and '# coordinates: supplied-assay-midpoints' in bundle['phase1']['merged_csv'],'project preserves coordinate mode and provenance')
            c.evaluate('async () => { resetToSample(); await applyBundle(window._testBundle); computeMerge(); }')
            check(c.evaluate('window._coreUseProvidedXYZ===true && STATE.merged[0].midx===1000'),'project reload restores supplied coordinates')
            tab(c,2);c.locator('#fileInput').set_input_files([]);c.locator('#fileInput').set_input_files([collar,survey,assay]);c.wait_for_timeout(800)
            check(c.evaluate('!window._coreUseProvidedXYZ && !document.getElementById("coreProvidedXYZ").checked'),'new assay upload resets optional mode to measured-survey default')
            tab(c,2);c.locator('#coreLengthUnit').select_option('ft');c.wait_for_timeout(800)
            assign(c,'collar',{'x':'E_custom','y':'N_custom','z':'Z_custom','depth':'TD_custom'})
            tab(c,2);c.locator('#coreProvidedXYZ').check()
            assign(c,'assay',{'midx':'mx_custom','midy':'my_custom','midz':'mz_custom'})
            c.evaluate('computeMerge()')
            row=c.evaluate('STATE.merged[0]')
            check(close(row['to_m'],3.048) and close(row['midx'],304.8) and close(row['midz'],914.4),'feet conversion works with manual structural/midpoint assignment')
            assign(c,'assay',{'midx':'mx_custom','midy':'my_custom','midz':'mz_custom'});c.evaluate('computeMerge()')
            check(c.evaluate('Math.abs(STATE.merged[0].to_m-3.048)<1e-8 && Math.abs(STATE.merged[0].midx-304.8)<1e-8'),'repeated Apply Mapping never converts feet twice')
            c.evaluate("async () => { await OrebitProject.save('feet-roundtrip'); window._ftBundle=await dbGet('feet-roundtrip'); await applyBundle(window._ftBundle); computeMerge(); }")
            check(c.evaluate("STATE.lengthUnitSource==='m' && window._coreLengthUnit==='m' && Math.abs(STATE.merged[0].midx-304.8)<1e-8"),'bundle stores normalized midpoint coordinates and resets import units')
            assign(c,'assay',{'midx':'midx','midy':'midy','midz':'midz'});c.evaluate('computeMerge()')
            check(c.evaluate('Math.abs(STATE.merged[0].midx-304.8)<1e-8'),'project manual mapping retains normalized metres')
            c.evaluate('resetToSample()');assign(c,'collar',{});c.evaluate('computeMerge()')
            check(c.evaluate("window._coreLengthUnit==='m' && STATE.collar[0].x===SAMPLE_DATA.collar[0].x"),'feet upload followed by sample mapping leaves metre sample unchanged')
            tab(c,2);c.locator('#coreLengthUnit').select_option('ft');c.wait_for_timeout(300)
            check(c.evaluate('STATE.collar.length===SAMPLE_DATA.collar.length && STATE.collar[0].x===SAMPLE_DATA.collar[0].x'),'changing future import units cannot resurrect a prior uploaded dataset')
            assign(c,'collar',{})
            check(c.evaluate('STATE.collar[0].x===SAMPLE_DATA.collar[0].x'),'manual mapping uses loaded source units rather than future import preferences')
            c.close()

            r=page(browser,'Resource');tab(r,2)
            resource=file('resource.csv','hole_id,from_m,to_m,midx,midy,midz,au_gpt,custom_note\nA,0,1,0,0,0,2,one\nB,0,1,10,0,0,4,two\n')
            r.locator('#fileInput').set_input_files(resource);r.wait_for_function('() => DATA.rows.length===2');r.wait_for_timeout(600)
            r.evaluate("() => { setupState.element='au_gpt'; setupState.domain='all'; setupState.gradeUnit='g/t'; variogramState.model={type:'spherical',nugget:.1,sill:1,range:30}; blockState.blocks=[{cx:5,cy:0,cz:0,idx:0},{cx:25,cy:0,cz:0,idx:1}]; blockState.size=[10,10,10]; blockState.origin=[0,-5,-5]; blockState.dims=[3,1,1]; blockState.density=2.9; }")
            tab(r,6)
            def fill_search(radius,fallback):
                for key,val in [('srMaj',radius),('srSemi',radius),('srMin',radius),('sMinN',2),('sMaxN',4),('sMaxHole',0),('sPassFactor',4),('sPassMin',2)]:r.locator('#'+key).fill(str(val))
                r.locator('#sDomainBound').uncheck();r.locator('#sSecondPass').set_checked(fallback)
                r.evaluate('runEstimation()');r.wait_for_function('() => estimState.done&&!estimState._running')
            fill_search(8,False)
            primary=r.evaluate('Array.from(estimState.results.ok)')
            applied_summary = r.locator('#estimationContent .card').filter(has_text='Search ellipsoid').locator(':scope > p').first
            check(applied_summary.count()==1 and applied_summary.inner_text().count('8m')==3,
                  'Search Ellipsoid summary updates to the radii applied by the completed estimate')

            check(math.isfinite(primary[0]) and math.isnan(primary[1]),'legacy single-pass estimates only informed blocks')
            tab(r,6);fill_search(8,True)
            expanded=r.evaluate('({ok:Array.from(estimState.results.ok),passes:Array.from(estimState.results.passNumber)})')
            check(expanded['passes']==[1,2] and close(expanded['ok'][0],primary[0]) and math.isfinite(expanded['ok'][1]),'fallback fills insufficient blocks without altering primary estimates')
            before=r.evaluate('JSON.stringify(searchState)');r.locator('#sAz').fill('');r.locator('#sMaxHole').fill('-1');r.evaluate('runEstimation()')
            check(r.evaluate('JSON.stringify(searchState)')==before,'invalid search leaves previous estimate parameters intact')
            # Keep deliberately invalid model probes in one browser turn. Otherwise
            # a queued workflow refresh (or its timer) correctly retires the accepted
            # estimate while range=0 is exposed between Playwright calls.
            check(r.evaluate("""async () => {
                const model=variogramState.model,result=estimState.results,confirm=confirmEstimationCost;
                try {
                    variogramState.model={...model,range:0};confirmEstimationCost=async()=>true;
                    for(const [id,value] of Object.entries({srMaj:8,srSemi:8,srMin:8,sAz:0,sDip:0,sMinN:2,sMaxN:4,sMaxHole:0}))document.getElementById(id).value=value;
                    await runEstimation();
                    return estimState.results===result && estimState.done && OrebitResourceEstimateContract.validate(variogramState.model,searchState,getSamples().length).valid===false;
                } finally {variogramState.model=model;confirmEstimationCost=confirm;}
            }"""), 'invalid variogram is rejected before it can overwrite the accepted result')
            r.evaluate('() => {renderCrossVal();crossvalState={results:null,metrics:null};}')
            check(r.evaluate("""() => {
                const model=variogramState.model;
                try {
                    variogramState.model={...model,range:0};runCrossVal();
                    return !crossvalState.metrics && !crossvalState.results;
                } finally {variogramState.model=model;}
            }"""), 'cross-validation shares the model/search prerequisite gate')
            check(r.evaluate('estimState.done && !!estimState.results && estimState.appliedSignature===resourceCalculationSignature()'), 'invalid-model probes restore the accepted calculation context before export')
            def export(flavor):
                with r.expect_download() as ev:r.evaluate(f"exportBlockCSV('{flavor}')")
                p=tmp/(flavor+'.csv');ev.value.save_as(str(p))
                return list(csv.reader(io.StringIO('\n'.join(line for line in p.read_text().splitlines() if line and not line.startswith('#')))))
            generic=export('generic');audit=export('audit');ijk=export('ijk')
            check(generic[0]==['X','Y','Z','X_INC','Y_INC','Z_INC','IDW','OK','NN','KRIGE_VAR','NEAR_DIST','N_NEIGHBORS','CLASS'] and all(len(row)==13 for row in generic),'generic CSV retains exact legacy column names/order/count')
            check(audit[0]==generic[0]+['DENSITY','PASS','N_HOLES','SUPPORT_VOLUME_M3','SUPPORT_DOMAINS'] and all(len(row)==18 for row in audit),'audit columns add density and filled-support reconciliation without changing generic export')
            check(ijk[1][6]=='1-1-1' and ijk[2][6]=='3-1-1','IJK retains lattice gaps after envelope masking')
            nested={'type':'spherical','nugget':.45,'sill':1,'range':150,'azDeg':90,'aniso':{'rMaj':150,'rSemi':60,'rMin':40},'struct1':{'type':'spherical','psill':.35,'rangeMaj':10,'rangeMin':8,'rangeVert':15},'struct2':{'type':'spherical','psill':.2,'rangeMaj':150,'rangeMin':60,'rangeVert':40}}
            r.evaluate('(m)=>{variogramState.model=m;blockState.envelopeMode="xyz";blockState.envelopeRadius=25;saveResourceSession();variogramState.model=null;restoreResourceSession();}',nested)
            check(r.evaluate('variogramState.model')==nested,'session roundtrip preserves full nested model and anisotropy')
            r.evaluate('() => noteSessionRecovered(JSON.parse(localStorage.getItem(RESOURCE_SESSION_KEY)))')
            recovery=r.locator('#resourceRecoveryNote').inner_text()
            check('Resource setup restored' in recovery and 'Recompute declustering' in recovery
                  and 'Generate Grid' in recovery and 'Run Estimation' in recovery
                  and r.locator('#resourceRecoveryNote button').count()==0,
                  'Recovered setup notice explains pending calculations without a misleading clean-start button')
            r.evaluate("() => {const p=JSON.parse(localStorage.getItem(RESOURCE_SESSION_KEY));delete p.envelopeMode;delete p.envelopeRadius;delete p.search.maxPerHole;delete p.search.secondPass;localStorage.setItem(RESOURCE_SESSION_KEY,JSON.stringify(p));blockState.envelopeMode='xy';searchState.maxPerHole=0;searchState.secondPass=false;restoreResourceSession();}")
            check(r.evaluate("blockState.envelopeMode==='xy'&&!searchState.secondPass&&searchState.maxPerHole===0"),'legacy session without new fields still loads with original defaults')
            r.evaluate('blockState.envelopeMode="xyz";blockState.envelopeRadius=.01;blockState.envelopeRadiusUserSet=true');tab(r,5)
            old=r.evaluate('JSON.stringify({size:blockState.size,blocks:blockState.blocks})')
            r.locator('#bmX').fill('10');r.locator('#bmY').fill('10');r.locator('#bmZ').fill('10');r.evaluate('generateBlocks()');r.wait_for_timeout(200)
            check(r.evaluate('JSON.stringify({size:blockState.size,blocks:blockState.blocks})')==old,'empty sparse grid cannot replace geometry underneath existing results')
            r.evaluate('blockState.envelopeRadius=25;searchState.maxPerHole=4;searchState.secondPass=true');tab(r,2)
            resource2=file('resource2.csv','hole_id,from_m,to_m,midx,midy,midz,ni_pct\nC,0,1,50,0,0,1.2\nD,0,1,60,0,0,1.4\n')
            r.locator('#fileInput').set_input_files(resource2);r.wait_for_function("() => DATA.columns.includes('ni_pct')");r.wait_for_timeout(500)
            check(r.evaluate("blockState.envelopeMode==='xyz'&&searchState.maxPerHole===0&&!searchState.secondPass&&estimState.results===null"),'new commodity upload resets all added estimation options and results')
            tab(r,5);r.locator('#bmDens').fill('0');old=r.evaluate('JSON.stringify([blockState.blocks,blockState.size,blockState.density,blockState.densityUserSet])')
            r.locator('#bmGenBtn').click();r.wait_for_timeout(200)
            check(r.evaluate('JSON.stringify([blockState.blocks,blockState.size,blockState.density,blockState.densityUserSet])')==old, 'Invalid density stops grid generation without silently substituting 1 t/m3')
            r.locator('#bmDens').fill('2');r.locator('#bmGenBtn').click();r.wait_for_function('() => blockState.blocks?.length>0')
            check(r.evaluate('resourceDensityAudit(blockState.blocks.map((_,i)=>i)).fallback===blockState.blocks.length'), 'Uniform density provenance explicitly records every cell using the entered fallback')
            check(r.evaluate("resourceDensityAudit(blockState.blocks.map((_,i)=>i)).source==='entered-uniform'"), 'Only successfully generated, valid density is recorded as explicitly entered')
            tab(r,3);r.locator('#setupGradeUnit').select_option('kg/m³')
            check(r.evaluate('!blockState.blocks && !estimState.done && !_gtCurveSnapshot'), 'Changing mass grade to volumetric invalidates incompatible existing model results')
            tab(r,5);r.locator('#bmGenBtn').click();r.wait_for_function('() => blockState.blocks?.length>0')
            check(r.evaluate('blockState.density===1 && !blockState.blockDensities'), 'Volumetric grid uses volume weights without a measured-density assumption')
            check('Rock tonnage is not determined' in r.locator('#gridMassBasis').inner_text(), 'Volumetric grid insight explains the quantity as volume, not rock mass')
            tab(r,3);r.locator('#setupGradeUnit').select_option('%')
            check(r.evaluate('blockState.density===2 && !blockState.blocks'), 'Returning to mass grades restores the prior explicit density, with recomputation required')
            r.evaluate("setupState.gradeUnit='ppm';saveResourceSession();setupState.gradeUnit=null;restoreResourceSession()")
            check(r.evaluate("setupState.gradeUnit==='ppm'"), 'Session roundtrip preserves the explicitly assigned grade unit')
            r.evaluate("async () => { window._unitBundle=await sealProjectCapsule(buildBundle('unit-roundtrip'));setupState.gradeUnit=null;await loadBundle(window._unitBundle); }")
            check(r.evaluate("setupState.gradeUnit==='ppm' && window._unitBundle.units.ni_pct==='ppm'"), 'Native project bundle carries the explicit unit despite a conflicting percentage header')
            tab(r,2);r.locator('#fileInput').set_input_files([]);r.locator('#fileInput').set_input_files(resource2);r.wait_for_function('() => setupState.gradeUnit===null')
            check(r.evaluate("gradeUnitFor('ni_pct')==='%'"), 'A new dataset clears stale ppm overrides before interpreting nickel percentage')
            density_file=file('density-support.csv','hole_id,from_m,to_m,midx,midy,midz,au_gpt,density\nA,0,1,0,0,0,1,2\nB,0,1,10,0,0,3,3\n')
            r.locator('#fileInput').set_input_files(density_file);r.wait_for_function('() => DATA.columns.includes("density")')
            r.evaluate("() => {blockState.size=[1,1,1];blockState.blocks=[{cx:1,cy:1,cz:1},{cx:1000,cy:1,cz:1}];blockState.density=2.8;assignBlockDensities();}")
            check(r.evaluate('JSON.stringify(Array.from(blockState.blockDensities))')=='[2,2.8]', 'Measured-density assignment and distant-cell fallback retain independently known values')
            audit=r.evaluate('resourceDensityAudit([0,1])')
            check(audit['assigned']==1 and audit['fallback']==1 and audit['unknown']==0, 'Density audit distinguishes a real measured value from the fallback, without comparing numeric equality')
            # The real confirmation can outlive a new file import. The old
            # owner must not read its form into the replacement dataset.
            r.evaluate("() => {variogramState.model={type:'spherical',nugget:.1,sill:1,range:30};blockState.blocks=[{cx:1,cy:0,cz:0}];blockState.size=[1,1,1];window._originalCost=confirmEstimationCost;window.confirmEstimationCost=()=>new Promise(resolve=>window._releaseCost=resolve);}")
            tab(r,6);r.locator('#srMaj').fill('999')
            r.evaluate('() => {window._pendingEstimate=runEstimation();}')
            r.wait_for_function('() => !!window._releaseCost')
            tab(r,2);r.locator('#fileInput').set_input_files(resource2)
            r.wait_for_function('() => DATA.columns.includes("ni_pct") && setupState.element==="ni_pct"')
            r.evaluate('async()=>{_releaseCost(true);await _pendingEstimate;window.confirmEstimationCost=_originalCost;}')
            check(r.evaluate('!estimState.done && estimState.results===null && searchState.rMaj===200'), 'Pending estimation confirmation cannot overwrite a newly uploaded dataset or its search defaults')
            # Defer the actual CV callback, import through the normal file input,
            # then dispatch it. This isolates scheduling, not numerical results.
            cvfile=file('cv-race.csv','hole_id,from_m,to_m,midx,midy,midz,au_gpt\n'+''.join(f'H{i},0,1,{i*2},0,0,{1+i/10}\n' for i in range(40)))
            r.locator('#fileInput').set_input_files(cvfile);r.wait_for_function('() => DATA.rows.length===40')
            r.evaluate("variogramState.model={type:'spherical',nugget:.1,sill:1,range:50}");tab(r,7)
            r.evaluate("() => {const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===30?(window._pendingCV=fn,0):original(fn,ms,...args);runCrossVal();window.setTimeout=original;}")
            tab(r,2);r.locator('#fileInput').set_input_files(resource2);r.wait_for_function('() => DATA.columns.includes("ni_pct")')
            r.evaluate('window._pendingCV()')
            check(r.evaluate('!crossvalState.metrics && !crossvalState.results && !crossvalState._running'), 'Delayed cross-validation cannot attach old sample predictions to the replacement dataset')
            # Holes 120 m apart: the old fixed 25 m sphere left a gap at 60 m between them.
            spaced=file('spaced.csv','hole_id,from_m,to_m,midx,midy,midz,ni_pct\nP,0,1,0,0,0,1\nQ,0,1,120,0,0,1.5\nR,0,1,240,0,0,2\n')
            r.locator('#fileInput').set_input_files(spaced);r.wait_for_function('() => getSamples().some(p=>p.x===240)')
            tab(r,5)
            for key in ('bmX','bmY','bmZ'):r.locator('#'+key).fill('10')
            r.locator('#bmGenBtn').click();r.wait_for_function('() => blockState.blocks?.length>0')
            check(r.evaluate('blockState.envelopeRadius')==60 and r.evaluate('blockState.blocks.filter(b=>b.cx>50&&b.cx<70).length')>0, 'Auto envelope radius reaches half the hole spacing, so blocks between holes stay connected')
            large=file('grid-race.csv','hole_id,from_m,to_m,midx,midy,midz,ni_pct\nA,0,1,0,0,0,1\nB,0,1,400,400,100,2\n')
            r.locator('#fileInput').set_input_files(large);r.wait_for_function('() => getSamples().some(p=>p.x===400)')
            tab(r,5);r.evaluate("setResourceEnvelope('xy',25)")
            for key,value in (('bmX','2'),('bmY','2'),('bmZ','1')):r.locator('#'+key).fill(value)
            r.evaluate('() => {window._originalConfirm=orebitConfirm;window.orebitConfirm=()=>new Promise(resolve=>window._releaseGrid=resolve);window._pendingGrid=generateBlocks();}')
            r.wait_for_function('() => !!window._releaseGrid')
            tab(r,2);r.locator('#fileInput').set_input_files(resource2);r.wait_for_function('() => getSamples().some(p=>p.x===50)')
            r.evaluate('async()=>{_releaseGrid(true);await _pendingGrid;window.orebitConfirm=_originalConfirm;}')
            check(r.evaluate('!blockState.blocks && !blockState.size && !estimState.done'), 'Pending large-grid confirmation cannot install geometry from a previous dataset')
            pipeline_rows='hole_id,from_m,to_m,midx,midy,midz,ni_pct\n'+''.join(
                f'H{i},0,1,{i},0,0,{1+i/100}\n' for i in range(30))
            pipeline_file=file('pipeline-cancel.csv',pipeline_rows)
            r.locator('#fileInput').set_input_files(pipeline_file);r.wait_for_function('() => DATA.rows.length===30')
            r.evaluate('() => { startComputePipeline(); return true; }')
            r.wait_for_function("() => document.getElementById('computeOverlay')")
            r.locator('#computeOverlayCancel').click()
            r.wait_for_function("() => !document.getElementById('computeOverlay') && !document.getElementById('btnComputeAll').disabled")
            check(r.evaluate('!estimState._running && !estimState.done'), 'Cancelling the heavy pipeline tears down progress and leaves no partial estimate accepted')
            r.evaluate('() => { window._pipelineSourceBefore=DATA; startComputePipeline(); return true; }')
            r.wait_for_function("() => document.getElementById('computeOverlay')")
            r.evaluate('setActiveDataset(DATA)')
            r.wait_for_function("() => !document.getElementById('computeOverlay') && !document.getElementById('btnComputeAll').disabled")
            check(r.evaluate('DATA!==window._pipelineSourceBefore && !estimState._running'), 'Replacing the source cancels its pipeline before the new dataset can receive stale work')
            r.evaluate("""() => {
              setupState.element='ni_pct'; setupState.domain='all';
              variogramState.model={type:'spherical',nugget:.1,sill:1,range:30};
              blockState.blocks=Array.from({length:12000},(_,i)=>({cx:i*1000,cy:0,cz:0,idx:i}));
              blockState.size=[10,10,10]; blockState.origin=[0,-5,-5]; blockState.dims=[12000,1,1];
              confirmEstimationCost=async()=>true;
            }""")
            tab(r,6);fill_search(8,False)
            r.evaluate('() => { runEstimation(); return true; }')
            r.wait_for_function('() => estimState.done&&!estimState._running')
            r.evaluate('() => { window._acceptedBeforeCancel=estimState.results; window._snapshotBeforeCancel=window.__resourceResultSnapshot; }')
            r.evaluate('() => { window._originalEstimateRAF=requestAnimationFrame; window._pendingEstimateFrame=null; window.requestAnimationFrame=fn=>{window._pendingEstimateFrame=fn;return 1;}; runEstimation(); return true; }')
            r.wait_for_function("() => estimState._running && document.getElementById('estimStatus').innerHTML.includes('cancelEstimation')")
            r.evaluate('cancelEstimation()')
            r.evaluate('() => { if(window._pendingEstimateFrame)window._pendingEstimateFrame(); window.requestAnimationFrame=window._originalEstimateRAF; }')
            r.wait_for_function('() => !estimState._running')
            check(r.evaluate('estimState.results===window._acceptedBeforeCancel && estimState.done'), 'Cancelled estimation discards its partial arrays and preserves the last completed result')
            check(r.evaluate('window.__resourceResultSnapshot===window._snapshotBeforeCancel && resourceAcceptedSnapshot()===window._snapshotBeforeCancel'), 'Cancelled same-signature rerun leaves the accepted snapshot current')
            check(not r.evaluate('window._renderFailures||[]'),'compatibility scenarios contain no swallowed rendering errors')
            r.close()

            # User-visible variography help must follow the selected locale,
            # including touch-sized layouts where native title tooltips do not
            # provide reliable hover discovery. Keep the sample's scientific
            # defaults unchanged while inspecting the actual owner controls.
            for language, width in (('en', 1440), ('id', 390)):
                localized = page(browser, 'Resource')
                localized.set_viewport_size({'width': width, 'height': 844 if width < 700 else 950})
                localized.evaluate(f"applyLanguage('{language}')")
                tab(localized, 3)
                defaults = localized.evaluate("""() => ({
                  element: setupState.element, domain: setupState.domain,
                  gradeUnit: setupState.gradeUnit, declusterCell: document.querySelector('#declusterCell').value
                })""")
                check(defaults == {'element': 'ni_pct', 'domain': 'all', 'gradeUnit': None, 'declusterCell': '42'},
                      f'Resource sample Setup keeps its element, domain, auto unit, and spacing-derived decluster default in {language}/{width}')
                tab(localized, 4)
                localized.locator('#variogramSampling summary').click()
                localized.locator('#variogramModelCustom summary').click()
                help_state = localized.evaluate("""() => ({
                  defaults: [variogramState.direction, document.querySelector('#varLag').value,
                    document.querySelector('#varN').value, document.querySelector('#varTol').value,
                    document.querySelector('#varMaxH').value, document.querySelector('#varModelType').value],
                  omniLabel: document.querySelector('#varDir option[value="omni"]').textContent,
                  modelPending: variogramState.model === null,
                  samplingHelp: document.querySelector('#variogramSampling>[data-i18n="res.vg.customSamplingHelp"]').innerText,
                  titles: ['varLag','varN','varTol','varMaxH','varModelType','varNugget','varSill','varRange']
                    .map(id => document.getElementById(id).title),
                  fits: document.documentElement.scrollWidth <= innerWidth + 1
                })""")
                check(help_state['defaults'] == ['omni', '50', '15', '22.5', '', 'spherical']
                      and help_state['modelPending'] and help_state['fits'],
                      f'Variography keeps scientific defaults, leaves the model uncomputed, and fits {language}/{width}')
                if language == 'id':
                    check(help_state['omniLabel'] == 'Omnidireksional'
                          and 'Lebar bin mengelompokkan pasangan sampel menurut jarak.' in help_state['samplingHelp']
                          and 'lebar bin, dan jumlah bin' in help_state['samplingHelp']
                          and 'setengah extent data' not in help_state['samplingHelp']
                          and 'Lebar jarak untuk mengelompokkan pasangan sampel.' in help_state['titles'][0]
                          and 'Jumlah bin lag' in help_state['titles'][1]
                          and 'Rentang sudut' in help_state['titles'][2]
                          and 'Jarak maksimum' in help_state['titles'][3]
                          and 'Pilih bentuk spherical' in help_state['titles'][4]
                          and 'jarak nol' in help_state['titles'][5]
                          and 'varians total' in help_state['titles'][6]
                          and 'Jarak saat variogram mencapai sill' in help_state['titles'][7],
                          'Resource Variography instructions and all eight model/sampling tooltips are Indonesian at 390px')
                else:
                    check(help_state['omniLabel'] == 'Omnidirectional'
                          and 'The bin width groups sample pairs by distance.' in help_state['samplingHelp']
                          and 'lag width and bin count' in help_state['samplingHelp']
                          and 'half the data extent' not in help_state['samplingHelp']
                          and 'Distance width used to bin sample pairs.' in help_state['titles'][0]
                          and 'Number of lag bins' in help_state['titles'][1]
                          and 'Angular window' in help_state['titles'][2]
                          and 'Maximum distance' in help_state['titles'][3]
                          and 'Choose spherical' in help_state['titles'][4]
                          and 'zero distance' in help_state['titles'][5]
                          and 'total variance' in help_state['titles'][6]
                          and 'Distance where the variogram reaches the sill' in help_state['titles'][7],
                          'Resource Variography instructions and all eight model/sampling tooltips remain English at 1440px')
                # Reset is a native dataset replacement: the sample's auto
                # cell size must be recomputed rather than carried from the
                # uploaded dataset's different drill spacing.
                reset_csv=file('reset-spacing.csv','# orebit-schema=v1\n# units: au_gpt=g/t\n# notes: uploaded dataset provenance\nhole_id,from_m,to_m,midx,midy,midz,au_gpt\nA,0,1,0,0,0,1\nB,0,1,10,0,0,3\n')
                tab(localized,2)
                localized.locator('#fileInput').set_input_files(reset_csv)
                localized.wait_for_function('() => DATA.rows.length===2 && DATA.name.includes("reset-spacing")')
                check(localized.evaluate('window._lastSchemaMeta.notes==="uploaded dataset provenance"'),
                      f'CSV upload records schema provenance before reset in {language}/{width}')
                tab(localized,3)
                localized.locator('#resourceSetupAdvanced>summary').click()
                localized.locator('#declusterCell').fill('10')
                localized.locator('#declusterCell').press('Tab')
                check(localized.evaluate('setupState.declusterCell===10'),
                      f'Uploaded dataset owns its explicitly adjusted declustering-cell size in {language}/{width}')
                tab(localized,2)
                localized.locator('button[onclick="resetToSample()"]:visible').click()
                localized.wait_for_function('() => DATA.name===EMBEDDED_DATA.name')
                tab(localized,3)
                localized.locator('#resourceSetupAdvanced>summary').click()
                check(localized.evaluate('setupState.declusterCell===42 && document.querySelector("#declusterCell").value==="42"'),
                      f'Native Reset to sample recomputes the sample-derived declustering-cell default in {language}/{width}')
                check(localized.evaluate('window._lastSchemaMeta===null && buildBundle("sample-reset").schemaMeta===null'),
                      f'Native Reset to sample clears prior CSV provenance from exported project data in {language}/{width}')
                tab(localized, 6)
                search_heading = localized.locator('#estimationContent h3').first.inner_text().strip()
                expected_heading = 'Search ellipsoid' if language == 'en' else 'Elipsoid pencarian'
                check(search_heading == expected_heading,
                      f'Resource estimation labels its search section in {language}/{width}')
                localized.close()
            browser.close()
    finally:server.shutdown();server.server_close()
print(f'COMPATIBILITY: {passed} passed')
