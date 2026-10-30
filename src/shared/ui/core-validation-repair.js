/* Validation actions share Core's import/edit owners; never infer measurements. */
(function () {
  'use strict';
  const tables = ['collar', 'survey', 'assay', 'geology'];
  const tr = key => window.__t('core.repair.' + key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const snapshot = () => JSON.stringify(tables.map(name => [name, STATE[name], STATE.rawHeaders[name], STATE.rawRows[name], STATE.isSample[name], [...STATE.edits[name]], STATE.newRows[name], [...STATE.deletedIdx[name]]]));
  let undo = null;
  function candidate() {
    if (STATE.lengthUnitSource !== 'm' || window._coreLengthUnit !== 'm' || STATE.crs !== 'EPSG:32751') return false;
    return tables.every(name => STATE.isSample[name] && !STATE.edits[name].size && !STATE.newRows[name].length && !STATE.deletedIdx[name].size) &&
      tables.every(name => JSON.stringify(STATE[name]) === JSON.stringify(SAMPLE_DATA[name]));
  }
  function entry(action, detail, diffs = []) {
    const at = new Date().toISOString();
    STATE.CHANGE_LOG.push({table:'validation', timestamp:at, summary:detail, diffs});
    logPipeline(action, detail);
  }
  function refresh() {
    window.OrebitCoreScope?.reset(); STATE.desurvey = null; STATE.merged = null; STATE.composite = null;
    updateDataTag(); rerenderAll();
    if (typeof AutoSave !== 'undefined') AutoSave.schedule();
    window.OrebitScreeningWorkflow?.refresh();
  }
  async function applySource() {
    if (!candidate()) return false;
    const before = snapshot();
    if (!await orebitConfirm(tr('confirm'))) return false;
    // A delayed dialog must never restore synthetic rows into a new project.
    if (!candidate() || snapshot() !== before) { toast(tr('changed'), 'warn'); return false; }
    const prior = Object.fromEntries(['collar','geology'].map(name => [name, {
      rows:copy(STATE[name]), headers:copy(STATE.rawHeaders[name]), raw:copy(STATE.rawRows[name])
    }]));
    for (const name of ['collar','geology']) {
      const rows = copy(SAMPLE_SOURCE_DATA[name]);
      _coreLoadTable(name, rows, Object.keys(rows[0] || {}), copy(rows));
      STATE.isSample[name] = true; // Known synthetic source; never presented as customer data.
    }
    const diffs=[];
    for(const name of ['collar','geology']){
      const beforeRows=new Set(prior[name].rows.map(row=>JSON.stringify(row))),afterRows=new Set(STATE[name].map(row=>JSON.stringify(row)));
      STATE[name].forEach((row,idx)=>{if(!beforeRows.has(JSON.stringify(row)))Object.entries(row).forEach(([col,value])=>diffs.push({table:name,idx,col,old:null,new:value,kind:'source-restoration-added'}));});
      prior[name].rows.forEach((row,idx)=>{if(!afterRows.has(JSON.stringify(row)))Object.entries(row).forEach(([col,value])=>diffs.push({table:name,idx,col,old:value,new:null,kind:'source-restoration-removed'}));});
    }
    entry('Validation repair', 'Restored collar and geology from the bundled synthetic source; no assay or survey measurements changed.',diffs);
    undo = {before:prior, after:snapshot()};
    UNDO.push({type:'validation-repair'});
    refresh(); toast(tr('applied'), 'good'); return true;
  }
  function undoSource() {
    if (!undo || undo.after !== snapshot()) { undo = null; toast(tr('changed'), 'warn'); return false; }
    for (const [name, prior] of Object.entries(undo.before)) {
      STATE[name] = copy(prior.rows); STATE.rawHeaders[name] = copy(prior.headers); STATE.rawRows[name] = copy(prior.raw);
      STATE.isSample[name] = true;
    }
    undo = null;
    entry('Undo validation repair', 'Restored the prior synthetic collar/geology findings; downstream geometry must be recomputed.');
    refresh(); return true;
  }
  const tabs = {collar:3, survey:4, assay:5, geology:6};
  const panels = {collar:'collarPanel', survey:'surveyPanel', assay:'assayPanel', geology:'geologyPanel'};
  let context = null;
  let groupReturn = null;
  const groupDownloadUrls = new Set();
  const refs = () => tables.map(name => STATE[name]);
  const sameSource = source => source.every((rows,i) => rows === STATE[tables[i]]);
  const sourceIds = new WeakMap();let nextSourceId=1;
  const sourceRevision = () => tables.flatMap(name=>[STATE[name],STATE.rawHeaders[name],STATE.rawRows[name]]).map(ref=>{if(!sourceIds.has(ref))sourceIds.set(ref,nextSourceId++);return sourceIds.get(ref);}).join('.')+'.'+(STATE.CHANGE_LOG?.length||0);
  const filled = value => value !== null && value !== undefined && String(value).trim() !== '';
  const el = (tag,text,className) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const button = (text,fn,primary=false) => {const n=el('button',text);n.type='button';n.className='btn'+(primary?'':' secondary');n.dataset.actionRole=primary?'apply':'inspect';n.onclick=fn;return n;};
  function recordsFor(check) {
    if(check.records)return check.records;
    const holes=new Set(check.holes||[]);
    return STATE[check.table].flatMap((r,idx)=>holes.has(r.hole_id)?[{idx,hole_id:r.hole_id,columns:['hole_id']}]:[]);
  }
  function findings(checks=_p1RunValidationChecks()) {
    const items=[],missing=new Map(),revision=sourceRevision();
    for(const check of checks){
      if(check.severity==='ok'||!check.code||check.code==='geometry')continue;
      if(check.code==='missing-collar'){
        for(const hole of check.holes){
          if(!missing.has(hole))missing.set(hole,{id:'missing-collar:'+hole,code:'missing-collar',table:'collar',hole_id:hole,severity:'fail',sources:[]});
          missing.get(hole).sources.push(check.table);
        }
      }else if(check.code==='missing-table'){
        const group=items.find(item=>item.code==='missing-table'&&item.table===check.table);
        if(group){group.holes=[...new Set([...group.holes,...check.holes])];if(check.severity==='fail')group.severity='fail';}
        else items.push({id:'missing-table:'+check.table,code:'missing-table',table:check.table,holes:[...new Set(check.holes)],severity:check.severity,records:[]});
      }else{
        const records=recordsFor(check);
        if(records.length)items.push({...check,id:check.code+':'+check.table,records});
      }
    }
    // Geometry readiness has a distinct owner. Locate its actual missing inputs,
    // including sparse XYZ omissions that the completeness percentage only warns about.
    if(checks.some(c=>c.code==='geometry'&&c.severity==='fail')){
      const table=window._coreUseProvidedXYZ?'assay':'collar';
      const records=STATE[table].flatMap((r,idx)=>{
        const columns=window._coreUseProvidedXYZ?['midx','midy','midz'].map((k,i)=>r[k]!=null?k:['x','y','z'][i] in r?['x','y','z'][i]:k).filter(k=>!filled(r[k])||!Number.isFinite(Number(r[k]))):['x','y','z'].filter(k=>!filled(r[k])||!Number.isFinite(Number(r[k])));
        return columns.length?[{idx,hole_id:r.hole_id,columns}]:[];
      });
      const uncovered=records.filter(record=>{const existing=items.find(i=>i.table===table&&i.records?.some(r=>r.idx===record.idx&&record.columns.every(c=>r.columns.includes(c))));if(existing){existing.severity='fail';return false;}return true;});
      if(uncovered.length)items.unshift({id:'geometry:'+table,code:'geometry',table,severity:'fail',records:uncovered});
      if(!window._coreUseProvidedXYZ){
        const surveyIds=new Set(STATE.survey.map(r=>r.hole_id));
        const needed=[...new Set(STATE.assay.map(r=>r.hole_id))].filter(h=>h&&!surveyIds.has(h));
        if(needed.length){const existing=items.find(i=>i.code==='missing-table'&&i.table==='survey');if(existing){existing.holes=[...new Set([...existing.holes,...needed])];existing.severity='fail';}else items.push({id:'missing-table:survey',code:'missing-table',table:'survey',holes:needed,severity:'fail',records:[]});}
      }
    }
    if(!items.length&&!missing.size&&checks.some(c=>c.severity==='fail'))items.push({id:'missing-input',code:'missing-input',table:'collar',severity:'fail',records:[]});
    const result=[...missing.values(),...items];result.forEach(issue=>{issue.sourceRevision=revision;issue.operationGates={continue:issue.severity!=='fail'};});
    return result.sort((a,b)=>(a.severity==='fail'?0:1)-(b.severity==='fail'?0:1));
  }
  function issueTitle(issue){
    if(issue.code==='missing-table'&&Array.isArray(issue.holes)){const title=tr('group.missing-table').replace('{table}',window.__t('core.table.'+issue.table));return issue.hole_id?title+' · '+String(issue.hole_id):title;}
    return tr('issue.'+issue.code).replace('{table}',window.__t('core.table.'+issue.table)).replace('{hole}',String(issue.hole_id||''));
  }
  // Read-only presentation of the existing validation owner, not new gates.
  function summary(checks=_p1RunValidationChecks()) {
    const items=findings(checks),blocking=items.filter(issue=>issue.severity==='fail');
    const holes=new Set();
    for(const issue of items){
      for(const hole of issue.holes||[])if(hole!=null&&String(hole).trim())holes.add(String(hole));
      if(issue.hole_id!=null&&String(issue.hole_id).trim())holes.add(String(issue.hole_id));
      for(const record of issue.records||[]){const hole=record.hole_id??STATE[issue.table]?.[record.idx]?.hole_id;if(hole!=null&&String(hole).trim())holes.add(String(hole));}
    }
    const failedChecks=checks.filter(c=>c.severity==='fail').length,warnings=checks.filter(c=>c.severity==='warn').length;
    return {sourceRevision:sourceRevision(),state:failedChecks?'blocked':warnings?'warning':'ready',
      title:failedChecks?(blocking.length?issueTitle(blocking[0]):tr('blocked')):tr('ready'),blockingCauses:blocking.length,
      affectedHoles:holes.size,failedChecks,warnings};
  }
  function reason(issue){return tr('reason.'+issue.code).replace('{table}',window.__t('core.table.'+issue.table)).replace('{hole}',String(issue.hole_id||''));}
  function currentContext(){
    if(!context||!sameSource(context.source)||(context.groupId&&context.groupRevision!==sourceRevision()))return null;
    return context;
  }
  function focusCell(table,idx,column){
    requestAnimationFrame(()=>{
      const row=document.querySelector('#'+panels[table]+' tr[data-idx="'+idx+'"]');
      const cell=Array.from(row?.querySelectorAll('td[data-col]')||[]).find(td=>td.dataset.col===column);
      if(!cell)return;cell.tabIndex=0;
      // The user may already be editing in this table; never pull focus out of an open cell editor.
      if(cell.closest('#'+panels[table])?.contains(document.activeElement))return;
      cell.scrollIntoView({block:'center',inline:'nearest'});cell.focus({preventScroll:true});
    });
  }
  function locate(id,record=null,sourceTable=null){
    const issue=findings().find(item=>item.id===id);
    if(!issue){showTab(7);return;}
    const table=sourceTable||issue.table;
    const draft=STATE.newRows[table].findIndex(r=>r.hole_id===issue.hole_id);
    const selected=record||issue.records?.[0]||(draft>=0?{idx:STATE[table].length+draft,hole_id:issue.hole_id,columns:TABLE_SCHEMA[table].required.filter(k=>k!=='hole_id')}:null);
    context={id,table,idx:selected?.idx??null,columns:selected?.columns||['hole_id'],hole_id:selected?.hole_id??issue.hole_id,source:refs(),issue,added:draft>=0,showHole:issue.code==='duplicate',relatedRows:selected?.relatedRows||[],groupId:issue.holes?issue.id:null,groupRevision:issue.sourceRevision,groupQuery:selected?.groupQuery??groupReturn?.query??'',groupPage:selected?.groupPage??groupReturn?.page??0};
    STATE.filter[table]='';STATE.sort[table]=null;STATE.page[table]=selected?Math.floor(selected.idx/STATE.pageSize):0;
    showTab(tabs[table]);
    const card=document.querySelector('#'+panels[table]+' .core-repair-context');
    card?.scrollIntoView({block:'start'});
    if(selected)focusCell(table,selected.idx,context.columns[0]);
  }
  function returnToResults(){
    const c=currentContext();
    if(c?.groupId)groupReturn={id:c.groupId,query:c.groupQuery,page:c.groupPage,openerHole:c.hole_id,open:true,source:c.source};
    else groupReturn=null;
    context=null;showTab(7);document.getElementById('coreValidationResults')?.scrollIntoView({block:'start'});
    if(groupReturn)requestAnimationFrame(()=>Array.from(document.querySelectorAll('[data-repair-hole]')).find(node=>node.dataset.repairHole===groupReturn.openerHole)?.focus());
  }
  function openMapping(table,columns){
    context=null;showTab(7);
    const target=columns.map(col=>document.getElementById('map_'+table+'_'+col)).find(Boolean)||document.getElementById('map_'+table+'_hole_id');
    const host=document.getElementById('coreValidationMapping');if(host)host.open=true;
    if(target){let parent=target.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}target.scrollIntoView({block:'center'});target.focus({preventScroll:true});}
  }
  function addRecord(){
    const c=currentContext();if(!c||c.added)return;
    // Only the known identifier is prefilled. Measured XYZ/direction/intervals
    // stay empty until the geologist supplies verified source values.
    const total=STATE[c.table].length;
    addNewRow(c.table);const row=STATE.newRows[c.table].at(-1);row.hole_id=c.hole_id;
    c.idx=total+STATE.newRows[c.table].length-1;c.columns=TABLE_SCHEMA[c.table].required.filter(k=>k!=='hole_id');c.added=true;
    STATE.page[c.table]=Math.floor(c.idx/STATE.pageSize);rerenderTable(c.table);focusCell(c.table,c.idx,c.columns[0]);
  }
  function renderContext(table,host){
    const c=currentContext();if(!c||c.table!==table)return;
    const hasRows=STATE[table].some(r=>r.hole_id===c.hole_id),hasDraft=STATE.newRows[table].some(r=>r.hole_id===c.hole_id);c.added=hasDraft;
    const card=el('section',undefined,'core-repair-context');card.setAttribute('role','region');card.setAttribute('aria-label',tr('focused'));
    card.append(el('strong',issueTitle({...c.issue,hole_id:c.hole_id})),el('p',reason(c.issue)));
    const instructions=el('p',c.applied?tr('appliedReview'):hasDraft?tr('draftInstructions'):hasRows?tr('editInstructions'):tr('missingInstructions'));card.append(instructions);
    const actions=el('div',undefined,'workflow-actions');
    if(!hasRows&&!hasDraft&&!c.applied){const add=button(tr('addRecord'),addRecord,true);add.dataset.repairAdd='true';actions.append(add);}
    const dirty=STATE.edits[table].size||STATE.newRows[table].length||STATE.deletedIdx[table].size;
    if(dirty){const apply=button(tr('applyAndReview'),()=>{applyChanges(table);returnToResults();},true);apply.dataset.repairApply='true';actions.append(apply);}
    const back=button(tr('revalidate'),returnToResults,!dirty&&c.applied);back.dataset.repairReturn='true';back.dataset.actionRole=!dirty&&c.applied?'next':'inspect';actions.append(back);
    actions.append(button(tr('showAll'),()=>{context=null;rerenderTable(table);}));
    actions.append(button(tr('import'),()=>showTab(2)));
    if(STATE.rawHeaders[table]?.length){const mapping=button(tr('assignColumns'),()=>openMapping(table,c.columns));mapping.dataset.repairMapping=table;mapping.dataset.actionRole='custom';actions.append(mapping);}
    if(c.issue.sources){
      for(const source of c.issue.sources){const inspect=button(tr('inspectSource').replace('{table}',window.__t('core.table.'+source)),()=>{
        const record=STATE[source].map((r,idx)=>({idx,hole_id:r.hole_id,columns:['hole_id']})).find(r=>r.hole_id===c.hole_id);locate(c.id,record,source);
      });inspect.dataset.repairSource=source;actions.append(inspect);}
    }
    card.append(actions);host.prepend(card);
  }
  function cellFocused(table,idx,col){const c=currentContext();return !!c&&!c.applied&&c.table===table&&(c.idx===idx||c.relatedRows.includes(idx))&&c.columns.includes(col);}
  function rowVisible(table,idx){const c=currentContext();if(!c||c.table!==table||c.applied)return true;return c.idx!==null&&!c.showHole?(c.idx===idx||c.relatedRows.includes(idx)):STATE[table][idx]?.hole_id===c.hole_id||STATE.newRows[table][idx-STATE[table].length]?.hole_id===c.hole_id;}
  function render(checks=_p1RunValidationChecks()) {
    const host=document.getElementById('coreValidationRemedies'),results=document.getElementById('coreValidationResults');if(!host||!results)return;
    for(const url of groupDownloadUrls)URL.revokeObjectURL(url);groupDownloadUrls.clear();
    host.replaceChildren();results.replaceChildren();
    const items=findings(checks),failures=checks.filter(c=>c.severity==='fail').length;
    if(groupReturn&&(!sameSource(groupReturn.source)||!items.some(item=>item.id===groupReturn.id)))groupReturn=null;
    results.append(el('h3',tr('results')),el('p',failures?tr('blocked'):tr('ready')));
    // Some checks describe calculation assumptions rather than source rows.
    // Keep the warning count and its actual owner text visible together.
    const warnings=checks.filter(check=>check.severity==='warn');
    if(warnings.length){
      const notices=el('section',undefined,'core-validation-notices');
      notices.dataset.validationWarnings=String(warnings.length);
      notices.append(el('h4',tr('warningDetails')));
      const list=el('ul');
      for(const warning of warnings){
        // Keep machine-readable checks unchanged; translate only the summary
        // presented to the geologist. Raw check values remain available to the
        // validation API and report evidence.
        let text=String(warning.name||'')+' — '+String(warning.value??'');
        if(warning.code==='missing-table'){
          const table=window.__t('core.table.'+warning.table);
          const key=warning.table==='geology'?'warning.missingGeology':warning.table==='survey'?'warning.missingSurvey':'warning.missingAssay';
          text=tr(key).replace('{n}',String(warning.holes?.length??0)).replace('{table}',table);
        }else if(warning.name==='Coordinate source'){
          text=window._coreUseProvidedXYZ?tr('warning.providedXYZ'):tr('warning.minimumCurvature');
        }
        list.append(el('li',text));
      }
      notices.append(list);results.append(notices);
    }
    if(!items.length)results.append(el('p',tr('noFindings'),'hint good'));
    const source=refs();
    for(const issue of items){
      const section=el('section',undefined,'core-repair-issue');section.dataset.repairIssue=issue.id;
      section.dataset.sourceRevision=issue.sourceRevision;
      const grouped=issue.code==='missing-table'&&Array.isArray(issue.holes);
      const groupTitle=grouped?tr('group.missing-table').replace('{table}',window.__t('core.table.'+issue.table)):'';
      if(grouped){section.setAttribute('role','group');section.setAttribute('aria-label',groupTitle);}
      const top=el('div',undefined,'core-repair-heading');top.append(el('strong',grouped?groupTitle:issueTitle(issue)),el('span',tr(issue.severity==='fail'?'blocking':'warning'),'badge '+(issue.severity==='fail'?'bad':'warn')));section.append(top,el('p',grouped?tr('reason.missing-table').replace('{table}',window.__t('core.table.'+issue.table)):reason(issue)));
      if(grouped){
        section.append(el('p',tr('affectedHoles').replace('{n}',issue.holes.length)));
        const action=button(tr('importMissing').replace('{table}',window.__t('core.table.'+issue.table)),()=>showTab(2),issue.severity==='fail');action.dataset.repairImport=issue.table;section.append(action);
        const saved=groupReturn?.id===issue.id&&sameSource(groupReturn.source)?groupReturn:null;
        const detail=el('details',undefined,'core-repair-hole-details');detail.open=!!saved?.open;detail.append(el('summary',tr('showHoles').replace('{n}',issue.holes.length)));
        const search=el('input');search.type='search';search.value=saved?.query||'';search.setAttribute('aria-label',tr('searchHoles').replace('{table}',window.__t('core.table.'+issue.table)));detail.append(search);
        const list=el('div',undefined,'core-repair-hole-list'),pager=el('div',undefined,'core-repair-hole-pager');detail.append(list,pager);
        const download=document.createElement('a');download.className='btn secondary';download.textContent=tr('downloadAllHoles').replace('{n}',issue.holes.length);download.download='validation-'+issue.table+'-affected-holes.csv';download.dataset.repairDownload=issue.table;detail.append(download);
        const serial=[['hole_id','table','code','severity','source_revision'],...issue.holes.map(hole=>[hole,issue.table,issue.code,issue.severity,issue.sourceRevision])];const csv=serial.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));groupDownloadUrls.add(href);download.href=href;
        let pageIndex=saved?.page||0;
        const updateSaved=(openerHole=saved?.openerHole)=>{groupReturn={id:issue.id,query:search.value,page:pageIndex,openerHole,open:detail.open,source};};
        const drawPage=()=>{
          const query=search.value.trim().toLocaleLowerCase();const filtered=issue.holes.filter(hole=>String(hole).toLocaleLowerCase().includes(query));const pageCount=Math.max(1,Math.ceil(filtered.length/25));pageIndex=Math.max(0,Math.min(pageIndex,pageCount-1));
          list.replaceChildren();pager.replaceChildren();
          const visible=filtered.slice(pageIndex*25,(pageIndex+1)*25);
          if(!visible.length)list.append(el('p',tr('noHoleMatches')));
          for(const hole of visible){const line=el('div',undefined,'core-repair-record');line.append(el('span',String(hole)));const inspect=button(tr('openIssue').replace('{table}',window.__t('core.table.'+issue.table)),()=>{if(sameSource(source)&&sourceRevision()===issue.sourceRevision)locate(issue.id,{idx:null,hole_id:hole,columns:['hole_id'],groupQuery:search.value,groupPage:pageIndex});else returnToResults();});inspect.dataset.repairLocate=issue.id+':'+hole;inspect.dataset.repairHole=hole;line.append(inspect);list.append(line);}
          pager.append(el('span',tr('holePage').replace('{page}',pageIndex+1).replace('{pages}',pageCount).replace('{n}',filtered.length)));
          const previous=button(tr('previousPage'),()=>{pageIndex--;updateSaved();drawPage();});previous.disabled=pageIndex===0;pager.append(previous);
          const nextPage=button(tr('nextPage'),()=>{pageIndex++;updateSaved();drawPage();});nextPage.disabled=pageIndex>=pageCount-1;pager.append(nextPage);
        };
        detail.addEventListener('toggle',()=>{updateSaved();});search.addEventListener('input',()=>{pageIndex=0;updateSaved();drawPage();});drawPage();
        section.append(detail);
      }else if(issue.records?.length){
        section.append(el('p',tr('affected').replace('{n}',issue.records.length)));
        const makeRecord=record=>{
          const line=el('div',undefined,'core-repair-record'),r=STATE[issue.table][record.idx];
          line.append(el('span',tr('row').replace('{n}',record.idx+1)+' · '+String(record.hole_id||tr('missingId'))+' · '+record.columns.map(col=>col+' = '+(filled(r?.[col])?String(r[col]):tr('empty'))).join('; ')));
          const action=button(tr('openCell'),()=>{if(sameSource(source))locate(issue.id,record);else returnToResults();});action.dataset.repairRow=String(record.idx);line.append(action);return line;
        };
        issue.records.slice(0,5).forEach(record=>section.append(makeRecord(record)));
        if(issue.records.length>5){const more=el('details');more.append(el('summary',tr('more').replace('{n}',issue.records.length-5)));let shown=5;const batch=()=>{const end=Math.min(shown+25,issue.records.length);issue.records.slice(shown,end).forEach(record=>more.append(makeRecord(record)));shown=end;if(shown<issue.records.length){const next=button(tr('nextRows'),()=>{next.remove();batch();});more.append(next);}};more.addEventListener('toggle',()=>{if(more.open&&shown===5)batch();});section.append(more);}
      }else{
        const action=button(issue.code==='missing-input'?tr('import'):tr('openIssue').replace('{table}',window.__t('core.table.'+issue.table)),()=>{if(issue.code==='missing-input')showTab(2);else if(sameSource(source))locate(issue.id);else returnToResults();});action.dataset.repairLocate=issue.id;section.append(action);
      }
      results.append(section);
    }
    host.hidden=!items.length&&!undo;
    if(!host.hidden){host.append(el('h3',tr('title')),el('p',tr('scope')));
      if(candidate()){
        const preview=el('p',tr('sourcePreview'),'hint');
        const docs=el('a',tr('sourcePreviewDocs'));docs.href='#';docs.dataset.docs='ref/tabs';docs.dataset.docsFind='Validation';
        preview.append(' ',docs);host.append(preview);
        const repair=button(tr('applySource'),applySource,true);repair.id='coreRepairSource';host.append(repair);
      }
      if(undo&&undo.after===snapshot())host.append(button(tr('undo'),()=>undoLast()));
    }
  }
  window.OrebitCoreRepair={render,applySource,undoSource,candidate,findings,summary,locate,renderContext,cellFocused,rowVisible,activeTable:()=>currentContext()?.table||null,pendingFinding:table=>{const c=currentContext();return !!c&&c.table===table&&!c.applied;},columnsFor:table=>currentContext()?.table===table?context.columns:[],applied:table=>{if(context?.table===table){context.applied=true;context.groupRevision=sourceRevision();}},returnToResults,reset:()=>{undo=null;context=null;groupReturn=null;}};
})();

