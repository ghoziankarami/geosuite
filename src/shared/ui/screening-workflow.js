/* Consistent navigation and focus across screening apps. Calculations stay in their owners. */
(function () {
  'use strict';
  const tr = (key, values={}) => Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',String(v)), window.__t('flow.'+key));
  const node = (tag, content, cls) => {const el=document.createElement(tag);if(content!=null)el.textContent=content;if(cls)el.className=cls;return el;};
  function button(title, role, action) {const el=node('button',title,'btn'+(['inspect','custom','advanced'].includes(role)?' secondary':''));el.type='button';el.dataset.actionRole=role;el.addEventListener('click',action);return el;}
  const label = n => document.querySelectorAll('nav.tabs .tab')[n-1]?.textContent.trim() || String(n);
  const resource = () => document.getElementById('blockModelContent')!==null;
  const assay = () => document.getElementById('assayAdvancedToggle')!==null || typeof OrebitAssayWorkflow!=='undefined';
  let current=1, lastMainStage=1, lastSource=null, initialized=false, validation=null;
  const moved=new Map();
  let reportSettingsMarker=null;
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
    const navigationOpener=document.activeElement;
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
        if(result(n)!==before && ready(n)){dirty.delete(n);navigate(target);_focusWorkflowDestination(target,navigationOpener);}
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
    const reportSettings=document.getElementById('reportExportSettings');
    if(reportSettingsMarker?.isConnected&&reportSettings){reportSettingsMarker.replaceWith(reportSettings);reportSettingsMarker=null;}
  }
  const main = () => resource()?[2,3,4,5,6,7,10,12]:(window._coreUseProvidedXYZ?[2,7,11,14,13]:[2,7,10,11,14,13]);
  function navigate(n) {showTab(n);document.getElementById('tab'+n)?.scrollIntoView({block:'start',behavior:'smooth'});}
  function links(stages,n) {
    const row=node('nav',null,'workflow-step-links');row.setAttribute('aria-label',tr('workflow'));
    for(const [i,stage] of stages.entries()){const b=button(label(stage),'inspect',()=>navigate(stage));if(stage===n)b.setAttribute('aria-current','step');row.append(b);}
    row.addEventListener('focusin',event=>{
      const focused=event.target;
      if(focused.parentElement!==row||focused.tagName!=='BUTTON')return;
      // Native reverse tabbing can leave a button behind the overflow clip.
      // Wait for the browser's focus scroll, then move only this stage strip.
      requestAnimationFrame(()=>{
        if(document.activeElement!==focused||focused.parentElement!==row||!_visibleFocusTarget(focused)||
          !row.closest('.panel.active')||row.scrollWidth<=row.clientWidth)return;
        const bounds=row.getBoundingClientRect(),target=focused.getBoundingClientRect();
        // Bounds use rendered pixels; scrollLeft/clientWidth use layout pixels.
        // Convert both the clip and adjustment at zoom instead of over-scrolling.
        const scale=row.offsetWidth?bounds.width/row.offsetWidth:1;
        const left=bounds.left+row.clientLeft*scale,right=left+row.clientWidth*scale;
        if(target.left<left)row.scrollLeft+=(target.left-left)/scale;
        else if(target.right>right)row.scrollLeft+=(target.right-right)/scale;
      });
    });
    return row;
  }
  // One inventory serves every module. Links reveal existing owners; they never apply a treatment.
  const RELATED = {
    core:{1:[[14,'domain']],2:[[14,'domain'],[3,'collar'],[4,'survey'],[5,'assay'],[6,'geology']],7:[[14,'domain'],[3,'collar'],[4,'survey'],[5,'assay'],[6,'geology']],9:[[14,'domain']],10:[[8,'strips'],[9,'section'],[14,'domain']],11:[[14,'domain'],[12,'composite']],13:[[14,'domain'],[12,'composite'],[7,'validation']]},
    assay:{3:[[12,'qaqc'],[6,'spacing']],8:[[9,'topcut'],[4,'bivariate'],[5,'multivariate']],11:[[10,'lithology'],[5,'multivariate']],7:[[6,'spacing'],[12,'qaqc']],13:[[12,'qaqc'],[9,'topcut']]},
    resource:{3:[[3,'decluster','resourceSetupAdvanced']],4:[[4,'anisotropy','variogramAdvanced']],5:[[5,'density','blockAdvanced']],6:[[11,'viewer']],7:[[8,'swath'],[9,'confidence'],[11,'viewer']],10:[[11,'viewer'],[9,'confidence']],12:[[11,'viewer'],[8,'swath'],[9,'confidence']]}
  };
  const origins=new Map();
  function related(module,n,go) {
    const row=node('section',null,'workflow-related');row.setAttribute('aria-label',tr('related'));
    const origin=origins.get(module+':'+n);
    // The Resource viewer's primary already returns to the report. Retain one
    // return path rather than a second row of the same destination above its plot.
    const hasReturn=origin&&origin!==n&&!(module==='resource'&&n===11&&origin===12);
    if(hasReturn){row.append(button(tr('return',{stage:label(origin)}),'inspect',()=>go(origin)));}
    const tools=RELATED[module]?.[n]||[];
    if(tools.length){row.append(node('p',tr('related'),'workflow-related-title'));
      const actions=node('div',null,'workflow-related-actions');
      for(const [stage,key,id] of tools){const b=button(tr('tool.'+key),'inspect',()=>{
        if(stage!==n){origins.set(module+':'+stage,n);go(stage);}
        if(id){const el=document.getElementById(id);if(el){el.open=true;el.scrollIntoView({block:'start',behavior:'smooth'});el.querySelector('summary')?.focus();}}
      });b.dataset.relatedStage=String(stage);if(id)b.dataset.relatedTarget=id;actions.append(b);}
      row.append(actions);
    }
    row.hidden=!tools.length&&!hasReturn;
    return row;
  }
  // One sticky Back/Continue bar at the foot of a stage. Its onward button only
  // clicks the card's own control, so gating, calculation and handoff stay with their owners.
  let barSource=null;
  function owner(module,n,stages) {
    for(const [stage,tools] of Object.entries(RELATED[module]||{}))
      if(+stage!==n&&stages.includes(+stage)&&tools.some(tool=>tool[0]===n))return +stage;
    return stages.filter(stage=>stage<n).pop()||1;
  }
  function mirror() {
    const onward=document.querySelector('.workflow-stage-bar-next'),why=document.querySelector('.workflow-stage-bar-why');
    if(!onward||!barSource)return;
    const card=barSource.closest('.assay-workflow-card'),repair=card?.querySelector('[data-workflow-repair]');
    if(card)barSource=repair&&!repair.hidden?repair:card.querySelector('[data-workflow-next]')||card.querySelector('.workflow-actions [data-action-role="next"]');
    if(!barSource)return;
    onward.textContent=barSource.textContent;onward.disabled=barSource.disabled;
    const gate=barSource.closest('.assay-workflow-card')?.querySelector('.workflow-gate');
    why.textContent=barSource.disabled?(gate&&!gate.hidden?gate.textContent:tr('blocked')):'';
  }
  function stageBar(module,stages,n,panel,card) {
    document.querySelectorAll('.workflow-stage-bar').forEach(el=>el.remove());barSource=null;
    document.body.classList.remove('workflow-stage-bar-on');
    if(!card||n===1)return;
    const i=stages.indexOf(n),back=i>0?stages[i-1]:i===0?1:origins.get(module+':'+n)||owner(module,n,stages);
    const bar=node('nav',null,'workflow-stage-bar');bar.setAttribute('aria-label',tr('stageBar'));
    bar.append(button(tr('return',{stage:label(back)}),'inspect',()=>navigate(back)),node('span',null,'workflow-stage-bar-why'));
    barSource=card.querySelector('[data-workflow-repair]')||card.querySelector('[data-workflow-next]')||card.querySelector('.workflow-actions [data-action-role="next"]');
    if(barSource){const onward=button('','next',()=>{if(barSource&&!barSource.disabled)barSource.click();});onward.classList.add('workflow-stage-bar-next');bar.append(onward);}
    panel.append(bar);document.body.classList.add('workflow-stage-bar-on');mirror();revealFocusedControl(document.activeElement);
  }
  function dashboard(panel, insight, purpose, first, resume=false) {
    panel.querySelector('.assay-workflow-card')?.remove();
    const card=node('section',null,'assay-workflow-card workflow-dashboard');card.setAttribute('aria-label',tr('guide'));
    card.append(node('h2',label(1)),node('p',purpose,'workflow-purpose'));
    const facts=node('div',null,'workflow-insight');facts.append(node('strong',tr('quickInsight')),node('p',insight));card.append(facts);
    const actions=node('div',null,'workflow-actions');actions.append(button(resume?tr('resume',{stage:label(first)}):tr(first===2?'import':'start'),'next',()=>navigate(first)));if(first!==2)actions.append(button(tr('import'),'inspect',()=>navigate(2)));card.append(actions);
    card.append(related('core',1,navigate));panel.prepend(card);
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
    if(n===14&&!assay())return window.__t('dom.insight.checking');
    if(!STATE.collar.length&&!STATE.assay.length)return tr('empty');
    if(n===10){
      const checks=_p1RunValidationChecks(),fail=checks.filter(c=>c.severity==='fail').length;
      const traces=Object.values(STATE.desurvey?.holes||{}).filter(h=>h.trace?.length).length;
      return tr('desurveyStatus',{holes:traces,fail});
    }
    if(n===11)return tr('mergeStatus',{rows:STATE.merged?.length||0});
    if(n===7&&!assay()&&validation){
      const fail=validation.filter(c=>c.severity==='fail').length,warn=validation.filter(c=>c.severity==='warn').length;
      const source=window.OrebitCoreRepair?.findings(validation).find(issue=>issue.code==='missing-table'&&issue.severity==='fail');
      if(source)return tr('coreMissingSource',{table:window.__t('core.table.'+source.table),n:source.holes.length,fail,warn});
      return tr('coreQuality',{fail,warn});
    }
    return tr('coreLoaded',{holes:STATE.collar.length.toLocaleString(),assays:STATE.assay.length.toLocaleString(),logs:STATE.geology.length.toLocaleString()});
  }
  function next(n) {
    if(resource())return n===1?3:n===2?3:n===7?10:n===10?12:n<10?n+1:n===11?12:null;
    if(n===7&&window._coreUseProvidedXYZ)return 11;
    return ({1:7,2:7,3:4,4:5,5:6,6:7,7:10,8:9,9:10,10:11,11:13,12:13})[n]||null;
  }
  function ready(n) {
    if(resource())return n===2?!!DATA?.rows?.length:n===3?!!DATA?.rows?.length&&!!setupState.element:n===5?!!blockState.blocks?.length:isTabDone(n);
    if(n===7)return _coreAnalysisReady();
    return p1IsTabReady(n);
  }
  function measuredSurveyIssue(){
    if(resource()||window._coreUseProvidedXYZ)return null;
    const issues=window.OrebitCoreRepair?.findings?.()||[];
    if(issues.some(issue=>issue.code==='geometry'&&issue.table==='collar'&&issue.severity==='fail'))return null;
    return issues.find(issue=>issue.id==='missing-table:survey'&&issue.severity==='fail')||null;
  }
  function suppliedXYZIssue(){
    if(resource()||!window._coreUseProvidedXYZ)return null;
    return (window.OrebitCoreRepair?.findings?.()||[]).find(issue=>issue.code==='geometry'&&issue.severity==='fail'&&issue.records?.length)||null;
  }
  // Disclosure state is view-only and scoped to the actual source population.
  // Rendering/locale/revisit must not move native controls or apply parameters.
  let optionsSource=null;
  const optionsOpen=new Map();
  function decorateOptions(panel) {
    const source=typeof DATA!=='undefined'?DATA?.rows:typeof STATE!=='undefined'?STATE.collar:null;
    if(source!==optionsSource){optionsSource=source;optionsOpen.clear();}
    panel.querySelectorAll('details[data-workflow-options]').forEach(details=>{
      if(optionsOpen.has(details.id))details.open=optionsOpen.get(details.id);
      if(details.dataset.workflowOptionsBound)return;
      details.dataset.workflowOptionsBound='true';
      details.addEventListener('toggle',()=>{
        if(details.isConnected&&source===optionsSource)optionsOpen.set(details.id,details.open);
      });
    });
  }
  function customize(panel) {
    const options=panel.querySelector('details[data-workflow-options]');
    if(!options)return;options.open=true;
    let parent=options.parentElement;while(parent&&parent!==panel){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}
    const summary=options.querySelector(':scope > summary');
    summary?.scrollIntoView({block:'center',behavior:'smooth'});summary?.focus({preventScroll:true});
  }
  function navigation(n) {
    const nav=document.querySelector('nav.tabs');if(!nav)return;
    document.body.classList.toggle('core-guided',!resource()&&!assay());
    document.body.classList.add('screening-guided');document.body.classList.toggle('workflow-on-dashboard',n===1);
    const stages=main();
    const foot=nav.querySelector('.orebit-rail-foot');if(foot)foot.style.order='999';
    nav.querySelectorAll('.tab').forEach((el,i)=>{const stage=i+1;el.dataset.workflowAdvanced=String(stage!==1&&!stages.includes(stage));el.dataset.workflowAuxiliary='false';el.style.order=String(stage===1?0:stages.includes(stage)?stages.indexOf(stage)+1:100+stage);});
    let toggle=nav.querySelector('.screening-advanced-toggle');
    if(!toggle){toggle=button('', 'advanced',()=>{document.body.classList.toggle('screening-advanced-open');navigation(current);});toggle.classList.add('screening-advanced-toggle');toggle.style.order='90';nav.append(toggle);}
    if(n!==1&&!stages.includes(n))document.body.classList.add('screening-advanced-open');
    const open=document.body.classList.contains('screening-advanced-open');toggle.textContent=tr(open?'hideAdvanced':'advanced');toggle.setAttribute('aria-expanded',String(open));
    sidebar(stages,n,toggle,open);
  }
  // One rail hierarchy for all three apps. Numbers denote sequence, not approval.
  function sidebar(stages,n,toggle,open) {
    const nav=document.querySelector('nav.tabs');if(!nav)return;
    // Reuse the shell's single collapse control and preference. Opening Advanced
    // expands that same rail so optional tool names remain readable.
    if(!toggle.dataset.railExpansionBound){
      toggle.dataset.railExpansionBound='true';
      toggle.addEventListener('click',()=>{
        if(document.documentElement.classList.contains('orebit-rail-collapsed'))
          nav.querySelector('.orebit-rail-toggle')?.click();
      },true);
    }
    let heading=nav.querySelector('.workflow-nav-heading');
    if(!heading){heading=node('div',null,'workflow-nav-heading');heading.style.order='0';nav.append(heading);}
    heading.textContent=tr('workflow');
    const count=node('span',String(stages.length),'workflow-nav-count');count.setAttribute('aria-hidden','true');heading.append(count);
    const controls=[];
    nav.querySelectorAll('.tab').forEach((el,i)=>{
      const stage=i+1,index=stages.indexOf(stage);
      if(index>=0)el.dataset.workflowStep=String(index+1);else delete el.dataset.workflowStep;
      el.setAttribute('aria-label',el.textContent.trim());
      el.setAttribute('title',el.textContent.trim());
      if(stage===n)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
      if(el.dataset.workflowAdvanced==='true'){el.id=el.id||'workflow-nav-tab-'+stage;controls.push(el.id);}
    });
    toggle.setAttribute('aria-controls',controls.join(' '));
    toggle.classList.add('workflow-nav-disclosure');toggle.dataset.open=String(open);
  }
  function updateCoreValidationInsight(insight) {
    validation=_p1RunValidationChecks();
    const report=window.OrebitCoreRepair.summary(validation);
    const text=(selector,value)=>{const el=insight.querySelector(selector);if(el&&el.textContent!==String(value))el.textContent=String(value);};
    insight.dataset.validationState=report.state;
    insight.dataset.sourceRevision=report.sourceRevision;
    text('h3',report.title);text('p',facts(7));
    text('[data-validation-metric="causes"]',report.blockingCauses);
    text('[data-validation-metric="holes"]',report.affectedHoles);
  }
  function sync() {
    if(resource())validateResourceCalculationContext();
    const panel=document.getElementById('tab'+current),card=panel?.querySelector('.assay-workflow-card');if(!card)return;
    const insight=card.querySelector('.workflow-insight');
    if(insight?.classList.contains('workflow-validation-summary'))updateCoreValidationInsight(insight);
    else if(!resource()&&!assay()&&current===14&&insight?.querySelector('p')){
      window.OrebitCoreDomainViewer?.updateInsight(insight.querySelector('p'));
      window.OrebitCoreDomainViewer?.updateContinuation(card.querySelector('#domainWorkflowNext'));
    }
    else if(insight?.querySelector('p'))insight.querySelector('p').textContent=facts(current);
    if(calculation(current)&&dirty.has(current)&&result(current)!==dirty.get(current))dirty.delete(current);
    const gate=card.querySelector('.workflow-gate');if(gate){
      if(pending?.stage===current){gate.hidden=false;gate.textContent=tr('calculating');}
      else if(resource()&&failedAttempt?.stage===current&&failedAttempt.rows===DATA.rows&&failedAttempt.signature===failureSignature(current)){gate.hidden=false;gate.textContent=tr('notAdvanced');}
      else {gate.hidden=canContinue(current);gate.textContent=tr(!resource()&&[7,10].includes(current)?'blockedGeometry':'blocked');}
    }
    const onward=card.querySelector('[data-workflow-next]');if(onward){onward.disabled=!canContinue(current);if(calculation(current))onward.textContent=tr(!ready(current)||dirty.has(current)?'computeNext':'next',{stage:label(next(current))});
      const repair=card.querySelector('[data-workflow-repair]');if(repair){repair.hidden=canContinue(current);onward.hidden=!canContinue(current);}
    }
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
      if(current===12){
        const settings=document.getElementById('reportExportSettings'),actions=card.querySelector('.workflow-actions');
        if(settings&&actions&&!card.contains(settings)){
          reportSettingsMarker=document.createComment('report export settings location');
          settings.before(reportSettingsMarker);actions.before(settings);
        }
      }
    }
    mirror();
  }
  function refresh(n=current) {
    if(!initialized)return;const focusedBeforeRefresh=document.activeElement;
    restoreActions();stageBar();current=n;navigation(n);const panel=document.getElementById('tab'+n);if(!panel)return;
    const source=resource()?DATA:[STATE.collar,STATE.survey,STATE.assay,STATE.geology];
    const changed=resource()?source!==lastSource:!lastSource||source.some((rows,index)=>rows!==lastSource[index]);
    if(changed){lastSource=source;lastMainStage=1;}
    const mainStages=main();if(n!==1&&mainStages.includes(n))lastMainStage=n;
    const focusedHelp=panel.querySelector('.workflow-help > summary');
    const restoreHelpFocus=focusedHelp&&document.activeElement===focusedHelp;
    const helpWasOpen=focusedHelp?.parentElement.open;
    decorateOptions(panel);
    if(!resource()&&n===7)validation=_p1RunValidationChecks();
    panel.querySelector('.assay-workflow-card')?.remove();
    if(!resource()&&({3:'collar',4:'survey',5:'assay',6:'geology'})[n]===window.OrebitCoreRepair?.activeTable()){
      const card=node('section',null,'assay-workflow-card core-correction-guide');card.append(node('p',window.__t('core.repair.focused')+' · '+label(n),'workflow-eyebrow'),links(main(),n));panel.prepend(card);return;
    }
    if(n===1){const loaded=resource()?!!DATA?.rows?.length:!!STATE.collar.length&&!!STATE.assay.length;const first=!loaded?2:lastMainStage>1?lastMainStage:resource()?3:7;dashboard(panel,facts(n),tr('purpose1'),first,loaded&&lastMainStage>1);return;}
    const card=node('section',null,'assay-workflow-card');card.setAttribute('aria-label',tr('guide'));
    const stages=main(),i=stages.indexOf(n);card.classList.toggle('workflow-optional',i<0);card.append(node('p',i<0?tr('optional'):tr('step',{n:i+1,total:stages.length}),'workflow-eyebrow'),node('h2',label(n)));
    const purpose=window.__t('flow.purpose'+n);if(purpose!=='flow.purpose'+n)card.append(node('p',purpose,'workflow-purpose'));
    card.append(links(stages,n));
    const summary=node('section',null,'workflow-insight');
    if(!resource()&&n===7){
      summary.classList.add('workflow-validation-summary');
      const heading=node('h3');heading.id='coreValidationSummaryTitle';summary.setAttribute('aria-labelledby',heading.id);
      summary.append(heading,node('p',facts(n)));
      const metrics=node('dl',null,'validation-summary-metrics');
      for(const [key,title] of [['causes','validationBlockingCauses'],['holes','validationAffectedHoles']]){
        const group=node('div'),value=node('dd');value.dataset.validationMetric=key;
        group.append(node('dt',tr(title)),value);metrics.append(group);
      }
      summary.append(metrics);updateCoreValidationInsight(summary);
    }else {
      summary.append(node('strong',tr('quickInsight')),node('p',facts(n)));
      if(!resource()&&!assay()&&n===14){summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');}
    }
    card.append(summary);
    const actions=node('div',null,'workflow-actions');
    if(n===2)actions.append(button(tr('import'),'apply',()=>document.getElementById('fileInput').click()));
    if(!resource()&&!assay()&&n===14){const nextTask=button(window.__t('dom.workflow.nextContacts'),'next',()=>{});nextTask.id='domainWorkflowNext';actions.append(nextTask);}
    const target=next(n);if(target&&!(resource()&&n===3)){const returning=resource()&&n===11&&origins.get('resource:'+n)===target;const onward=button(tr(returning?'return':'next',{stage:label(target)}),'next',()=>continueStage(n,target));onward.dataset.workflowNext='true';onward.disabled=!canContinue(n);actions.append(onward);}
    if(!resource()&&[10,11].includes(n)&&!_coreAnalysisReady()){
      const surveyIssue=measuredSurveyIssue(),xyzIssue=suppliedXYZIssue();
      const repairLabel=surveyIssue?window.__t('core.repair.importMissing').replace('{table}',window.__t('core.table.survey')):xyzIssue?window.__t('core.repair.fixSuppliedXYZ'):window.__t('core.repair.openFindings');
      const repair=button(repairLabel,'next',()=>{
        const currentSurvey=measuredSurveyIssue(),currentXYZ=suppliedXYZIssue();
        if(currentSurvey){navigate(2);requestAnimationFrame(()=>document.getElementById('fileInput')?.click());return;}
        navigate(7);const results=document.getElementById('coreValidationResults');
        results?.scrollIntoView({block:'start',behavior:'smooth'});
        if(currentXYZ){const issue=results?.querySelector(`[data-repair-issue="${currentXYZ.id}"] [data-repair-row]`);if(issue){issue.click();return;}}
        results?.querySelector('button')?.focus({preventScroll:true});
      });repair.dataset.workflowRepair='true';actions.prepend(repair);
    }
    let validationNextAction=null;
    if(!resource() && n===7 && !ready(n)){
      const results=document.getElementById('coreValidationResults');
      const firstRepair=results?.querySelector('[data-repair-import], [data-repair-row]');
      const repair=button(firstRepair?.textContent?.trim()||window.__t('core.repair.openFindings'),'next',()=>{
        if(firstRepair?.isConnected){firstRepair.click();return;}
        results?.scrollIntoView({block:'start',behavior:'smooth'});
        results?.querySelector('button')?.focus({preventScroll:true});
      });repair.dataset.workflowRepair='true';
      validationNextAction=node('section',null,'workflow-next-action');
      validationNextAction.setAttribute('aria-label',window.__t('core.repair.title'));
      validationNextAction.append(node('h3',window.__t('core.repair.title')),repair);
      const skip=button(window.__t('core.scope.skip'),'inspect',()=>window.OrebitCoreScope.preview(card,target));skip.dataset.coreSkip='';actions.append(skip);
    }
    if(n!==2){
      const inspect=button(tr('inspect'),'inspect',()=>{
        const id=resource()?({3:'resourceSetupQuickInsight',4:'varPlot',5:blockState.blocks?.length?'blockGridSummary':'blockPreview',6:'estimResults',7:'cvResults',11:'d3Plot'})[n]:({7:'coreValidationResults',10:'desurveyPanel',11:'mergePanel'})[n];
        const result=(id&&document.getElementById(id))||panel.querySelector('.plot-container,.card');
        if(result){let parent=result.parentElement;while(parent&&parent!==panel){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}result.scrollIntoView({block:'start',behavior:'smooth'});result.setAttribute('tabindex','-1');result.focus({preventScroll:true});}
      });
      inspect.dataset.workflowInspect='true';
      if(resource()&&[4,6,7].includes(n))inspect.disabled=!ready(n);
      actions.append(inspect);
    }
    if(!resource()&&n===13&&typeof OrebitHandoff!=='undefined'&&OrebitHandoff.available()){
      const handoff=button(window.__t('handoff.toAssay'),'next',()=>OrebitHandoff.send('Assay',exportMasterCSV));
      handoff.disabled=!STATE.merged?.length||!_coreAnalysisReady();actions.append(handoff);
    }
    if(!resource()&&[2,7].includes(n)&&STATE.usingSample)actions.append(button(window.__t('core.source.download'),'inspect',downloadSampleSources));
    if(panel.querySelector('details[data-workflow-options]'))actions.append(button(tr('options'),'custom',()=>customize(panel)));card.append(actions);
    const key=node('div',null,'action-key');for(const role of ['next','inspect','custom','advanced'])key.append(node('span',window.__t('ux.action.'+role),'action-key-'+role));card.append(key);
    if(target){const gate=node('p',null,'workflow-gate');gate.setAttribute('role','status');card.append(gate);}
    card.append(related(resource()?'resource':'core',n,navigate));
    if(!resource()&&n===7){
      // Match the guided order: summary, next action, cause groups, location
      // overview. Keep legacy per-hole and QA tables below the map, and retain
      // placeholders so owner rerenders can replace each native result safely.
      if(validationNextAction)card.insertBefore(validationNextAction,actions);
      let validationAnchor=validationNextAction||card.querySelector('.workflow-insight');
      for(const id of ['coreValidationResults','coreValidationRemedies']){
        const element=document.getElementById(id);
        if(element){
          const marker=document.createComment('validation result location');
          element.before(marker);moved.set(id,{element,marker});
          card.insertBefore(element,validationAnchor.nextSibling);validationAnchor=element;
        }
      }
      const map=document.getElementById('linkageMapCard');
      if(map){
        const marker=document.createComment('validation map location');
        map.before(marker);moved.set('linkageMapCard',{element:map,marker});
        card.insertBefore(map,validationAnchor.nextSibling);
      }
    }
    if(!resource()&&window.OrebitCoreScope.record()){const scope=node('section',null,'workflow-insight');scope.dataset.coreAnalysisScope='';scope.append(node('p',window.OrebitCoreScope.describe()),button(window.__t('core.scope.clear'),'inspect',()=>{window.OrebitCoreScope.clear();navigate(7);}));card.append(scope);}
    compact(card);panel.prepend(card);sync();stageBar(resource()?'resource':'core',stages,n,panel,card);
    // A queued form-change redraw must not drop a keyboard user to <body>
    // when the compact help disclosure is replaced within the same panel.
    if(restoreHelpFocus&&document.activeElement===document.body){
      const help=card.querySelector('.workflow-help');
      if(help){help.open=helpWasOpen;help.querySelector('summary')?.focus({preventScroll:true});}
    }
    // Moving an owner's real action also blurs it; retain native focus only
    // when that same control is still visible in the active panel.
    if(document.activeElement===document.body&&focusedBeforeRefresh?.isConnected&&
      focusedBeforeRefresh.closest('.panel')===panel&&panel.classList.contains('active')&&
      focusedBeforeRefresh.getClientRects().length)focusedBeforeRefresh.focus({preventScroll:true});
  }
  // View hierarchy only; scientific state, actions and parameter controls keep their owners.
  function compact(card) {
    if(card.classList.contains('workflow-dashboard'))return;
    card.classList.add('workflow-compact');
    // Optional inspection panels already have a short toolbar. Do not add an
    // empty help disclosure for their hidden legend or push the viewer away.
    if(card.classList.contains('workflow-optional'))return;
    const help=node('details',null,'workflow-help');help.append(node('summary',tr('stageHelp')));
    for(const el of Array.from(card.children))if(el.matches('.workflow-recommendation,.action-key'))help.append(el);
    if(help.children.length>1)card.append(help);
  }
  // Shared view-only focus recovery also serves Assay's separate review boot.
  function revealFocusedControl(target) {
    const panel=target?.closest?.('.panel');
    if(!panel||!target.matches('button,input,select,textarea,a[href],[role="button"]')||target.closest('.workflow-stage-bar'))return;
    requestAnimationFrame(()=>{
      if(!target.isConnected||document.activeElement!==target||panel.offsetParent===null)return;
      const rect=target.getBoundingClientRect();
      const covered=[panel.querySelector('.workflow-stage-bar'),document.getElementById('mobileBottomNav')].some(bar=>{
        if(!bar||!bar.offsetHeight)return false;
        const overlay=bar.getBoundingClientRect();
        return rect.right>overlay.left&&rect.left<overlay.right&&rect.bottom>overlay.top&&rect.top<overlay.bottom;
      });
      if(covered)target.scrollIntoView({block:'center',inline:'nearest'});
    });
  }
  document.addEventListener('focusin',ev=>revealFocusedControl(ev.target));
  // Hidden inspection canvases keep their calculated data. Opening a view
  // resizes only its connected plots; it never runs a calculation owner.
  document.addEventListener('toggle',ev=>{
    const details=ev.target;
    if(!details.matches?.('details.workflow-inspection')||!details.open)return;
    requestAnimationFrame(()=>{
      if(!details.isConnected||!details.open||typeof Plotly==='undefined')return;
      details.querySelectorAll('.js-plotly-plot').forEach(plot=>{
        if(!plot.isConnected||!plot.getClientRects().length)return;
        const job=Plotly.Plots.resize(plot);
        if(job?.catch)job.catch(error=>console.warn('Inspection plot resize',error));
      });
    });
  },true);
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
        if(stage===4&&typeof renderVariogramSamplingIssue==='function')renderVariogramSamplingIssue();
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
      if(current===4&&inputs[4].test(id)&&typeof clearVariogramSamplingIssue==='function')clearVariogramSamplingIssue();
      // A completed calculation may have replaced the result since the last
      // edit, before sync retires its old marker. Rebase this new edit first.
      if(inputs[current].test(id))dirty.set(current,result(current));
      const status=document.querySelector('#tab'+current+' .workflow-gate');if(status)status.textContent='';
      sync();
    });
    document.addEventListener('change',ev=>{
      if(!ev.target.closest('.panel')||ev.target.closest('.assay-workflow-card'))return;
      // Sampling edits already update the guide through input/sync; rebuilding
      // its native actions on blur would interrupt sequential keyboard focus.
      if(resource()&&current===4&&/^var(Dir|Lag|N|Tol|MaxH)$/.test(ev.target.id)){sync();return;}
      setTimeout(()=>refresh(current),0);
    });
    // Only update view state: no calculations, parameter changes or approval marks.
    setInterval(sync,1000);
    if(new URLSearchParams(window.location.search).get('workflow')==='domain')window.showTab(14);
    else refresh(typeof currentTab==='number'?currentTab:1);
  }
  window.OrebitScreeningWorkflow={customize,decorateOptions,dashboard,links,related,sidebar,stageBar,mirror,compact,refresh,reset:()=>{failedAttempt=null;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else setTimeout(boot,0);
})();
