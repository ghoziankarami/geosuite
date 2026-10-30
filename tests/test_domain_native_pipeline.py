"""Native Core/Assay/Resource journey from raw CSVs, never an injected solid."""
import csv
import functools
import math
import re
import hashlib
import http.server
import importlib.metadata
import json
import os
import shutil
from pathlib import Path
import tempfile
import threading

import fitz
from playwright.sync_api import sync_playwright
from domain_native_fixture import write_domain_fixture

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'build/build.mjs').exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST', ROOT / 'dist'))
passed = 0
CAPTURE = os.environ.get('OREBIT_WORKSHOP_CAPTURE')


def capture(page, name, selector=None):
    """Optional actual-app workshop evidence; never inject a scientific result."""
    if not CAPTURE:
        return
    output = Path(CAPTURE)
    output.mkdir(parents=True, exist_ok=True)
    if selector:
        page.locator(selector).scroll_into_view_if_needed()
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    image = output/(name+'.png')
    page.screenshot(path=str(image), animations='disabled')
    receipt = output/'captures.json'
    records = json.loads(receipt.read_text()) if receipt.exists() else []
    records.append({'name': name, 'image': image.name, 'sha256': hashlib.sha256(image.read_bytes()).hexdigest(),
                    'module': page.url.rsplit('/', 1)[-1], 'language': page.locator('html').get_attribute('lang'),
                    'viewport': page.viewport_size, 'fixture': 'domain_native_fixture grid6 measured ends varying grades'})
    receipt.write_text(json.dumps(records, indent=2)+'\n')


def workshop_checkpoint(page, name):
    if not CAPTURE:
        return
    output=Path(CAPTURE).parent/'checkpoints'
    output.mkdir(parents=True,exist_ok=True)
    if page.locator('#orebit-support-moment').is_visible():
        page.locator('#orebit-support-moment .support-dismiss-btn').click()
    page.locator('.orebit-avatar').click()
    page.once('dialog',lambda dialog:dialog.accept(name+'.orebit'))
    with page.expect_download() as download:
        page.locator('[data-act="export"]').click()
    download.value.save_as(str(output/(name+'.orebit')))


def check(value, message):
    global passed
    assert value, message
    passed += 1
    print('PASS:', message, flush=True)


def ready(page):
    page.wait_for_function('()=>window.__i18nBooted===true&&typeof OrebitHandoff===\'object\'')
    picker = page.locator('.lang-picker-overlay')
    if picker.count():
        picker.locator('[data-pick="en"]').click()
    if page.locator('.tour-skip').is_visible():
        page.locator('.tour-skip').click()
    page.evaluate("""()=>{window.__nativePipelineErrors=[];const original=safeRender;
      window.safeRender=(name,fn)=>original(name,()=>{try{const v=fn();if(v?.catch)return v.catch(e=>{__nativePipelineErrors.push(String(e));throw e;});return v;}catch(e){__nativePipelineErrors.push(String(e));throw e;}});
      safeRender('pipeline-canary',()=>{throw Error('pipeline-canary')});}""")
    check(page.evaluate("__nativePipelineErrors.splice(0).some(s=>s.includes('pipeline-canary'))"), 'Live swallowed-render detector in '+page.url)
    page.evaluate("window._renderFailures=(window._renderFailures||[]).filter(x=>x.label!=='pipeline-canary');document.querySelectorAll('.toast').forEach(e=>e.remove())")


def stage(page, number):
    button = page.locator(f'nav.tabs .tab[onclick="showTab({number})"]')
    if not button.is_visible():
        page.locator('nav.tabs .screening-advanced-toggle').click()
    button.click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=number)


def reveal(page, selector):
    for details in page.locator(selector).locator('xpath=ancestor::details').all():
        if not details.evaluate('e=>e.open'):
            details.locator(':scope > summary').click()


def raw_core(page):
    return page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')


def prism_cell_volume(block, size):
    x0=max(0,block['cx']-size[0]/2-700000);x1=min(100,block['cx']+size[0]/2-700000)
    y0=max(0,block['cy']-size[1]/2-9800000);y1=min(100,block['cy']+size[1]/2-9800000)
    z0=block['cz']-size[2]/2;z1=block['cz']+size[2]/2
    if x1<=x0 or y1<=y0:return 0.0
    # Six-hole raw grid: top=96-X/20-Y/40; base=top-6.
    b=-1/20;c=-1/40
    def positive_plane(d):
        p=lambda x,y:max(d+b*x+c*y,0)**3
        return (p(x1,y1)-p(x0,y1)-p(x1,y0)+p(x0,y0))/(6*b*c)
    return max(0.0,positive_plane(96-z0)-positive_plane(96-z1)-positive_plane(90-z0)+positive_plane(90-z1))


