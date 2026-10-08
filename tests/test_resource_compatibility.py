"""Backward-compatible Core mapping and optional Resource estimation features.
Uses actual file uploads, existing mapper controls, and built product functions.
"""
import csv
import functools
import http.server
import io
import json
import math
from pathlib import Path
import tempfile
import threading
from playwright.sync_api import sync_playwright
ROOT = next(p for p in Path(__file__).resolve().parents if (p/'build/build.mjs').exists())
passed = 0

def check(condition, message):
    global passed
    assert condition, message
    passed += 1
    print('PASS:', message, flush=True)

def close(a,b): return abs(a-b)<1e-7

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'dist')))
threading.Thread(target=server.serve_forever,daemon=True).start()

def page(browser,phase):
    pg=browser.new_page(accept_downloads=True,viewport={'width':1400,'height':1000})
    pg.goto(f'http://127.0.0.1:{server.server_port}/{phase}.html',wait_until='domcontentloaded')
    pg.wait_for_function("() => typeof showTab === 'function'")
    pg.evaluate("() => document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove())")
    return pg

def tab(pg,n): pg.evaluate(f'showTab({n})')

def assign(pg,table,mapping):
    tab(pg,7)
    for key,val in mapping.items(): pg.locator(f'#map_{table}_{key}').select_option(val)
    pg.evaluate(f"applyColumnMapping('{table}')")

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
            c.evaluate('resetToSample(); applyBundle(window._testBundle); computeMerge()')
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
            c.evaluate("async () => { await OrebitProject.save('feet-roundtrip'); window._ftBundle=await dbGet('feet-roundtrip'); applyBundle(window._ftBundle); computeMerge(); }")
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

            check(math.isfinite(primary[0]) and math.isnan(primary[1]),'legacy single-pass estimates only informed blocks')
            tab(r,6);fill_search(8,True)
            expanded=r.evaluate('({ok:Array.from(estimState.results.ok),passes:Array.from(estimState.results.passNumber)})')
            check(expanded['passes']==[1,2] and close(expanded['ok'][0],primary[0]) and math.isfinite(expanded['ok'][1]),'fallback fills insufficient blocks without altering primary estimates')
            before=r.evaluate('JSON.stringify(searchState)');r.locator('#sAz').fill('');r.locator('#sMaxHole').fill('-1');r.evaluate('runEstimation()')
            check(r.evaluate('JSON.stringify(searchState)')==before,'invalid search leaves previous estimate parameters intact')
            def export(flavor):
                with r.expect_download() as ev:r.evaluate(f"exportBlockCSV('{flavor}')")
                p=tmp/(flavor+'.csv');ev.value.save_as(str(p))
                return list(csv.reader(io.StringIO('\n'.join(line for line in p.read_text().splitlines() if line and not line.startswith('#')))))
            generic=export('generic');audit=export('audit');ijk=export('ijk')
            check(generic[0]==['X','Y','Z','X_INC','Y_INC','Z_INC','IDW','OK','NN','KRIGE_VAR','NEAR_DIST','N_NEIGHBORS','CLASS'] and all(len(row)==13 for row in generic),'generic CSV retains exact legacy column names/order/count')
            check(audit[0]==generic[0]+['DENSITY','PASS','N_HOLES'] and all(len(row)==16 for row in audit),'audit columns available only through additive export')
            check(ijk[1][6]=='1-1-1' and ijk[2][6]=='3-1-1','IJK retains lattice gaps after envelope masking')
            nested={'type':'spherical','nugget':.45,'sill':1,'range':150,'azDeg':90,'aniso':{'rMaj':150,'rSemi':60,'rMin':40},'struct1':{'type':'spherical','psill':.35,'rangeMaj':10,'rangeMin':8,'rangeVert':15},'struct2':{'type':'spherical','psill':.2,'rangeMaj':150,'rangeMin':60,'rangeVert':40}}
            r.evaluate('(m)=>{variogramState.model=m;blockState.envelopeMode="xyz";blockState.envelopeRadius=25;saveResourceSession();variogramState.model=null;restoreResourceSession();}',nested)
            check(r.evaluate('variogramState.model')==nested,'session roundtrip preserves full nested model and anisotropy')
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
            r.evaluate("window._unitBundle=buildBundle('unit-roundtrip');setupState.gradeUnit=null;loadBundle(window._unitBundle)")
            check(r.evaluate("setupState.gradeUnit==='ppm' && window._unitBundle.units.ni_pct==='ppm'"), 'Native project bundle carries the explicit unit despite a conflicting percentage header')
            tab(r,2);r.locator('#fileInput').set_input_files([]);r.locator('#fileInput').set_input_files(resource2);r.wait_for_function('() => setupState.gradeUnit===null')
            check(r.evaluate("gradeUnitFor('ni_pct')==='%'"), 'A new dataset clears stale ppm overrides before interpreting nickel percentage')
            density_file=file('density-support.csv','hole_id,from_m,to_m,midx,midy,midz,au_gpt,density\nA,0,1,0,0,0,1,2\nB,0,1,10,0,0,3,3\n')
            r.locator('#fileInput').set_input_files(density_file);r.wait_for_function('() => DATA.columns.includes("density")')
            r.evaluate("() => {blockState.size=[1,1,1];blockState.blocks=[{cx:1,cy:1,cz:1},{cx:1000,cy:1,cz:1}];blockState.density=2.8;assignBlockDensities();}")
            check(r.evaluate('JSON.stringify(Array.from(blockState.blockDensities))')=='[2,2.8]', 'Measured-density assignment and distant-cell fallback retain independently known values')
            audit=r.evaluate('resourceDensityAudit([0,1])')
            check(audit['assigned']==1 and audit['fallback']==1 and audit['unknown']==0, 'Density audit distinguishes a real measured value from the fallback, without comparing numeric equality')
            check(not r.evaluate('window._renderFailures||[]'),'compatibility scenarios contain no swallowed rendering errors')
            r.close();browser.close()
    finally:server.shutdown();server.server_close()
print(f'COMPATIBILITY: {passed} passed')
