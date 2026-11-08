/* Display-only reduction. Calculations, exports and original traces stay intact. */
(function (root) {
  'use strict';
  function sampleTrace(trace, limit = 2500) {
    const n=trace.x?.length;
    if(trace.type!=='scatter'||!Array.isArray(trace.x)||!Array.isArray(trace.y)||trace.y.length!==n||n<=limit)return trace;
    if(!Number.isInteger(limit)||limit<8)throw new Error('Invalid plot point budget');
    const selected=new Set([0,n-1]);
    // Preserve spatial/grade extrema as well as a deterministic spread of ranks.
    for(const field of [trace.x,trace.y]){
      let lo=-1,hi=-1;
      field.forEach((v,i)=>{if(Number.isFinite(v)){if(lo<0||v<field[lo])lo=i;if(hi<0||v>field[hi])hi=i;}});
      if(lo>=0)selected.add(lo);if(hi>=0)selected.add(hi);
    }
    const budget=limit-selected.size;
    for(let i=0;i<budget;i++)selected.add(Math.floor((i+1)*(n-1)/(budget+1)));
    const indexes=[...selected].sort((a,b)=>a-b);
    const pick=value=>Array.isArray(value)&&value.length===n?indexes.map(i=>value[i]):value;
    const copy={...trace};
    for(const key of ['x','y','z','customdata','text','ids'])if(key in copy)copy[key]=pick(copy[key]);
    if(trace.marker){copy.marker={...trace.marker};for(const key of ['size','color','opacity'])if(key in copy.marker)copy.marker[key]=pick(copy.marker[key]);}
    return copy;
  }
  root.OrebitPlotSampling=Object.freeze({sampleTrace});
})(typeof window==='undefined'?globalThis:window);
