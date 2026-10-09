/* Bounded display-only drillhole batching. Numerical sample populations stay intact. */
function drillholeDisplay(samples, limit=10000) {
  limit=Math.max(2,Math.min(50000,Math.floor(limit)||10000));
  const groups=new Map();let unknown=0;
  for(const s of samples){
    const id=s.rid==null||s.rid===''?'unknown:'+(unknown++):'id:'+String(s.rid);
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(s);
  }
  const step=Math.max(1,Math.ceil(groups.size/(limit/2))), selected=[...groups.values()].filter((_,i)=>i%step===0);
  const perHole=Math.max(2,Math.floor(limit/Math.max(1,selected.length)));
  const x=[],y=[],z=[];let displayed=0;
  for(const source of selected){
    const points=source.slice().sort((a,b)=>Number.isFinite(a.md)&&Number.isFinite(b.md)?a.md-b.md:b.z-a.z);
    const pick=[];
    if(points.length<=perHole)pick.push(...points);
    else for(let i=0;i<perHole;i++)pick.push(points[Math.round(i*(points.length-1)/(perHole-1))]);
    for(const p of pick){x.push(p.x);y.push(p.y);z.push(p.z);displayed++;}
    // Null separators prevent false connections between holes, including missing IDs.
    x.push(null);y.push(null);z.push(null);
  }
  return {x,y,z,displayed,total:samples.length,holes:groups.size,displayedHoles:selected.length};
}
