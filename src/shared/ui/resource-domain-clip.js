/* Domain S9 in Resource: exact filled volume of the current block model inside the solid received
   from Core. Read-only reconciliation beside the grid summary; estimation and its tonnage are
   unchanged until the owner reviews this comparison. Only a solid validated at handoff is used. */
(function() {
  'use strict';
  let job = 0, cache=null, supportRevision=0;
  const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', {maximumFractionDigits:d, minimumFractionDigits:d});
  const esc = v => String(v).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

  function syncSupportNotice() {
    const handoff=typeof OrebitHandoff==='object'?OrebitHandoff:null;
    const support=window.__resourceBlockSupport;
    const applied=!!(support && support.blocks===blockState.blocks && support.received===handoff?.domain());
    const basis=document.getElementById('gridSupportBasis');
    if(basis){basis.textContent=resourceSupportDescription();basis.classList.toggle('warn',!applied);}
    if(typeof handoff?.showDomain==='function') handoff.showDomain();
  }

  function summarise(result, bs) {
    const [ox, oy, oz] = bs.origin, [dx, dy, dz] = bs.size, [nx, ny] = bs.dims, full = dx * dy * dz;
    let inModel = 0, touched = 0, partial = 0;
    for (const b of bs.blocks) {
      const i = Math.floor((b.cx - ox) / dx), j = Math.floor((b.cy - oy) / dy), k = Math.floor((b.cz - oz) / dz);
      const v = result.filled[i + nx * (j + ny * k)] || 0;
      if (v <= 0) continue;
      inModel += v; touched++;
      if (v < full * (1 - 1e-9)) partial++;
    }
    return {sourceSolid:result.sourceSolid,solid:result.solid,terrainExcluded:result.terrainExcluded, inGrid:result.total, outsideGrid:result.outside, inModel, outsideEnvelope:Math.max(0, result.total - inModel),
      touched, partial, full:touched - partial, blockVolume:full};
  }

  function render() {
    const box = document.getElementById('blockDomainClip');
    const received = typeof OrebitHandoff === 'object' && OrebitHandoff.domain ? OrebitHandoff.domain() : null;
    const bs = typeof blockState === 'object' ? blockState : null;
    const mine = ++job;
    window.__resourceDomainClip = null;
    if (!box) return;
    if(window.__resourceBlockSupport&&window.__resourceBlockSupport.received!==received){window.__resourceBlockSupport=null;window.__resourceBlockSupportRecovery=null;estimState={results:null,done:false};classState={thresholds:null,labels:null};}
    syncSupportNotice();
    if (!received || !bs || !bs.blocks) { cache=null;box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const codes = received.domains.map(d => esc(d.code)).join(', ');
    const head = `<h3 data-i18n="res.clip.title">Domain solid from Core</h3>`;
    if (!hasCurrentGeologicalReview(received)) {
      cache=null;
      box.innerHTML = head + `<p class="hint warn"><strong>${codes}</strong> · <span data-i18n="res.clip.notValidated">Not validated at handoff, so no volume is compared. Rebuild and accept it in Core, then send it again.</span></p>`;
      window.__resourceDomainClip = {status:'not-validated'};
      return translateTree(box);
    }
    box.innerHTML = head + `<p class="hint" id="blockDomainClipProgress"><span data-i18n="res.clip.running">Measuring the solid inside each block…</span></p>`;
    translateTree(box);
    const grid = {origin:bs.origin, size:bs.size, count:bs.dims}, blocks = bs.blocks;
    const cancelled = () => mine !== job || blockState.blocks !== blocks;
    const context=JSON.stringify(grid);
    if(window.__resourceBlockSupport&&window.__resourceBlockSupport.blocks!==blocks){window.__resourceBlockSupport=null;estimState={results:null,done:false};classState={thresholds:null,labels:null};syncSupportNotice();}
    if(cache?.received===received&&cache.blocks===blocks&&cache.context===context){restorePendingSupport(received,blocks,cache.measurements);show(box,cache.rows,received,cache.measurements);return;}
    cache=null;
    const stop=document.createElement('button');stop.type='button';stop.className='btn secondary';stop.textContent=t('res.clip.cancel');
    stop.onclick=()=>{
      if(cancelled())return;job++;window.__resourceDomainClip={status:'cancelled'};
      box.innerHTML=head+'<p class="hint">'+esc(t('res.clip.cancelled'))+'</p>';
      const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.textContent=t('res.clip.retry');retry.onclick=render;box.append(retry);
    };
    box.append(stop);
    // Keep only the current solid's large cell array alive. Starting every domain
    // concurrently multiplied memory by the number of geological groups.
    (async()=>{
      const rows=[],measurements=[];
      for(const [n,d] of received.domains.entries()){
        if(cancelled())return;
        const progress=document.getElementById('blockDomainClipProgress');
        if(progress)progress.textContent=t('res.clip.progress').replace('{n}',String(n+1)).replace('{total}',String(received.domains.length));
        const terrain=d.build.inputs?.terrainSurface;
        if(!terrain||d.build.inputs?.topographyAudit?.fullSurfaceClipping!==true)throw Error('BLOCK_SUPPORT_TERRAIN_SURFACE_REQUIRED');
        const measured=await OrebitTerrainClip.fractionsAsync(d.build.mesh,terrain,grid,{cancelled});
        if(!measured||cancelled())return;
        rows.push({code:d.code,density:d.density,...summarise(measured,bs)});
        measurements.push({code:d.code,filled:measured.filled});
      }
      cache={received,blocks,context,rows,measurements};restorePendingSupport(received,blocks,measurements);show(box,rows,received,measurements);
    })().catch(error=>{
      if(cancelled())return;
      box.innerHTML=head+`<p class="hint bad"><span data-i18n="res.clip.failed">The received solid could not be measured against this grid.</span> <code>${esc(error.message)}</code></p>`;
      window.__resourceDomainClip={status:'error',error:error.message};translateTree(box);
    });
  }

  function restorePendingSupport(received,blocks,measurements){
    const candidate=window.__resourceBlockSupportRecovery;
    if(!candidate)return false;
    try{
      const grid=candidate.grid,model={origin:blockState.origin,size:blockState.size,dims:blockState.dims,blocks};
      if(candidate.sourceHash!==received.source?.sha256||!grid||grid.blockCount!==blocks.length||
         JSON.stringify(grid.origin)!==JSON.stringify(model.origin)||JSON.stringify(grid.size)!==JSON.stringify(model.size)||
         JSON.stringify(grid.dims)!==JSON.stringify(model.dims))throw Error('BLOCK_SUPPORT_RECOVERY_GRID_OR_LINEAGE_MISMATCH');
      const rebuilt=OrebitResourceBlockSupport.build(received,model,measurements,candidate.domains.map(d=>d.code),candidate.review);
      if(JSON.stringify(rebuilt)!==JSON.stringify(candidate))throw Error('BLOCK_SUPPORT_RECOVERY_MEASUREMENT_MISMATCH');
      window.__resourceBlockSupport={snapshot:rebuilt,received,blocks,blockIndexes:new Set(rebuilt.supportedBlockIndexes),revision:++supportRevision};
      window.__resourceBlockSupportRecovery=null;
      estimState={results:null,done:false};classState={thresholds:null,labels:null};crossvalState={results:null,metrics:null};window._gtCurveSnapshot=null;
      saveResourceSession();return true;
    }catch(error){
      window.__resourceBlockSupportRecovery=null;
      console.warn('[filled-block support recovery]',error.code||error.message);
      saveResourceSession();return false;
    }
  }

  function show(box, rows, received, measurements) {
    const support=window.__resourceBlockSupport;
    const applied=!!(support && support.received===received && support.blocks===blockState.blocks);
    const selected=applied?new Set(support.snapshot.domains.map(d=>d.code)):null;
    const review=applied?support.snapshot.review:{};
    const imported=received.domains.some(d=>d.build.inputs?.terrainSurface?.kind==='imported-dxf-3dface-tin');
    const basisKey=applied?(imported?'res.clip.basisAppliedImported':'res.clip.basisApplied'):'res.clip.basis';
    const body = rows.map(r => {
      const tonnes = Number.isFinite(r.density) && r.density > 0 ? fmt(r.inModel * r.density) + ' t @ ' + fmt(r.density, 2) : null;
      return `<tr><th scope="row">${esc(r.code)}</th><td>${fmt(r.sourceSolid)}</td><td>${fmt(r.solid)}</td><td>${fmt(r.inModel)}</td><td>${fmt(r.outsideEnvelope)}</td><td>${fmt(r.outsideGrid)}</td><td>${fmt(r.terrainExcluded)}</td>`
        + `<td>${fmt(r.full)} / ${fmt(r.partial)}</td><td>${tonnes || '<span data-i18n="res.clip.noDensity">No density declared in Core</span>'}</td></tr>`;
    }).join('');
    const coverage=rows.map(r=>`<li><strong>${esc(r.code)}</strong>: ${r.solid>0?fmt(Math.min(100,100*r.inModel/r.solid),2)+'%':'—'} · ${fmt(Math.max(0,r.solid-r.inModel),2)} m³</li>`).join('');
      box.innerHTML = `<h3 data-i18n="res.clip.title">Domain solid from Core</h3>
      <div class="domain-clip-scroll"><table class="data-table"><thead><tr>
        <th data-i18n="res.clip.code">Domain</th><th data-i18n="res.clip.sourceSolid">Geological solid (m³)</th><th data-i18n="res.clip.solid">Below reviewed terrain (m³)</th><th data-i18n="res.clip.inModel">Filled in model blocks (m³)</th>
        <th data-i18n="res.clip.outsideEnvelope">In grid, outside generated blocks (m³)</th><th data-i18n="res.clip.outsideGrid">Below terrain, outside grid (m³)</th><th data-i18n="res.clip.terrainExcluded">Excluded above/outside terrain (m³)</th>
        <th data-i18n="res.clip.fullPartial">Full / partial blocks</th><th data-i18n="res.clip.tonnes">Filled tonnage</th></tr></thead><tbody>${body}</tbody></table></div>
      <p><strong data-i18n="res.clip.coverageTitle">Solid coverage in generated blocks; volume outside them</strong></p>
      <ul>${coverage}</ul><p data-i18n="res.clip.coverageHelp"></p>
      <p class="hint" data-i18n="${basisKey}"></p>
      <details id="resourceBlockSupportReview"><summary data-i18n="res.clip.applyTitle">Review and apply filled-block support</summary>
        <p class="hint" data-i18n="res.clip.terrainLimit">Resource clips each reviewed Core solid below its bound collar-elevation TIN; terrain-uncovered and above-terrain volumes are excluded and reported.</p>
        <div>${received.domains.map(d=>`<label><input type="checkbox" data-support-domain value="${esc(d.code)}" ${!selected||selected.has(d.code)?'checked':''}> ${esc(d.code)}</label>`).join(' ')}</div>
        <label><span data-i18n="res.clip.reviewer">Reviewer</span> <input id="resourceSupportReviewer" maxlength="120" value="${esc(review.reviewer||'')}"></label>
        <label><span data-i18n="res.clip.reason">Reason</span> <input id="resourceSupportReason" maxlength="500" value="${esc(review.reason||'')}"></label>
        <button class="btn" type="button" onclick="OrebitResourceDomainClip.applySupport()" data-i18n="res.clip.apply">Apply selected support</button>
        <div id="resourceSupportStatus" role="status" aria-live="polite"></div>
      </details>`;
    if(received.domains.some(d=>d.build.inputs?.terrainSurface?.kind==='imported-dxf-3dface-tin')){
      const terrainLimit=box.querySelector('[data-i18n="res.clip.terrainLimit"]');
      if(terrainLimit){terrainLimit.dataset.i18n='res.clip.terrainLimitImported';terrainLimit.textContent=t('res.clip.terrainLimitImported');}
    }
    window.__resourceDomainClip = {status:'measured', rows, at:(received.handoff || {}).at || null,
      supportApplied:applied,appliedSupport:applied?support.snapshot:null};
    translateTree(box);
    syncSupportNotice();
  }

  function applySupport(){
    const status=document.getElementById('resourceSupportStatus');
    try{
      if(!cache||cache.received!==OrebitHandoff.domain()||cache.blocks!==blockState.blocks)throw Error('BLOCK_SUPPORT_MEASUREMENT_STALE');
      const selected=[...document.querySelectorAll('[data-support-domain]:checked')].map(el=>el.value),snapshot=OrebitResourceBlockSupport.build(cache.received,
        {origin:blockState.origin,size:blockState.size,dims:blockState.dims,blocks:blockState.blocks},cache.measurements,selected,
        {reviewer:document.getElementById('resourceSupportReviewer')?.value,reason:document.getElementById('resourceSupportReason')?.value});
      window.__resourceBlockSupport={snapshot,received:cache.received,blocks:blockState.blocks,blockIndexes:new Set(snapshot.supportedBlockIndexes),revision:++supportRevision};
      estimState={results:null,done:false};classState={thresholds:null,labels:null};crossvalState={results:null,metrics:null};window._gtCurveSnapshot=null;
      if(status)status.textContent=t('res.clip.applied').replace('{blocks}',String(snapshot.counts.supportedBlocks)).replace('{records}',String(snapshot.counts.records));
      const basis=document.querySelector('#blockDomainClip [data-i18n="res.clip.basis"]');
      if(basis){const imported=cache.received.domains.some(d=>d.build.inputs?.terrainSurface?.kind==='imported-dxf-3dface-tin'),key=imported?'res.clip.basisAppliedImported':'res.clip.basisApplied';basis.dataset.i18n=key;basis.textContent=t(key);}
      window.__resourceDomainClip.supportApplied=true;window.__resourceDomainClip.appliedSupport=snapshot;
      syncSupportNotice();
      saveResourceSession();return snapshot;
    }catch(error){
      const reasons={BLOCK_SUPPORT_REVIEW_REQUIRED:'res.clip.needReview',BLOCK_SUPPORT_DOMAIN_SELECTION_REQUIRED:'res.clip.needDomain',
        BLOCK_SUPPORT_MEASUREMENT_STALE:'res.clip.needMeasurement',BLOCK_SUPPORT_DOMAIN_REVIEW_STALE:'res.clip.needGeology',
        BLOCK_SUPPORT_TERRAIN_REVIEW_REQUIRED:'res.clip.needTerrain',BLOCK_SUPPORT_EMPTY:'res.clip.noSupport',BLOCK_SUPPORT_DOMAIN_OVERLAP:'res.clip.overlap'};
      const code=error.code||error.message;
      if(status)status.textContent=reasons[code]?t(reasons[code]):t('res.clip.applyBlocked').replace('{reason}',code||'BLOCK_SUPPORT_FAILED');
      return false;
    }
  }

  window.OrebitResourceDomainClip = Object.freeze({render,applySupport});
  window.addEventListener('orebit-domain-handoff', () => { if (document.getElementById('blockDomainClip')) render(); });
})();
