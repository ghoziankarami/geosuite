/* Consistent navigation and focus across screening apps. Calculations stay in their owners. */
(function () {
  'use strict';
  const tr = (key, values={}) => Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',String(v)), window.__t('flow.'+key));
  const node = (tag, content, cls) => {const el=document.createElement(tag);if(content!=null)el.textContent=content;if(cls)el.className=cls;return el;};
  function button(title, role, action) {const el=node('button',title,'btn'+(['inspect','custom','advanced'].includes(role)?' secondary':''));el.type='button';el.dataset.actionRole=role;el.addEventListener('click',action);return el;}
  const label = n => document.querySelectorAll('nav.tabs .tab')[n-1]?.textContent.trim() || String(n);
  const resource = () => document.getElementById('blockModelContent')!==null;
  const assay = () => document.getElementById('assayAdvancedToggle')!==null || typeof OrebitAssayWorkflow!=='undefined';
  let current=1, initialized=false, validation=null;
  const moved=new Map();
  const dirty=new Map();
  let pending=null;
  let failedAttempt=null;
  const failureSignature = n => JSON.stringify({calculation:resourceCalculationSignature(),inputs:Array.from(document.querySelectorAll('#tab'+n+' input,#tab'+n+' select')).map(el=>[el.id,el.value,el.checked])});
  const calculation = n => resource()&&[4,5,6,7].includes(n);
  const result = n => ({4:variogramState.model,5:blockState.blocks,6:estimState.results,7:crossvalState.metrics})[n];
  function canContinue(n) {
    if(!calculation(n))return ready(n);
    if(pending||estimState._running||estimState._confirming||crossvalState._running)return false;
    return !!DATA?.rows?.length && !!setupState.element &&
      (n<6 || !!variogramState.model) && (n!==6 || !!blockState.blocks?.length);
  }
  async function continueStage(n,target) {
    if(resource())validateResourceCalculationContext();
    if(pending || !canContinue(n))return;
    if(!calculation(n)){navigate(target);return;}
    const rows=DATA.rows,before=result(n);
    const needsRun=!ready(n)||dirty.has(n);
    if(!needsRun){navigate(target);return;}
    const controls=Array.from(document.querySelectorAll('#tab'+n+' input,#tab'+n+' select')).map(el=>[el,el.disabled]);
    failedAttempt=null;
    pending={stage:n};controls.forEach(([el])=>el.disabled=true);sync();
    try {
      // Existing owners read the current visible/custom parameters and retain
      // their own confirmation, validation, cancellation and numerical rules.
      await ({4:computeVariogram,5:generateBlocks,6:runEstimation,7:runCrossVal})[n]();
      while(estimState._running||estimState._confirming||crossvalState._running)
        await new Promise(resolve=>setTimeout(resolve,100));
      if(DATA.rows===rows && current===n){
        if(result(n)!==before && ready(n)){dirty.delete(n);navigate(target);}
        else {
          failedAttempt={stage:n,rows,signature:failureSignature(n)};
          const status=document.querySelector('#tab'+n+' .workflow-gate');
          if(status){status.hidden=false;status.textContent=tr('notAdvanced');}
        }
      }
    } catch(error) {
      console.error('Guided calculation failed',error);
      failedAttempt={stage:n,rows,signature:failureSignature(n)};
      if(current===n){const status=document.querySelector('#tab'+n+' .workflow-gate');if(status){status.hidden=false;status.textContent=tr('notAdvanced');}}
    } finally {controls.forEach(([el,disabled])=>el.disabled=disabled);pending=null;sync();}
  }
  function restoreActions() {
    for(const {element,marker} of moved.values()){
      if(marker.isConnected)marker.replaceWith(element);else element.remove();
    }
    moved.clear();
  }
  const main = () => resource()?[2,3,4,5,6,7,10,12]:(window._coreUseProvidedXYZ?[2,7,11,13]:[2,7,10,11,13]);
  function navigate(n) {showTab(n);document.getElementById('tab'+n)?.scrollIntoView({block:'start',behavior:'smooth'});}
  function links(stages,n) {
    const row=node('nav',null,'workflow-step-links');row.setAttribute('aria-label',tr('workflow'));
    for(const [i,stage] of stages.entries()){const b=button(label(stage),'inspect',()=>navigate(stage));if(stage===n)b.setAttribute('aria-current','step');row.append(b);}
    return row;
  }
  // One inventory serves every module. Links reveal existing owners; they never apply a treatment.
  const RELATED = {
    core:{2:[[3,'collar'],[4,'survey'],[5,'assay'],[6,'geology']],7:[[3,'collar'],[4,'survey'],[5,'assay'],[6,'geology']],10:[[8,'strips'],[9,'section']],11:[[12,'composite']],13:[[12,'composite'],[7,'validation']]},
    assay:{3:[[12,'qaqc'],[6,'spacing']],8:[[9,'topcut'],[4,'bivariate'],[5,'multivariate']],11:[[10,'lithology'],[5,'multivariate']],7:[[6,'spacing'],[12,'qaqc']],13:[[12,'qaqc'],[9,'topcut']]},
    resource:{3:[[3,'decluster','resourceSetupAdvanced']],4:[[4,'anisotropy','variogramAdvanced']],5:[[5,'density','blockAdvanced']],6:[[11,'viewer']],7:[[8,'swath'],[9,'confidence'],[11,'viewer']],10:[[11,'viewer'],[9,'confidence']],12:[[11,'viewer'],[8,'swath'],[9,'confidence']]}
  };
  const origins=new Map();
  function related(module,n,go) {
    const row=node('section',null,'workflow-related');row.setAttribute('aria-label',tr('related'));
    const origin=origins.get(module+':'+n);
    if(origin&&origin!==n){row.append(button(tr('return',{stage:label(origin)}),'inspect',()=>go(origin)));}
    const tools=RELATED[module]?.[n]||[];
    if(tools.length){row.append(node('p',tr('related'),'workflow-related-title'));
      const actions=node('div',null,'workflow-related-actions');
      for(const [stage,key,id] of tools){const b=button(tr('tool.'+key),'inspect',()=>{
        if(stage!==n){origins.set(module+':'+stage,n);go(stage);}
        if(id){const el=document.getElementById(id);if(el){el.open=true;el.scrollIntoView({block:'start',behavior:'smooth'});el.querySelector('summary')?.focus();}}
      });b.dataset.relatedStage=String(stage);if(id)b.dataset.relatedTarget=id;actions.append(b);}
      row.append(actions);
    }
    row.hidden=!tools.length&&!origin;
    return row;
  }
  function dashboard(panel, insight, purpose, first) {
    panel.querySelector('.assay-workflow-card')?.remove();
    const card=node('section',null,'assay-workflow-card workflow-dashboard');card.setAttribute('aria-label',tr('guide'));
    card.append(node('h2',label(1)),node('p',purpose,'workflow-purpose'));
    const facts=node('div',null,'workflow-insight');facts.append(node('strong',tr('quickInsight')),node('p',insight));card.append(facts);
    const actions=node('div',null,'workflow-actions');actions.append(button(tr(first===2?'import':'start'),'next',()=>navigate(first)));if(first!==2)actions.append(button(tr('import'),'inspect',()=>navigate(2)));card.append(actions);panel.prepend(card);
    document.body.classList.add('screening-guided','workflow-on-dashboard');
    return card;
  }
  function facts(n) {
    if(resource()){
      if(typeof DATA==='undefined'||!DATA?.rows?.length)return tr('empty');
      if(n===4){const m=variogramState.model,number=v=>Number.isFinite(v)?String(Number(v.toPrecision(4))):'—';return m?tr('varReady',{type:m.type,nugget:number(m.nugget),sill:number(m.sill),range:number(m.range)}):tr('varPending');}
      if(n===5)return blockState.blocks?tr('gridReady',{blocks:blockState.blocks.length.toLocaleString()}):tr('gridPending');
      if(n===6)return tr('estimated',{status:tr(estimState.done?'complete':'notComplete')});
      return tr('loaded',{rows:DATA.rows.length.toLocaleString()});
    }
    if(!STATE.collar.length&&!STATE.assay.length)return tr('empty');
    if(n===7&&validation)return tr('coreQuality',{fail:validation.filter(c=>c.severity==='fail').length,warn:validation.filter(c=>c.severity==='warn').length});
    return tr('coreLoaded',{holes:STATE.collar.length.toLocaleString(),assays:STATE.assay.length.toLocaleString(),logs:STATE.geology.length.toLocaleString()});
  }
  function next(n) {
    if(resource())return n===1?3:n===2?3:n===7?10:n===10?12:n<10?n+1:n===11?12:null;
    if(n===7&&window._coreUseProvidedXYZ)return 11;
    return ({1:7,2:7,3:4,4:5,5:6,6:7,7:10,8:9,9:10,10:11,11:13,12:13})[n]||null;
  }
  function ready(n) {
    if(resource())return n===2?!!DATA?.rows?.length:n===3?!!DATA?.rows?.length&&!!setupState.element:n===5?!!blockState.blocks?.length:isTabDone(n);
    if(n===7)return !!STATE.collar.length&&validation&&!validation.some(c=>c.severity==='fail')&&coreGeometryReady();
    return p1IsTabReady(n);
  }
  function customize(panel) {
    const first=Array.from(panel.querySelectorAll('input[type=number],select')).find(el=>!el.closest('.assay-workflow-card'));
    if(!first)return;let parent=first.parentElement;while(parent&&parent!==panel){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
    first.scrollIntoView({block:'center',behavior:'smooth'});first.focus({preventScroll:true});
  }
  function navigation(n) {
    const nav=document.querySelector('nav.tabs');if(!nav)return;
    document.body.classList.add('screening-guided');document.body.classList.toggle('workflow-on-dashboard',n===1);
    const stages=main();
    const foot=nav.querySelector('.orebit-rail-foot');if(foot)foot.style.order='999';
    nav.querySelectorAll('.tab').forEach((el,i)=>{const stage=i+1;el.dataset.workflowAdvanced=String(stage!==1&&!stages.includes(stage));el.style.order=String(stage===1?0:stages.includes(stage)?stages.indexOf(stage)+1:100+stage);});
    let toggle=nav.querySelector('.screening-advanced-toggle');
    if(!toggle){toggle=button('', 'advanced',()=>{document.body.classList.toggle('screening-advanced-open');navigation(current);});toggle.classList.add('screening-advanced-toggle');toggle.style.order='90';nav.append(toggle);}
    if(n!==1&&!stages.includes(n))document.body.classList.add('screening-advanced-open');
    const open=document.body.classList.contains('screening-advanced-open');toggle.textContent=tr(open?'hideAdvanced':'advanced');toggle.setAttribute('aria-expanded',String(open));
  }
  function sync() {
    if(resource())validateResourceCalculationContext();
    const panel=document.getElementById('tab'+current),card=panel?.querySelector('.assay-workflow-card');if(!card)return;
    card.querySelector('.workflow-insight p').textContent=facts(current);
    if(calculation(current)&&dirty.has(current)&&result(current)!==dirty.get(current))dirty.delete(current);
    const gate=card.querySelector('.workflow-gate');if(gate){
      if(pending?.stage===current){gate.hidden=false;gate.textContent=tr('calculating');}
      else if(resource()&&failedAttempt?.stage===current&&failedAttempt.rows===DATA.rows&&failedAttempt.signature===failureSignature(current)){gate.hidden=false;gate.textContent=tr('notAdvanced');}
      else {gate.hidden=canContinue(current);gate.textContent=tr(!resource()&&[7,10].includes(current)?'blockedGeometry':'blocked');}
    }
    const onward=card.querySelector('[data-workflow-next]');if(onward){onward.disabled=!canContinue(current);if(calculation(current))onward.textContent=tr(!ready(current)||dirty.has(current)?'computeNext':'next',{stage:label(next(current))});}
    const inspect=card.querySelector('[data-workflow-inspect]');if(inspect&&resource()&&[4,6,7].includes(current))inspect.disabled=!ready(current);
    // Move the owner's real button into the focused action area; retain its handler and ID.
    if(resource()){
      const id=({3:'resourceSetupNext',4:'varComputeBtn',5:'bmGenBtn',6:'resourceRunEstimate',7:'resourceRunCrossval',12:'pdf-export-btn'})[current];
      const old=id&&moved.get(id);
      if(old)old.element.dataset.actionRole=current===12?'export':current===3?'next':'custom';
      if(old&&!old.marker.isConnected){old.element.remove();moved.delete(id);}
      const action=id&&document.getElementById(id);if(action&&!card.contains(action)){
        const marker=document.createComment('workflow action location');action.before(marker);moved.set(id,{element:action,marker});
        if(current===3)action.dataset.workflowNext='true';
        action.dataset.actionRole=current===12?'export':current===3?'next':'custom';const actions=card.querySelector('.workflow-actions');if(current===3||current===12)actions.prepend(action);else actions.append(action);
      }
    }
  }
  function refresh(n=current) {
    if(!initialized)return;restoreActions();current=n;navigation(n);const panel=document.getElementById('tab'+n);if(!panel)return;
    if(!resource()&&n===7)validation=_p1RunValidationChecks();
    panel.querySelector('.assay-workflow-card')?.remove();
    if(n===1){const loaded=resource()?!!DATA?.rows?.length:!!STATE.collar.length&&!!STATE.assay.length;dashboard(panel,facts(n),tr('purpose1'),loaded?(resource()?3:7):2);return;}
    const card=node('section',null,'assay-workflow-card');card.setAttribute('aria-label',tr('guide'));
    const stages=main(),i=stages.indexOf(n);card.append(node('p',i<0?tr('optional'):tr('step',{n:i+1,total:stages.length}),'workflow-eyebrow'),node('h2',label(n)));
    const purpose=window.__t('flow.purpose'+n);if(purpose!=='flow.purpose'+n)card.append(node('p',purpose,'workflow-purpose'));
    card.append(links(stages,n));
    const summary=node('div',null,'workflow-insight');summary.append(node('strong',tr('quickInsight')),node('p',facts(n)));card.append(summary);
    const actions=node('div',null,'workflow-actions');
    if(n===2)actions.append(button(tr('import'),'apply',()=>document.getElementById('fileInput').click()));
    const target=next(n);if(target&&!(resource()&&n===3)){const onward=button(tr('next',{stage:label(target)}),'next',()=>continueStage(n,target));onward.dataset.workflowNext='true';onward.disabled=!canContinue(n);actions.append(onward);}
    if(!resource() && n===7 && !ready(n)){
      const repair=button(window.__t('core.repair.title'),'next',()=>{const el=document.getElementById('coreValidationRemedies');el?.scrollIntoView({block:'start',behavior:'smooth'});el?.querySelector('button')?.focus({preventScroll:true});});repair.dataset.workflowRepair='true';actions.prepend(repair);
    }
    if(n!==2){
      const inspect=button(tr('inspect'),'inspect',()=>{
        const id=resource()?({3:'resourceSetupQuickInsight',4:'varPlot',5:blockState.blocks?.length?'blockGridSummary':'blockPreview',6:'estimResults',7:'cvResults'})[n]:({7:'coreValidationRemedies',10:'desurveyPanel',11:'mergePanel'})[n];
        const result=(id&&document.getElementById(id))||panel.querySelector('.plot-container,.card');
        if(result){let parent=result.parentElement;while(parent&&parent!==panel){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}result.scrollIntoView({block:'start',behavior:'smooth'});result.setAttribute('tabindex','-1');result.focus({preventScroll:true});}
      });
      inspect.dataset.workflowInspect='true';
      if(resource()&&[4,6,7].includes(n))inspect.disabled=!ready(n);
      actions.append(inspect);
    }
    if(!resource()&&n===13&&typeof OrebitHandoff!=='undefined'&&OrebitHandoff.available()){
      const handoff=button(window.__t('handoff.toAssay'),'next',()=>OrebitHandoff.send('Assay',exportMasterCSV));
      handoff.disabled=!STATE.merged?.length||!coreGeometryReady()||_p1RunValidationChecks().some(row=>row.severity==='fail');actions.append(handoff);
    }
    if(!resource()&&[2,7].includes(n)&&STATE.usingSample)actions.append(button(window.__t('core.source.download'),'inspect',downloadSampleSources));
    actions.append(button(tr('custom'),'custom',()=>customize(panel)));card.append(actions);
    const key=node('div',null,'action-key');for(const role of ['next','inspect','custom','advanced'])key.append(node('span',window.__t('ux.action.'+role),'action-key-'+role));card.append(key);
    if(target){const gate=node('p',null,'workflow-gate');gate.setAttribute('role','status');card.append(gate);}
    card.append(related(resource()?'resource':'core',n,navigate));
    panel.prepend(card);sync();
  }
  function boot() {
    if(assay()||typeof showTab!=='function'||initialized)return;initialized=true;
    const original=window.showTab;window.showTab=function(n){restoreActions();const result=original.apply(this,arguments);refresh(n);return result;};
    window.__i18nBeforeRenderHooks=window.__i18nBeforeRenderHooks||[];
    window.__i18nBeforeRenderHooks.push(()=>{
      if(!resource()||!calculation(current))return;
      const stage=current,rows=DATA.rows;
      const drafts=Array.from(document.querySelectorAll('#tab'+stage+' input[id],#tab'+stage+' select[id]')).filter(el=>!['file','hidden','button','submit'].includes(el.type)).map(el=>({id:el.id,type:el.type,value:el.value,checked:el.checked}));
      return ()=>{
        if(current!==stage||DATA.rows!==rows)return;
        drafts.forEach(draft=>{const el=document.getElementById(draft.id);if(!el||el.type!==draft.type)return;if(el.tagName==='SELECT'&&!Array.from(el.options).some(option=>option.value===draft.value))return;el.value=draft.value;el.checked=draft.checked;});
        if(stage===5&&typeof updateBlockPreview==='function')updateBlockPreview();
        sync();
      };
    });
    window.__i18nPostApplyHooks=window.__i18nPostApplyHooks||[];window.__i18nPostApplyHooks.push(()=>refresh(current));
    document.addEventListener('click',ev=>{
      if(pending&&ev.target.closest('#varComputeBtn,#bmGenBtn,#resourceRunEstimate,#resourceRunCrossval')){ev.preventDefault();ev.stopImmediatePropagation();}
    },true);
    document.addEventListener('input',ev=>{
      if(!resource()||!calculation(current))return;
      failedAttempt=null;
      const id=ev.target.id;
      const inputs={4:/^var(Dir|Lag|N|Tol|MaxH)$/,5:/^bm/,6:/^(sr|s)(Maj|Semi|Min|Az|Dip|MinN|MaxN|Octant|MaxHole|SecondPass|PassFactor|PassMin|DomainBound)$/,7:/^cvLimit$/};
      if(inputs[current].test(id)&&!dirty.has(current))dirty.set(current,result(current));
      const status=document.querySelector('#tab'+current+' .workflow-gate');if(status)status.textContent='';
      sync();
    });
    document.addEventListener('change',ev=>{if(ev.target.closest('.panel')&&!ev.target.closest('.assay-workflow-card'))setTimeout(()=>refresh(current),0);});
    // Only update view state: no calculations, parameter changes or approval marks.
    setInterval(sync,1000);refresh(typeof currentTab==='number'?currentTab:1);
  }
  window.OrebitScreeningWorkflow={dashboard,links,related,refresh,reset:()=>{failedAttempt=null;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else setTimeout(boot,0);
})();
