/* Core owns Domain state. The viewer (core-domain-viewer.js) previews; only a geologist-accepted solid is stored here. */
(function () {
  'use strict';
  let interpretation = OrebitDomainState.create();
  let epoch = 0, revision = 0;
  const geometryCache=new Map();
  function source() {
    const scope=window.OrebitCoreScope?.record();
    return {tables:Object.fromEntries(['collar','survey','assay','geology'].map(k=>[k,STATE[k]])),
      geometryAlgorithm:window.OrebitMinimumCurvature?.version||'unavailable', analysisPopulation:scope?{policy:scope.policy,included:scope.included}:null, crs:STATE.crs, lengthUnit:'m', gradeUnits:STATE.units || {}, coordinateMode:window._coreUseProvidedXYZ?'supplied-midpoints':'measured-survey'};
  }
  async function capture() {
    const version=epoch, text=JSON.stringify(source());
    const sha256=await OrebitDomainState.hash(JSON.parse(text));
    if(version!==epoch || text!==JSON.stringify(source())) throw new Error('DOMAIN_SOURCE_CHANGED');
    return {sha256,rows:STATE.assay.length,holes:STATE.collar.length};
  }
  function reset() {epoch++;revision++;geometryCache.clear();interpretation=OrebitDomainState.create();}
  function invalidate(reason) {epoch++;revision++;geometryCache.clear();if(interpretation.domains.length) OrebitDomainState.invalidate(interpretation,reason);}
  function exportState() {return JSON.parse(JSON.stringify(interpretation));}
  function freezeSolids(){
    for(const d of interpretation.domains){const m=d.build?.mesh;if(!m)continue;
      for(const p of m.v)Object.freeze(p);for(const f of m.f)Object.freeze(f);
      Object.freeze(m.v);Object.freeze(m.f);Object.freeze(m);
    }
  }
  function displaySolids(){
    return interpretation.domains.map(d=>Object.freeze({code:d.code,label:d.label||d.code,colour:d.colour,visible:d.visible!==false,stale:!!d.build?.stale,mesh:d.build?.mesh}));
  }
  function setVisibility(code,visible){
    if(typeof visible!=='boolean')throw Error('DOMAIN_VISIBILITY_INVALID');
    const domain=interpretation.domains.find(d=>d.code===code);if(!domain)throw Error('DOMAIN_CODE_INVALID');
    domain.visible=visible;revision++;
    interpretation.provenance.history.push({at:new Date().toISOString(),action:'domain-visibility',detail:code+' · '+visible});
  }

  function contactMembership(target,threshold,codebook=interpretation.codebook) {
    const split=String(target).indexOf(':'),kind=String(target).slice(0,split),name=String(target).slice(split+1);
    if(kind==='book'){
      const definition=codebook.find(d=>d.code===name),codes=new Set(definition?.lithologies||[]),rows=STATE.geology;
      return {table:'geology',member:r=>{const v=rows[r.sourceIndex]?.lith1;return !definition?.lithologies.length||v==null||v===''?null:codes.has(String(v));}};
    }
    if(kind==='lith'){
      const rows=STATE.geology;
      return {table:'geology',member:r=>{const v=rows[r.sourceIndex]?.lith1;return v==null||v===''?null:String(v)===name;}};
    }
    if(kind!=='grade'||!Number.isFinite(threshold))throw Error('DOMAIN_CONTACT_TARGET_INVALID');
    const rows=STATE.assay;
    return {table:'assay',member:r=>{const v=rows[r.sourceIndex]?.[name],x=v===''||v==null?NaN:Number(v);return Number.isFinite(x)?x>=threshold:null;}};
  }
  function deriveSurface(recipe,codebook=interpretation.codebook){
    if(!recipe||!['first_from','last_to','grade_cross'].includes(recipe.rule))throw Error('DOMAIN_SURFACE_RECIPE_INVALID');
    const {table,member}=contactMembership(recipe.target,recipe.threshold,codebook),geometry=intervalGeometry(table);
    if(geometry.status==='endpoints-unavailable')throw Error('DOMAIN_CONTACT_ENDPOINTS_UNAVAILABLE');
    const picks=OrebitDomainContacts.pickContacts(geometry.intervals,recipe.rule,member);
    const surface=OrebitDomainContacts.contactSurface(picks,recipe.maxEdge==null?{}:{maxEdge:recipe.maxEdge});
    if(surface.status!=='surface')throw Error('DOMAIN_SURFACE_'+String(surface.status).toUpperCase());
    return {picks,...surface};
  }
  async function resolveSurface(record,sourceHash,codebook=interpretation.codebook){
    OrebitDomainState.checkSurfaces([record]);
    if(record.sourceHash!==sourceHash||record.crs!==String(STATE.crs||'').trim())throw Error('DOMAIN_SURFACE_STALE');
    const surface=deriveSurface(record.recipe,codebook);
    if(surface.used!==record.points||surface.tin.triangles.length!==record.triangles||surface.maxEdge!==record.maxEdge||
       await OrebitDomainState.hash(surface.tin)!==record.geometryHash)throw Error('DOMAIN_SURFACE_CHANGED');
    return surface;
  }
  async function saveContactSurface(name,recipe){
    name=String(name).trim();
    if(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name))throw Error('DOMAIN_SURFACE_NAME_INVALID');
    if(interpretation.surfaces.some(s=>s.id===name))throw Error('DOMAIN_SURFACE_NAME_EXISTS');
    const token=epoch,version=revision,current=await capture(),surface=deriveSurface(recipe);
    const record={kind:'contact-tin',id:name,name,sourceHash:current.sha256,crs:String(STATE.crs||'').trim(),units:'m',
      recipe:JSON.parse(JSON.stringify(recipe)),geometryHash:await OrebitDomainState.hash(surface.tin),
      createdAt:new Date().toISOString(),points:surface.used,triangles:surface.tin.triangles.length,maxEdge:surface.maxEdge};
    if(token!==epoch||version!==revision)throw Error('DOMAIN_SOURCE_CHANGED');
    const next=JSON.parse(JSON.stringify(interpretation));next.surfaces.push(record);OrebitDomainState.checkSurfaces(next.surfaces);
    next.provenance.history.push({at:record.createdAt,action:'save-contact-surface',detail:name});
    interpretation=next;revision++;return JSON.parse(JSON.stringify(record));
  }
  async function previewContactSurface(id){
    const token=epoch,version=revision,record=interpretation.surfaces.find(s=>s.id===id);
    if(!record)throw Error('DOMAIN_SURFACE_PAIR_REQUIRED');
    const current=await capture(),surface=await resolveSurface(record,current.sha256);
    if(token!==epoch||version!==revision)throw Error('DOMAIN_SOURCE_CHANGED');
    return surface;
  }
  async function buildContactSurfacePair(upperId,lowerId,topography,terrainSurface){
    if(upperId===lowerId)throw Error('DOMAIN_SURFACE_PAIR_SAME');
    const token=epoch,version=revision,current=await capture();
    const records=[upperId,lowerId].map(id=>interpretation.surfaces.find(s=>s.id===id));
    if(records.some(s=>!s))throw Error('DOMAIN_SURFACE_PAIR_REQUIRED');
    const [upper,lower]=await Promise.all(records.map(s=>resolveSurface(s,current.sha256)));
    let terrain=null;
    if(topography==='collars'){
      const rows=STATE.collar.filter(c=>[c.x,c.y,c.z].every(v=>v!==''&&v!=null&&Number.isFinite(Number(v))));
      terrain={kind:'reviewed-collar-tin',...OrebitGeometryPrimitives.makeTIN(rows.map(c=>[Number(c.x),Number(c.y),Number(c.z)]))};
    }else if(topography==='imported')terrain=terrainSurface;
    else if(topography!=='unavailable')throw Error('DOMAIN_SURFACE_PAIR_TOPOGRAPHY');
    if(topography==='imported'&&!terrain)throw Error('SURFACE_IMPORT_REQUIRED');
    const result=OrebitDomainBetween.buildSurfacePair(upper.tin,lower.tin,{terrain});
    if(token!==epoch||version!==revision)throw Error('DOMAIN_SOURCE_CHANGED');
    result.sourceRevision=epoch;result.interpretationRevision=revision;
    result.inputs={surfacePair:{upper:JSON.parse(JSON.stringify(records[0])),lower:JSON.parse(JSON.stringify(records[1]))},terrainSurface:terrain,
      rules:{method:'surface-pair',upperSurface:upperId,lowerSurface:lowerId,supportPolicy:'intersection-no-extrapolation',topography},
      topographyAudit:terrain?{type:topography==='collars'?'reviewed collar-elevation TIN':'imported DXF terrain TIN',pointCount:terrain.v.length,triangleCount:terrain.triangles.length,fullSurfaceClipping:false,coverageMethod:'exact-TIN-overlay'}:null};
    return result;
  }
  async function validateSurfacePairBuild(inputs,mesh,sourceHash,codebook){
    if(inputs?.rules?.method!=='surface-pair')return;
    const pair=inputs.surfacePair;
    if(!pair||pair.upper.id===pair.lower.id||inputs.rules.upperSurface!==pair.upper.id||inputs.rules.lowerSurface!==pair.lower.id||inputs.rules.supportPolicy!=='intersection-no-extrapolation')throw Error('DOMAIN_SURFACE_PAIR_REQUIRED');
    const [upper,lower]=await Promise.all([resolveSurface(pair.upper,sourceHash,codebook),resolveSurface(pair.lower,sourceHash,codebook)]);
    if(inputs.rules.topography==='collars'){
      const rows=STATE.collar.filter(c=>[c.x,c.y,c.z].every(v=>v!==''&&v!=null&&Number.isFinite(Number(v))));
      const expected={kind:'reviewed-collar-tin',...OrebitGeometryPrimitives.makeTIN(rows.map(c=>[Number(c.x),Number(c.y),Number(c.z)]))};
      if(await OrebitDomainState.hash(expected)!==await OrebitDomainState.hash(inputs.terrainSurface))throw Error('DOMAIN_SURFACE_PAIR_TERRAIN_CHANGED');
    }else if(inputs.rules.topography!=='imported')throw Error('DOMAIN_SURFACE_PAIR_TOPOGRAPHY');

    const rebuilt=OrebitDomainBetween.buildSurfacePair(upper.tin,lower.tin,{terrain:inputs.terrainSurface});
    if(rebuilt.status!=='solid'||rebuilt.validation.topography!==true||await OrebitDomainState.hash(rebuilt.mesh)!==await OrebitDomainState.hash(mesh))throw Error('DOMAIN_SURFACE_PAIR_CHANGED');
  }

  function contactSourceIssue(inputs,codebook=interpretation.codebook) {
    const rules=inputs?.rules;
    if(!rules?.target||['section-loft','surface-pair'].includes(rules.method))return null;
    const {table,member}=contactMembership(rules.target,rules.threshold,codebook);
    const geometry=intervalGeometry(table);
    if(geometry.status==='endpoints-unavailable')return 'DOMAIN_CONTACT_ENDPOINTS_UNAVAILABLE';
    const picks=OrebitDomainContacts.pickContacts(geometry.intervals,'first_from',member);
    return picks.some(p=>['repeated-domain-intervals','domain-support-gap'].includes(p.reason))?'DOMAIN_CONTACT_SUPPORT_AMBIGUOUS':null;
  }

  async function restore(state) {
    const token=epoch,version=revision,snapshot=JSON.parse(JSON.stringify(state));
    const current=await capture();
    if(token!==epoch||version!==revision) throw new Error('DOMAIN_SOURCE_CHANGED');
    const next=OrebitDomainState.restore(snapshot,current.sha256);
    for(const d of next.domains){
      const b=d.build;if(!b?.mesh)continue;
      const inputsHash=await OrebitDomainState.hash(b.inputs),meshHash=await OrebitDomainState.hash(b.mesh);
      let reason=null;
      if(inputsHash!==b.inputsHash)reason='Stored interpretation inputs changed';
      else if(b.inputs?.material&&(b.inputs.material.density!==d.density||b.inputs.material.unit!=='t/m3'))reason='Stored material density changed';
      else if(!b.meshHash||meshHash!==b.meshHash)reason='Stored solid requires verification';
      else{
        try{const volume=OrebitDomainSolid.prepareSolid(b.mesh).volume;
          if(!Number.isFinite(b.volume)||Math.abs(volume-b.volume)>Math.max(1,volume)*1e-8)reason='Stored solid volume changed';
        }catch{reason='Stored solid geometry invalid';}
      }
      if(!reason){try{await validateSurfacePairBuild(b.inputs,b.mesh,current.sha256,next.codebook);reason=contactSourceIssue(b.inputs,next.codebook);}catch{reason='Stored contact interpretation requires current source review';}}
      if(!reason){
        if(!b.review||!b.reviewHash)reason='Stored solid requires reviewer identity and rationale';
        else if(await OrebitDomainState.hash(b.review)!==b.reviewHash||b.review.code!==d.code||b.review.volume!==b.volume||b.review.sourceHash!==next.source?.sha256||b.review.inputsHash!==b.inputsHash||b.review.meshHash!==b.meshHash)reason='Stored solid review changed';
      }
      if(reason)OrebitDomainState.invalidate({...next,domains:[d]},reason);
    }
    if(token!==epoch||version!==revision)throw Error('DOMAIN_SOURCE_CHANGED');
    interpretation=next;freezeSolids();epoch++;revision++;geometryCache.clear();
    return exportState();
  }
  function invalidateInterpretation(reason,code=null) {
    const domains=interpretation.domains.filter(d=>code==null||d.code===code);
    if(!domains.length)return;
    revision++;
    OrebitDomainState.invalidate({...interpretation,domains},reason);
  }
  function saveWorkspace(value) {
    const next=JSON.parse(JSON.stringify(value));
    if(JSON.stringify(next)===JSON.stringify(interpretation.workspace))return;
    OrebitDomainState.checkWorkspace(next);
    interpretation.workspace=next;revision++;
  }
  // Several disjoint domains can coexist. Replacing a code checks every other
  // current domain; boundary contact is permitted, positive-volume overlap is not.
  async function acceptSolid(value) {
    if(value?.density!=null&&(!Number.isFinite(value.density)||value.density<=0))throw Error('DOMAIN_DENSITY_INVALID');
    if(value?.volume!=null&&!Number.isFinite(value.volume))throw Error('DOMAIN_SOLID_VOLUME_MISMATCH');
    const token=epoch,version=revision,entry=JSON.parse(JSON.stringify(value));
    const changed=()=>token!==epoch||version!==revision;
    const current=await capture();
    if(changed()||(entry.sourceRevision!=null&&entry.sourceRevision!==epoch))throw Error('DOMAIN_SOURCE_CHANGED');
    const v=entry?.validation;
    if(!v||['topology','selfIntersection','topography','surfaceCrossings','honouring'].some(k=>v[k]!==true)||entry.review!==true)throw Error('DOMAIN_SOLID_NOT_ACCEPTABLE');
    const reviewer=OrebitDomainState.reviewIdentity(entry.reviewRecord);
    if(typeof entry.code!=='string'||!entry.code.trim())throw Error('DOMAIN_CODE_INVALID');
    if(!entry.inputs||typeof entry.inputs!=='object'||Array.isArray(entry.inputs)||!entry.inputs.rules||typeof entry.inputs.rules!=='object'||Array.isArray(entry.inputs.rules))throw Error('DOMAIN_SOLID_INPUT_INVALID');
    await validateSurfacePairBuild(entry.inputs,entry.mesh,current.sha256,interpretation.codebook);
    const contactIssue=contactSourceIssue(entry.inputs);if(contactIssue)throw Error(contactIssue);
    const code=entry.code.trim(),prepared=OrebitDomainSolid.prepareSolid(entry.mesh);
    if(entry.volume!=null&&(!Number.isFinite(entry.volume)||Math.abs(entry.volume-prepared.volume)>Math.max(1,prepared.volume)*1e-8))throw Error('DOMAIN_SOLID_VOLUME_MISMATCH');
    const terrain=entry.inputs.terrainSurface;
    const pairedTerrain=entry.inputs.rules.method==='surface-pair';
    const collarTerrain=['surface-pair','section-loft'].includes(entry.inputs.rules.method)&&entry.inputs.rules.topography==='collars';
    if(entry.inputs.rules.topography==='imported'||terrain?.kind==='imported-dxf-3dface-tin'||collarTerrain){
      const p=terrain?.provenance;
      const imported=entry.inputs.rules.topography==='imported'||terrain?.kind==='imported-dxf-3dface-tin';
      if(imported&&(!terrain||terrain.kind!=='imported-dxf-3dface-tin'||terrain.units!=='m'||terrain.crs!==String(STATE.crs||'').trim()||
         !p||p.sourceCRS!==terrain.crs||p.targetCRS!==terrain.crs||p.sourceUnits!=='m'||p.transform!=='identity'||!/^[a-f0-9]{64}$/i.test(p.sourceHash||'')||
         (!pairedTerrain&&entry.inputs.topographyAudit?.fullSurfaceClipping!==true)))throw Error('DOMAIN_TERRAIN_SURFACE_INVALID');
      // Paired horizons and section lofts initially carry an elevation/coverage check, not a
      // filled-volume certificate. Compute that certificate before acceptance;
      // Resource must retain its existing exact-terrain support gate.
      const coverage=OrebitSurfaceImport.assessCoverage(terrain,entry.mesh);
      if(!coverage.fullSurfaceCoverage&&!(entry.inputs.rules.method==='section-loft'&&entry.inputs.rules.topography==='collars'))throw Error('DOMAIN_TERRAIN_COVERAGE_INCOMPLETE');
      // Preserve Core's existing ability to review an extended section loft.
      // Incomplete collar coverage is explicitly uncertified and remains
      // blocked by Resource; it must never acquire a full-terrain flag.
      if(!coverage.fullSurfaceCoverage){
        entry.inputs.topographyAudit={...entry.inputs.topographyAudit,coverage,fullSurfaceClipping:false};
      }else{
      const lo=[0,1,2].map(k=>Math.min(...entry.mesh.v.map(q=>q[k]))),hi=[0,1,2].map(k=>Math.max(...entry.mesh.v.map(q=>q[k])));
      const size=lo.map((x,k)=>hi[k]-x);
      if(size.some(x=>!Number.isFinite(x)||x<=0))throw Error('DOMAIN_TERRAIN_SURFACE_INVALID');
      const clipped=await OrebitTerrainClip.fractionsAsync(entry.mesh,terrain,{origin:lo,size,count:[1,1,1]},{cancelled:changed});
      if(!clipped||changed())throw Error('DOMAIN_SOURCE_CHANGED');
      const tolerance=Math.max(prepared.volume,clipped.sourceSolid)*1e-8;
      if(clipped.terrainExcluded>tolerance||Math.abs(clipped.solid-prepared.volume)>tolerance)throw Error('DOMAIN_TERRAIN_SURFACE_CROSSING');
      entry.inputs.topographyAudit={...entry.inputs.topographyAudit,coverage,fullSurfaceClipping:true,
        volumeBelowTerrain:clipped.solid,terrainExcluded:clipped.terrainExcluded,validationMethod:'exact-signed-tetrahedron-volume'};
      }
    }
    const next=JSON.parse(JSON.stringify(interpretation));
    if(next.source?.sha256!==current.sha256)for(const d of next.domains)if(d.build){d.build.stale=true;d.build.staleReason='Source data or coordinate context changed';}
    const others=next.domains.filter(d=>d.code!==code),overlaps=[];
    for(const other of others){
      if(other.build?.stale)continue;
      const measured=await OrebitConvexClip.overlapAsync(entry.mesh,other.build.mesh,{cancelled:changed});
      if(!measured||changed())throw Error('DOMAIN_SOURCE_CHANGED');
      if(measured.volume>Math.max(prepared.volume,other.build.volume)*1e-8){
        const error=Error('DOMAIN_SOLIDS_OVERLAP');Object.assign(error,{domain:other.code,volume:measured.volume});throw error;
      }
      overlaps.push({code:other.code,volume:measured.volume,method:measured.method});
    }
    const epsg=/^EPSG:(\d+)$/i.exec(String(STATE.crs||'').trim());
    next.source={sha256:current.sha256,rows:current.rows,holes:current.holes};
    next.crs={...next.crs,...(epsg?{kind:'epsg',epsg:Number(epsg[1])}:{kind:'unconfirmed',epsg:null})};
    const definition=entry.inputs?.rules?.target?.startsWith('book:')?next.codebook.find(d=>d.code===entry.inputs.rules.target.slice(5)):null;
    if(definition)entry.inputs.codebook=JSON.parse(JSON.stringify(definition));
    entry.inputs.material={density:entry.density??null,unit:'t/m3',source:'Core declared material'};
    const inputsHash=await OrebitDomainState.hash(entry.inputs),meshHash=await OrebitDomainState.hash(entry.mesh);
    const review={...reviewer,at:new Date().toISOString(),code,volume:prepared.volume,sourceHash:current.sha256,inputsHash,meshHash};
    const reviewHash=await OrebitDomainState.hash(review);
    next.domains=others.concat({code,...(definition?{label:definition.label,colour:definition.colour,visible:definition.visible,precedence:definition.precedence,weathering:definition.weathering,geotechnical:definition.geotechnical}:{}),density:entry.density??null,build:{mesh:entry.mesh,volume:prepared.volume,inputs:entry.inputs,
      inputsHash,meshHash,review,reviewHash,overlaps,stale:false,validation:{...v,overlap:true,geologistReview:true}}});
    next.contactRules=next.domains.map(d=>d.build.inputs.rules);
    next.sections=next.domains.flatMap(d=>(d.build.inputs.sections||[]).map(s=>({...s,domainCode:d.code})));
    next.provenance.history.push({at:review.at,action:'accept-solid',detail:code+' · '+Math.round(prepared.volume)+' m3',review,reviewHash,overlaps});
    if(changed())throw Error('DOMAIN_SOURCE_CHANGED');
    interpretation=OrebitDomainState.check(next);freezeSolids();revision++;
    return exportState();
  }
  function setCodebook(entries){
    const next=JSON.parse(JSON.stringify(entries));OrebitDomainState.checkCodebook(next);
    if(JSON.stringify(next)===JSON.stringify(interpretation.codebook))return;
    for(const d of interpretation.domains){
      const key=d.build?.inputs?.rules?.target;
      if(!key?.startsWith('book:'))continue;
      const code=key.slice(5),before=interpretation.codebook.find(e=>e.code===code),after=next.find(e=>e.code===code);
      if(JSON.stringify(before)!==JSON.stringify(after))OrebitDomainState.invalidate({...interpretation,domains:[d]},'Geological codebook changed');
    }
    interpretation.codebook=next;revision++;
    interpretation.provenance.history.push({at:new Date().toISOString(),action:'edit-codebook',detail:next.map(d=>d.code).join(', ')});
    return exportState();
  }
  function removeSolid(code=null) {
    const removed=interpretation.domains.filter(d=>code==null||d.code===code);
    if(!removed.length)return exportState();
    interpretation.provenance.history.push({at:new Date().toISOString(),action:'remove-solid',detail:removed.map(d=>d.code).join(', ')});
    interpretation.domains=interpretation.domains.filter(d=>!removed.includes(d));
    interpretation.sections=interpretation.domains.flatMap(d=>(d.build.inputs.sections||[]).map(s=>({...s,domainCode:d.code})));
    interpretation.contactRules=interpretation.domains.map(d=>d.build.inputs.rules);revision++;
    return exportState();
  }
  function intervalGeometry(table='assay') {
    if(!['assay','geology'].includes(table))throw new Error('DOMAIN_INTERVAL_SOURCE_INVALID');
    if(window._coreUseProvidedXYZ) return {algorithm:OrebitMinimumCurvature.version,coordinateMode:'supplied-midpoints',status:'endpoints-unavailable',intervals:[]};
    if(!STATE.desurvey)computeDesurvey();
    const cached=geometryCache.get(table);
    if(cached?.epoch===epoch&&cached.rows===STATE[table]&&cached.desurvey===STATE.desurvey)return cached.value;
    const intervals=STATE[table].map((row,index)=>{
      const hole=STATE.desurvey.holes[row.hole_id],from=Number(row.from_m),to=Number(row.to_m);
      const valid=row.from_m!=null&&row.to_m!=null&&String(row.from_m).trim()!==''&&String(row.to_m).trim()!==''&&Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&to>from;
      const start=valid?hole?.curve?.atMD(from):null,end=valid?hole?.curve?.atMD(to):null;
      const assumptions=(hole?.assumptions||[]).filter(code=>code!=='LAST_DIRECTION_EXTENSION'||to>hole.surveys[hole.surveys.length-1].depth);
      return {sourceIndex:index,hole_id:row.hole_id,from_m:row.from_m,to_m:row.to_m,start:start??null,end:end??null,status:!start||!end?'invalid':assumptions.length?'assumed':'measured',assumptions};
    });
    const value=Object.freeze({algorithm:OrebitMinimumCurvature.version,coordinateMode:'measured-survey',sourceTable:table,crs:STATE.crs||null,
      status:intervals.some(r=>r.status==='invalid')?'invalid':intervals.some(r=>r.status==='assumed')?'assumed':'measured',
      intervals:Object.freeze(intervals.map(r=>Object.freeze({...r,start:r.start?Object.freeze({...r.start}):null,end:r.end?Object.freeze({...r.end}):null,assumptions:Object.freeze(r.assumptions.slice())})))});
    geometryCache.set(table,{epoch,rows:STATE[table],desurvey:STATE.desurvey,value});
    return value;
  }
  function intervalMembership(table='assay',options={}){
    if(!['assay','geology'].includes(table))throw Error('DOMAIN_INTERVAL_SOURCE_INVALID');
    const limit=options.maxIntervals??10000;
    if(!Number.isInteger(limit)||limit<1||limit>50000)throw Error('DOMAIN_INTERVAL_BUDGET');
    const sourceRows=STATE[table];if(sourceRows.length>limit)throw Error('DOMAIN_INTERVAL_BUDGET');
    const epochAtStart=epoch,revisionAtStart=revision,geometry=intervalGeometry(table);
    if(geometry.status==='endpoints-unavailable')throw Error('DOMAIN_INTERVAL_ENDPOINTS_UNAVAILABLE');
    const accepted=interpretation.domains.filter(d=>d.build?.mesh&&!d.build.stale&&d.build.validation?.geologistReview===true&&
      d.build.validation?.topology===true&&d.build.validation?.selfIntersection===true);
    if(!accepted.length)return {table,status:'no-reviewed-solid',sourceRevision:epoch,interpretationRevision:revision,intervals:[],domains:[]};
    const prepared=accepted.map(d=>{
      try{return {code:d.code,solid:OrebitDomainSolid.prepareSolid(d.build.mesh)};}
      catch(error){return {code:d.code,error:error.message};}
    });
    const intervals=geometry.intervals.map(item=>{
      const row=sourceRows[item.sourceIndex],parentObservationId=[table,item.sourceIndex,String(row?.hole_id??''),String(row?.from_m??''),String(row?.to_m??'')].join(':');
      const source={table,sourceIndex:item.sourceIndex,hole_id:item.hole_id,from_m:item.from_m,to_m:item.to_m,parentObservationId};
      const curve=STATE.desurvey?.holes?.[item.hole_id]?.curve;
      if(item.status==='invalid'||!curve)return {...source,geometryStatus:item.status,status:'ambiguous',reason:'DOMAIN_INTERVAL_TRACE_UNAVAILABLE',domains:[]};
      const memberships=prepared.map(({code,solid,error})=>{
        if(!solid)return {code,status:'ambiguous',reason:error||'DOMAIN_INTERVAL_SOLID_INVALID'};
        try{
          const measured=OrebitDomainIntervalMembership.measure(curve,Number(item.from_m),Number(item.to_m),solid,options);
          const assumed=item.status==='assumed';
          return {...measured,code,status:assumed?'ambiguous':measured.status,reason:assumed?'DOMAIN_INTERVAL_TRACE_ASSUMED':null};
        }catch(error){return {code,status:'ambiguous',reason:error.message||'DOMAIN_INTERVAL_CLASSIFICATION_FAILED'};}
      });
      const overlappingDomains=memberships.filter(m=>m.insideLength>1e-8).map(m=>m.code);
      return {...source,geometryStatus:item.status,assumptions:item.assumptions.slice(),status:item.status==='assumed'||item.status==='invalid'?'ambiguous':
        memberships.some(m=>m.status==='ambiguous')?'ambiguous':'measured',overlappingDomains,domains:memberships};
    });
    if(epochAtStart!==epoch||revisionAtStart!==revision)throw Error('DOMAIN_SOURCE_CHANGED');
    return {table,status:geometry.status,sourceRevision:epochAtStart,interpretationRevision:revisionAtStart,
      boundaryPolicy:'boundary support is reported separately; no boundary row is auto-assigned',
      overlapPolicy:'domains are measured independently; overlapping support is listed and is not resolved or auto-assigned',domains:prepared.map(d=>d.code),intervals};
  }
  // Capture a single immutable interpretation for asynchronous export. A draft
  // edit or dataset replacement during hashing cannot certify another state.
  async function checkedSnapshot(){
    const token=epoch,version=revision,snapshot=exportState(),current=await capture();
    if(token!==epoch||version!==revision)throw Error('DOMAIN_SOURCE_CHANGED');
    return {snapshot,readiness:OrebitDomainState.readiness(snapshot,current.sha256)};
  }
  window.__orebitDomainHandoff=async(file)=>{
    if(!interpretation.domains.length)return null;
    const token=epoch,version=revision;
    const {snapshot,readiness:r}=await checkedSnapshot();
    const domain={...snapshot,handoff:{from:'Core',readiness:r.status,volume:r.volume,at:new Date().toISOString()}};
    const result=file ? await window.OrebitCoreEDAReference.attachExportMembership(file,domain) : domain;
    if(token!==epoch||version!==revision)throw Error('DOMAIN_SOURCE_CHANGED');
    return result;
  };
  async function exportSolidDXF(){
    const {snapshot,readiness:r}=await checkedSnapshot();
    if(r.status!=='validated')throw Error('DOMAIN_DXF_NOT_VALIDATED');
    return OrebitDomainDXF.writeSolids(snapshot.domains.map(d=>({code:d.code,mesh:d.build.mesh})),{comment:'Orebit Core domain solid, validated '+new Date().toISOString().slice(0,10)+'; reviews '+JSON.stringify(snapshot.domains.map(d=>({code:d.code,review:d.build.review,reviewHash:d.build.reviewHash})))});
  }
  async function exportInterop(format){
    const {snapshot,readiness:r}=await checkedSnapshot();
    if(r.status!=='validated')throw Error('DOMAIN_INTEROP_NOT_VALIDATED');
    const options={version:window.OREBIT_VERSION||'unrecorded'};
    if(format==='obj')return OrebitDomainInterop.writeOBJ(snapshot,options);
    if(format==='csv')return OrebitDomainInterop.writePolylines(snapshot,options);
    throw Error('DOMAIN_INTEROP_FORMAT');
  }
  window.OrebitCoreDomain = {saveContactSurface,previewContactSurface,buildContactSurfacePair,surfaces:()=>JSON.parse(JSON.stringify(interpretation.surfaces)),capture,contactMembership,reset,invalidate,invalidateInterpretation,sourceRevision:()=>epoch,hasAcceptedLoft:code=>interpretation.domains.some(d=>d.code===code&&d.build?.inputs?.rules?.method==='section-loft'&&!d.build.stale),interpretationRevision:()=>revision,saveWorkspace,setCodebook,displaySolids,setVisibility,codebook:()=>JSON.parse(JSON.stringify(interpretation.codebook)),summaries:()=>interpretation.domains.map(d=>({code:d.code,density:d.density,visible:d.visible,build:{volume:d.build?.volume,stale:d.build?.stale,staleReason:d.build?.staleReason,review:d.build?.review?{...d.build.review}:null,validation:{...d.build?.validation}}})),exportState,restore,intervalGeometry,intervalMembership,acceptSolid,removeSolid,exportSolidDXF,exportInterop,
    readiness:async()=>(await checkedSnapshot()).readiness};
})();