def main():
    check(abs(prism_cell_volume({"cx":700050,"cy":9800050,"cz":90},[100,100,40])-60000)<1e-6,"Independent analytic integral recovers the complete60,000 m³ prism")
    handler = functools.partial(type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message':lambda *_:None}),directory=str(DIST))
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='native-pipeline-') as tmp, sync_playwright() as pw:
            paths = write_domain_fixture(Path(tmp),measured_ends=True,varying_grades=True,grid_size=6)
            if CAPTURE:
                source_dir=Path(CAPTURE).parent/'source-csv'
                source_dir.mkdir(parents=True,exist_ok=True)
                for source in paths:
                    shutil.copyfile(source,source_dir/source.name)
            browser = pw.chromium.launch(headless=True,args=['--no-sandbox'])
            context = browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
            context.add_init_script("if(location.protocol==='http:'){localStorage.setItem('orebit.lang','en');localStorage.setItem('lang','en')}")
            page_errors=[]
            context.on('page',lambda p:p.on('pageerror',lambda e:page_errors.append(str(e))))
            core=context.new_page();core.goto(f'http://127.0.0.1:{server.server_port}/Core.html');ready(core)
            stage(core,2);core.locator('#fileInput').set_input_files([str(p) for p in paths])
            core.wait_for_function('()=>STATE.collar.length===36&&STATE.survey.length===72&&STATE.assay.length===108&&STATE.geology.length===108')
            core.locator('#coreCRS').fill('EPSG:32748');core.locator('#coreCRS').press('Tab')
            original=raw_core(core)
            capture(core,'01-core-import','#coreCRS')
            stage(core,7)
            check(core.evaluate("!_p1RunValidationChecks().some(c=>c.severity==='fail')"),'Native four-file source has no blocking structural findings')
            capture(core,'02-core-validation','#tab7')
            stage(core,10);core.wait_for_function('()=>!!STATE.desurvey')
            capture(core,'03-core-desurvey','#tab10')
            stage(core,11);core.locator('#computeMergeBtn').click();core.wait_for_function('()=>STATE.merged?.length===108')
            workshop_checkpoint(core,'01-Core-prepared')
            stage(core,13)
            capture(core,'04-core-handoff','#tab13')
            with context.expect_page() as popup:
                core.locator('#tab13 .workflow-stage-bar-next').click()
            assay=popup.value;assay.wait_for_load_state('domcontentloaded');ready(assay)
            assay.wait_for_function('()=>DATA.rows.length===108&&OrebitHandoff.contexts().length===1&&currentTab===3')
            capture(assay,'05-assay-eda','#tab3')
            check(assay.evaluate('OrebitHandoff.domain()===null'),'Initial EDA handoff carries source but invents no reviewed geological solid')
            stage(assay,11)
            reveal(assay,'#domainProposalReason')
            assay.locator('#domainProposalReason').fill('Synthetic native pipeline EDA reference; not a geological acceptance.')
            assay.locator('#domainProposalApply').click()
            assay.locator('#sendAssayEDAReferenceToCore').click()
            core.wait_for_function("()=>OrebitCoreEDAReference.exportState()?.status==='current'")
            stage(core,14)
            core.locator('#coreEdaReference button').filter(has_text='Accept for review').click()
            check(raw_core(core)==original,'EDA proposal review preserves all four original raw source tables')
            core.locator('.domain-steps [data-domain-step="book"]').click()
            core.locator('#domainCodebookCode').fill('SAP');core.locator('#domainCodebookLabel').fill('Synthetic saprolite')
            reveal(core,'#domainCodebookDensity');core.locator('#domainCodebookDensity').fill('1.6');core.locator('#domainCodebookLithologies').get_by_label('SAP', exact=True).check();core.locator('#domainCodebookApply').click()
            core.locator('.domain-steps [data-domain-step="contacts"]').click()
            core.locator('#domainContactTarget').select_option('book:SAP')
            core.locator('.domain-steps [data-domain-step="solid"]').click()
            core.locator('#domainSolidTopo').select_option('collars');core.locator('#domainSolidBuild').click()
            core.wait_for_function('()=>!!window.__domainSolid')
            check(core.evaluate('Math.abs(window.__domainSolid.volume-60000)<1e-6'),'Native contacts produce the independent 100×100×6 =60,000 m³ solid')
            check(core.locator('#domainSolidAcceptBtn').is_disabled(),'Native build cannot approve itself without reviewer/rationale')
            core.locator('#domainSolidReview').check();core.locator('#domainSolidReviewer').fill('Synthetic pipeline reviewer')
            core.locator('#domainSolidReason').fill('Synthetic test: inspect actual top/base contacts and independent prism volume.')
            core.locator('#domainSolidAcceptBtn').click()
            core.wait_for_function('()=>document.querySelector("#domainReadiness [aria-current=true]")?.dataset.state==="validated"')
            check(core.locator('#domainSolidChecks [data-check="geologistReview"] span').inner_text()=='Reviewer record','Synthetic QA acceptance is labelled as a reviewer record, not professional geologist approval')
            check('reviewer qualifications are not verified' in core.locator('.domain-review-record').inner_text().lower(),'Saved domain review states that entered reviewer qualifications are not verified')
            core.locator('#domainViewerPanel [data-mode="3d"]').click()
            core.wait_for_function("()=>document.getElementById('domainViewer3d')?.data?.some(trace=>trace.type==='mesh3d'&&trace.name==='SAP')")
            core.locator('.domain-tree-row[data-domain-code="SAP"]').click()
            core.wait_for_function("()=>{const traces=document.getElementById('domainViewer3d')?.data||[];return traces.length===1&&traces[0].type==='mesh3d'&&traces[0].name==='SAP'}")
            check(core.evaluate("document.getElementById('domainViewer3d').data.length===1&&document.getElementById('domainViewer3d').data[0].type==='mesh3d'&&document.getElementById('domainViewer3d').data[0].name==='SAP'"),'Selecting the reviewed SAP layer shows only its visible 3D solid')
            capture(core,'06-core-domain-solid-selected','#domainViewer3d')
            workshop_checkpoint(core,'02-Core-domain-reviewed')
            core.locator('.domain-steps [data-domain-step="handoff"]').click()
            assay_before=assay.evaluate('JSON.stringify(DATA.rows)')
            core.wait_for_function("()=>document.querySelector('#tab14 .workflow-stage-bar-next')?.textContent===document.getElementById('returnAssayCheckpointFromCore')?.textContent")
            check(core.locator('#tab14 .workflow-stage-bar-next').inner_text()==core.locator('#returnAssayCheckpointFromCore').inner_text(),'Contextual Domain footer mirrors the actual Assay-return owner')
            core.locator('#tab14 .workflow-stage-bar-next').click()
            assay.wait_for_function("()=>document.querySelector('.assay-checkpoint-return-status')?.dataset.state==='restored'")
            check(assay.evaluate('JSON.stringify(DATA.rows)')==assay_before and raw_core(core)==original,'Actual Core return preserves Assay rows and original Core source')
            check(assay.evaluate("OrebitHandoff.domain()?.handoff.readiness==='validated'&&Math.abs(OrebitHandoff.domain().handoff.volume-60000)<1e-6"),'Assay receives the actual natively reviewed60,000 m³ geometry')
            membership=assay.evaluate("async()=>({context:await OrebitAssayWorkflow.estimationContext(),statuses:OrebitHandoff.domain().intervalMembership?.intervals.map(i=>[i.status,i.geometryStatus])})")
            if not membership['context']['membershipRevision']:
                print('MEMBERSHIP DIAGNOSTIC',assay.evaluate("""async()=>{
                  const domain=OrebitHandoff.domain(),packet=domain?.intervalMembership,body=JSON.parse(JSON.stringify(domain));delete body.intervalMembership;
                  const pbody=JSON.parse(JSON.stringify(packet));delete pbody.revision;
                  const bad=(packet?.intervals||[]).flatMap((r,i)=>{let cursor=Number(r.from);const issues=[];
                    for(const s of r.spans){if(s.entryMD!==cursor||s.exitMD<=s.entryMD)issues.push({cursor,span:s});cursor=s.exitMD;}
                    if(cursor!==Number(r.to)||!r.spans.length)issues.push({cursor,to:r.to,spans:r.spans});return issues.length?[{i,status:r.status,issues}]:[];});
                  return {packet:!!packet,source:packet?.sourceRevision===await _opcAssayDataRevision(DATA),geological:packet?.geologicalRevision===await _opcSha256(body),digest:packet?.revision===await _opcSha256(pbody),bad:bad.slice(0,8)};
                }"""),flush=True)
            check(bool(membership['context']['membershipRevision']), 'Actual measured Core intersections bind every Assay parent and current geological revision')
            print('MEMBERSHIP', {str(pair):membership['statuses'].count(pair) for pair in membership['statuses']},flush=True)
            stage(assay,11)
            assay.locator('#assay-estimation-domain-0').check()
            check(assay.locator('#assay-estimation-domain-0').input_value()=='SAP','Native estimation choice refers to actual SAP geology, separately from the EDA candidate labels')
            assay.locator('#assay-estimation-boundary').select_option('hard')
            assay.locator('.workflow-estimation-spec input[aria-label="Reviewer identifier"]').fill('Synthetic pipeline reviewer')
            assay.locator('.workflow-estimation-spec textarea[aria-label="Reason for this element population"]').fill('Synthetic native review: only measured SAP support under hard geological boundaries.')
            assay.get_by_role('button',name='Preview decisions',exact=True).click()
            print('ESTIMATION PREVIEW',assay.locator('.workflow-estimation-spec .workflow-status').inner_text(),flush=True)
            assay.get_by_role('button',name='Apply domains and open Stats',exact=True).click()
            assay.wait_for_function("()=>OrebitAssayWorkflow.estimationSpecReadiness().then(r=>r.status==='approved')")
            assay.wait_for_function("()=>currentTab===8&&OrebitAssayWorkflow.reviewedEDAStatus()?.status==='current'")
            check(assay.evaluate('_scopedRows().length<DATA.rows.length'),'Native Apply immediately displays the measured domain population in Stats')
            stage(assay,11)
            capture(assay,'07-assay-population','#assay-estimation-domain-0')
            check(assay.evaluate('JSON.stringify(DATA.rows)')==assay_before,'Explicit native population approval preserves every original Assay row')
            stage(assay,7);reveal(assay,'#compLength');assay.locator('#compLength').fill('2');assay.locator('#compLength').press('Tab')
            assay.get_by_role('button',name='Prepare boundary-support preview',exact=True).click()
            assay.wait_for_function("()=>!!document.getElementById('assayBoundaryPrepStatus')?.dataset.status")
            check(assay.locator('#assayBoundaryPrepStatus').get_attribute('data-status')=='prepared-preview','Native reviewed preparation succeeds: '+assay.locator('#assayBoundaryPrepStatus').inner_text())
            capture(assay,'08-assay-composite','#assayBoundaryPrepStatus')
            # Pause only one real digest; release the original algorithm unchanged.
            # This makes a user edit during async preparation deterministic.
            assay.evaluate("""()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);let held=false;
              window.__restorePipelineDigest=()=>{crypto.subtle.digest=digest};
              crypto.subtle.digest=(...args)=>{if(held)return digest(...args);held=true;
                return new Promise((resolve,reject)=>{window.__releasePipelineDigest=()=>digest(...args).then(resolve,reject)});};}""")
            stage(assay,13)
            with context.expect_page() as pending:
                assay.locator('#tab13 .workflow-stage-bar-next').click()
            reserved=pending.value
            assay.wait_for_function("()=>typeof window.__releasePipelineDigest==='function'")
            stage(assay,7);reveal(assay,'#compLength');assay.locator('#compLength').fill('3');assay.locator('#compLength').press('Tab')
            with reserved.expect_event('close'):
                assay.evaluate('()=>{__restorePipelineDigest();__releasePipelineDigest()}')
            check(assay.evaluate('JSON.stringify(DATA.rows)')==assay_before,'Editing composite length during asynchronous handoff aborts its reserved popup without changing source')
            reveal(assay,'#compLength');assay.locator('#compLength').fill('2');assay.locator('#compLength').press('Tab')
            with assay.expect_download() as download:
                assay.get_by_role('button',name='Export reviewed Resource composites',exact=True).click()
            reviewed=Path(tmp)/'reviewed.csv';download.value.save_as(str(reviewed))
            if CAPTURE:
                shutil.copyfile(reviewed,Path(CAPTURE).parent/'reviewed-resource-composites.csv')
            workshop_checkpoint(assay,'03-Assay-reviewed')
            saved_spec=assay.evaluate('OrebitAssayWorkflow.serialise().estimationSpec')
            assay.locator('.orebit-avatar').click()
            assay.once('dialog',lambda dialog:dialog.accept('reviewed-Assay.orebit'))
            with assay.expect_download() as project_download:
                assay.locator('[data-act="export"]').click()
            assay_project=Path(tmp)/'reviewed-Assay.orebit';project_download.value.save_as(str(assay_project))
            reopened_assay=context.new_page();reopened_assay.goto(f'http://127.0.0.1:{server.server_port}/Assay.html');ready(reopened_assay)
            reopened_assay.evaluate('''()=>{const original=applyBundle;window.__assayImportFinished=false;
              window.applyBundle=async(...args)=>{const result=await original(...args);window.__assayImportFinished=true;return result;};}''')
            reopened_assay.locator('.orebit-avatar').click()
            with reopened_assay.expect_file_chooser() as project_input:
                reopened_assay.locator('[data-act="import"]').click()
            project_input.value.set_files(str(assay_project))
            reopened_assay.wait_for_function('()=>window.__assayImportFinished===true')
            check(reopened_assay.evaluate('JSON.stringify(DATA.rows)')==assay_before,'Native saved Assay project reopens every original raw row')
            check(reopened_assay.evaluate('OrebitAssayWorkflow.serialise().estimationSpec')==saved_spec,'Completed project import preserves the later population approval instead of overwriting it with the upstream pre-review checkpoint')
            check(reopened_assay.evaluate("OrebitAssayWorkflow.estimationSpecReadiness().then(r=>r.status==='approved')"),'Reopened population still validates against its exact source, geological and measured-membership revisions')
            stage(reopened_assay,7)
            reopened_assay.get_by_role('button',name='Prepare boundary-support preview',exact=True).click()
            reopened_assay.wait_for_function("()=>document.getElementById('assayBoundaryPrepStatus')?.dataset.status==='prepared-preview'")
            check(reopened_assay.evaluate('JSON.stringify(DATA.rows)')==assay_before,'Native reopened project resumes boundary-support preparation without inventing another analyst approval')
            reopened_assay.close()
            stage(assay,13)
            with assay.expect_download() as master_download:
                assay.locator('#tab13 button[onclick="exportMasterForEstimation()"]').click()
            master=Path(tmp)/'master.csv';master_download.value.save_as(str(master))
            check(master.read_text()==reviewed.read_text(),'The native Report Master CSV is identical to explicit reviewed preparation, including population/support/provenance')
            check(assay.evaluate('JSON.stringify(DATA.rows)')==assay_before,'Standalone reviewed Master download preserves every raw Assay row')
            with context.expect_page() as popup:
                assay.locator('#tab13 .workflow-stage-bar-next').click()
            resource=popup.value;resource.wait_for_load_state('domcontentloaded');ready(resource)
            try:
                resource.wait_for_function("()=>DATA.rows.length>0&&OrebitHandoff.domain()?.handoff.readiness==='validated'")
            except Exception:
                print('RESOURCE IMPORT DIAGNOSTIC',resource.evaluate("()=>({name:DATA.name,rows:DATA.rows.length,cols:DATA.cols,domain:OrebitHandoff.domain()?.handoff,parents:OrebitHandoff.contexts().length,status:document.getElementById('uploadStatus')?.innerText,errors:window.__nativePipelineErrors,failures:window._renderFailures})"),flush=True)
                raise
            got_domains=resource.evaluate("[...new Set(DATA.rows.map(r=>r[colIdx('domain')]))]")
            check(got_domains==['SAP'],'The primary Resource handoff respects the approved geological population, not other EDA labels: '+str(got_domains))
            check(resource.evaluate("OrebitHandoff.contexts().some(c=>c.project.sourcePhase==='Assay'&&c.project.parentContexts?.[0]?.project.sourcePhase==='Core')"),'Resource retains Assay review plus the original four-table Core parent chain')
            check(resource.evaluate("GEO_CRS==='EPSG:32748'&&DATA.rows.length===48"),'Reviewed CSV supplies its explicit frame and exactly48 two-metre composites')
            check(resource.evaluate("DATA.rows.reduce((s,r)=>s+Number(r[colIdx('to_m')])-Number(r[colIdx('from_m')]),0)===96"),'Resource receives96 measured metres, separately from60,000 m³ geological volume')
            resource_rows=resource.evaluate('JSON.stringify(DATA.rows)')
            if CAPTURE:
                stage(resource,3)
                capture(resource,'09-resource-input','#tab3')
            stage(resource,5)
            for control,value in (('bmX','25'),('bmY','25'),('bmZ','2'),('bmDens','1.6')):
                resource.locator('#'+control).fill(value)
            resource.locator('#bmGenBtn').click()
            resource.wait_for_function("()=>window.__resourceDomainClip?.status==='measured'")
            clip=resource.evaluate('window.__resourceDomainClip')
            row=clip['rows'][0]
            check(abs(row['solid']-60000)<1e-6 and abs(row['inModel']+row['outsideEnvelope']+row['outsideGrid']-60000)<1e-6,'Native Resource grid accounts for the independent60,000 m³ prism without treating every parent as full')
            check(resource.evaluate('!window.__resourceBlockSupport'),'Measuring received geometry does not silently apply estimation support')
            resource.locator('#resourceBlockSupportReview>summary').click()
            resource.get_by_role('button',name='Apply selected support',exact=True).click()
            check(resource.evaluate('!window.__resourceBlockSupport'),'Blank reviewer and rationale cannot apply geological support')
            resource.locator('#resourceSupportReviewer').fill('Synthetic Resource reviewer')
            resource.locator('#resourceSupportReason').fill('Review measured clipped cells against the actual returned synthetic SAP solid.')
            resource.get_by_role('button',name='Apply selected support',exact=True).click()
            check(resource.evaluate("window.__resourceBlockSupport?.snapshot.schema==='orebit-resource-block-support'"),'Explicit native review applies filled-cell support independently of interval preparation')
            capture(resource,'10-resource-support','#resourceBlockSupportReview')
            check(resource.evaluate('JSON.stringify(DATA.rows)')==resource_rows,'Measuring and applying support never rewrites received composites')
            grid=resource.evaluate('({size:blockState.size,blocks:blockState.blocks,support:window.__resourceBlockSupport.snapshot})')
            expected_volumes={block['idx']:prism_cell_volume(block,grid['size']) for block in grid['blocks']}
            support_by_index={row['blockIndex']:row['filledVolume'] for row in grid['support']['records']}
            check(all(abs(support_by_index.get(index,0)-volume)<1e-6 for index,volume in expected_volumes.items()),'Every native filled-cell volume matches an independent analytic integral of the sloping6m prism')
            supported_volume=sum(expected_volumes.values())
            check(0<supported_volume<60000,'Received geometry volume stays distinct from the smaller source-centroid grid support')
            stage(resource,4);reveal(resource,'#varLag')
            for control,value in (('varLag','20'),('varN','5'),('varTol','22.5'),('varMaxH','100')):
                resource.locator('#'+control).fill(value)
            resource.locator('#varDir').select_option('omni');resource.locator('#varComputeBtn').click()
            resource.wait_for_function('()=>!!variogramState.experimental&&!!variogramState.model')
            fitted=resource.evaluate('variogramState.model')
            check(fitted['covarianceMode']=='model-range' and all(math.isfinite(fitted[key]) for key in ('nugget','sill','range')),'Native empirical variogram and auto-fit produce a finite model from48 reviewed composites, without an injected model')
            capture(resource,'11-resource-variogram','#varComputeBtn')
            stage(resource,6);reveal(resource,'#srMaj')
            for control,value in (('srMaj','150'),('srSemi','150'),('srMin','150'),('sMinN','2'),('sMaxN','12')):
                resource.locator('#'+control).fill(value)
            resource.locator('#resourceRunEstimate').click()
            resource.wait_for_function('()=>estimState.done===true')
            capture(resource,'12-resource-estimate','#resourceRunEstimate')
            estimate=resource.evaluate("""()=>({blocks:blockState.blocks,ok:Array.from(estimState.results.ok),
              idw:Array.from(estimState.results.idw),nn:Array.from(estimState.results.nn),
              report:resourceReportSummary(null,false),snapshot:window.__resourceResultSnapshot})""")
            finite=lambda value:isinstance(value,(int,float)) and math.isfinite(value)
            estimated_volume=sum(expected_volumes[b['idx']] for i,b in enumerate(estimate['blocks']) if finite(estimate['ok'][i]))
            check(0<estimated_volume<=supported_volume+1e-7,'Native estimate has positive supported coverage, separately from missing/unestimated support')
            check(all(not finite(estimate['ok'][i]) and not finite(estimate['idw'][i]) and not finite(estimate['nn'][i]) for i,b in enumerate(estimate['blocks']) if expected_volumes[b['idx']]<1e-9),'Unsupported parent cells stay unestimated across all three methods')
            rollup=estimate['report']['quantityRollup']
            check(abs(rollup['supported']['volume']-supported_volume)<1e-6 and abs(rollup['estimated']['volume']-estimated_volume)<1e-6 and abs(rollup['unestimated']['volume']-(supported_volume-estimated_volume))<1e-6,'Report support/estimated/unestimated volumes match the independent per-cell prism oracle')
            check(abs(estimate['report']['estimated']['mt']-estimated_volume*1.6/1e6)<1e-10,'Report tonnage uses measured filled volume times the explicitly reviewed1.6 t/m³ density')
            stage(resource,9)
            resource.locator('#tab9 button[onclick="runClassification()"]').click()
            resource.wait_for_function('()=>!!classState.labels')
            check(resource.evaluate("['rpeDomainCheck','rpeCutoffCheck','rpeMiningCheck','rpeMetCheck'].every(id=>!document.getElementById(id).checked)"),'Preliminary confidence computation never invents Competent Person readiness attestations')
            stage(resource,12)
            capture(resource,'13-resource-report','#tab12')
            reveal(resource,'#tab12 button[onclick="exportBlockCSV(\'audit\')"]')
            with resource.expect_download() as audit_download:
                resource.locator('#tab12 button[onclick="exportBlockCSV(\'audit\')"]').click()
            audit=Path(tmp)/'resource-audit.csv';audit_download.value.save_as(str(audit))
            audit_rows=list(csv.DictReader(line for line in audit.read_text().splitlines() if line and not line.startswith('#')))
            check(abs(sum(float(row['SUPPORT_VOLUME_M3']) for row in audit_rows)-supported_volume)<1e-6,'Native audit CSV conserves every analytic filled support volume')
            check(all(row['SUPPORT_DOMAINS']=='SAP' for row in audit_rows if float(row['SUPPORT_VOLUME_M3'])>0),'Native audit CSV names the actual reviewed SAP domain on each supported parent')
            check(resource.evaluate('!window._gtCurveSnapshot?.useClass'),'First Report export starts with the visible all-classes scope before any GT visit')
            resource.locator('#reportCutoffNote').fill('Synthetic native pipeline: full estimated support, explicit density1.6, no certified classification.')
            resource.locator('#reportCutoffNote').press('Tab')
            with resource.expect_download() as pdf_download:
                resource.locator('#pdf-export-btn').click()
            pdf_path=Path(os.environ.get('OREBIT_NATIVE_EVIDENCE_DIR',tmp))/'native-resource.pdf';pdf_path.parent.mkdir(parents=True,exist_ok=True);pdf_download.value.save_as(str(pdf_path))
            with fitz.open(pdf_path) as document:
                pdf_text='\n'.join(page.get_text() for page in document)
                check(len(document)>1 and 'Synthetic native pipeline' in pdf_text,'Native PDF contains the actual source/scope rationale and multiple report pages')
                check('SAP' in pdf_text and re.search(r'\b1[.,]6(?:0+)?\s*t/m[3³]\b',pdf_text),'Native PDF retains reviewed geological scope and density, separately from screening classification')
            after_pdf=resource.evaluate('window._resourceReportSnapshot')
            check(not after_pdf['useClass'] and abs(after_pdf['selected']['volume']-estimated_volume)<1e-6,'First PDF chart preparation preserves all-class selection and the independent estimated volume')
            check(resource.evaluate('JSON.stringify(DATA.rows)')==resource_rows,'Native variogram, estimation and CSV/PDF exports preserve every reviewed source composite')
            if resource.locator('#orebit-support-moment').is_visible():
                resource.locator('#orebit-support-moment .support-dismiss-btn').click()
            stage(resource,7)
            resource.evaluate('''()=>{window.__nativeCVSearchLog=[];window.__nativeCVNeighbors=neighborsAround;
              window.neighborsAround=(index,x,y,z,samples,search)=>{const result=__nativeCVNeighbors(index,x,y,z,samples,search);
                const target=samples.findIndex(s=>s.x===x&&s.y===y&&s.z===z);
                __nativeCVSearchLog.push({target,excluded:search.excludeIndex,count:result.length,selfPresent:result.some(n=>n.idx===target)});return result;};}''')
            resource.locator('#resourceRunCrossval').click()
            resource.wait_for_function('()=>!!crossvalState.metrics&&!crossvalState._running')
            cv_search=resource.evaluate('()=>{window.neighborsAround=__nativeCVNeighbors;return __nativeCVSearchLog}')
            check(len(cv_search)==48 and all(row.get('excluded')==row['target'] and row['count']==12 and not row['selfPresent'] for row in cv_search),'Every native LOO target is excluded before the12-neighbour limit, including uncapped search')
            cv=resource.evaluate('crossvalState.metrics')
            cv_pairs=resource.evaluate('crossvalState.results')
            errors=[p-a for a,p in zip(cv_pairs['actual'],cv_pairs['predOK']) if finite(a) and finite(p)]
            check(cv['ok']['n']==len(errors)>=3 and abs(cv['ok']['rmse']-math.sqrt(sum(e*e for e in errors)/len(errors)))<1e-10
                  and abs(cv['ok']['bias']-sum(errors)/len(errors))<1e-10,'Native leave-one-out metrics match independently computed residual RMSE/bias for actual reviewed composites')
            capture(resource,'14-resource-cross-validation','#resourceRunCrossval')
            stage(resource,8)
            resource.locator('#tab8 button[onclick="computeSwath()"]').click()
            capture(resource,'15-resource-swath','#swathSummary')
            stage(resource,10)
            for control,value in (('gtMin','0'),('gtMax','2'),('gtSteps','5')):
                resource.locator('#'+control).fill(value)
            resource.locator('#gtClass').uncheck()
            resource.locator('#tab10 button[onclick="computeGT()"]').click()
            curve=resource.evaluate('window._gtCurveSnapshot')
            for cutoff,tonnes,grade in zip(curve['cutoffs'],curve['tons'],curve['meanG']):
                selected=[(expected_volumes[b['idx']]*1.6,estimate['ok'][i]) for i,b in enumerate(estimate['blocks']) if finite(estimate['ok'][i]) and estimate['ok'][i]>=cutoff]
                total=sum(w for w,g in selected)
                check(abs(tonnes-total/1e6)<1e-10,'Native grade-tonnage cutoff '+str(cutoff)+' conserves independently summed supported tonnes')
                check((grade is None and total==0) or (total>0 and abs(grade-sum(w*g for w,g in selected)/total)<1e-8),'Native cutoff mean uses the same supported-tonnage population')
            capture(resource,'16-resource-grade-tonnage','#gtMin')
            check(resource.evaluate('JSON.stringify(DATA.rows)')==resource_rows,'CV/swath/grade-tonnage preserve original reviewed composites')
            workshop_checkpoint(resource,'04-Resource-estimated')
            if resource.locator('#orebit-support-moment').is_visible():
                resource.locator('#orebit-support-moment .support-dismiss-btn').click()
            resource.locator('.orebit-avatar').click()
            resource.once('dialog',lambda dialog:dialog.accept('native-pipeline-Resource.orebit'))
            with resource.expect_download() as downloaded:
                resource.locator('[data-act="export"]').click()
            project=Path(tmp)/'native-pipeline-Resource.orebit';downloaded.value.save_as(str(project))
            saved=json.loads(project.read_text())
            check(saved['parentContexts'][0]['project']['sourcePhase']=='Assay' and saved['geologicalDomain']['handoff']['volume']==60000,'Native project export retains reviewed geology plus nested Assay/Core provenance')
            tampered=json.loads(project.read_text());tampered['parentContexts'][0]['project']['interpretation']={'changedReview':True}
            bad_project=Path(tmp)/'tampered.orebit';bad_project.write_text(json.dumps(tampered))
            resource.locator('.orebit-avatar').click()
            with resource.expect_file_chooser() as chooser:
                resource.locator('[data-act="import"]').click()
            chooser.value.set_files(str(bad_project))
            resource.get_by_text('PROJECT_PARENT_CONTEXT_REVISION_MISMATCH',exact=False).wait_for()
            check(resource.evaluate('JSON.stringify(DATA.rows)')==resource_rows and resource.evaluate('!!window.__resourceBlockSupport'),'Tampered Assay review fails project preflight before changing active data or applied support')
            replacement=Path(tmp)/'replacement.csv';replacement.write_text('hole_id,from_m,to_m,midx,midy,midz,domain,ni_pct\nNEW,0,2,1,2,3,NEW,1.2\n')
            stage(resource,2);resource.locator('#fileInput').set_input_files(str(replacement))
            resource.wait_for_function('()=>DATA.rows.length===1')
            check(resource.evaluate("OrebitHandoff.contexts().length===0&&OrebitHandoff.domain()===null&&GEO_CRS===''&&!window.__resourceBlockSupport"),'Ordinary replacement retires old provenance, geology, support and undeclared CRS')
            resource.locator('.orebit-avatar').click()
            with resource.expect_file_chooser() as chooser:
                resource.locator('[data-act="import"]').click()
            chooser.value.set_files(str(project))
            resource.wait_for_function("()=>DATA.rows.length===48&&OrebitHandoff.domain()?.handoff.readiness==='validated'")
            check(resource.evaluate('JSON.stringify(DATA.rows)')==resource_rows,'Native project reopen restores the exact reviewed composites')
            check(resource.evaluate("GEO_CRS==='EPSG:32748'&&OrebitHandoff.contexts()[0].project.parentContexts[0].project.sourcePhase==='Core'"),'Native reopen restores its declared frame and the complete original source chain')
            check(resource.evaluate('!window.__resourceBlockSupport'),'Reopening never silently applies an old support review to a new grid')
            check(resource.evaluate('variogramState.model')==fitted and resource.evaluate('!estimState.done&&!variogramState.experimental'),'Project reopen retains the explicit fitted model and retires bins/estimates until recomputed')
            stage(resource,2);resource.locator('button[onclick="resetToSample()"]').click()
            check(resource.evaluate("OrebitHandoff.contexts().length===0&&OrebitHandoff.domain()===null&&!window.__resourceBlockSupport&&GEO_CRS==='EPSG:32751'"),'Native sample reset retires all received provenance/review and restores only the sample frame')
            for page in (core,assay,resource):
                check(not page.evaluate('window.__nativePipelineErrors.length'),'No swallowed native renderer failures in '+page.url)
            check(not page_errors,'No uncaught script failures in native cross-app journey')
            print(json.dumps({'checks':passed,'browser':browser.version,'playwright':importlib.metadata.version('playwright'),'fixtures':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},'fixtureProfile':{'grid':6,'collars':36,'surveys':72,'assayRows':108,'geologyRows':108,'retainedParents':16,'composites':48,'informedMetres':96},'quantities':{'geologicalM3':60000,'supportedM3':supported_volume,'estimatedM3':estimated_volume,'unestimatedM3':supported_volume-estimated_volume,'densityTonnesPerM3':1.6,'estimatedTonnes':estimated_volume*1.6,'fittedModel':fitted,'nativeBlocks':len(estimate['blocks']),'pdfSelectedM3':after_pdf['selected']['volume'],'pdfUsesConfidenceFilter':after_pdf['useClass']},'pageErrors':page_errors}),flush=True)
            browser.close()
    finally:
        server.shutdown();server.server_close()


if __name__=='__main__':main()
