"""Guided workflow through real upload, editable controls, review provenance and PDF download."""
import csv,functools,http.server,io,json,tempfile,threading,os,shutil
import fitz
from pathlib import Path
from playwright.sync_api import sync_playwright
from geological_review_fixture import reviewed_packet

def _workflow_options(page, disclosure):
    # Follow the native disclosure before editing; keep all numerical assertions.
    target = page.locator('#' + disclosure)
    if not target.evaluate('e=>e.open'):
        target.locator(':scope > summary').click()
    assert target.evaluate('e=>e.open'), 'Task Options must expose its actual controls'

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'build/build.mjs').exists())
passed=0
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(Path(os.environ.get('OREBIT_TEST_DIST',ROOT/'dist')))))
threading.Thread(target=server.serve_forever,daemon=True).start()
def check(condition,message):
 global passed
 assert condition,message
 passed+=1;print('PASS:',message,flush=True)
def stage(p,n):
 p.locator(f'nav.tabs .tab[onclick="showTab({n})"]').click();p.wait_for_timeout(180)
def status(p,n):return p.evaluate('(n)=>OrebitAssayWorkflow.snapshot().find(r=>r.stage===n).status',n)
try:
 with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,args=['--no-sandbox'])
  p=b.new_page(accept_downloads=True,viewport={'width':1440,'height':1000});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  p.add_init_script("localStorage.setItem('lang','en');localStorage.setItem('orebit.lang','en');localStorage.setItem('orebit_tour_seen_P2','1')")
  p.goto(f'http://127.0.0.1:{server.server_port}/Assay.html');p.wait_for_function('() => window.OrebitAssayWorkflow && document.body.classList.contains("assay-guided")')
  check(p.evaluate("typeof OrebitEstimationSpec==='object'&&typeof OrebitEstimationSpec.approve==='function'"),'Assay exposes the versioned per-element estimation review owner')
  if p.locator('.tour-skip').is_visible():p.locator('.tour-skip').click()
  p.evaluate('''() => {window.__workflowFailures=[];const old=safeRender;window.safeRender=(name,fn)=>old(name,()=>{try{return fn()}catch(e){window.__workflowFailures.push(name+':'+e.message);throw e}});safeRender('canary',()=>{throw Error('workflow-canary')});}''')
  check(p.evaluate("window.__workflowFailures.some(e=>e.includes('workflow-canary'))"),'Swallowed renderer detector is live')
  p.evaluate('window.__workflowFailures=[]')
  csv=Path(tmp)/'general-gold.csv';csv.write_text('hole_id,from_m,to_m,au_gpt,cu_pct,midx,midy,midz,domain\n'+''.join(f'H{i//4}, {i%4*2}, {i%4*2+2}, {1000 if i==11 else i}, {i/10}, {100+i//4*30}, 200, {300-i%4*2}, D\n' for i in range(12)))
  stage(p,2);p.locator('#fileInput').set_input_files(str(csv));p.wait_for_function('() => DATA.rows.length===12&&currentTab===3')
  check(p.locator('nav.tabs .tab:visible').count()==7,'Main navigation has dashboard plus six steps: '+str(p.evaluate("[...document.querySelectorAll('nav.tabs .tab')].map(e=>[e.textContent,e.dataset.workflowAdvanced,getComputedStyle(e).display])"))+str(errors))
  check(p.locator('#tab3 .assay-workflow-card').is_visible(),'Upload leads to the real validation stage')
  check(status(p,3)=='not-reviewed','Opening a tab never claims analyst review')
  p.wait_for_timeout(100)
  check(p.locator('nav.tabs .tab[onclick="showTab(3)"]').evaluate("e=>!e.classList.contains('workflow-reviewed')&&getComputedStyle(e,'::after').content===JSON.stringify(e.dataset.workflowStep)"),'Visited tab shows its stage number without a false reviewed checkmark')
  raw_rows=p.evaluate('JSON.stringify(DATA.rows)')
  assay_context=p.evaluate('OrebitAssayWorkflow.estimationContext()')
  check(assay_context['sourceRevision'] and len(assay_context['parentObservationIds'])==12 and assay_context['geologicalRevision'] is None,
        'Estimation context binds every assay parent while reporting that no accepted geology is present')
  blocked_spec=p.evaluate("async()=>{try{await OrebitAssayWorkflow.approveEstimationSpec({}, {reviewer:'fixture',reason:'test'});return 'unexpected'}catch(e){return e.message}}")
  check(blocked_spec=='ESTIMATION_GEOLOGY_REQUIRED','Assay cannot approve an estimation population without an accepted geological revision')
  p.locator('#assay-workflow-element-3').select_option('cu_pct')
  check(p.evaluate("primaryElement()==='cu_pct'&&window._domainAudit===null"),'Visible commodity choice changes the target without applying a domain')
  check(p.evaluate('JSON.stringify(DATA.rows)')==raw_rows,'Commodity choice preserves every raw grade and coordinate')
  p.locator('#assay-workflow-element-3').select_option('au_gpt')
  p.locator('#tab3 .workflow-notes summary').click();p.locator('#assay-stage-note-3').fill('Initial data validation reviewed.');p.locator('#tab3 .workflow-notes button').click()
  check(status(p,3)=='reviewed','Validation is recorded explicitly')
  p.wait_for_timeout(100)
  check(p.locator('nav.tabs .tab[onclick="showTab(3)"]').evaluate("e=>e.classList.contains('workflow-reviewed')&&getComputedStyle(e,'::after').display!=='none'&&getComputedStyle(e,'::after').content===JSON.stringify('✓')"),'Only explicit review replaces the stage number with a visible checkmark')
  p.evaluate("DATA.rows[0][colIdx('au_gpt')]=-1")
  check(status(p,3)=='stale','Changed grades invalidate the validation review')
  p.evaluate("DATA.rows[0][colIdx('au_gpt')]=0")
  stage(p,8);check(p.locator('#assayStatsAdvanced').evaluate('(e)=>!e.open'),'Advanced statistics are optional and collapsed')
  check(p.locator('#statsElementSelect').input_value()=='au_gpt' and p.locator('#assay-workflow-element-8').input_value()=='au_gpt','Stats and the guided commodity choice agree')
  check('must be capped' not in p.locator('#st').inner_text() and 'top-cut required' not in p.locator('#st').inner_text(),'High CV presents review candidates without mandatory cap claims')
  check(p.locator('nav.tabs .tab-group-label:visible').count()==0,'Legacy sidebar groups do not contradict the guided order')
  check(p.locator('#statHist').is_visible(),'Primary distribution plot remains visible')
  p.locator('#tab8 .workflow-notes summary').click();p.locator('#assay-stage-note-8').fill('Distribution reviewed; retain valid zero; no cap applied.')
  p.locator('#tab8 .workflow-notes button').click();check(status(p,8)=='reviewed','Explicit review captures the distribution decision')
  check(p.evaluate("!window._capLog.au_gpt"),'Recommended review does not silently cap grades')
  stage(p,11);p.locator('#domainMethodSelect').select_option('cutoff');p.locator('#domainCutoff').fill('0');p.locator('#domainCutoff').press('Tab');p.wait_for_timeout(200)
  check(p.evaluate("_domainAudit===null"),'Choosing a domain cutoff is a preview, not a recorded application')
  p.locator('#domainProposalReason').fill('Synthetic zero-cutoff population review');p.locator('#domainProposalApply').click()
  p.locator('#tab11 .workflow-notes summary').click();p.locator('#assay-stage-note-11').fill('Zero cutoff for grouping only, not economics.');p.locator('#tab11 .workflow-notes button').last.click()
  check(p.evaluate("OrebitAssayWorkflow.snapshot().find(r=>r.stage===11).parameters.actualDomain.cutoff===0"),'Ledger keeps exact zero domain cutoff and actual method')
  p.locator('#domainCutoff').fill('1.25');p.locator('#domainCutoff').press('Tab');p.wait_for_timeout(200);check(status(p,11)=='stale','Changed domain parameters invalidate prior review')
  p.locator('#domainProposalReason').fill('Synthetic revised-cutoff population review');p.locator('#domainProposalApply').click()
  p.locator('#tab11 .workflow-notes button').last.click();check(status(p,11)=='reviewed','Re-review records the edited domain parameters')
  p.wait_for_function("()=>document.getElementById('domainValElementSelect')")
  check(status(p,11)=='reviewed','Late optional domain diagnostics do not invalidate a scientific population review')
  p.locator('#domainValElementSelect').select_option('cu_pct')
  check(status(p,11)=='reviewed','Optional diagnostic element changes do not reapply or invalidate accepted population labels')
  stage(p,7);_workflow_options(p, 'assayCompositeOptions');p.locator('#compLength').fill('3.5');p.locator('#compLength').press('Tab');p.wait_for_timeout(180)
  stage(p,8);stage(p,7)
  check(p.evaluate('_compositeCache.length===3.5'),'Sensitivity trials preserve the selected composite population')
  selected=p.evaluate('({count:_compositeCache.composites.length,tail:_compositeCache.droppedTailLength})')
  lineage=p.evaluate("_compositeCache.composites[0]")
  lineage_parents=__import__('json').loads(lineage['parent_observation_ids'])
  lineage_contributions=__import__('json').loads(lineage['parent_contributions'])
  check(len(lineage_parents)==2 and [round(x['supportLength'],3) for x in lineage_contributions]==[2.0,1.5]
        and round(lineage['parent_support_m'],3)==3.5
        and abs(lineage_contributions[1]['elements']['au_gpt']['weightedValue']-1.5)<1e-9
        and abs(sum(row['elements']['au_gpt']['weightedValue'] for row in lineage_contributions)
                -lineage['au_gpt_comp']*sum(row['elements']['au_gpt']['supportLength'] for row in lineage_contributions))<5e-4,
        'A 3.5 m composite retains stable parent IDs and exact per-element overlap support/grade-length')
  p.locator('#tab7 .workflow-notes summary').click();p.locator('#assay-stage-note-7').fill('Custom 3.5 m composite selected for screening.');p.locator('#tab7 .workflow-notes button').click()
  check(p.evaluate("OrebitAssayWorkflow.snapshot().find(r=>r.stage===7).parameters.composite.length===3.5"),'Custom composite length is retained in reviewed settings')
  recorded=p.evaluate('OrebitAssayWorkflow.snapshot().find(r=>r.stage===7).insight')
  check(f"{selected['count']} composites at 3.5 m" in recorded and f"{selected['tail']} m" in recorded,'Recorded composite count and tails belong to the selected length')
  p.evaluate('computeComposites(5,0.5,_compBreakAtLitho())')
  with p.expect_download() as download:p.locator('#tab7 button[onclick="exportComposites()"]').click()
  composite_csv=Path(tmp)/'selected-composites.csv';download.value.save_as(composite_csv)
  import csv,io
  csv_text=composite_csv.read_text();csv_rows=list(csv.DictReader(io.StringIO('\n'.join(line for line in csv_text.splitlines() if not line.startswith('#')))))
  check('length=3.5m' in csv_text and len(csv_rows)==selected['count'] and all(float(row['comp_length'])<=3.5 for row in csv_rows),'Direct composite CSV uses the selected length, not a sensitivity trial')
  first_export=csv_rows[0];exported_parents=json.loads(first_export['parent_observation_ids']);exported_contributions=json.loads(first_export['parent_contributions'])
  check(first_export['parent_support_m']=='3.5' and exported_parents==lineage_parents
        and [round(row['supportLength'],3) for row in exported_contributions]==[2.0,1.5]
        and '_elementSupport' not in first_export,
        'Composite CSV carries machine-readable parent/support lineage without leaking internal object columns')
  master_capture=p.evaluate('OrebitHandoff.capture(exportMasterForEstimation)');master_rows=list(csv.DictReader(io.StringIO('\n'.join(line for line in master_capture['text'].splitlines() if line.strip() and not line.startswith('#')))))
  master_first=master_rows[0]
  check(master_capture['name'].startswith('master-estimation-3.5m')
        and json.loads(master_first['parent_observation_ids'])==lineage_parents
        and json.loads(master_first['parent_contributions'])==lineage_contributions,
        'Resource-facing master-estimation export preserves the same parent and element-support lineage')
  _workflow_options(p, 'assayCompositeOptions');p.locator('#compLength').fill('4');p.locator('#compLength').press('Tab');p.wait_for_timeout(180);check(status(p,7)=='stale','Changed composite length invalidates prior review')
  p.locator('#tab7 .workflow-notes button').click()
  p.locator('#assayAdvancedToggle').click();check(p.locator('nav.tabs .tab:visible').count()==13,'All thirteen tools remain reachable in advanced navigation')
  stage(p,9);_workflow_options(p, 'assayTopCutOptions');p.locator('#customCut').fill('0');p.locator('#tab9 .workflow-notes summary').click();p.locator('#assay-stage-note-9').fill('<img src=x onerror="window.__noteExecuted=true"> No treatment selected.');p.locator('#tab9 .workflow-notes button').click()
  check(p.evaluate("OrebitAssayWorkflow.snapshot().find(r=>r.stage===9).parameters.controls.customCut==='0'"),'Exact unapplied zero control is distinguished from applied treatment')
  p.locator('#topcutDecisionReason').fill('')
  check(p.evaluate("recordNoCapDecision('au_gpt')===false&&!_treatmentDecisions.au_gpt"),'No-cap review cannot be recorded without an analyst reason')
  p.locator('#topcutDecisionReason').fill('Retain full assay population; no project-specific cap basis.')
  check(p.evaluate("recordNoCapDecision('au_gpt')===true&&_treatmentDecisions.au_gpt.reviewed===true"),'Reviewed no-cap decision records its reason without changing grades')
  no_cap_header=p.evaluate('_treatmentCsvHeader()')
  check('no-cap' in no_cap_header and 'no project-specific cap basis' in no_cap_header.lower(),'No-cap decision and reason travel with exported treatment provenance')
  _workflow_options(p, 'assayTopCutOptions');p.locator('#customCut').fill('5');p.locator('#customCut').press('Tab');p.wait_for_timeout(180);check(status(p,9)=='stale','Edited treatment proposal invalidates prior settings review')
  p.locator('#topcutDecisionReason').fill('Synthetic reviewed cap for treatment-lineage acceptance.')
  check(p.evaluate("applyTopCutReviewed('au_gpt')===true&&_treatmentDecisions.au_gpt.kind==='cap'&&_treatmentDecisions.au_gpt.reviewed"),'Applying a cap records the required review reason and ordered decision')
  cap_header=p.evaluate('_treatmentCsvHeader()')
  check('reviewed=yes' in cap_header and 'Synthetic reviewed cap' in cap_header and 'decision order' in cap_header.lower(),'Cap reason and decision order accompany the exported grade treatment')
  check(p.evaluate("recordNoCapDecision('au_gpt')===false&&_treatmentDecisions.au_gpt.kind==='cap'"),'No-cap decision is blocked while an applied cap remains active')
  saved_treatments=p.evaluate('_serialiseTreatments()')
  p.evaluate('_restoreTreatments',saved_treatments)
  check(p.evaluate("_treatmentDecisions.au_gpt.reviewed&&_treatmentDecisions.au_gpt.reviewReason.includes('Synthetic reviewed cap')&&_treatmentDecisionHistory.some(d=>d.kind==='no-cap')"),'Treatment reasons and decision history survive the project treatment save/restore boundary')
  p.evaluate("undoTopCut('au_gpt')")
  check(p.evaluate("!_capLog.au_gpt&&_treatmentDecisionHistory.some(d=>d.kind==='cap-undo')"),'Undo removes the active cap and appends an auditable decision-history entry')
  p.evaluate('showTab(8)');p.wait_for_selector('#logTransformReason')
  original_cu=p.evaluate("DATA.rows.map(r=>r[colIdx('cu_pct')])")
  check(p.evaluate("applyLogTransformReviewed('cu_pct')===false"),'Descriptive log transform also requires an explicit reason')
  p.locator('#logTransformReason').fill('Diagnostic distribution view only; no inverse contract for physical estimation.')
  check(p.evaluate("applyLogTransformReviewed('cu_pct')===true&&_treatmentDecisions.cu_pct.kind==='descriptive-log'&&_logXform.cu_pct.role==='descriptive-only'"),'Reviewed log transform records descriptive-only role without replacing the source grade')
  check(p.evaluate("original=>JSON.stringify(DATA.rows.map(r=>r[colIdx('cu_pct')]))===JSON.stringify(original)",original_cu),'Descriptive transform leaves original physical assay grades unchanged')
  log_header=p.evaluate('_treatmentCsvHeader()')
  check('no back-transform claim' in log_header and 'added diagnostic-only column' in log_header and 'distribution view only' in log_header.lower(),'Export labels the transformed column diagnostic-only and states no back-transform contract')
  # Synthetic protocol geometry/membership tests preparation, not native geological interpretation.
  p.evaluate("""async base => {
    const cols=DATA.columns||DATA.cols,context=await OrebitAssayWorkflow.estimationContext(),geologicalRevision=await _opcSha256(base),sourceRevision=await _opcAssayDataRevision({columns:cols,rows:DATA.rows});
    const intervals=DATA.rows.map((row,index)=>{const from=Number(row[cols.indexOf('from_m')]),to=Number(row[cols.indexOf('to_m')]),mid=(from+to)/2,state=index===0?'inside':index===1?'crossing':'outside',spans=state==='inside'?[{state:'inside',entryMD:from,exitMD:to,supportLength:to-from}]:state==='crossing'?[{state:'inside',entryMD:from,exitMD:mid,supportLength:mid-from},{state:'outside',entryMD:mid,exitMD:to,supportLength:to-mid}]:[{state:'outside',entryMD:from,exitMD:to,supportLength:to-from}],insideLength=spans.filter(s=>s.state==='inside').reduce((sum,s)=>sum+s.supportLength,0),outsideLength=to-from-insideLength;return {parentObservationId:context.parentObservationIds[index],holeId:String(row[cols.indexOf('hole_id')]),from:row[cols.indexOf('from_m')],to:row[cols.indexOf('to_m')],status:state,geometryStatus:'measured',domains:[{code:'SAP',status:state,insideLength,outsideLength,boundaryLength:0,spans}],spans:spans.map(s=>({...s,geologicalDomainId:s.state==='inside'?'SAP':'__OUTSIDE__'}))};});
    const packet={schema:'orebit-assay-interval-membership',version:1,sourceRevision,geologicalRevision,intervals};packet.revision=await _opcSha256(packet);base.intervalMembership=packet;await OrebitHandoff.acceptReturnedDomain(base);
    return true
  }""", reviewed_packet({'v':[[0,0,6],[100,0,6],[100,100,6],[0,100,6],[0,0,0],[100,0,0],[100,100,0],[0,100,0]],
                         'f':[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]]},60000))
  stage(p,11);p.wait_for_selector('#assay-estimation-domain-0');p.locator('#assay-estimation-domain-0').check();p.locator('#assay-estimation-boundary').select_option('hard')
  p.locator('.workflow-estimation-spec input[aria-label="Reviewer identifier"]').fill('synthetic-reviewer');p.locator('.workflow-estimation-spec textarea[aria-label="Reason for this element population"]').fill('Synthetic measured membership fixture review')
  p.get_by_role('button',name='Preview decisions').click();preview_text=p.locator('.workflow-estimation-spec .workflow-status').inner_text()
  check('1 retained' in preview_text and '1 split' in preview_text and '10 rejected' in preview_text,'The analyst preview shows inside/crossing/outside parent counts before approval: '+preview_text)
  p.get_by_role('button',name='Apply domains and open Stats').click();p.wait_for_function("()=>OrebitAssayWorkflow.estimationSpecReadiness().then(r=>r.status==='approved')")
  check(p.evaluate("OrebitAssayWorkflow.serialise().estimationSpec.elements[0].decisions.filter(d=>d.action==='split').length===1"),'Hard-boundary Apply records a conserved split and leaves source assay rows unchanged')
  p.wait_for_function("()=>currentTab===8&&OrebitAssayWorkflow.reviewedEDAStatus()?.status==='current'")
  check(p.evaluate('_scopedRows().length')==2,'Native Apply opens Stats for the two reviewed parents without deleting raw assays')
  stage(p,11)
  p.locator('.workflow-estimation-spec input[placeholder="Reason for undo"]').fill('Undo synthetic review');p.get_by_role('button',name='Undo latest population approval').click();p.wait_for_function("()=>OrebitAssayWorkflow.serialise().estimationSpec===null")
  check(p.evaluate("OrebitAssayWorkflow.serialise().estimationSpecHistory.at(-1).action==='undo'"),'Undo removes the reviewed estimation population with a required reason recorded in the project ledger')
  p.locator('#assay-estimation-domain-0').check();p.locator('#assay-estimation-boundary').select_option('hard');p.locator('.workflow-estimation-spec input[aria-label="Reviewer identifier"]').fill('synthetic-reviewer');p.locator('.workflow-estimation-spec textarea[aria-label="Reason for this element population"]').fill('Synthetic measured membership fixture review');p.get_by_role('button',name='Preview decisions').click();p.get_by_role('button',name='Apply domains and open Stats').click();p.wait_for_function("()=>OrebitAssayWorkflow.estimationSpecReadiness().then(r=>r.status==='approved')")
  membership_source_before=p.evaluate('JSON.stringify(DATA.rows)');stage(p,7);p.get_by_role('button',name='Prepare boundary-support preview').click();p.wait_for_function("()=>!!document.querySelector('#assayBoundaryPrepStatus')?.dataset.status")
  prep_status=p.locator('#assayBoundaryPrepStatus').get_attribute('data-status');prep_text=p.locator('#assayBoundaryPrepStatus').inner_text()
  check(prep_status=='prepared-preview','Approved population can create its measured hard-boundary support preview: '+prep_text)
  prepared=p.evaluate("async()=>{const workflow=OrebitAssayWorkflow,spec=workflow.serialise().estimationSpec,context=await workflow.estimationContext(),columns=DATA.columns||DATA.cols,membershipSourceRevision=await _opcAssayDataRevision({columns,rows:DATA.rows});return OrebitEstimationSpec.prepareComposites({revision:context.sourceRevision,membershipSourceRevision,columns,rows:DATA.rows,parentObservationIds:context.parentObservationIds},OrebitHandoff.domain().intervalMembership,spec,{length:3.5,minimumLength:0})}")
  check(prepared['counts']['retainedParents']==2 and prepared['counts']['preparedIntervals']==2 and round(sum(row['supportLength'] for row in prepared['prepared']),3)==3.0,'Approved measured hard-boundary preparation retains 2 m inside + 1 m crossing support under stable parents')
  check(p.evaluate('JSON.stringify(DATA.rows)')==membership_source_before,'Hard-boundary preparation preview leaves the active raw assay rows unchanged')
  reviewed_export=p.evaluate("""async()=>{let file=null;window.__orebitCaptureDownload=(name,content)=>{file={name,text:String(content)}};try{await exportReviewedBoundaryComposites()}finally{window.__orebitCaptureDownload=null}return file}""")
  check(reviewed_export and reviewed_export['name'].startswith('reviewed-boundary-master-') and 'parent_contributions' in reviewed_export['text'] and 'coordinate_status' in reviewed_export['text'],'Reviewed membership drives an actual Resource-facing CSV with parent lineage and explicit coordinate status')
  csv_lines=[line for line in reviewed_export['text'].splitlines() if line and not line.startswith('#')]
  exported_rows=list(csv.DictReader(io.StringIO('\n'.join(csv_lines))))
  contribution_rows=json.loads(exported_rows[0]['parent_contributions']) if exported_rows else []
  support_by_parent={row['parentObservationId']:row['elements']['au_gpt']['supportLength'] for row in contribution_rows}
  check(len(exported_rows)==1 and sorted(support_by_parent.values())==[1,2] and round(float(exported_rows[0]['informed_length']),3)==3 and p.evaluate('JSON.stringify(DATA.rows)')==membership_source_before,'Resource-facing reviewed export conserves 2 m inside + 1 m crossing support without mutating source assays')
  stale_source=p.evaluate("""async()=>{const i=colIdx('au_gpt'),before=DATA.rows[0][i];DATA.rows[0][i]=before+0.01;const blocked=await exportReviewedBoundaryComposites(),master=await exportMasterForEstimation();DATA.rows[0][i]=before;return blocked===false&&master===false&&document.getElementById('assayBoundaryPrepStatus').dataset.status==='blocked'}""")
  check(stale_source,'Reviewed and Master exports reject source changes after approval')
  stale_membership=p.evaluate("""async()=>{const original=OrebitHandoff.domain(),changed=JSON.parse(JSON.stringify(original));changed.intervalMembership.sourceRevision='stale-source';await OrebitHandoff.acceptReturnedDomain(changed);const blocked=await exportReviewedBoundaryComposites(),master=await exportMasterForEstimation();await OrebitHandoff.acceptReturnedDomain(original);return blocked===false&&master===false&&document.getElementById('assayBoundaryPrepStatus').dataset.status==='blocked'}""")
  check(stale_membership,'Reviewed and Master exports reject stale measured-membership lineage')
  boundary_csv=Path(tmp)/reviewed_export['name'];boundary_csv.write_text(reviewed_export['text'])
  rp=b.new_page(viewport={'width':1280,'height':800});rp.goto(p.url.replace('Assay.html','Resource.html'));rp.wait_for_function('()=>window.__i18nBooted===true')
  if rp.locator('.lang-picker-overlay').count():rp.locator('.lang-picker-overlay [data-pick="en"]').click()
  rp.locator('#fileInput').set_input_files(str(boundary_csv));rp.wait_for_function('()=>DATA.rows.length===1&&DATA.columns.includes("parent_contributions")')
  imported=rp.evaluate("""()=>{const cols=DATA.columns||DATA.cols,row=DATA.rows[0],get=k=>row[cols.indexOf(k)];return {hole:get('hole_id'),from:get('from_m'),to:get('to_m'),grade:get('au_gpt'),domain:get('domain'),parents:get('parent_observation_ids'),contributions:get('parent_contributions'),status:get('coordinate_status')}}""")
  check(imported['hole']=='H0' and float(imported['from'])==0 and float(imported['to'])==3 and abs(float(imported['grade'])-1/3)<1e-4 and imported['domain']=='SAP','Resource imports the exact Assay reviewed-boundary CSV with interval, selected-domain grade and parent lineage')
  check(len(json.loads(imported['parents']))==2 and 'au_gpt' in imported['contributions'] and imported['status']=='interpolated-from-measured-assay-stations','Resource preserves exported parent/element support details and coordinate quality status')
  rp.close()
  # This negative fixture deliberately lacks geology; native bundles now retain it.
  bundle=p.evaluate("buildBundle('workflow-project')");bundle.pop('geologicalDomain',None);p.evaluate('applyBundle',bundle);p.wait_for_timeout(300)
  check(p.evaluate("primaryElement()==='au_gpt'"),'Project round-trip preserves the selected commodity')
  check(p.evaluate("async()=>OrebitAssayWorkflow.serialise().estimationSpec?.status==='approved'&&(await OrebitAssayWorkflow.estimationSpecReadiness()).status==='stale'"),'Project reopen preserves the estimation review but reports it stale without the matching accepted geology')
  check(p.evaluate('async()=>await exportReviewedBoundaryComposites()===false&&await exportMasterForEstimation()===false'),'Reviewed and Master CSV exports refuse a restored project whose approved source/geology/membership lineage is stale')
  check(any(r['note'].startswith('Custom 3.5') for r in p.evaluate('OrebitAssayWorkflow.snapshot()')),'Project bundle round-trip preserves interpretation notes')
  p.evaluate('showTab(13)');p.wait_for_timeout(300)
  check(p.evaluate('window.__noteExecuted!==true') and p.locator('.workflow-review-list img').count()==0,'Free-text interpretation remains inert markup')
  with p.expect_download(timeout=90000) as download:p.locator('#btnReportPdf').click()
  pdf=Path(tmp)/'assay.pdf';download.value.save_as(str(pdf));data=pdf.read_bytes()
  evidence=os.environ.get('GEOSUITE_EVIDENCE_DIR')
  if evidence:
   out=Path(evidence);out.mkdir(parents=True,exist_ok=True);shutil.copy2(pdf,out/'assay-workflow.pdf');p.screenshot(path=str(out/'assay-report-desktop.png'))
  check(data.startswith(b'%PDF-') and b'%%EOF' in data,'Native Assay PDF download succeeds')
  check(b'Custom 3.5 m composite' in data and b'Recorded settings' in data,'PDF includes stage notes and recorded settings')
  with fitz.open(pdf) as doc:
   text=' '.join(' '.join(page.get_text().split()) for page in doc)
   check('"controls":' not in text and '"actualDomain":' not in text and '"minimumTail":' not in text,'PDF shows readable parameter labels instead of raw JSON')
   check('earlier data/parameter state' in text and 'not a prerequisite' in text,'PDF explains stale reviews and optional stages honestly')
   bad=[(i+1,word) for i,page in enumerate(doc) for word in page.get_text('words') if not(word[0]>=0 and word[1]>=0 and word[2]<=page.rect.width+1 and word[3]<=page.rect.height+1)]
   check(not bad,'PDF text stays within each page: '+str(bad[:8]))
  check(p.evaluate("window._reportInterpretationSnapshot.stages.some(r=>r.stage===9&&r.status==='stale')"),'PDF exports actual stale state instead of inventing approval')
  if p.locator('#orebit-support-moment .support-close-btn').is_visible():p.locator('#orebit-support-moment .support-close-btn').click()
  p.evaluate('showTab(8)');p.wait_for_timeout(200)
  if not p.locator('#tab8 .workflow-notes').evaluate('(e)=>e.open'):p.locator('#tab8 .workflow-notes summary').click()
  long_note='Long interpretation for pagination. '*130+'END-OF-LONG-INTERPRETATION'
  p.locator('#assay-stage-note-8').fill(long_note);p.locator('#tab8 .workflow-notes button').click();p.evaluate('showTab(13)')
  if p.locator('#orebit-support-moment .support-close-btn').is_visible():p.locator('#orebit-support-moment .support-close-btn').click()
  with p.expect_download(timeout=90000) as download:p.locator('#btnReportPdf').click()
  long_pdf=Path(tmp)/'long.pdf';download.value.save_as(str(long_pdf))
  with fitz.open(long_pdf) as doc:
   check('END-OF-LONG-INTERPRETATION' in ''.join(page.get_text() for page in doc),'Long interpretation survives pagination to its final marker')
   last=doc[-1].get_text();check(f'{len(doc)} / {len(doc)}' in last,'Footer accounts for every added interpretation page')
  if p.locator('#orebit-support-moment .support-close-btn').is_visible():p.locator('#orebit-support-moment .support-close-btn').click()
  p.evaluate("applyLanguage('id')");check('Catatan' in p.locator('#tab13 .workflow-notes').inner_text(),'Language switch updates the guided workflow')
  p.set_viewport_size({'width':390,'height':844});p.evaluate('showTab(8)');p.wait_for_timeout(200)
  check(p.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Guided workflow fits a 390 px mobile viewport')
  check(p.locator('#tab8 .workflow-actions button').first.is_visible(),'Main action remains visible on mobile')
  p.set_viewport_size({'width':320,'height':740});p.wait_for_timeout(150)
  check(p.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Guided workflow fits a 320 px mobile viewport')
  csv2=Path(tmp)/'second.csv';csv2.write_text('hole_id,from_m,to_m,cu_pct,midx,midy,midz\nC1,0,2,0,10,10,20\nC2,0,2,1,40,10,20\n')
  p.evaluate('showTab(2)');p.locator('#fileInput').set_input_files(str(csv2));p.wait_for_function('() => DATA.rows.length===2&&currentTab===3')
  check(all(r['status']=='not-reviewed' and r['note']=='' for r in p.evaluate('OrebitAssayWorkflow.snapshot()')),'New commodity upload clears previous reviews and notes')
  legacy=p.evaluate("buildBundle('legacy-project')");legacy.pop('interpretation',None);p.evaluate('applyBundle',legacy)
  check(p.evaluate('DATA.rows.length===2') and all(r['status']=='not-reviewed' for r in p.evaluate('OrebitAssayWorkflow.snapshot()')),'Legacy projects without the optional ledger retain their data and load safely')
  p.evaluate("OrebitAssayWorkflow.restore({schema:'orebit-assay-interpretation',version:1,stages:{invalid:true}})");check(p.evaluate('OrebitAssayWorkflow.snapshot().length===13'),'Malformed optional ledger cannot break legacy project loading')
  check(not errors and p.evaluate('window.__workflowFailures.length===0'),'Actual workflow has no page or swallowed rendering errors')
  b.close()
finally:server.shutdown();server.server_close()
print('ASSAY WORKFLOW:',passed,'passed',flush=True)
