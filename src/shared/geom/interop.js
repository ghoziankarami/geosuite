/* Domain S10: portable OBJ solids and true-coordinate section polylines.
   OBJ groups have safe identifiers; literal domain names remain in JSON comments.
   Coordinates stay in the declared projected metre frame, without display VE. */
(function(root){
  'use strict';
  const comment=v=>JSON.stringify(v).replace(/[\r\n]/g,' ');
  function metadata(state,options){return {schemaVersion:state.schemaVersion,source:state.source,crs:state.crs,
    generated:options.generated||new Date().toISOString(),version:options.version||'unrecorded',
    interpretation:'Geologist-reviewed explicit interpretation. Initial screening; not a Resource declaration.'};}
  function writeOBJ(state,options={}){
    root.OrebitDomainState.check(state);
    const lines=['# Orebit explicit domain solid','# provenance '+comment(metadata(state,options))];
    let offset=1;
    for(const [n,d] of state.domains.entries()){
      root.OrebitDomainSolid.prepareSolid(d.build.mesh);
      lines.push('# domain '+comment({code:d.code,density:d.density,inputsHash:d.build.inputsHash,meshHash:d.build.meshHash,rules:d.build.inputs.rules,review:d.build.review,reviewHash:d.build.reviewHash}), 'g domain_'+(n+1));
      for(const p of d.build.mesh.v)lines.push('v '+p.join(' '));
      for(const f of d.build.mesh.f)lines.push('f '+f.map(i=>i+offset).join(' '));
      offset+=d.build.mesh.v.length;
    }
    return lines.join('\n')+'\n';
  }
  function writePolylines(state,options={}){
    root.OrebitDomainState.check(state);
    const fields=['domain','section','station_m','azimuth_deg','point','x_m','y_m','rl_m','snapped_hole','snapped_depth_m','snap_off_plane_m','snapped_radius_m','source_sha256','crs','length_unit','rules','exported_utc','reviewer','review_reason','reviewed_utc','review_source_sha256'];
    const rows=[fields],m=metadata(state,options),g=root.OrebitGeometryPrimitives;
    for(const d of state.domains)for(const [section,s] of (d.build.inputs.sections||[]).entries()){
      const plane=g.sectionPlane([s.origin[0],s.origin[1],0],s.azimuth);
      for(const [point,p] of s.points.entries()){
        const xyz=g.unproject(plane,[p[0],-p[1],0]),snap=s.snaps[point];
        rows.push([d.code,section+1,s.station,s.azimuth,point+1,...xyz,snap?.hole??'',snap?.depth??'',snap?.off??'',snap?.radius??'',m.source.sha256,
          state.crs.kind==='epsg'?'EPSG:'+state.crs.epsg:state.crs.kind,'m',JSON.stringify(d.build.inputs.rules),m.generated,
          d.build.review?.reviewer||'',d.build.review?.reason||'',d.build.review?.at||'',d.build.review?.sourceHash||'']);
      }
    }
    if(rows.length===1)throw Error('DOMAIN_POLYLINES_UNAVAILABLE');
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    return rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
  }
  root.OrebitDomainInterop=Object.freeze({writeOBJ,writePolylines});
})(typeof window==='undefined'?globalThis:window);
