/* S1: exact minimum-curvature arc positions; raw surveys remain untouched. */
(function(root){'use strict';
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 // Unit tangent in projected XYZ; dip convention is chosen by the import owner.
 function direction(s,incFromVert){
  if(!s||!['depth','dip','azimuth'].every(k=>finite(s[k]))||s.depth<0||Math.abs(s.dip)>90||s.azimuth<0||s.azimuth>360)throw Error('DESURVEY_STATION_INVALID');
  const inc=incFromVert(s.dip),az=s.azimuth*Math.PI/180;
  if(!finite(inc)||inc<0||inc>Math.PI)throw Error('DESURVEY_INCLINATION_INVALID');
  return [Math.sin(inc)*Math.sin(az),Math.sin(inc)*Math.cos(az),-Math.cos(inc)];
 }
 // Integrated spherical interpolation over fraction f of a measured-depth segment.
 function displacement(a,b,L,f){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==3||b.length!==3||![...a,...b,L,f].every(finite)||Math.abs(Math.hypot(...a)-1)>1e-8||Math.abs(Math.hypot(...b)-1)>1e-8||!(L>0)||f<0||f>1)throw Error('DESURVEY_SEGMENT_INVALID');
  const dot=a.reduce((s,x,i)=>s+x*b[i],0),cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const beta=Math.atan2(Math.hypot(...cross),Math.max(-1,Math.min(1,dot)));
  if(Math.PI-beta<1e-6)throw Error('DESURVEY_OPPOSITE_DIRECTIONS');
  if(beta<1e-10)return a.map(x=>x*L*f);
  const den=beta*Math.sin(beta),af=2*Math.sin((2-f)*beta/2)*Math.sin(f*beta/2)/den,bf=2*Math.sin(f*beta/2)**2/den;
  return a.map((x,i)=>L*(af*x+bf*b[i]));
 }
 // Read-only measurement validation; same-MD conflicts require source review.
 function issues(rows,incFromVert){
  const groups=new Map(),result=[];
  const number=v=>v===null||v===undefined||String(v).trim()===''?NaN:Number(v);
  for(const row of rows){
   const station={depth:number(row.depth),dip:number(row.dip),azimuth:number(row.azimuth)};
   try{station.vector=direction(station,incFromVert);}catch(error){result.push({hole_id:row.hole_id,depth:row.depth,code:'INVALID_MEASUREMENT'});continue;}
   if(!groups.has(row.hole_id))groups.set(row.hole_id,[]);groups.get(row.hole_id).push(station);
  }
  for(const [hole_id,stations] of groups){
   stations.sort((a,b)=>a.depth-b.depth);
   for(let i=1;i<stations.length;i++){
    const a=stations[i-1],b=stations[i];
    if(a.depth===b.depth){if(Math.hypot(...a.vector.map((v,k)=>v-b.vector[k]))>1e-8)result.push({hole_id,depth:b.depth,code:'CONFLICTING_STATION'});continue;}
    try{displacement(a.vector,b.vector,b.depth-a.depth,1);}catch(error){result.push({hole_id,depth:b.depth,code:'OPPOSITE_DIRECTIONS'});}
   }
  }
  return result;
 }
 function prepare(trace,surveys,incFromVert){
  if(!Array.isArray(trace)||!trace.length||!Array.isArray(surveys)||!surveys.length)return null;
  if(!trace.every((p,i)=>['depth','x','y','z'].every(k=>finite(p[k]))&&p.depth>=0&&(!i||p.depth>trace[i-1].depth)))return null;
  if(!surveys.every((s,i)=>['depth','dip','azimuth'].every(k=>finite(s[k]))&&s.depth>=0&&Math.abs(s.dip)<=90&&s.azimuth>=0&&s.azimuth<=360&&(!i||s.depth>surveys[i-1].depth)))return null;
  const points=trace.map(p=>({depth:p.depth,x:p.x,y:p.y,z:p.z})),stations=surveys.map(s=>({...s,vector:direction(s,incFromVert)}));
  // Prepare once per source context; every interval lookup is O(log stations).
  for(let i=1;i<stations.length;i++)displacement(stations[i-1].vector,stations[i].vector,stations[i].depth-stations[i-1].depth,1);
  function atMD(md){
   if(!finite(md)||md<0)return null;
   let lo=0,hi=points.length-1;
   while(lo<=hi){const mid=(lo+hi)>>1;if(points[mid].depth<md)lo=mid+1;else if(points[mid].depth>md)hi=mid-1;else return {x:points[mid].x,y:points[mid].y,z:points[mid].z};}
   if(hi<0)return null;
   const p=points[hi],last=stations[stations.length-1];let delta;
   if(md>=last.depth)delta=last.vector.map(v=>v*(md-p.depth));
   else{
    let start=0,end=stations.length-1;
    while(start<=end){const mid=(start+end)>>1;if(stations[mid].depth<=p.depth)start=mid+1;else end=mid-1;}
    const a=stations[end],b=stations[end+1];if(!a||!b||a.depth!==p.depth)return null;
    delta=displacement(a.vector,b.vector,b.depth-a.depth,(md-a.depth)/(b.depth-a.depth));
   }
   return {x:p.x+delta[0],y:p.y+delta[1],z:p.z+delta[2]};
  }
  return Object.freeze({atMD,stationCount:stations.length});
 }
 function pointAtMD(trace,surveys,md,incFromVert){return prepare(trace,surveys,incFromVert)?.atMD(md)??null;}
 root.OrebitMinimumCurvature=Object.freeze({version:'minimum-curvature-arc-v1',direction,displacement,issues,prepare,pointAtMD});
})(typeof window==='undefined'?globalThis:window);

