/* P5.01: turn exact per-domain clipping arrays into a reviewed, sparse
   block/domain support snapshot. Empty geometry never falls back to a full cell. */
(function(root){
  'use strict';
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  function build(received,model,measurements,selectedCodes,review={}){
    const fail=code=>{const error=Error(code);error.code=code;throw error;};
    if(!received||received.schemaVersion!==1||received.handoff?.readiness!=='validated'||!received.source?.sha256)fail('BLOCK_SUPPORT_GEOMETRY_NOT_VALIDATED');
    if(!model||!Array.isArray(model.origin)||!Array.isArray(model.size)||!Array.isArray(model.dims)||!Array.isArray(model.blocks))fail('BLOCK_SUPPORT_MODEL_INVALID');
    const [ox,oy,oz]=model.origin,[dx,dy,dz]=model.size,[nx,ny,nz]=model.dims,cellVolume=dx*dy*dz,totalCells=nx*ny*nz;
    if(![ox,oy,oz,dx,dy,dz,cellVolume].every(Number.isFinite)||![dx,dy,dz].every(v=>v>0)||![nx,ny,nz].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isSafeInteger(totalCells)||totalCells>2000000)fail('BLOCK_SUPPORT_GRID_INVALID');
    const codes=[...new Set(Array.isArray(selectedCodes)?selectedCodes:[])];
    if(!codes.length||codes.some(code=>typeof code!=='string'||!code.trim()))fail('BLOCK_SUPPORT_DOMAIN_SELECTION_REQUIRED');
    if(typeof root.hasCurrentGeologicalReview!=='function'||!root.hasCurrentGeologicalReview(received))fail('BLOCK_SUPPORT_DOMAIN_REVIEW_STALE');
    if(new Set(model.blocks.map(b=>b?.idx)).size!==model.blocks.length||model.blocks.some(b=>!Number.isInteger(b?.idx)||b.idx<0))fail('BLOCK_SUPPORT_PARENT_DUPLICATE');
    const definitions=new Map((received.domains||[]).map(d=>[d.code,d]));
    if(codes.some(code=>!definitions.has(code)))fail('BLOCK_SUPPORT_DOMAIN_UNKNOWN');
    const measured=new Map((Array.isArray(measurements)?measurements:[]).map(d=>[d.code,d.filled]));
    const gridCount=totalCells,records=[],seenCells=new Set(),cellTotals=new Map(),blockIndexes=new Set();
    for(const code of codes){
      const domain=definitions.get(code),build=domain?.build,validation=build?.validation,terrain=build?.inputs?.topographyAudit,surface=build?.inputs?.terrainSurface;
      if(build?.stale||!build?.mesh||!validation||['topology','selfIntersection','topography','surfaceCrossings','overlap','honouring','geologistReview'].some(key=>validation[key]!==true))fail('BLOCK_SUPPORT_DOMAIN_REVIEW_STALE');
      if(!terrain||terrain.fullSurfaceClipping!==true||!surface||!['reviewed-collar-tin','imported-dxf-3dface-tin'].includes(surface.kind)||!Array.isArray(surface.v)||!Array.isArray(surface.triangles))fail('BLOCK_SUPPORT_TERRAIN_REVIEW_REQUIRED');
      if(surface.kind==='imported-dxf-3dface-tin'&&(!/^[a-f0-9]{64}$/.test(surface.provenance?.sourceHash||'')||surface.units!=='m'||surface.provenance?.sourceUnits!=='m'||surface.provenance?.transform!=='identity'||surface.provenance?.targetCRS!==surface.crs))fail('BLOCK_SUPPORT_TERRAIN_REVIEW_REQUIRED');
      const fills=measured.get(code);
      if(!fills||fills.length!==gridCount)fail('BLOCK_SUPPORT_MEASUREMENT_MISSING');
      for(const block of model.blocks){
        const i=Math.floor((block.cx-ox)/dx),j=Math.floor((block.cy-oy)/dy),k=Math.floor((block.cz-oz)/dz);
        if(i<0||i>=nx||j<0||j>=ny||k<0||k>=nz)fail('BLOCK_SUPPORT_CELL_ALIGNMENT_INVALID');
        const cell=i+nx*(j+ny*k),volume=fills[cell];
        if(!Number.isFinite(volume)||volume< -cellVolume*1e-9||volume>cellVolume*(1+1e-8))fail('BLOCK_SUPPORT_VOLUME_INVALID');
        if(volume<=cellVolume*1e-12)continue;
        if(seenCells.has(code+'\u0000'+cell))fail('BLOCK_SUPPORT_PARENT_DUPLICATE');
        seenCells.add(code+'\u0000'+cell);blockIndexes.add(block.idx);
        const total=(cellTotals.get(cell)||0)+volume;cellTotals.set(cell,total);
        if(total>cellVolume*(1+1e-8))fail('BLOCK_SUPPORT_DOMAIN_OVERLAP');
        records.push({blockIndex:block.idx,cellIndex:cell,domainCode:code,filledVolume:+Math.min(volume,cellVolume).toFixed(10)});
      }
    }
    if(!records.length)fail('BLOCK_SUPPORT_EMPTY');
    const reviewer=String(review.reviewer||'').trim(),reason=String(review.reason||'').trim();
    if(!reviewer||!reason)fail('BLOCK_SUPPORT_REVIEW_REQUIRED');
    const snapshot={schema:'orebit-resource-block-support',version:1,sourceHash:received.source.sha256,
      domains:codes.map(code=>({code,meshHash:definitions.get(code).build.meshHash,inputsHash:definitions.get(code).build.inputsHash,terrainSurfaceKind:definitions.get(code).build.inputs.terrainSurface.kind,topographyAudit:definitions.get(code).build.inputs.topographyAudit})),
      grid:{origin:[...model.origin],size:[...model.size],dims:[...model.dims],blockCount:model.blocks.length,cellVolume},records,
      supportedBlockIndexes:[...blockIndexes].sort((a,b)=>a-b),counts:{records:records.length,supportedBlocks:blockIndexes.size,partialRecords:records.filter(r=>r.filledVolume<cellVolume*(1-1e-9)).length},
      terrainBasis:codes.some(code=>definitions.get(code).build.inputs.terrainSurface.kind==='imported-dxf-3dface-tin')
        ?'Core-reviewed bound terrain TIN (including imported DXF); Resource clips and reports terrain exclusions'
        :'Core-reviewed collar-elevation TIN; Resource clips and reports terrain exclusions',
      review:{reviewer,reason,at:String(review.at||new Date().toISOString())}};
    return freeze(snapshot);
  }
  root.OrebitResourceBlockSupport=Object.freeze({build});
})(typeof window==='undefined'?globalThis:window);
