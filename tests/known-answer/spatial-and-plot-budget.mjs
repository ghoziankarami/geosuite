import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const context=vm.createContext({console});
for(const name of ['spatial-index','plot-sampling'])vm.runInContext(fs.readFileSync(path.join(root,'src/shared/geo',name+'.js'),'utf8'),context);
const spatial=context.OrebitSpatial, plot=context.OrebitPlotSampling;
const plain=value=>JSON.parse(JSON.stringify(value));
const points=Array.from({length:180},(_,i)=>({x:392000+(i%13)*17.3,y:9558000+Math.floor(i/13)*11.9,id:i}));
points.push({...points[0],id:180});
const before=JSON.stringify(points),index=spatial.createIndex(points);
for(let q=0;q<40;q++){
 const x=392000+(q%8)*12.7,y=9558000+(q%11)*13.4;
 const expected=points.map((point,order)=>({point,order,distanceSquared:(x-point.x)**2+(y-point.y)**2})).sort((a,b)=>a.distanceSquared-b.distanceSquared||a.order-b.order).slice(0,5);
 assert.deepEqual(plain(spatial.nearest(index,x,y,5)),expected);
}
assert.equal(spatial.nearest(index,points[0].x,points[0].y,1,0)[0].point.id,180);
assert.equal(JSON.stringify(points),before);
assert.equal(spatial.nearest(spatial.createIndex([]),0,0).length,0);
assert.throws(()=>spatial.createIndex([{x:Infinity,y:0}]),/finite/);
const trace={type:'scatter',mode:'markers',x:Array.from({length:12000},(_,i)=>i),y:Array.from({length:12000},(_,i)=>Math.sin(i)),customdata:Array.from({length:12000},(_,i)=>'row-'+i),marker:{size:Array.from({length:12000},(_,i)=>i+1),color:'teal'}};
trace.y[333]=999;trace.y[444]=-999;
const original=JSON.stringify(trace),sample=plot.sampleTrace(trace);
assert.ok(sample.x.length<=2500);assert.equal(sample.x[0],0);assert.equal(sample.x.at(-1),11999);
assert.ok(sample.x.includes(333)&&sample.x.includes(444));
for(let i=0;i<sample.x.length;i++){assert.equal(sample.customdata[i],'row-'+sample.x[i]);assert.equal(sample.marker.size[i],sample.x[i]+1);assert.equal(sample.y[i],trace.y[sample.x[i]]);}
assert.equal(JSON.stringify(trace),original);
const box={type:'box',x:trace.x};assert.equal(plot.sampleTrace(box),box);
const small={type:'scatter',x:[0,1],y:[1,2]};assert.equal(plot.sampleTrace(small),small);
console.log('Exact spatial neighbours match 40 independent full scans; display samples preserve aligned extrema and original populations.');