function traceFromSurveys(collar, surveys, incFromVert) {
  // Minimum Curvature method (Sawaryn & Thorogood, 2003 SPE 84246)
  // Z increases up; we subtract TVD (true vertical depth = projection of MD onto vertical axis).
  const trace = [];
  const cx = Number(collar.x), cy = Number(collar.y), cz = Number(collar.z);
  if ([collar.x,collar.y,collar.z].some(v=>v===null||v===undefined||String(v).trim()==='') || ![cx,cy,cz].every(Number.isFinite)) return [];
  if (!Array.isArray(surveys) || !surveys.length || surveys[0].depth!==0) return [];
  const directions=surveys.map(s=>OrebitMinimumCurvature.direction(s,incFromVert));
  if (surveys.some((s,i)=>i&&s.depth<=surveys[i-1].depth)) throw new Error('DESURVEY_STATIONS_UNORDERED');
  let X = cx;
  let Y = cy;
  let Z = cz;
  trace.push({ depth: 0, x: X, y: Y, z: Z });

  for (let i = 0; i < surveys.length - 1; i++) {
    const s1 = surveys[i], s2 = surveys[i+1];
    const md1 = s1.depth, md2 = s2.depth;
    if (md2 <= md1) continue;
    const dMD = md2 - md1;
    const delta=OrebitMinimumCurvature.displacement(directions[i],directions[i+1],dMD,1);
    X+=delta[0];Y+=delta[1];Z+=delta[2];
    trace.push({ depth: md2, x: X, y: Y, z: Z });
  }
  // Extend final segment to total_depth if collar.depth > last survey depth
  const totalDepth = Number(collar.depth);
  const lastSurvey = surveys[surveys.length - 1];
  if (totalDepth && totalDepth > lastSurvey.depth + 0.01) {
    const dMD = totalDepth - lastSurvey.depth;
    const delta=directions[directions.length-1].map(value=>value*dMD);
    X+=delta[0];Y+=delta[1];Z+=delta[2];
    trace.push({ depth: totalDepth, x: X, y: Y, z: Z });
  }
  return trace;
}
