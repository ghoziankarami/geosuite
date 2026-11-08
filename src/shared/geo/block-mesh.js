/* Pure regular-grid display geometry. No resource calculation or population mutation. */
function _blockMeshTrace(xs, ys, zs, cs, bx, by, bz, colorOpts, surface=false, hoverTexts=null) {
 const vx = [], vy = [], vz = [], intensity = [], ii = [], jj = [], kk = [], text=[];
 // Cull shared internal faces on the regular block grid. Full filtered geometry stays connected;
 // neither the display limit nor hidden interior faces change resource populations or tonnage.
 const key=(x,y,z)=>[Math.round((x-xs[0])/bx),Math.round((y-ys[0])/by),Math.round((z-zs[0])/bz)].join(':');
 const cells=surface?new Set(xs.map((x,n)=>key(x,ys[n],zs[n]))):null;
 const neighbors=[[0,0,-bz],[0,0,bz],[0,-by,0],[0,by,0],[-bx,0,0],[bx,0,0]];
 let faceCount=0;
 if(surface){for(let n=0;n<xs.length;n++)for(const [dx,dy,dz] of neighbors)if(!cells.has(key(xs[n]+dx,ys[n]+dy,zs[n]+dz)))faceCount++;
   // Explicit bounded fallback to individual sampled blocks on unusually fragmented large grids.
   if(faceCount>120000)return null;
 }
 const faces = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[2,6,7],[2,7,3],[0,4,7],[0,7,3],[1,5,6],[1,6,2]];
 for (let n = 0; n < xs.length; n++) {
  const x = xs[n], y = ys[n], z = zs[n], hx = bx/2, hy = by/2, hz = bz/2;
  const exposed=neighbors.map(([dx,dy,dz])=>!surface||!cells.has(key(x+dx,y+dy,z+dz)));
  if(!exposed.some(Boolean))continue;
  const o=vx.length;
  [[x-hx,y-hy,z-hz],[x+hx,y-hy,z-hz],[x+hx,y+hy,z-hz],[x-hx,y+hy,z-hz],[x-hx,y-hy,z+hz],[x+hx,y-hy,z+hz],[x+hx,y+hy,z+hz],[x-hx,y+hy,z+hz]].forEach(p => { vx.push(p[0]); vy.push(p[1]); vz.push(p[2]); intensity.push(cs[n]);text.push(hoverTexts?.[n]||''); });
  for (let j=0;j<faces.length;j++) {if(!exposed[Math.floor(j/2)])continue;const f=faces[j]; ii.push(o+f[0]); jj.push(o+f[1]); kk.push(o+f[2]); }
 }
 return {type:'mesh3d',x:vx,y:vy,z:vz,i:ii,j:jj,k:kk,intensity,colorscale:colorOpts.colorscale,cmin:colorOpts.cmin,cmax:colorOpts.cmax,showscale:true,flatshading:true,opacity:1,colorbar:colorOpts.colorbar,text,hoverinfo:hoverTexts?'text':'skip',lighting:{ambient:0.65,diffuse:0.75,roughness:0.8,specular:0.05}};
}
