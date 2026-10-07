/* Guided Assay review. Existing calculation and export functions remain authoritative. */
(function () {
  'use strict';
  const MAIN = [2, 3, 8, 11, 7, 13];
  const NEXT = {1:2, 2:3, 3:8, 8:11, 9:11, 10:11, 11:7, 7:13, 4:8, 5:11, 6:13, 12:13};
  const ELEMENT_IDS={8:'statsElementSelect',9:'tcElementSelect',10:'lithoElementSelect',11:'domainElementSelect'};
  const KEYS = {1:'dashboard',2:'upload',3:'data',4:'bivariate',5:'multivariate',6:'spacing',7:'composite',8:'stats',9:'topcut',10:'litho',11:'domain',12:'qaqc',13:'report'};
  let entries = {}, current = 1, initialized = false;
  const text = (key, values={}) => Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',String(v)), window.__t('asy.workflow.'+key));
  const label = n => window.__t('tab.'+KEYS[n]);
  const data = () => typeof DATA === 'undefined' ? null : DATA;
  const clone = x => JSON.parse(JSON.stringify(x));
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
    const controls={};
    document.querySelectorAll('#tab'+n+' input[id],#tab'+n+' select[id]').forEach(el=>{
      if(el.closest('.assay-workflow-card') || el.type==='file' || el.type==='button')return;
      controls[el.id]=el.type==='checkbox'?el.checked:el.multiple?Array.from(el.selectedOptions,o=>o.value):el.value;
    });
    const e=element(n);
    return {element:e,unit:e?elementMeta(e).unit:null,scope:window._domainScope||'All',controls,
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
    if(n===7||n===13)semantic.composite=p.composite;
    if(n===11)semantic.domain=p.actualDomain;
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
  function reset() {entries={};Object.values(ELEMENT_IDS).forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.querySelectorAll('.assay-workflow-card').forEach(el=>el.remove());}
  function restore(record) {
    entries={};
    if(record?.schema!=='orebit-assay-interpretation'||record.version!==1||!Array.isArray(record.stages))return;
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
      dataset:{name:data()?.name||'',rows:data()?.rows.length||0,columns:data()?.columns||[]},
      fingerprintPurpose:'Change detection; not file authenticity',targetElement:data()?primaryElement():null,stages:snapshot()};
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
  function navigate(n){showTab(n);document.querySelector('#tab'+n+' .assay-workflow-card')?.scrollIntoView({block:'start',behavior:'smooth'});}
  function record(n,advance) {
    if(!data()?.rows?.length)return;
    const note=document.getElementById('assay-stage-note-'+n)?.value||entries[n]?.note||'';
    entries[n]={stage:n,title:label(n),context:context(n),reviewedAt:new Date().toISOString(),note,
      parameters:parameters(n),insight:insight(n)};
    if(typeof AutoSave!=='undefined')AutoSave.schedule();
    refresh(n);
    if(advance&&NEXT[n])navigate(NEXT[n]);
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
    document.body.classList.add('assay-guided');
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
  }
  function refresh(n=current) {
    if(!initialized)return;current=n;decorateNavigation(n);
    const panel=document.getElementById('tab'+n);if(!panel)return;
    let card=panel.querySelector('.assay-workflow-card');
    const oldNote=document.getElementById('assay-stage-note-'+n)?.value;
    const notesOpen=card?.querySelector('.workflow-notes')?.open;
    if(card)card.remove();card=node('section',null,'assay-workflow-card');card.setAttribute('aria-label',text('guide'));
    const step=MAIN.indexOf(n);card.append(node('p',step>=0?text('step',{n:step+1,total:MAIN.length}):text('optional'),'workflow-eyebrow'));
    card.append(node('h2',label(n)),node('p',text('purpose'+n),'workflow-purpose'));
    if(data()&&[3,7,8,9,10,11,13].includes(n)&&availableElements().length){
      const field=node('label',text('element'),'workflow-element');const select=node('select');select.id='assay-workflow-element-'+n;field.htmlFor=select.id;
      for(const e of availableElements()){const m=elementMeta(e),option=node('option',m.label+' ('+m.unit+')');option.value=e;select.append(option);}
      select.value=element(n);select.addEventListener('change',()=>chooseElement(n,select.value));field.append(select);card.append(field);
    }
    const facts=node('div',null,'workflow-insight');facts.append(node('strong',text('quickInsight')),node('p',insight(n)));card.append(facts);
    card.append(node('p',text('recommend'+n),'workflow-recommendation'));
    const actions=node('div',null,'workflow-actions');
    const calc=button(text(n===2?'chooseFile':n===3?'checkData':n===8?'reviewTail':n===7?'useMedian':n===13?'pdf':'refresh'),()=>recommend(n),false,n===2?'apply':n===13?'export':n===7?'custom':'inspect');
    calc.disabled=n!==2&&!data()?.rows?.length;actions.append(calc);
    if(n!==2&&n!==13){const next=button(text('recordContinue'),()=>record(n,true),false,'next');next.disabled=!data()?.rows?.length;actions.append(next);}
    if(n===13&&typeof OrebitHandoff!=='undefined'&&OrebitHandoff.available())actions.append(button(window.__t('handoff.toResource'),()=>OrebitHandoff.send('Resource',exportMasterForEstimation),true));
    if([7,8,9,10,11].includes(n))actions.append(button(text('custom'),()=>{const control=Array.from(panel.querySelectorAll('select,input[type=number]')).find(el=>!el.closest('.assay-workflow-card'));if(control){control.scrollIntoView({block:'center',behavior:'smooth'});control.focus({preventScroll:true});}},true,'custom'));
    card.append(actions);
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
    panel.prepend(card);
    if(n===13)renderReview(panel,card);
  }
  function renderReview(panel,card){
    panel.querySelector('.workflow-review-list')?.remove();
    const list=node('details',null,'workflow-review-list');list.append(node('summary',text('reviewRecord')));
    for(const r of snapshot()){
      const row=node('div',null,'workflow-review-row');row.append(node('strong',r.title+' - '+text(r.status==='not-reviewed'?'notReviewed':r.status)));
      if(r.insight)row.append(node('p',r.insight));if(r.note)row.append(node('p',r.note));
      if(r.parameters){const d=node('details');d.append(node('summary',text('parameters')),node('pre',JSON.stringify(r.parameters,null,2)));row.append(d);}
      list.append(row);
    }
    card.after(list);
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
  window.OrebitAssayWorkflow={reset,restore,serialise,snapshot,refresh,record,parameters,context};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else setTimeout(boot,0);
})();
