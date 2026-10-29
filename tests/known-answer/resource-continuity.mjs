#!/usr/bin/env node
// Execute the current production scan; compare exact sums with the independent
// materialized-pair reference and analytic along-strike fixtures.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const privatePath = new URL('../../../exe-wrapper/pywebview/phases/Resource.html', import.meta.url);
const path = fs.existsSync(privatePath) ? privatePath : new URL('../../phases/Resource.html', import.meta.url);
const source = fs.readFileSync(path, 'utf8');
const start = source.indexOf('async function computeDirectionalScan()');
const end = source.indexOf('\nasync function plotDirectionalScan()', start);
assert.ok(start > 0 && end > start);
const body = source.slice(start, end);
let checks = 0;
function reference(pool, step, tolerance, lag, maxH) {
  const pairs = [];
  for (let i=0; i<pool.length; i++) for (let j=i+1; j<pool.length; j++) {
    const dx=pool[j].x-pool[i].x, dy=pool[j].y-pool[i].y, h=Math.hypot(dx,dy);
    if (h===0 || h>maxH) continue;
    let az=Math.atan2(dx,dy)*180/Math.PI;
    if (az<0) az+=180;
    if (az>=180) az-=180;
    pairs.push({h,az,diffSq:(pool[j].v-pool[i].v)**2});
  }
  const nLag=Math.max(6,Math.min(30,Math.floor(maxH/lag))), results=[];
  for (let a=0; a<180; a+=step) {
    const bins=Array.from({length:nLag},()=>({sum:0,n:0}));
    for (const p of pairs) {
      let d=Math.abs(p.az-a);if(d>90)d=180-d;
      if(d>tolerance)continue;
      const b=Math.floor(p.h/lag);if(b>=nLag)continue;
      bins[b].sum+=p.diffSq;bins[b].n++;
    }
    const lags=[],gammas=[],npairs=[];
    bins.forEach((bin,b)=>{if(bin.n>=5){lags.push((b+.5)*lag);gammas.push(bin.sum/(2*bin.n));npairs.push(bin.n);}});
    results.push({azimuth:a,lags,gammas,npairs,totalPairs:npairs.reduce((a,b)=>a+b,0)});
  }
  return results;
}
async function scan(samples, parameters, cancel = false, mutateGuard = false) {
  const elements=Object.fromEntries(Object.entries(parameters).map(([key,value])=>[key,{value:String(value)}]));
  elements.dsStatus={innerHTML:''};elements.dsAdoptBtn={disabled:true};
  const context={ensurePlotly:async()=>{},getSamples:()=>samples,
    document:{getElementById:id=>elements[id]},variogramState:{directionalScan:{}},
    DATA:{rows:samples},setupState:{element:'synthetic',domain:'all'},gradeUnitFor:()=>'% ',currentTab:4,
    performance:cancel?{now:(()=>{let n=0;return()=>n+=14;})()}:performance,
    setTimeout:cancel?(fn=>{context.DATA={rows:[]};fn();}):setTimeout,t:()=> 'Inputs changed',
    plotDirectionalScan:async()=>{},_seededSubsample:(pool,n)=>pool.slice(0,n)};
  vm.createContext(context);vm.runInContext('let _directionalScanSequence=0;\n'+(mutateGuard?body.replaceAll('if (!current())','if (false)'):body),context);
  await context.computeDirectionalScan();
  return JSON.parse(JSON.stringify(context.variogramState.directionalScan));
}
let seed=91827;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for (let n of [30,61,147,300]) for (let step of [10,22.5,45]) {
  const samples=Array.from({length:n},(_,i)=>({x:Math.floor(random()*300),y:Math.floor(random()*300),v:i%7===0?0:random()*10}));
  // Include coincident observations and non-integer lags/tolerances.
  samples[1]={...samples[0],v:9};
  const lag=37.5, maxH=225, tolerance=step===10?5:22.5;
  const got=await scan(samples,{dsStep:step,dsTol:tolerance,dsLag:lag,dsMaxH:maxH});
  assert.deepEqual(got.results,reference(samples,step,tolerance,lag,maxH));checks++;
  assert.equal(got.samplesUsed,n);checks++;
}
const along=Array.from({length:60},(_,i)=>({x:i*10,y:0,v:i*2}));
const got=await scan(along,{dsStep:45,dsTol:5,dsLag:20,dsMaxH:100});
const east=got.results.find(r=>r.azimuth===90);
for (let b=0;b<6;b++) {
  let count=0,sum=0;
  for(let offset=1;offset<=10;offset++) if(Math.floor(offset*10/20)===b) {
    count+=60-offset;sum+=(60-offset)*(offset*2)**2;
  }
  assert.equal(east.npairs[b],count);checks++;
  assert.equal(east.gammas[b],sum/(2*count));checks++;
}
assert.equal(got.bestAzimuth,90);checks++;
const constant=await scan(along.map(p=>({...p,v:4})),{dsStep:45,dsTol:22.5,dsLag:20,dsMaxH:100});
assert.ok(constant.results.flatMap(r=>r.gammas).every(g=>g===0));checks++;
const insufficient=await scan(along.slice(0,29),{dsStep:45,dsTol:22.5,dsLag:20,dsMaxH:100});
assert.equal(insufficient.results,undefined);checks++;
const capped=await scan(Array.from({length:5001},(_,i)=>({x:i*10,y:0,v:i%11})),{dsStep:45,dsTol:22.5,dsLag:20,dsMaxH:100});
assert.equal(capped.samplesUsed,5000);checks++;
assert.equal(capped.results.find(r=>r.azimuth===90).npairs[0],4999);checks++;
for (const dsStep of [-10,Infinity,0,1,90]) {
  const invalid=await scan(along,{dsStep,dsTol:22.5,dsLag:20,dsMaxH:100});
  assert.equal(invalid.results,undefined);checks++;
}
for (const key of ['dsTol','dsLag','dsMaxH']) {
  const invalid=await scan(along,{dsStep:45,dsTol:22.5,dsLag:20,dsMaxH:100,[key]:0});
  assert.equal(invalid.results,undefined);checks++;
}
const changed=await scan(along,{dsStep:45,dsTol:22.5,dsLag:20,dsMaxH:100},true);
assert.equal(changed.results,undefined);checks++;
assert.equal(changed.lagSize,undefined);checks++;
const removedGuard=await scan(along,{dsStep:45,dsTol:22.5,dsLag:20,dsMaxH:100},true,true);
// Removing only the current-source guard must allow the stale result and fail
// the normal rejection assertion, proving the test reaches that race.
assert.notEqual(removedGuard.results,undefined);checks++;
const factoryStart=source.indexOf('function newResourceVariography()');
const factoryEnd=source.indexOf('// Static seed list',factoryStart);
assert.ok(factoryStart>0&&factoryEnd>factoryStart);
const resetContext=vm.createContext({});
vm.runInContext(source.slice(factoryStart,factoryEnd),resetContext);
for (const preserve of [false,true]) {
  vm.runInContext(`variogramState.experimental={lags:[1]};variogramState.model={nugget:99};
    variogramState.direction='EW';variogramState.variogramMap={z:[[99]]};
    variogramState.directionalScan={scanStep:10,tolHor:5,lagSize:30,maxDist:900,results:[{azimuth:90}],bestAzimuth:90};
    variogramState.downhole={lagSize:3,maxDist:80,lags:[1],gammas:[99],pairs:[10],suggestedNugget:99};
    variogramState.nestedModel={use2:true};resetResourceVariography(${preserve});`,resetContext);
  const reset=JSON.parse(vm.runInContext('JSON.stringify(variogramState)',resetContext));
  for(const value of [reset.experimental,reset.model,reset.variogramMap,reset.directionalScan.results,reset.downhole.lags,reset.downhole.gammas,reset.downhole.pairs]) {
    assert.equal(value,null);checks++;
  }
  assert.equal(reset.downhole.suggestedNugget,0);checks++;
  assert.equal(reset.nestedModel.use2,false);checks++;
  assert.equal(reset.directionalScan.scanStep,preserve?10:22.5);checks++;
  assert.equal(reset.direction,preserve?'EW':'omni');checks++;
}