/* An explicit, conservative screening scope. Raw tables are never rewritten.
   Exclude entire affected holes so an invalid station/interval cannot alter a
   retained trace. A scoped result is not a clean regional validation. */
(function () {
  'use strict';
  const names=['collar','survey','assay','geology'];
  const tr=(key,values={})=>Object.entries(values).reduce((out,[k,v])=>out.replaceAll('{'+k+'}',String(v)),window.__t('core.scope.'+key));
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
  let active=null;
  const context=()=>JSON.stringify([STATE.crs,STATE.lengthUnitSource,window._coreLengthUnit,window._coreUseProvidedXYZ,STATE.bdlMode]);
  const refs=()=>names.map(name=>STATE[name]);
  const snapshot=()=>JSON.stringify([context(),...names.map(name=>STATE[name])]);
  function selected(ids) {const keep=new Set(ids);return Object.fromEntries(names.map(name=>[name,STATE[name].filter(row=>keep.has(row.hole_id))]));}
  function prepare() {
    const groups=new Map();
    for(const name of names)for(const row of STATE[name]){
      if(!row.hole_id)continue;
      if(!groups.has(row.hole_id))groups.set(row.hole_id,Object.fromEntries(names.map(k=>[k,[]])));
      groups.get(row.hole_id)[name].push(row);
    }
    const included=[],reasons=new Map();
    for(const [id,source] of groups){
      const failed=_p1RunValidationChecks(source).filter(check=>check.severity==='fail');
      if(source.assay.length&&coreGeometryReady(source)&&!failed.length)included.push(id);
      else reasons.set(id,failed.map(check=>check.name+': '+check.value).join('; ')||'No usable assay population');
    }
    const combined=_p1RunValidationChecks(selected(included)).filter(check=>check.severity==='fail');
    if(combined.length){for(const id of included)reasons.set(id,combined.map(check=>check.name+': '+check.value).join('; '));included.length=0;}
    const keep=new Set(included);
    const excluded=names.flatMap(table=>STATE[table].flatMap((row,idx)=>keep.has(row.hole_id)?[]:[{table,row:idx+1,hole_id:row.hole_id||null,reason:reasons.get(row.hole_id)||'Missing hole ID'}]));
    return {included,excluded,assays:selected(included).assay.length};
  }
  function reset() {if(!active)return;active=null;STATE.desurvey=null;STATE.merged=null;STATE.composite=null;window.OrebitCoreDomain?.invalidate('Validation analysis population changed');}
  function source() {
    if(active&&(context()!==active.context||!active.refs.every((rows,i)=>rows===STATE[names[i]])))reset();
    return active?active.source:STATE;
  }
  function record(){source();return active?JSON.parse(JSON.stringify(active.record)):null;}
  function ready(){const s=source();return !!s.assay.length&&coreGeometryReady(s)&&!_p1RunValidationChecks(s).some(check=>check.severity==='fail');}
  function clear(){reset();STATE.desurvey=null;STATE.merged=null;STATE.composite=null;logPipeline('Screening scope cleared','Regional validation applies again; derived geometry and merged results cleared.');rerenderAll();AutoSave.schedule();}
  function activate(plan,note,at=new Date().toISOString()) {
    const s=selected(plan.included);
    if(!s.assay.length||!coreGeometryReady(s)||_p1RunValidationChecks(s).some(check=>check.severity==='fail'))return false;
    window.OrebitCoreDomain?.invalidate('Validation analysis population changed');
    active={refs:refs(),context:context(),source:s,record:{schema:'orebit-core-validation-scope',version:1,at,note,policy:'exclude-whole-hole',included:plan.included,excluded:plan.excluded,assays:plan.assays}};
    STATE.desurvey=null;STATE.merged=null;STATE.composite=null;
    return true;
  }
  function restore(saved){
    reset();if(saved?.schema!=='orebit-core-validation-scope'||saved.version!==1||typeof saved.note!=='string'||!saved.note.trim()||!Array.isArray(saved.included)||!Array.isArray(saved.excluded))return;
    const plan=prepare();
    if(JSON.stringify(plan.included)!==JSON.stringify(saved.included)||JSON.stringify(plan.excluded)!==JSON.stringify(saved.excluded))return;
    activate(plan,saved.note.slice(0,2000),saved.at);
  }
  function describe(){const r=record();return r?tr('active',{holes:r.included.length,assays:r.assays,excluded:r.excluded.length})+' '+tr('reason')+': '+r.note:tr('regional');}
  function csv(){const r=record();return '# validation-scope: '+(r?JSON.stringify(r):'full regional population; no validation exclusions');}
  function preview(host,onward){
    host.querySelector('[data-core-scope-preview]')?.remove();
    const plan=prepare(),before=snapshot(),section=node('section');section.dataset.coreScopePreview='';section.className='core-repair-context';
    section.append(node('h3',tr('title')),node('p',tr('preview',{holes:plan.included.length,assays:plan.assays,excluded:plan.excluded.length})),node('p',tr('policy')));
    const details=node('details'),summary=node('summary',tr('excluded'));details.append(summary);
    for(const row of plan.excluded.slice(0,200)){details.append(node('p',row.table+' · '+tr('row',{n:row.row})+' · '+(row.hole_id||'—')+' · '+row.reason));}section.append(details);
    if(plan.excluded.length>200)section.append(node('p',tr('limited')));
    const download=node('button',tr('download'));download.type='button';download.className='btn secondary';download.onclick=()=>downloadFile('validation-excluded.csv',['table,source_row,hole_id,reason',...plan.excluded.map(row=>[row.table,row.row,row.hole_id,row.reason].map(csvEscape).join(','))].join('\n'),'text/csv');section.append(download);
    const label=node('label',tr('reason')),note=node('textarea');note.id='coreScopeNote';note.maxLength=2000;note.required=true;label.htmlFor=note.id;section.append(label,note);
    const status=node('p');status.setAttribute('role','status');section.append(status);
    const actions=node('div');actions.className='workflow-actions';
    const apply=node('button',tr('continue'));apply.type='button';apply.className='btn';apply.dataset.actionRole='next';apply.disabled=!plan.assays;
    apply.onclick=()=>{
      if(!note.value.trim()){note.reportValidity();note.focus();return;}
      if(snapshot()!==before){status.textContent=tr('changed');apply.disabled=true;return;}
      if(!activate(plan,note.value.trim())){status.textContent=tr('none');return;}
      logPipeline('Validation deferred — scoped screening',describe()+' Complete excluded-source records remain in project metadata and the exclusion CSV; the PDF details list the first 200.');
      STATE.CHANGE_LOG.push({table:'validation',timestamp:active.record.at,summary:describe(),diffs:[],scope:record()});
      AutoSave.schedule();showTab(onward);
    };
    const cancel=node('button',tr('cancel'));cancel.type='button';cancel.className='btn secondary';cancel.onclick=()=>section.remove();actions.append(apply,cancel);section.append(actions);host.append(section);note.focus();
  }
  window.OrebitCoreScope={source,record,ready,prepare,reset,restore,describe,csv,preview,clear};
})();
