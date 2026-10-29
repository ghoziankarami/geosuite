/* Guided Assay review. Existing calculation and export functions remain authoritative. */
(function () {
  'use strict';
  const MAIN = [2, 3, 8, 11, 7, 13];
  const NEXT = {1:2, 2:3, 3:8, 8:11, 9:11, 10:11, 11:7, 7:13, 4:8, 5:11, 6:13, 12:13};
  const ELEMENT_IDS={8:'statsElementSelect',9:'tcElementSelect',10:'lithoElementSelect',11:'domainElementSelect'};
  const KEYS = {1:'dashboard',2:'upload',3:'data',4:'bivariate',5:'multivariate',6:'spacing',7:'composite',8:'stats',9:'topcut',10:'litho',11:'domain',12:'qaqc',13:'report'};
  let entries = {}, current = 1, lastMainStage = 1, initialized = false, checkpointReturnStatus = null, estimationSpec = null, estimationSpecUndo = null, estimationSpecHistory=[];
  const text = (key, values={}) => Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',String(v)), window.__t('asy.workflow.'+key));
  const label = n => window.__t('tab.'+KEYS[n]);
  const data = () => typeof DATA === 'undefined' ? null : DATA;
  const clone = x => JSON.parse(JSON.stringify(x));
  let reviewedEDAScope = null;
  function reviewedEDAKey(){
    const d=data();
    return JSON.stringify({columns:d?.columns||d?.cols,rows:d?.rows,units:d?.units||{},
      geology:window.OrebitHandoff?.domain?.(),spec:estimationSpec});
  }
  function reviewedEDAStatus(){
    if(!reviewedEDAScope)return null;
    return {status:reviewedEDAScope.key===reviewedEDAKey()?'current':'stale',
      parents:reviewedEDAScope.rows.length,crossing:reviewedEDAScope.crossing,
      support:reviewedEDAScope.support,domains:reviewedEDAScope.domains.slice()};
  }
  function reviewedEDARows(){
    const state=reviewedEDAStatus();
    return !state?null:state.status==='current'?reviewedEDAScope.rows:[];
  }
  function clearReviewedEDAScope(){
    reviewedEDAScope=null;
    document.getElementById('reviewedEDAScopeBar')?.remove();
  }
  function reviewedEDAMessage(state){
    return state.status==='current'?text('estimation.edaScope',{domains:state.domains.join(', '),parents:state.parents,crossing:state.crossing,support:state.support.toFixed(3)}):text('estimation.edaStale');
  }
  function reviewedEDABadge(){
    const state=reviewedEDAStatus();if(!state)return '';
    return '<div class="hint warn" data-reviewed-eda-status="'+state.status+'">'+escapeHtml(reviewedEDAMessage(state))+'</div>';
  }
  async function inspectReviewedEDA(){
    const key=reviewedEDAKey(),d=data(),spec=estimationSpec;
    if((await estimationSpecReadiness()).status!=='approved')throw Error('ESTIMATION_SPEC_NOT_CURRENT');
    const context=await estimationContext(),membership=window.OrebitHandoff?.domain?.()?.intervalMembership;
    const prepared=OrebitEstimationSpec.prepareComposites({revision:context.sourceRevision,
      membershipSourceRevision:await _opcAssayDataRevision({columns:d.columns||d.cols,rows:d.rows}),
      columns:d.columns||d.cols,rows:d.rows,parentObservationIds:context.parentObservationIds},membership,spec,
      {length:1,minimumLength:0});
    if(key!==reviewedEDAKey()||d!==data())throw Error('ESTIMATION_SPEC_NOT_CURRENT');
    const indices=[...new Set(prepared.prepared.map(p=>p.sourceRowIndex))];
    reviewedEDAScope={key,rows:indices.map(i=>d.rows[i]),
      crossing:indices.filter(i=>context.membershipByParent[context.parentObservationIds[i]].status==='crossing').length,
      support:prepared.prepared.reduce((s,p)=>s+p.supportLength,0),
      domains:[...new Set(spec.elements.flatMap(e=>e.geologicalDomainIds))]};
    document.getElementById('reviewedEDAScopeBar')?.remove();
    const bar=node('div',null,'data-source-bar');bar.id='reviewedEDAScopeBar';
    bar.append(node('span',text('estimation.edaActive')),button(text('estimation.edaClear'),()=>{clearReviewedEDAScope();showTab(current);},true,'inspect'));
    document.getElementById('domainScopeBar')?.after(bar);
    navigate(8);
  }
  // Change detection only, not an authenticity/security hash. No raw assays enter the ledger.
  function fingerprint(value) {
    const s=JSON.stringify(value);let h=2166136261;
    for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);
    return s.length+':'+(h>>>0).toString(16);
  }
  function element(n) {
    return document.getElementById(ELEMENT_IDS[n])?.value || (data() ? primaryElement() : null);
  }
  function chooseElement(n,value){
    if(!availableElements().includes(value))return;
    // Select the view/report target without applying a domain or grade treatment.
    window._primaryElement=value;
    Object.values(ELEMENT_IDS).forEach(id=>{const el=document.getElementById(id);if(el&&Array.from(el.options).some(o=>o.value===value))el.value=value;});
    const origin=document.getElementById(ELEMENT_IDS[n]);
    if(origin)origin.dispatchEvent(new Event('change',{bubbles:true}));else showTab(n);
    refresh(n);
  }
  function parameters(n) {
    const controls={},controlLabels={};
    document.querySelectorAll('#tab'+n+' input[id],#tab'+n+' select[id]').forEach(el=>{
      if(el.closest('.assay-workflow-card') || el.type==='file' || el.type==='button')return;
      controls[el.id]=el.type==='checkbox'?el.checked:el.multiple?Array.from(el.selectedOptions,o=>o.value):el.value;
      const label=el.closest('label')?.cloneNode(true);
      if(label){label.querySelectorAll('input,select,button,svg').forEach(node=>node.remove());controlLabels[el.id]=label.textContent.replace(/\s+/g,' ').replace(/:\s*$/,'').trim();}
    });
    const e=element(n);
    return {element:e,unit:e?elementMeta(e).unit:null,scope:window._domainScope||'All',controls,controlLabels,
      reviewedGeometryEDA:reviewedEDAStatus(),
      actualDomain:window._domainAudit?clone(window._domainAudit):null,
      actualTreatment:typeof _treatmentCsvHeader==='function'?_treatmentCsvHeader():null,
      composite:n===7||n===13?{length:_reportCompositeLength(),minimumTail:0.5,breakAtLithology:_compBreakAtLitho()}:null};
  }
  function context(n) {
    const d=data();if(!d)return null;
    const cols=d.columns||d.cols||[], e=element(n), p=parameters(n);
    const structure=['hole_id','from_m','to_m','midx','midy','midz'].filter(c=>cols.includes(c));
    const selected=n===3?[...new Set([...structure,...availableElements()])]:(n===8||n===9?[e, ...(p.scope==='All'?[]:['domain'])].filter(Boolean):cols);
    const indices=selected.map(c=>cols.indexOf(c));
    const rows=d.rows.map(r=>indices.map(i=>r[i]));
    const semantic={element:n===3?null:e,unit:p.unit,scope:p.scope,controls:p.controls};
    if(n===8||n===9)semantic.reviewedGeometryEDA=p.reviewedGeometryEDA;
    if(n===7||n===13)semantic.composite=p.composite;
    if(n===11){
      // Population review depends on accepted/draft science, not on optional
      // diagnostic controls mounting asynchronously or display filters.
      semantic.controls={};semantic.scope='All loaded rows';
      semantic.domain=p.actualDomain;
      semantic.proposal=window._domainPreviewAudit?clone(window._domainPreviewAudit):null;
    }
    if(n===9)semantic.treatment=p.actualTreatment;
    return fingerprint({columns:selected,units:d.units||{},rows,semantic});
  }
  function snapshot() {
    return Object.keys(KEYS).map(k=>{
      const n=Number(k), r=entries[n];
      return r?Object.assign(clone(r),{status:!r.context?'not-reviewed':r.context===context(n)?'reviewed':'stale'}):
        {stage:n,title:label(n),status:'not-reviewed',note:'',parameters:null,insight:null};
    });
  }
  function reset() {clearReviewedEDAScope();entries={};lastMainStage=1;checkpointReturnStatus=null;estimationSpec=null;estimationSpecUndo=null;estimationSpecHistory=[];Object.values(ELEMENT_IDS).forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.querySelectorAll('.assay-workflow-card').forEach(el=>el.remove());}
  function restore(record) {
    clearReviewedEDAScope();entries={};estimationSpec=null;estimationSpecUndo=null;estimationSpecHistory=[];
    if(record?.schema!=='orebit-assay-interpretation'||record.version!==1||!Array.isArray(record.stages))return;
    const restoreSpec=value=>{try{return value?.schema==='orebit-estimation-spec'&&value.version===1&&value.status==='approved'?OrebitEstimationSpec.approve(value,{sourceRevision:value.sourceRevision,geologicalRevision:value.geologicalRevision,membershipRevision:value.membershipRevision,parentObservationIds:value.sourceObservationIds,geologicalDomainIds:value.elements?.flatMap(e=>e.decisions.flatMap(d=>d.geologicalMembership))||[]},{reviewer:value.approval?.reviewer,reason:value.approval?.reason,at:value.approval?.at}):null;}catch(error){return null;}};
    estimationSpec=restoreSpec(record.estimationSpec);estimationSpecUndo=restoreSpec(record.estimationSpecUndo);
    if(Array.isArray(record.estimationSpecHistory))estimationSpecHistory=record.estimationSpecHistory.filter(e=>e&&['approve','replace','undo'].includes(e.action)&&typeof e.at==='string'&&typeof e.reason==='string'&&typeof e.membershipRevision==='string').slice(-50).map(clone);
    if(availableElements().includes(record.targetElement))window._primaryElement=record.targetElement;
    for(const row of record.stages.slice(0,13)){
      if(row&&Number.isInteger(row.stage)&&KEYS[row.stage]&&(typeof row.context==='string'||row.context===null)&&typeof row.note==='string'){
        entries[row.stage]={stage:row.stage,title:label(row.stage),context:row.context,
          reviewedAt:typeof row.reviewedAt==='string'?row.reviewedAt:null,note:row.note.slice(0,5000),
          parameters:row.parameters&&typeof row.parameters==='object'?clone(row.parameters):null,
          insight:typeof row.insight==='string'?row.insight:null};
      }
    }
  }
  function serialise() {
    return {schema:'orebit-assay-interpretation',version:1,generated:new Date().toISOString(),
      dataset:{name:data()?.name||'',rows:data()?.rows.length||0,columns:data()?.columns||[]},estimationSpec:estimationSpec?clone(estimationSpec):null,estimationSpecUndo:estimationSpecUndo?clone(estimationSpecUndo):null,estimationSpecHistory:clone(estimationSpecHistory),
      fingerprintPurpose:'Change detection; not file authenticity',targetElement:data()?primaryElement():null,stages:snapshot()};
  }
  async function estimationContext(){
    const d=data();if(!d?.rows?.length)return null;
    const cols=d.columns||d.cols||[],domain=window.OrebitHandoff?.domain?.()||null;
    const parentObservationIds=d.rows.map((row,index)=>['assay',index,String(row[cols.indexOf('hole_id')]??''),String(row[cols.indexOf('from_m')]??''),String(row[cols.indexOf('to_m')]??'')].join(':'));
    let geologicalRevision=null,membershipRevision=null,membershipByParent={};
    if(domain){
      const base=clone(domain),packet=base.intervalMembership;delete base.intervalMembership;
      geologicalRevision=await _opcSha256(base);
      if(packet?.schema==='orebit-assay-interval-membership'&&packet.version===1){
        const packetBody=clone(packet);delete packetBody.revision;
        const sourceRevision=await _opcAssayDataRevision({columns:cols,rows:d.rows});
        const aligned=Array.isArray(packet.intervals)&&packet.intervals.length===parentObservationIds.length&&packet.intervals.every((row,index)=>{
          if(packet.measurementEncoding!=null){
            let audit;try{audit=_opcDomainMeasurements(packet,row);}catch{return false;}
            if(!Array.isArray(audit)||audit.length!==domain.domains.length||new Set(audit.map(d=>d?.code)).size!==audit.length||
               audit.some(d=>!domain.domains.some(s=>s.code===d?.code)))return false;
          }
          const from=Number(d.rows[index][cols.indexOf('from_m')]),to=Number(d.rows[index][cols.indexOf('to_m')]);
          if(row.parentObservationId!==parentObservationIds[index]||String(row.holeId)!==String(d.rows[index][cols.indexOf('hole_id')]??'')||
            String(row.from)!==String(d.rows[index][cols.indexOf('from_m')]??'')||String(row.to)!==String(d.rows[index][cols.indexOf('to_m')]??'')||
            !['inside','outside','boundary','crossing','ambiguous'].includes(row.status)||!Array.isArray(row.spans)||!row.spans.length)return false;
          let cursor=from;
          for(const span of row.spans){if(!Number.isFinite(span.entryMD)||!Number.isFinite(span.exitMD)||span.entryMD!==cursor||span.exitMD<=span.entryMD||
            !['inside','outside','boundary','ambiguous'].includes(span.state))return false;cursor=span.exitMD;}
          return cursor===to;
        });
        if(packet.sourceRevision===sourceRevision&&packet.geologicalRevision===geologicalRevision&&packet.revision===await _opcSha256(packetBody)&&aligned){
          membershipRevision=packet.revision;membershipByParent=Object.fromEntries(packet.intervals.map(row=>[row.parentObservationId,row]));
        }
      }
    }
    return {sourceRevision:await _opcSha256({columns:cols,rows:d.rows,units:d.units||{}}),geologicalRevision,membershipRevision,membershipByParent,
      geologicalDomainIds:domain?.domains?.map(item=>item.code).filter(v=>typeof v==='string')||[],parentObservationIds};
  }
  async function approveEstimationSpec(candidate,review){
    const context=await estimationContext();if(!context)throw Error('ESTIMATION_SOURCE_REQUIRED');
    if(!context.geologicalRevision)throw Error('ESTIMATION_GEOLOGY_REQUIRED');
    if(!context.membershipRevision)throw Error('ESTIMATION_MEMBERSHIP_REQUIRED');
    const previous=estimationSpec;
    estimationSpec=OrebitEstimationSpec.approve(candidate,context,review);
    estimationSpecUndo=previous?clone(previous):null;
    estimationSpecHistory.push({action:previous?'replace':'approve',at:estimationSpec.approval.at,reason:estimationSpec.approval.reason,membershipRevision:estimationSpec.membershipRevision});estimationSpecHistory=estimationSpecHistory.slice(-50);
    if(typeof AutoSave!=='undefined')AutoSave.schedule();
    return {spec:clone(estimationSpec),readiness:OrebitEstimationSpec.readiness(estimationSpec,context)};
  }
  async function undoEstimationSpec(reason){
    if(!estimationSpec)throw Error('ESTIMATION_SPEC_NOTHING_TO_UNDO');
    if(!text(reason))throw Error('ESTIMATION_REVIEW_REQUIRED');
    const removed=estimationSpec;estimationSpecHistory.push({action:'undo',at:new Date().toISOString(),reason:text(reason),membershipRevision:removed.membershipRevision});estimationSpecHistory=estimationSpecHistory.slice(-50);
    estimationSpec=estimationSpecUndo;estimationSpecUndo=null;
    if(typeof AutoSave!=='undefined')AutoSave.schedule();
    return {removed:removed.schema,readiness:await estimationSpecReadiness()};
  }
  async function estimationSpecReadiness(){const context=await estimationContext();return OrebitEstimationSpec.readiness(estimationSpec,context||{});}
  async function receiveCheckpointReturn(packet) {
    await validateAssayCheckpointReturn(packet);
    const d=data(),contexts=window.OrebitHandoff?.contexts()||[];
    if(!d?.rows?.length||contexts.length!==1)return staleReturn('missing-source');
    const context=contexts[0],columns=d.cols||d.columns;
    const digest=await _opcAssayDataRevision({columns,rows:d.rows});
    if(digest!==packet.source.assayDatasetRevision||packet.checkpoint.dataset.rows!==d.rows.length||
      JSON.stringify(packet.checkpoint.dataset.columns)!==JSON.stringify(columns)||
      context.project?.sourceCapsule?.revision!==packet.source.coreRevision||
      context.export?.revision!==packet.source.exportRevision)return staleReturn('source-conflict');
    const restoredDomain=await window.OrebitHandoff.acceptReturnedDomain(packet.geologicalDomain);
    if(data()!==d)return staleReturn('source-conflict');
    if(!restoredDomain)return staleReturn('geology-invalid');
    restore(packet.checkpoint);
    window.OrebitHandoff.recordAssayCheckpointReturn(packet);
    setCheckpointReturnStatus({status:'restored',geologicalRevision:packet.source.geologicalRevision});
    refresh(current);
    if(typeof AutoSave!=='undefined')AutoSave.schedule();
    return {ok:true,status:'restored'};
  }
  function staleReturn(reason){setCheckpointReturnStatus({status:'stale',reason});return {ok:false,status:'stale',error:'ASSAY_CHECKPOINT_RETURN_SOURCE_CONFLICT'};}
  function setCheckpointReturnStatus(value){
    const allowed=['pending','restored','stale'];
    checkpointReturnStatus=value&&allowed.includes(value.status)?clone(value):null;
    refresh(13);
  }
  function insight(n) {
    const d=data();if(!d?.rows?.length)return text('empty');
    const e=element(n),idx=e?colIdx(e):-1;
    const scoped=(n===8||n===9)&&typeof _scopedRows==='function'?_scopedRows():d.rows;
    const vals=scoped.map(r=>r[idx]).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
    const m=e?elementMeta(e):{},s=vals.length?statsSummary(vals):null;
    if(n===3){const c=validateDataP2().counts;return text('quality',{rows:d.rows.length,bad:c.bad,warn:c.warn});}
    if(n===8||n===9){
      const base=s?text('distribution',{element:m.label,unit:m.unit,n:vals.length,mean:s.mean.toFixed(3),cv:s.cv.toFixed(2)}):text('noGrades');
      if(n===9){const cap=window._capLog?.[e];return base+' '+(cap?text('capApplied',{cut:cap.cut,unit:m.unit}):text('capNone'));}
      return base;
    }
    if(n===11)return text('domain',{method:window._domainAudit?.method||text('unrecorded'),n:new Set(d.rows.map(r=>r[colIdx('domain')]).filter(v=>v!=null)).size});
    if(n===7){const c=typeof _compositeCache==='undefined'?null:_compositeCache;return c?.composites?text('composite',{n:c.composites.length,length:_reportCompositeLength(),tail:c.droppedTailLength||0}):text('compositePending');}
    if(n===6)return text('coordinates',{n:d.rows.filter(r=>['midx','midy','midz'].every(c=>Number.isFinite(r[colIdx(c)]))).length,total:d.rows.length});
    if(n===12)return text('qaqc');
    if(n===13){const r=snapshot();return text('reviewSummary',{reviewed:r.filter(x=>x.status==='reviewed').length,stale:r.filter(x=>x.status==='stale').length});}
    return text('loaded',{rows:d.rows.length,elements:availableElements().length});
  }
  function node(tag,content,className) {const el=document.createElement(tag);if(content!=null)el.textContent=content;if(className)el.className=className;return el;}
  function button(title,fn,secondary=false,role='inspect') {const el=node('button',title,'btn'+(secondary?' secondary':''));el.type='button';el.dataset.actionRole=role;el.addEventListener('click',fn);return el;}
  async function renderEstimationReview(host){
    const title=node('h3',text('estimation.title')),explanation=node('p',text('estimation.explanation'));
    host.replaceChildren(title,explanation);
    const context=await estimationContext();if(!host.isConnected)return;
    if(!context?.geologicalRevision){host.append(node('p',text('estimation.blockedGeology'),'hint warn'));return;}
    if(!context.membershipRevision){host.append(node('p',text('estimation.blockedMembership'),'hint warn'));return;}
    const currentStatus=await estimationSpecReadiness();
    if(estimationSpec){host.append(button(text('estimation.edaInspect'),async()=>{try{await inspectReviewedEDA();}catch(error){toast(error.message||'ESTIMATION_SPEC_NOT_CURRENT','warn');}},true,'inspect'));host.append(node('p',text('estimation.approved',{status:currentStatus.status,elements:estimationSpec.elements.length,parents:estimationSpec.sourceObservationIds.length}),'hint '+(currentStatus.status==='approved'?'good':'warn')));
      const undoReason=node('input');undoReason.type='text';undoReason.maxLength=500;undoReason.placeholder=text('estimation.undoReason');undoReason.setAttribute('aria-label',text('estimation.undoReason'));
      const undo=button(text('estimation.undo'),async()=>{try{await undoEstimationSpec(undoReason.value);renderEstimationReview(host);}catch(error){toast(error.message||'ESTIMATION_SPEC_UNDO_FAILED','warn');}},true,'custom');undo.disabled=!undoReason.value.trim();undoReason.addEventListener('input',()=>{undo.disabled=!undoReason.value.trim();});host.append(undoReason,undo);
    }
    const codebook=context.geologicalDomainIds||[];if(!codebook.length){host.append(node('p',text('estimation.blockedGeology'),'hint warn'));return;}
    const domainField=node('fieldset',null,'workflow-estimation-domains'),legend=node('legend',text('estimation.domains'));domainField.append(legend,node('p',text('estimation.chooseDomain')));
    const choices=[];codebook.forEach((code,index)=>{const label=node('label',code),checkBox=node('input');checkBox.type='checkbox';checkBox.value=code;checkBox.id='assay-estimation-domain-'+index;label.htmlFor=checkBox.id;label.prepend(checkBox);choices.push(checkBox);domainField.append(label);});host.append(domainField);
    const policyLabel=node('label',text('estimation.boundary'),'workflow-element'),policy=node('select');policy.id='assay-estimation-boundary';policy.setAttribute('aria-label',text('estimation.boundary'));
    for(const [value,key] of [['','boundaryChoose'],['hard','hard'],['soft','soft']]){const option=node('option',text('estimation.'+key));option.value=value;policy.append(option);}policyLabel.htmlFor=policy.id;policyLabel.append(policy);host.append(policyLabel);
    const reviewer=node('input'),reason=node('textarea');reviewer.type='text';reviewer.maxLength=200;reviewer.placeholder=text('estimation.reviewer');reviewer.setAttribute('aria-label',text('estimation.reviewer'));
    reason.maxLength=1000;reason.rows=2;reason.placeholder=text('estimation.reason');reason.setAttribute('aria-label',text('estimation.reason'));
    const previewButton=button(text('estimation.preview'),()=>buildPreview(),true,'inspect'),applyButton=button(text('estimation.apply'),()=>applyPreview(),false,'apply');applyButton.disabled=true;
    const reviewFields=node('div',null,'workflow-estimation-review-fields'),reviewerLabel=node('label',text('estimation.reviewer')),reasonLabel=node('label',text('estimation.reason'));
    reviewerLabel.append(reviewer);reasonLabel.append(reason);reviewFields.append(reviewerLabel,reasonLabel);
    const reviewActions=node('div',null,'workflow-actions');reviewActions.append(previewButton,applyButton);
    const result=node('p',text('estimation.previewNeeds'),'workflow-status');result.setAttribute('aria-live','polite');host.append(reviewFields,reviewActions,result);
    let preview=null;
    function invalidate(){preview=null;applyButton.disabled=true;result.textContent=text('estimation.previewNeeds');host.querySelectorAll('.workflow-estimation-preview').forEach(el=>el.remove());}
    choices.forEach(el=>el.addEventListener('change',invalidate));policy.addEventListener('change',invalidate);reviewer.addEventListener('input',invalidate);reason.addEventListener('input',invalidate);
    function buildPreview(){
      const selected=choices.filter(el=>el.checked).map(el=>el.value),boundaryPolicy=policy.value,reviewReason=reason.value.trim(),reviewerId=reviewer.value.trim();
      if(!selected.length||!['hard','soft'].includes(boundaryPolicy)||!reviewReason||!reviewerId){result.textContent=text('estimation.previewNeeds');return;}
      const domainIndex=(data().columns||data().cols||[]).indexOf('domain'),decisions=[],counts={retain:0,split:0,reject:0,ambiguous:0};
      for(let index=0;index<context.parentObservationIds.length;index++){
        const parentObservationId=context.parentObservationIds[index],membership=context.membershipByParent[parentObservationId],actual=[...new Set(membership.spans.filter(s=>s.state==='inside').map(s=>s.geologicalDomainId))].sort();
        const intersects=actual.some(code=>selected.includes(code)),ambiguous=membership.status==='ambiguous',isBoundary=membership.status==='boundary';
        let action='reject',decisionReason='Rejected: measured support is outside the selected estimation population.';
        if(ambiguous){decisionReason='Rejected: measured membership is ambiguous and requires source/geology review.';counts.ambiguous++;}
        else if(isBoundary){decisionReason='Rejected: support lies on the geological boundary and is not assigned.';}
        else if(intersects&&membership.status==='crossing'&&boundaryPolicy==='hard'){action='split';decisionReason='Split at measured hard-boundary support.';}
        else if(intersects){action='retain';decisionReason=membership.status==='crossing'?'Retained across a reviewed soft geological boundary.':'Retained inside a selected accepted geological domain.';}
        if(action==='split')counts.split++;else if(action==='retain')counts.retain++;else if(!ambiguous)counts.reject++;
        const row=data().rows[index],from=Number(row[(data().columns||data().cols).indexOf('from_m')]),to=Number(row[(data().columns||data().cols).indexOf('to_m')]);
        const decision={parentObservationId,statisticalPopulationId:domainIndex<0?'unlabelled':String(row[domainIndex]??''),geologicalMembership:actual,membershipStatus:membership.status,
          action,reason:decisionReason};
        if(action==='split'){decision.support={fromMD:from,toMD:to};decision.parts=membership.spans.map(s=>({fromMD:s.entryMD,toMD:s.exitMD,geologicalDomainId:s.geologicalDomainId}));}
        decisions.push(decision);
      }
      preview={schema:'orebit-estimation-spec',version:1,sourceRevision:context.sourceRevision,geologicalRevision:context.geologicalRevision,membershipRevision:context.membershipRevision,
        roles:{source:'assay-source',statistical:'reviewed-statistical-population',geological:'accepted-geological-membership',estimation:'approved-estimation-population'},
        elements:[{elementId:element(11),unit:elementMeta(element(11)).unit||'unitless',populationId:element(11)+'::'+selected.join('+'),geologicalDomainIds:selected.slice().sort(),boundaryPolicy,boundaryReason:reviewReason,reviewReason,decisions}]};
      const valid=OrebitEstimationSpec.validate(preview,context);if(!valid.ok){preview=null;result.textContent=valid.findings.join(', ');return;}
      result.textContent=text('estimation.counts',counts);const details=node('details',null,'workflow-estimation-preview'),summary=node('summary',text('estimation.previewDetails'));details.append(summary);
      for(const d of decisions.slice(0,50))details.append(node('p',`${d.parentObservationId} · ${d.membershipStatus} · ${d.action}${d.action==='split'?' · '+d.parts.length+' support spans':''}`));
      if(decisions.length>50)details.append(node('p',text('estimation.previewFirst',{n:50,total:decisions.length})));host.insertBefore(details,reviewFields);applyButton.disabled=false;
    }
    async function applyPreview(){
      if(!preview)return;
      try{await approveEstimationSpec(preview,{reviewer:reviewer.value.trim(),reason:reason.value.trim()});host.replaceChildren();await renderEstimationReview(host);await inspectReviewedEDA();}
      catch(error){preview=null;applyButton.disabled=true;result.textContent=error.findings?.join(', ')||error.message||'ESTIMATION_SPEC_INVALID';}
    }
  }
  function navigate(n){showTab(n);document.querySelector('#tab'+n+' .assay-workflow-card')?.scrollIntoView({block:'start',behavior:'smooth'});}
  function record(n,advance) {
    if(!data()?.rows?.length)return;
    const note=document.getElementById('assay-stage-note-'+n)?.value||entries[n]?.note||'';
    entries[n]={stage:n,title:label(n),context:context(n),reviewedAt:new Date().toISOString(),note,
      parameters:parameters(n),insight:insight(n)};
    if(typeof AutoSave!=='undefined')AutoSave.schedule();
    if(advance&&NEXT[n])navigate(NEXT[n]);
    else refresh(n);
  }
  function recommend(n) {
    if(n===2){document.getElementById('fileInput').click();return;}
    if(n===3){showValidationReportP2();return;}
    if(n===8){navigate(9);return;}
    if(n===7){
      const raw=_reportMedianRawIntervalLength();if(!Number.isFinite(raw)||raw<=0)return;
      const el=document.getElementById('compLength');if(!el)return;
      // The existing UI accepts 0.5-10 m. Keep values outside that range for custom review.
      if(raw<0.5||raw>10){toast(text('customLength'), 'warn');el.focus();return;}
      el.value=String(raw);el.dispatchEvent(new Event('change',{bubbles:true}));refresh(n);return;
    }
    if(n===13){exportPDF();return;}
    showTab(n);refresh(n);
  }
  function decorateNavigation(n) {
    const nav=document.querySelector('nav.tabs');if(!nav)return;
    document.body.classList.add('assay-guided','screening-guided');
    document.body.classList.toggle('workflow-on-dashboard',n===1);
    const foot=nav.querySelector('.orebit-rail-foot');if(foot)foot.style.order='999';
    nav.querySelectorAll('.tab').forEach((el,i)=>{
      const tab=i+1;el.dataset.workflowAdvanced=String(tab!==1&&!MAIN.includes(tab));
      el.style.order=String(tab===1?0:MAIN.includes(tab)?MAIN.indexOf(tab)+1:100+tab);
      // Visits remain available to old readiness checks, but do not claim analyst approval.
      el.classList.remove('tab-done');
      const r=entries[tab];el.classList.toggle('workflow-reviewed',!!r&&r.context===context(tab));
    });
    let toggle=document.getElementById('assayAdvancedToggle');
    if(!toggle){toggle=button('',()=>{document.body.classList.toggle('assay-advanced-open');decorateNavigation(current);},true);toggle.dataset.actionRole='advanced';toggle.id='assayAdvancedToggle';toggle.style.order='90';nav.append(toggle);}
    if(n!==1&&!MAIN.includes(n))document.body.classList.add('assay-advanced-open');
    const open=document.body.classList.contains('assay-advanced-open');toggle.textContent=text(open?'hideAdvanced':'advanced');toggle.setAttribute('aria-expanded',String(open));
    OrebitScreeningWorkflow.sidebar(MAIN,n,toggle,open);
  }
  function refresh(n=current) {
    const scope=reviewedEDAStatus(),scopeLabel=document.querySelector('#reviewedEDAScopeBar span');
    if(scopeLabel)scopeLabel.textContent=text(scope?.status==='stale'?'estimation.edaStale':'estimation.edaActive');
    const scopeButton=document.querySelector('#reviewedEDAScopeBar button');
    if(scopeButton)scopeButton.textContent=text('estimation.edaClear');
    if(!initialized)return;if(n!==1&&MAIN.includes(n))lastMainStage=n;current=n;decorateNavigation(n);
    const panel=document.getElementById('tab'+n);if(!panel)return;
    OrebitScreeningWorkflow.decorateOptions(panel);
    let card=panel.querySelector('.assay-workflow-card');
    const oldNote=document.getElementById('assay-stage-note-'+n)?.value;
    const notesOpen=card?.querySelector('.workflow-notes')?.open;
    OrebitScreeningWorkflow.stageBar();
    if(n===1){const loaded=!!data()?.rows?.length,first=!loaded?2:lastMainStage>1?lastMainStage:3;OrebitScreeningWorkflow.dashboard(panel,insight(1),text('purpose1'),first,loaded&&lastMainStage>1);return;}
    if(card)card.remove();card=node('section',null,'assay-workflow-card');card.setAttribute('aria-label',text('guide'));
    const step=MAIN.indexOf(n);card.classList.toggle('workflow-optional',step<0);card.append(node('p',step>=0?text('step',{n:step+1,total:MAIN.length}):text('optional'),'workflow-eyebrow'));
    card.append(node('h2',label(n)),node('p',text('purpose'+n),'workflow-purpose'));
    card.append(OrebitScreeningWorkflow.links(MAIN,n));
    if(data()&&[3,7,8,9,10,11,13].includes(n)&&availableElements().length){
      const field=node('label',text('element'),'workflow-element');const select=node('select');select.id='assay-workflow-element-'+n;field.htmlFor=select.id;
      for(const e of availableElements()){const m=elementMeta(e),option=node('option',plotLabel(m.label+' ('+m.unit+')'));option.value=e;select.append(option);}
      select.value=element(n);select.addEventListener('change',()=>chooseElement(n,select.value));field.append(select);card.append(field);
    }
    const facts=node('div',null,'workflow-insight');facts.append(node('strong',text('quickInsight')),node('p',insight(n)));card.append(facts);
    if(scope&&[4,5,6,8,9].includes(n)){const disclosure=node('div',reviewedEDAMessage(scope),'hint warn');disclosure.dataset.reviewedEdaStatus=scope.status;card.append(disclosure);}
    if(n===11){const specPanel=node('section',null,'workflow-estimation-spec');card.append(specPanel);renderEstimationReview(specPanel);}
    card.append(node('p',text('recommend'+n),'workflow-recommendation'));
    const actions=node('div',null,'workflow-actions');
    const calc=button(text(n===2?'chooseFile':n===3?'checkData':n===8?'reviewTail':n===7?'useMedian':n===13?'pdf':'refresh'),()=>recommend(n),false,n===2?'apply':n===13?'export':n===7?'custom':'inspect');
    calc.disabled=n!==2&&!data()?.rows?.length;actions.append(calc);
    if(n===11){const openCore=node('a',text('openCoreDomain'),'btn secondary');openCore.href='Core.html?workflow=domain';openCore.target='_blank';openCore.rel='noopener';openCore.dataset.actionRole='inspect';actions.append(openCore);}
    if(n!==2&&n!==13){const next=button(text('recordContinue',{stage:label(NEXT[n])}),()=>record(n,true),false,'next');next.disabled=!data()?.rows?.length;actions.append(next);}
    if(n===13&&typeof OrebitHandoff!=='undefined'&&OrebitHandoff.available()){
      const handoff=button(window.__t('handoff.toResource'),()=>sendResourceHandoff(),false,'next');
      handoff.disabled=!data()?.rows?.length;actions.append(handoff);
    }
    if(panel.querySelector('details[data-workflow-options]'))actions.append(button(window.__t('flow.options'),()=>OrebitScreeningWorkflow.customize(panel),true,'custom'));
    card.append(actions);card.append(OrebitScreeningWorkflow.related('assay',n,navigate));
    const key=node('div',null,'action-key');for(const role of ['next','inspect','custom','advanced'])key.append(node('span',window.__t('ux.action.'+role),'action-key-'+role));card.append(key);
    const details=node('details',null,'workflow-notes');details.open=!!notesOpen;details.append(node('summary',text('notes')));
    const noteLabel=node('label',text('noteLabel'));noteLabel.htmlFor='assay-stage-note-'+n;
    const note=node('textarea');note.id=noteLabel.htmlFor;note.rows=2;note.maxLength=5000;note.value=oldNote??entries[n]?.note??'';
    note.addEventListener('input',()=>{if(!entries[n])entries[n]={stage:n,title:label(n),note:'',context:null};entries[n].note=note.value;entries[n].context=null;card.querySelector('.workflow-status').textContent=text('notReviewed');document.querySelectorAll('nav.tabs .tab')[n-1]?.classList.remove('workflow-reviewed');if(typeof AutoSave!=='undefined')AutoSave.schedule();});
    details.append(noteLabel,note,node('p',text('parameterHint')));
    if(n===11)details.append(button(text('reviewLithology'),()=>navigate(10),true));
    if(n===13)details.append(button(text('exportRecord'),()=>exportRecord(),true),button(text('exportComposites'),()=>exportMasterForEstimation(),true));
    const review=button(text('record'),()=>record(n,false),true);review.disabled=!data()?.rows?.length;details.append(review);card.append(details);
    const r=entries[n];card.append(node('p',r?.context?(r.context===context(n)?text('reviewed'):text('stale')):text('notReviewed'),'workflow-status'));
    OrebitScreeningWorkflow.compact(card);panel.prepend(card);
    if(n===13)renderReview(panel,card);
    OrebitScreeningWorkflow.stageBar('assay',MAIN,n,panel,card);
  }
  function renderReview(panel,card){
    panel.querySelector('.workflow-review-list')?.remove();
    panel.querySelector('.assay-checkpoint-return-tools')?.remove();
    const list=node('details',null,'workflow-review-list');list.append(node('summary',text('reviewRecord')));
    for(const r of snapshot()){
      const row=node('div',null,'workflow-review-row');row.append(node('strong',r.title+' - '+text(r.status==='not-reviewed'?'notReviewed':r.status)));
      if(r.insight)row.append(node('p',r.insight));if(r.note)row.append(node('p',r.note));
      if(r.parameters){const d=node('details');d.append(node('summary',text('parameters')),node('pre',OrebitScreeningReport.formatParameters(r.parameters)));row.append(d);}
      list.append(row);
    }
    card.after(list);
    const tools=document.createElement('div');tools.className='assay-checkpoint-return-tools';
    if(checkpointReturnStatus){
      const notice=node('p',text(({pending:'checkpointReturn.pending',restored:'checkpointReturn.restored',stale:'checkpointReturn.stale'})[checkpointReturnStatus.status]),'hint '+(checkpointReturnStatus.status==='stale'?'warn':'good'));
      notice.dataset.state=checkpointReturnStatus.status;notice.className='assay-checkpoint-return-status';tools.append(notice);
    }
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;input.id='assayCheckpointReturnFile';
    input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file)return;
      try{await OrebitHandoff.importAssayCheckpointReturnFile(file);}catch(error){setCheckpointReturnStatus({status:'stale'});console.warn('[Assay checkpoint return]',error);}
      input.value='';});
    tools.append(input,button(text('checkpointReturn.openJson'),()=>input.click(),true));
    list.after(tools);
  }
  async function exportRecord(){const record=serialise();await orebitSaveFile('Orebit-Assay-Interpretation.json',JSON.stringify(record,null,2),'application/json');}
  function boot(){
    if(initialized||typeof window.showTab!=='function')return;initialized=true;
    const original=window.showTab;window.showTab=function(n){const result=original.apply(this,arguments);refresh(n);return result;};
    window.__i18nPostApplyHooks=window.__i18nPostApplyHooks||[];
    window.__i18nPostApplyHooks.push(()=>refresh(current));
    document.addEventListener('change',ev=>{if(ev.target.closest('.panel')&&!ev.target.closest('.assay-workflow-card'))setTimeout(()=>refresh(current),0);});
    refresh(typeof currentTab==='number'?currentTab:1);
  }
  window.OrebitAssayWorkflow={reset,restore,serialise,snapshot,refresh,record,parameters,context,
    reviewedEDAStatus,reviewedEDARows,reviewedEDABadge,clearReviewedEDAScope,estimationContext,approveEstimationSpec,estimationSpecReadiness,undoEstimationSpec,receiveCheckpointReturn,setCheckpointReturnStatus};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else setTimeout(boot,0);
})();
