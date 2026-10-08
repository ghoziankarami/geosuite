"""Actual CSV/bundle/manual-unit handoffs; synthetic fixtures, independent metric answers.

Owns a temporary loopback server and supports both private/public source layouts.
GRADE_UNIT_TEST_SITE can point to an immutable prior artifact for removed-fix controls.
No data/result injection, forced navigation, hidden tour deletion or confirm replacement.
"""
import csv
import functools
import http.server
import json
import math
import os
import tempfile
import threading
from pathlib import Path

import fitz
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
while not (ROOT / 'build/build.mjs').exists():
    if ROOT.parent == ROOT:
        raise RuntimeError('Source root not found')
    ROOT = ROOT.parent
SITE = Path(os.environ.get('GRADE_UNIT_TEST_SITE', ROOT / 'dist'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check(name, condition, details=None):
    if not condition:
        raise AssertionError(f'{name}: {details}')
    print('PASS ' + name, flush=True)


def nav(page, tab):
    print(f'Navigate {page.url.rsplit("/",1)[-1]} tab {tab}',flush=True)
    page.locator(f'nav.tabs .tab[onclick="showTab({tab})"]').click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=tab)


def ready(context, base, module):
    page = context.new_page()
    page.goto(base + '/' + module + '.html')
    page.wait_for_function('()=>window.__i18nBooted===true')
    if page.locator('.lang-picker-overlay').count():
        page.locator('.lang-picker-overlay [data-pick="en"]').click()
    page.evaluate('''()=>{
      window.__gradeErrors=[];
      const owner=window.safeRender;
      window.safeRender=(name,fn)=>owner(name,()=>{try{return fn();}catch(e){window.__gradeErrors.push(name+': '+e.message);throw e;}});
      safeRender('unit-canary',()=>{throw Error('unit-canary');});
    }''')
    check(module + ' swallowed-error detector is live', page.evaluate('()=>window.__gradeErrors.splice(0).some(x=>x.includes("unit-canary"))'))
    return page


def upload(page, paths, wait):
    nav(page, 2)
    page.evaluate('()=>{window.__unitPriorRows=typeof STATE!=="undefined"&&Array.isArray(STATE.assay)?STATE.assay:DATA.rows;}')
    if len(paths)==1 and paths[0].suffix=='.orebit':
        with page.expect_file_chooser() as choice:
            page.locator('#tab2 button[onclick="importBundle()"]').click()
        choice.value.set_files(str(paths[0]))
    else:
        page.locator('#fileInput').set_input_files([str(p) for p in paths])
    page.wait_for_function('()=>window.__unitPriorRows!==(typeof STATE!=="undefined"&&Array.isArray(STATE.assay)?STATE.assay:DATA.rows)',timeout=30000)
    page.wait_for_function(wait, timeout=30000)
    if page.url.endswith('/Assay.html') and paths[0].suffix!='.orebit':
        page.wait_for_function('()=>document.getElementById("tab3").classList.contains("active")')


def download(page, selector, target):
    with page.expect_download(timeout=60000) as result:
        page.locator(selector).click()
    result.value.save_as(str(target))
    return target


def reveal(page, selector):
    for details in page.locator(selector).locator('xpath=ancestor::details').all():
        if details.get_attribute('open') is None:
            details.locator(':scope > summary').click()


def fixture(folder):
    tables = {
        'collar': ['hole_id,x,y,z,depth'],
        'survey': ['hole_id,depth,dip,azimuth'],
        'geology': ['hole_id,from_m,to_m,lith1'],
        'assay': ['hole_id,from_m,to_m,au_ppb,au_pct,ag_ppb,cu_ppm,sn_gm3,sn_kgm3,density'],
    }
    locations=[(0,0),(50,5),(6,61),(72,66)]
    for h in range(4):
        hole = 'UNIT' + str(h + 1)
        x,y=locations[h]
        tables['collar'].append(f'{hole},{500000+x},{9000000+y},300,50')
        tables['survey'].append(f'{hole},0,-90,0')
        tables['geology'].append(f'{hole},0,50,ORE')
        for i in range(10):
            grade = 1 + i/10 + h/20
            tables['assay'].append(f'{hole},{i*5},{i*5+5},{grade*1000},{grade/10000},{grade*1000},{grade*5000},{grade*1000},{grade},2.7')
    paths = []
    for name, lines in tables.items():
        p = folder / (name+'.csv')
        p.write_text('\n'.join(lines)+'\n')
        paths.append(p)
    return paths


def assay_snapshot(page):
    return page.evaluate('()=>({units:Object.fromEntries(availableElements().map(c=>[c,elementMeta(c).unit])),cols:DATA.cols,rows:DATA.rows,project:buildBundle("unit-test").units,errors:window.__gradeErrors})')


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        with tempfile.TemporaryDirectory(prefix='grade-unit-test-') as temp, sync_playwright() as pw:
            folder = Path(temp)
            paths = fixture(folder)
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
            context = browser.new_context(accept_downloads=True)
            errors = []
            context.on('page', lambda p: p.on('pageerror', lambda e: errors.append(str(e))))
            core = ready(context, base, 'Core')
            upload(core, paths, '()=>STATE.assay.length===40&&STATE.collar.length===4')
            nav(core, 7)
            state = core.evaluate('async()=>{const p=await OrebitProject.save("units");return {units:STATE.units,labels:Object.fromEntries(getActualGradeColumns().map(c=>[c,gradeColMeta(c).unit])),saved:p.metadata.units,project:p}}')
            for col, unit in [('au_ppb','ppb'),('au_pct','pct'),('ag_ppb','ppb'),('sn_gm3','g/m³'),('sn_kgm3','kg/m³')]:
                check('Core explicit '+col+' unit survives project save', state['units'][col] == unit and state['saved'][col] == unit, state)
            nav(core, 10)
            core.locator('#tab10 .workflow-actions [data-workflow-next]').click()
            core.wait_for_function('()=>STATE.merged&&STATE.merged.length===40')
            nav(core, 13)
            clean = download(core, '#tab13 button[onclick="exportMasterCSV()"]', folder/'clean.csv')
            saved = core.evaluate('async()=>await OrebitProject.save("unit-project")')
            check('Core project contains actual clean handoff rows', bool(saved['phase1']['merged_csv']))
            bundle = folder/'units.orebit'
            bundle.write_text(json.dumps(saved))
            expect = {'au_ppb':'ppb','au_pct':'%','ag_ppb':'ppb','cu_pct':'%','sn_gm3':'g/m³','sn_kgm3':'kg/m³'}
            first = None
            master = folder/'master.csv'
            for name, inputs in [('CSV',[clean]),('Core bundle',[bundle]),('four source CSVs',paths)]:
                assay = ready(context, base, 'Assay')
                upload(assay, inputs, '()=>DATA?.rows?.length===40&&DATA.rows[0][colIdx("hole_id")]==="UNIT1"')
                shot = assay_snapshot(assay)
                for col, unit in expect.items():
                    check('Assay '+name+' '+col+' label/project unit', shot['units'].get(col)==unit and shot['project'].get(col)==unit, shot['units'])
                check('Assay '+name+' canonical ppm-to-percent conversion', math.isclose(shot['rows'][0][shot['cols'].index('cu_pct')], .5, abs_tol=1e-12))
                check('Assay '+name+' retained explicit raw ppb', shot['rows'][0][shot['cols'].index('au_ppb')] == 1000)
                check('Assay '+name+' no renderer failures', not shot['errors'], shot['errors'])
                if first is None:
                    first = shot
                    nav(assay, 13)
                    print('Export actual Assay master',flush=True)
                    assay.locator('#tab13 .workflow-notes > summary').click()
                    with assay.expect_download(timeout=60000) as result:
                        assay.get_by_role('button',name='Export Resource-ready CSV',exact=True).click()
                    result.value.save_as(str(master))
                else:
                    cols=['hole_id','from_m','to_m','midx','midy','midz',*expect]
                    normalized=lambda x:[[row[x['cols'].index(c)] for c in cols] for row in x['rows']]
                    check('Assay '+name+' numerical handoff parity', normalized(shot) == normalized(first))
                assay.close()
            check('Assay export writes actual columns/units', '# units: ' in master.read_text() and 'au_ppb=ppb' in master.read_text() and 'sn_gm3=gm3' in master.read_text())
            resource = ready(context, base, 'Resource')
            upload(resource, [master], '()=>DATA.source==="upload"&&DATA.rows[0][DATA.cols.indexOf("hole_id")]==="UNIT1"')
            nav(resource, 3)
            for col, unit in expect.items():
                resource.locator('#setupElement').select_option(col)
                actual = resource.evaluate('()=>({unit:gradeUnitFor(setupState.element),label:elementLabelFor(setupState.element),metal:containedMetalTonnes(.0027,Number(DATA.rows[0][DATA.cols.indexOf(setupState.element)]),setupState.element,.001)})')
                expected = .0027 if col in ('au_ppb','au_pct','ag_ppb') else 13.5 if col=='cu_pct' else 1
                check('Resource uploaded '+col+' assigned unit/label', actual['unit']==unit and unit in actual['label'], actual)
                check('Resource uploaded '+col+' independently computed metal', math.isclose(actual['metal'], expected, rel_tol=1e-12), actual)
            check('No app exceptions or swallowed renderer failures', not errors and not resource.evaluate('()=>window.__gradeErrors'), errors)
            # Real calculation route and native report for mass/volume grades.
            for model_col,denominator,volumetric,formula in [('au_ppb',1000000000,False,'grade_ppb / 1000000000'),('sn_gm3',1000000,True,'grade_gm3 / 1000000')]:
                nav(resource,3)
                resource.locator('#setupElement').select_option(model_col)
                for stage in (3,4,5,6,7,10):
                    print('Resource compute/continue stage '+str(stage),flush=True)
                    if stage==4:
                        # This compact 50 m fixture needs short lag bins; exercise editable parameters.
                        reveal(resource,'#varLag')
                        resource.locator('#varLag').fill('5')
                        resource.locator('#varLag').press('Tab')
                        check('Custom short lag reaches the compute action',resource.locator('#varLag').input_value()=='5')
                    resource.locator(f'#tab{stage} .workflow-actions [data-workflow-next]').click()
                    try:
                        resource.wait_for_function('(n)=>!document.getElementById("tab"+n).classList.contains("active")',arg=stage,timeout=30000)
                    except Exception:
                        print(resource.locator('body').inner_text()[-6000:],flush=True)
                        raise
                check('Resource primary route finishes estimation',resource.evaluate('()=>estimState.done&&document.getElementById("tab12").classList.contains("active")'))
                pdf=download(resource,'#pdf-export-btn',folder/(model_col+'.pdf'))
                with fitz.open(pdf) as doc:
                    text='\n'.join(p.get_text() for p in doc)
                check('Native '+model_col+' PDF records exact denominator',formula in text,text[-1000:])
                audit=resource.evaluate('()=>({report:window._resourceReportSnapshot,blocks:blockState.blocks,size:blockState.size,densities:Array.from(blockState.blocks,(_,i)=>getBlockDensity(i)),grades:Array.from(estimState.results.ok)})')
                volume=math.prod(audit['size'])
                pairs=[(i,g) for i,g in enumerate(audit['grades']) if g is not None and math.isfinite(g)]
                rock=sum(volume*audit['densities'][i] for i,_ in pairs)
                metal=sum(volume*g/denominator if volumetric else volume*2.7*g/denominator for i,g in pairs)
                check('Native '+model_col+' report independently reconciles every estimated cell',len(pairs)>0 and math.isclose(audit['report']['metalTonnes'],metal,rel_tol=1e-10) and math.isclose(audit['report']['selected']['volMm3']*1000000,len(pairs)*volume,rel_tol=1e-10),audit['report'])
                check('Actual model density follows the physical basis',all(math.isclose(rho,1 if volumetric else 2.7,rel_tol=1e-12) for rho in audit['densities']))
                if not volumetric:
                    check('Native mass reconciles assigned rock density',math.isclose(audit['report']['selected']['mt']*1000000,rock,rel_tol=1e-10))
                else:
                    check('Native volumetric cover labels volume, rather than rock tonnes','Selected volume' in text and 'Selected tonnage' not in text.split('Results and interpretation')[0])
                if resource.locator('#orebit-support-moment .support-close-btn').is_visible():
                    resource.locator('#orebit-support-moment .support-close-btn').click()
            # Real corrected, same-name CSV import followed by the manual unit selector.
            assay_file=folder/'assay.csv'
            lines=list(csv.reader(assay_file.read_text().splitlines()))
            cu=lines[0].index('cu_ppm')
            for row in lines[1:]:
                row[cu]=str(float(row[cu])/10000)
            with assay_file.open('w',newline='') as f:
                csv.writer(f).writerows(lines)
            upload(core, paths, '()=>STATE.assay.length===40&&STATE.assay[0].cu_ppm===.5')
            nav(core,7)
            selector='select[data-unit-col="cu_ppm"]'
            reveal(core,selector)
            core.locator(selector).select_option('pct')
            check('Core manual unit changes label, preserves raw',core.evaluate('()=>gradeColMeta("cu_ppm").unit==="%"&&STATE.assay[0].cu_ppm===.5'))
            nav(core,10)
            core.locator('#tab10 .workflow-actions [data-workflow-next]').click()
            core.wait_for_function('()=>STATE.merged?.length===40&&STATE.merged[0].cu_ppm===.5')
            nav(core,13)
            manual=download(core,'#tab13 button[onclick="exportMasterCSV()"]',folder/'manual.csv')
            assay=ready(context,base,'Assay')
            upload(assay,[manual],'()=>DATA.rows.length===40&&DATA.rows[0][colIdx("hole_id")]==="UNIT1"')
            check('Exact upstream declaration wins over header; no double conversion',assay.evaluate('()=>DATA.rows[0][colIdx("cu_pct")]===.5&&elementMeta("cu_pct").unit==="%"'))
            nav(assay,2)
            assay.locator('#p2GradeCol').select_option('cu_pct')
            assay.locator('#p2GradeUnit').select_option('ppb')
            assay.locator('#p2ApplyMapping').click()
            before=assay_snapshot(assay)
            check('Assay manual ppb recorded in saved project without changing raw',before['units']['cu_pct']=='ppb' and before['project']['cu_pct']=='ppb' and before['rows'][0][before['cols'].index('cu_pct')]==.5)
            unit_bundle=folder/'manual-assay.orebit'
            unit_bundle.write_text(json.dumps(assay.evaluate('()=>buildBundle("manual-unit")')))
            reopened=ready(context,base,'Assay')
            upload(reopened,[unit_bundle],'()=>DATA.rows.length===40&&DATA.rows[0][colIdx("hole_id")]==="UNIT1"')
            restored=reopened.evaluate('()=>({unit:elementMeta("cu_pct").unit,cutoff:elementMeta("cu_pct").typicalCutoff,raw:DATA.rows[0][colIdx("cu_pct")]})')
            check('Assay reopened project keeps manual unit and equivalent cutoff',restored['unit']=='ppb' and math.isclose(restored['cutoff'],.3*10000000,rel_tol=1e-12) and restored['raw']==.5,restored)
            # File-local schema survives order changes and a final geology file with no units.
            assay_file.write_text('# units: cu_ppm=pct\n'+assay_file.read_text())
            declared=ready(context,base,'Assay')
            reordered=[paths[3],paths[0],paths[1],paths[2]] # assay, collar, survey, geology
            upload(declared,reordered,'()=>DATA.rows.length===40&&DATA.rows[0][colIdx("hole_id")]==="UNIT1"')
            check('Four-file schema follows the assay file, independent of final file',declared.evaluate('()=>DATA.rows[0][colIdx("cu_pct")]===.5&&elementMeta("cu_pct").unit==="%"'))
            upload(core,reordered,'()=>STATE.assay.length===40&&STATE.assay[0].cu_ppm===.5')
            check('Core schema declaration wins before suffix inference',core.evaluate('()=>STATE.units.cu_ppm==="pct"&&gradeColMeta("cu_ppm").unit==="%"&&STATE.assay[0].cu_ppm===.5'))
            nav(core,7)
            selector='select[data-unit-col="au_pct"]'
            reveal(core,selector)
            core.locator(selector).select_option('ppb')
            nav(core,10)
            core.locator('#tab10 .workflow-actions [data-workflow-next]').click()
            core.wait_for_function('()=>STATE.merged?.length===40')
            manual_core=folder/'core-manual.orebit'
            manual_core.write_text(json.dumps(core.evaluate('async()=>await OrebitProject.save("manual-core")')))
            carry=ready(context,base,'Assay')
            upload(carry,[manual_core],'()=>DATA.rows.length===40&&DATA.rows[0][colIdx("hole_id")]==="UNIT1"')
            check('Core bundle preserves manual unit even when its header says percent',carry.evaluate('()=>elementMeta("au_pct").unit==="ppb"&&DATA.rows[0][colIdx("au_pct")]===.0001'))
            lines=list(csv.reader(assay_file.read_text().splitlines()[1:]))
            for row in lines[1:]:
                row[lines[0].index('au_ppb')]='0'
            with assay_file.open('w',newline='') as f:
                csv.writer(f).writerows(lines)
            upload(core,paths,'()=>STATE.assay.length===40&&STATE.assay.every(r=>r.au_ppb===0)')
            nav(core,7)
            check('Core zero-only grade retains explicit unit; prior overrides reset',core.evaluate('()=>STATE.units.au_ppb==="ppb"&&STATE.units.au_pct==="pct"&&!STATE.unitsLocked.au_pct'))
            check('All final render/exception detectors remain clear',not errors and all(not p.evaluate('()=>window.__gradeErrors') for p in (core,assay,reopened,resource)),errors)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('Grade unit handoff browser checks passed', flush=True)


if __name__ == '__main__':
    main()
