/* P4.02: measure an actual measured-depth interval against one accepted closed solid.
   Trace curves are linearized to a declared deviation tolerance; segment/triangle
   crossings split support, so a short body cannot be skipped by endpoint/midpoint tests. */
(function(root){
  'use strict';
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  function measure(curve,from,to,solid,options={}){
    const tolerance=options.maxDeviation??0.005,maxSegments=options.maxSegments??20000,maxDepth=options.maxDepth??20;
    if(!curve||typeof curve.atMD!=='function'||!Number.isFinite(from)||!Number.isFinite(to)||from<0||!(to>from))throw Error('DOMAIN_INTERVAL_INVALID');
    if(!solid||typeof solid.classify!=='function'||(!Array.isArray(solid.triangles)&&typeof solid.segmentCandidates!=='function'))throw Error('DOMAIN_INTERVAL_SOLID_INVALID');
    if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>0.05||!Number.isInteger(maxSegments)||maxSegments<1||maxSegments>200000||!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>30)throw Error('DOMAIN_INTERVAL_OPTIONS');
    const point=md=>{const p=curve.atMD(md);if(!p||![p.x,p.y,p.z].every(Number.isFinite))throw Error('DOMAIN_INTERVAL_TRACE_UNAVAILABLE');return [p.x,p.y,p.z];};
    const path=[];let maxDeviation=0;
    function refine(a,pa,b,pb,depth){
      const span=b-a,m=(a+b)/2,pm=point(m),chord=pa.map((v,i)=>(v+pb[i])/2),deviation=distance(pm,chord);
      // Quarter checks prevent an inflected minimum-curvature segment from passing
      // on midpoint agreement alone. Recursion retains these true trace samples.
      const q1=point(a+span/4),q3=point(a+3*span/4),c1=pa.map((v,i)=>v*.75+pb[i]*.25),c3=pa.map((v,i)=>v*.25+pb[i]*.75);
      const error=Math.max(deviation,distance(q1,c1),distance(q3,c3));
      if(error<=tolerance){maxDeviation=Math.max(maxDeviation,error);path.push({a,pa,b,pb});if(path.length>maxSegments)throw Error('DOMAIN_INTERVAL_BUDGET');return;}
      if(depth>=maxDepth)throw Error('DOMAIN_INTERVAL_TOLERANCE');
      refine(a,pa,m,pm,depth+1);refine(m,pm,b,pb,depth+1);
    }
    refine(from,point(from),to,point(to),0);
    const crossings=(a,b)=>{
      const d=b.map((v,i)=>v-a[i]),dd=d.reduce((s,v)=>s+v*v,0),hits=[];
      if(dd===0)return hits;
      const candidates=typeof solid.segmentCandidates==='function'?solid.segmentCandidates(a,b):solid.triangles;
      for(const tri of candidates){
        const [v0,v1,v2]=tri.p,e1=v1.map((v,i)=>v-v0[i]),e2=v2.map((v,i)=>v-v0[i]);
        const h=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*h[0]+e1[1]*h[1]+e1[2]*h[2];
        if(Math.abs(det)<=1e-12*Math.sqrt(dd))continue;
        const inv=1/det,s=a.map((v,i)=>v-v0[i]),u=inv*(s[0]*h[0]+s[1]*h[1]+s[2]*h[2]);
        if(u< -1e-9||u>1+1e-9)continue;
        const q=[s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]],v=inv*(d[0]*q[0]+d[1]*q[1]+d[2]*q[2]);
        if(v< -1e-9||u+v>1+1e-9)continue;
        const t=inv*(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2]);if(t>=-1e-9&&t<=1+1e-9)hits.push(Math.max(0,Math.min(1,t)));
      }
      return hits.sort((x,y)=>x-y).filter((x,i,all)=>!i||x-all[i-1]>1e-8);
    };
    const length={inside:0,outside:0,boundary:0},spans=[];
    const origin=Array.isArray(solid.origin)?solid.origin:[0,0,0];
    for(const seg of path){
      const localA=seg.pa.map((v,i)=>v-origin[i]),localB=seg.pb.map((v,i)=>v-origin[i]);
      // Endpoint hits within the existing skipped-cut epsilon must not retire
      // a declared MD endpoint by leaving a floating-point tail uncovered.
      const cuts=[0,...crossings(localA,localB).filter(t=>t>1e-12&&t<1-1e-12),1];
      for(let i=0;i+1<cuts.length;i++){
        const t0=cuts[i],t1=cuts[i+1];if(t1-t0<=1e-12)continue;
        const mid=(t0+t1)/2,p=seg.pa.map((v,k)=>v+(seg.pb[k]-v)*mid),state=solid.classify(p);
        if(!Object.hasOwn(length,state))throw Error('DOMAIN_INTERVAL_CLASSIFIER_INVALID');
        const entryMD=t0===0?seg.a:seg.a+(seg.b-seg.a)*t0,exitMD=t1===1?seg.b:seg.a+(seg.b-seg.a)*t1,supportLength=exitMD-entryMD;
        length[state]+=supportLength;
        const previous=spans.at(-1);
        if(previous&&previous.state===state&&Math.abs(previous.exitMD-entryMD)<=1e-9){previous.exitMD=exitMD;previous.supportLength+=supportLength;}
        else spans.push({state,entryMD,exitMD,supportLength});
      }
    }
    const epsilon=Math.max(1e-8,(to-from)*1e-9),inside=length.inside>epsilon,outside=length.outside>epsilon,boundary=length.boundary>epsilon;
    const status=inside&&outside?'crossing':boundary&&!inside&&!outside?'boundary':inside?'inside':outside?'outside':'ambiguous';
    return {status,from,to,supportLength:to-from,insideLength:length.inside,outsideLength:length.outside,boundaryLength:length.boundary,spans,
      traceLinearization:{method:'minimum-curvature adaptive chords',maxDeviationMetres:maxDeviation,toleranceMetres:tolerance,segments:path.length},
      boundaryPolicy:'boundary support is explicit and is not assigned inside or outside'};
  }
  // A measured interval has one ordered depth partition, even when several
  // reviewed solids were measured independently. Never concatenate their full
  // outside spans or mistake crossing adjacent domains for a spatial overlap.
  function partition(from,to,domains){
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||!Array.isArray(domains)||!domains.length)throw Error('DOMAIN_INTERVAL_PARTITION_INVALID');
    const ambiguous=()=>({status:'ambiguous',spans:[{state:'ambiguous',entryMD:from,exitMD:to,geologicalDomainId:'__AMBIGUOUS__'}]});
    if(domains.some(d=>d.status==='ambiguous'||!Array.isArray(d.spans)||!d.spans.length))return ambiguous();
    const codes=new Set(),cuts=new Set([from,to]);
    for(const d of domains){
      if(typeof d.code!=='string'||!d.code||codes.has(d.code))throw Error('DOMAIN_INTERVAL_PARTITION_INVALID');codes.add(d.code);
      let cursor=from;
      for(const s of d.spans){
        if(!['inside','outside','boundary'].includes(s.state)||s.entryMD!==cursor||!Number.isFinite(s.exitMD)||s.exitMD<=s.entryMD||s.exitMD>to)throw Error('DOMAIN_INTERVAL_PARTITION_INVALID');
        cuts.add(s.entryMD);cuts.add(s.exitMD);cursor=s.exitMD;
      }
      if(cursor!==to)throw Error('DOMAIN_INTERVAL_PARTITION_INVALID');
    }
    const points=[...cuts].sort((a,b)=>a-b),spans=[];
    for(let i=0;i+1<points.length;i++){
      const entryMD=points[i],exitMD=points[i+1];
      const states=domains.map(d=>({code:d.code,span:d.spans.find(s=>s.entryMD<=entryMD&&s.exitMD>=exitMD)}));
      if(states.some(s=>!s.span))throw Error('DOMAIN_INTERVAL_PARTITION_INVALID');
      const inside=states.filter(s=>s.span.state==='inside');
      const state=inside.length>1?'ambiguous':inside.length?'inside':states.some(s=>s.span.state==='boundary')?'boundary':'outside';
      const geologicalDomainId=state==='inside'?inside[0].code:state==='outside'?'__OUTSIDE__':state==='boundary'?'__BOUNDARY__':'__AMBIGUOUS__';
      const previous=spans.at(-1);
      if(previous?.state===state&&previous.geologicalDomainId===geologicalDomainId)previous.exitMD=exitMD;
      else spans.push({state,entryMD,exitMD,geologicalDomainId});
    }
    const inside=spans.filter(s=>s.state==='inside'),outside=spans.some(s=>s.state==='outside');
    const status=spans.some(s=>s.state==='ambiguous')?'ambiguous':inside.length&&(outside||new Set(inside.map(s=>s.geologicalDomainId)).size>1)?'crossing':
      inside.length?'inside':outside?'outside':'boundary';
    return {status,spans};
  }
  root.OrebitDomainIntervalMembership=Object.freeze({measure,partition});
})(typeof window==='undefined'?globalThis:window);
