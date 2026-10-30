/* Core accepts Assay EDA as a versioned review reference; it never edits source labels. */
(function () {
  'use strict';
  let active = null;
  const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const currentRevision = async () => {
    if (window.__orebitCoreProjectReady) await window.__orebitCoreProjectReady;
    return window.OrebitProject.currentCapsuleRevision();
  };
  function render() {
    const host = document.getElementById('coreEdaReference');
    if (!host) return;
    host.replaceChildren();
    if (!active) { host.hidden = true; return; }
    host.hidden = false;
    const r = active.reference, audit = r.proposal.audit;
    const title = document.createElement('h3');
    title.textContent = t('core.edaReference.title');
    const state = document.createElement('p');
    state.setAttribute('role', 'status');
    state.dataset.state = active.status;
    state.textContent = t(({current:'core.edaReference.current','summary-only':'core.edaReference.summary-only',stale:'core.edaReference.stale'})[active.status]);
    const details = document.createElement('p');
    details.textContent = t('core.edaReference.details').replace('{method}',audit.method).replace('{element}',audit.element || '—')
      .replace('{count}',String(r.proposal.totalIntervals || r.proposal.intervals.length)).replace('{revision}',r.source.coreRevision.slice(0, 12));
    const original = document.createElement('p');
    original.textContent = t('core.edaReference.referenceOnly');
    const list = document.createElement('ul');
    r.proposal.intervals.slice(0, 12).forEach(row => {
      const item = document.createElement('li');
      item.textContent = `${row.holeId} · ${row.from}–${row.to} · ${row.sourceLabel || '—'} → ${row.candidateLabel || '—'}`;
      list.append(item);
    });
    const decision = document.createElement('p');
    decision.textContent = active.decision?.status === 'accepted-for-review'
      ? t('core.edaReference.accepted')
      : active.decision?.status === 'rejected' ? t('core.edaReference.declined') : '';
    const accept = document.createElement('button');
    accept.type = 'button'; accept.className = 'btn'; accept.disabled = active.status !== 'current';
    accept.textContent = t('core.edaReference.acceptForReview');
    accept.addEventListener('click', () => decide('accepted-for-review'));
    const reject = document.createElement('button');
    reject.type = 'button'; reject.className = 'btn secondary';
    reject.textContent = t('core.edaReference.decline');
    reject.addEventListener('click', () => decide('rejected'));
    const returnCheckpoint = document.createElement('button');
    returnCheckpoint.type='button'; returnCheckpoint.className='btn secondary'; returnCheckpoint.id='returnAssayCheckpointFromCore';
    returnCheckpoint.textContent=t('core.edaReference.returnCheckpoint');
    returnCheckpoint.disabled=active.status!=='current'||active.decision?.status!=='accepted-for-review';
    returnCheckpoint.addEventListener('click',sendCheckpointReturn);
    host.append(title, state, details, original, list, decision, accept, reject, returnCheckpoint);
  }

  async function persist() {
    if (!active || !STATE.currentProjectName) return false;
    await window.OrebitProject.save(STATE.currentProjectName);
    return true;
  }
  async function withMeasuredMembership(reference,domain){
    try{
      const measured=OrebitCoreDomain.intervalMembership('assay');
      if(['no-reviewed-solid','endpoints-unavailable'].includes(measured.status)||!reference?.source?.assayDatasetRevision||
        measured.intervals.length!==reference.proposal?.intervals?.length)return domain;
      const bySource=new Map(measured.intervals.map(row=>[row.sourceIndex,row]));
      if(bySource.size!==measured.intervals.length)throw Error('ESTIMATION_MEMBERSHIP_SOURCE_MAP');
      const intervals=reference.proposal.intervals.map((source,index)=>{
        const item=bySource.get(source.row);
        if(!item||source.row!==index||String(item.hole_id)!==String(source.holeId)||String(item.from_m)!==String(source.from)||String(item.to_m)!==String(source.to))throw Error('ESTIMATION_MEMBERSHIP_SOURCE_MAP');
        const from=Number(source.from),to=Number(source.to);if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw Error('ESTIMATION_MEMBERSHIP_ENDPOINTS_INVALID');
        const {status,spans}=item.status==='measured'?OrebitDomainIntervalMembership.partition(from,to,item.domains):
          {status:'ambiguous',spans:[{state:'ambiguous',entryMD:from,exitMD:to,geologicalDomainId:'__AMBIGUOUS__'}]};
        return {parentObservationId:['assay',source.row,String(source.holeId),String(source.from),String(source.to)].join(':'),holeId:String(source.holeId),from:source.from,to:source.to,
          status,geometryStatus:item.geometryStatus,domains:item.domains,spans};
      });
      const packet={schema:'orebit-assay-interval-membership',version:1,sourceRevision:reference.source.assayDatasetRevision,
        geologicalRevision:await _opcSha256(domain),intervals};
      // Keep the existing small-packet shape. Large multi-domain audits use a
      // lossless dictionary, not omitted observations or a raised payload gate.
      if(new TextEncoder().encode(JSON.stringify({...domain,intervalMembership:packet})).byteLength>8*1024*1024-128)
        Object.assign(packet,_opcCompactDomainMeasurements(intervals));
      packet.revision=await _opcSha256(packet);domain.intervalMembership=packet;
      return domain;
    }catch(error){console.warn('[Core measured interval handoff]',error);return domain;}
  }
  async function attachExportMembership(file,domain) {
    if (!domain || domain.handoff?.readiness !== 'validated' ||
        !/^drillhole-clean\.csv$/i.test(file?.name || '') ||
        !/^# orebit-schema=v1 source=phase1-core/m.test(file.text)) return domain;
    // Bind measured endpoints to the exact CSV the normal Assay import receives.
    const parsed = parseDrillholeCSV(file.text, {delimiter:'comma',decimal:'dot'});
    if (parsed.rejected.length) return domain;
    const data = parseResultToColsRows(parsed), columns = data.cols;
    const ix = ['hole_id','from_m','to_m'].map(key => columns.indexOf(key));
    if (ix.some(index => index < 0)) return domain;
    const result = await withMeasuredMembership({
      source:{assayDatasetRevision:await _opcAssayDataRevision(data)},
      proposal:{intervals:data.rows.map((row,index) => ({row:index,holeId:String(row[ix[0]] ?? ''),from:row[ix[1]],to:row[ix[2]]}))}
    },domain);
    if (result.intervalMembership) {
      const packet=result.intervalMembership;
      packet.sourceExportRevision=await _opcSha256(file.text);
      delete packet.revision;packet.revision=await _opcSha256(packet);
    }
    return result;
  }
  async function decide(status) {
    if (!active || (status === 'accepted-for-review' && active.status !== 'current')) return false;
    active.decision = {status, at: new Date().toISOString()};
    render();
    try { await persist(); } catch (error) { console.warn('[Core EDA reference] save failed', error); }
    return true;
  }
  async function sendCheckpointReturn() {
    if (!active || active.status!=='current' || active.decision?.status!=='accepted-for-review') return false;
    try {
      const file=window.OrebitHandoff.capture(window.exportMasterCSV);
      if(!file) throw Error('CORE_MASTER_EXPORT_UNAVAILABLE');
      const context=await window.OrebitProject.createHandoffContext(file);
      const domain=await withMeasuredMembership(active.reference,await window.__orebitDomainHandoff());
      const packet=await createAssayCheckpointReturn(active.reference,context,domain);
      const result=await window.OrebitHandoff.sendAssayCheckpointReturn(packet);
      toast(result?.ok?t('core.edaReference.returned'):t('core.edaReference.returnRecovery'),'good');
      return !!result?.ok;
    } catch(error) {
      console.warn('[Core Assay checkpoint return]',error);
      toast(t('core.edaReference.returnBlocked')+' '+(error.code||error.message),'warn');
      return false;
    }
  }
  async function receive(reference) {
    await validateAssayEDAReference(reference);
    const current = await currentRevision(), stateRevision = await window.OrebitProject.currentProjectStateRevision();
    const savedStateRevision = await window.OrebitProject.savedProjectStateRevision(STATE.currentProjectName);
    const matches = current === reference.source.coreRevision && stateRevision === reference.source.coreProjectStateRevision &&
      (!savedStateRevision || savedStateRevision === stateRevision);
    active = {reference: clone(reference), status: matches ? (reference.proposal.summaryOnly ? 'summary-only' : 'current') : 'stale', decision: null};
    render();
    return {ok: true, status: active.status};
  }
  async function restore(record) {
    active = null;
    if (!record) { render(); return null; }
    if (!record || !record.reference) throw Error('EDA_REFERENCE_PROJECT_INVALID');
    await validateAssayEDAReference(record.reference);
    const current = await currentRevision(), stateRevision = await window.OrebitProject.currentProjectStateRevision();
    const savedStateRevision = await window.OrebitProject.savedProjectStateRevision(STATE.currentProjectName);
    const matches = current === record.reference.source.coreRevision && stateRevision === record.reference.source.coreProjectStateRevision &&
      (!savedStateRevision || savedStateRevision === stateRevision);
    active = {reference: clone(record.reference), status: matches ? (record.reference.proposal.summaryOnly ? 'summary-only' : 'current') : 'stale',
      decision: record.decision && ['accepted-for-review', 'rejected'].includes(record.decision.status) ? clone(record.decision) : null};
    render();
    return clone(active);
  }
  function exportState() { return clone(active); }
  async function importFile(file) {
    if (!file || file.size > 4 * 1024 * 1024) throw Error('EDA_REFERENCE_TOO_LARGE');
    const record = JSON.parse(await file.text());
    return receive(record);
  }

  window.addEventListener('message', async event => {
    if (event.origin !== location.origin || event.data?.type !== 'orebit-assay-eda-reference') return;
    const requestId = event.data.requestId;
    let result;
    try { result = await receive(event.data.reference); }
    catch (error) { result = {ok: false, error: error.code || error.message || 'EDA_REFERENCE_REJECTED'}; }
    try { event.source?.postMessage({type: 'orebit-assay-eda-reference-ack', requestId, ...result}, event.origin); } catch (error) { /* opener closed */ }
  });
  document.addEventListener('languagechange', render);
  window.OrebitCoreEDAReference = Object.freeze({receive, restore, exportState, decide, render, importFile, sendCheckpointReturn, attachMeasuredMembership:withMeasuredMembership, attachExportMembership});
  function wireImport() {
    const button = document.getElementById('openCoreEdaReference'), input = document.getElementById('coreEdaReferenceFile');
    if (!button || !input || button.dataset.referenceWired) return;
    button.dataset.referenceWired = 'true';
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      try { const result = await importFile(file); toast(t(result.status === 'current' ? 'core.edaReference.loaded' : 'core.edaReference.loadedStale'), result.status === 'current' ? 'good' : 'warn'); }
      catch (error) { toast(t('core.edaReference.rejected') + ' ' + (error.code || error.message), 'bad'); }
      input.value = '';
    });
  }
  function receiveDesktop() { if (typeof OrebitHandoff === 'object') OrebitHandoff.receiveDesktopAssayReference(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireImport); else setTimeout(wireImport, 0);
  window.addEventListener('load', receiveDesktop, {once:true});
  window.__i18nPostApplyHooks = window.__i18nPostApplyHooks || [];
  window.__i18nPostApplyHooks.push(render);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else setTimeout(render, 0);
})();