// The main E-W/N-S calculator must treat a sample pair as an undirected axis.
// A dot-product reference avoids copying its angular normalization. Reordering
// or reflecting the same observations cannot change directional pair support.
const mainStart=source.indexOf('async function computeVariogram()');
const mainEnd=source.indexOf('\nasync function autoFitVariogram(',mainStart);
assert.ok(mainStart>0&&mainEnd>mainStart);
async function mainExperimental(pool,direction,tolerance){
  const cols=['midx','midy','midz','ni_pct','hole_id'];
  const rows=pool.map(p=>[p.x,p.y,100,p.v,p.id]);
  const elements={varDir:{value:direction},varLag:{value:'20'},varN:{value:'10'},
    varTol:{value:String(tolerance)},varMaxH:{value:'200'},varStatus:{innerHTML:''}};
  const context={DATA:{rows,cols},setupState:{element:'ni_pct',domain:'all'},
    rowsFiltered:()=>rows,colIdx:key=>cols.indexOf(key),asNum:x=>Number.isFinite(x)?x:null,
    document:{getElementById:id=>elements[id]},variogramState:{},ensurePlotly:async()=>{},
    clearVariogramSamplingIssue:()=>{},setVariogramSamplingIssue:()=>{},
    autoFitVariogram:()=>{},plotVariogram:async()=>{},t:key=>key};
  vm.createContext(context);vm.runInContext(source.slice(mainStart,mainEnd),context);
  await context.computeVariogram();
  return JSON.parse(JSON.stringify(context.variogramState.experimental));
}
function mainReference(pool,direction,tolerance){
  const bins=Array.from({length:10},()=>({sum:0,n:0}));let totalPairs=0;
  const cos=Math.cos(tolerance*Math.PI/180);
  for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
    const dx=pool[j].x-pool[i].x,dy=pool[j].y-pool[i].y,h=Math.hypot(dx,dy);
    if(!h||h>200)continue;
    const projection=direction==='EW'?Math.abs(dx):Math.abs(dy);
    if(direction!=='omni'&&projection<cos*h)continue;
    const bin=Math.floor(h/20);if(bin>=bins.length)continue;
    bins[bin].n++;bins[bin].sum+=(pool[j].v-pool[i].v)**2;totalPairs++;
  }
  const kept=bins.map((b,i)=>({...b,lag:(i+.5)*20})).filter(b=>b.n>=5);
  return {totalPairs,lags:kept.map(b=>b.lag),pairs:kept.map(b=>b.n),gammas:kept.map(b=>b.sum/(2*b.n))};
}
const grid=Array.from({length:64},(_,i)=>({x:(i%8)*20,y:Math.floor(i/8)*20,v:1+(i%8+2*Math.floor(i/8))/50,id:'H'+i}));
for(const tolerance of [5,22.5])for(const direction of ['EW','NS','omni']){
  let baseline;
  for(const pool of [grid,[...grid].reverse(),grid.map(p=>({...p,x:-p.x})),grid.map(p=>({...p,y:-p.y})),grid.map(p=>({...p,x:p.x+700000,y:p.y+9800000}))]){
    const actual=await mainExperimental(pool,direction,tolerance),expected=mainReference(pool,direction,tolerance);
    assert.deepEqual(actual.pairs,expected.pairs,`${direction}: axial pair counts must match independent dot-product support`);checks++;
    assert.deepEqual(actual.lags,expected.lags);checks++;
    assert.equal(actual.totalPairs,expected.totalPairs);checks++;
    actual.gammas.forEach((value,i)=>{assert.ok(Math.abs(value-expected.gammas[i])<1e-12,`${direction}: independent semivariance`);checks++;});
    if(baseline){
      assert.deepEqual(actual.pairs,baseline.pairs,`${direction}: row order/reflection/translation preserve support`);checks++;
      actual.gammas.forEach((value,i)=>{assert.ok(Math.abs(value-baseline.gammas[i])<1e-12);checks++;});
    }else baseline=actual;
  }
}
console.log(`RESOURCE CONTINUITY: ${checks} exact/reference checks passed`);
