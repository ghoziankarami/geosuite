// Domain S4 contacts: synthetic nickel laterite (limonite over saprolite over bedrock)
// with hand-derived contact depths, missing-data cases and a planar surface whose
// interpolated elevation is known exactly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({});
for(const name of ['primitives','contacts']) vm.runInContext(fs.readFileSync(path.join(root,`src/shared/geom/${name}.js`),'utf8'),ctx);
const c=ctx.OrebitDomainContacts;
let checks=0;
const ok=(cond,msg)=>{assert.ok(cond,msg);checks++;};
const close=(a,b,msg,tol=1e-9)=>ok(Math.abs(a-b)<=tol,`${msg}: ${a} != ${b}`);

// 5 x 5 vertical holes, 25 m apart, collars at z 100. Saprolite top depth is planar:
// d = 4 + 0.04 x + 0.02 y, so its elevation is z = 96 - 0.04 x - 0.02 y.
const rows=[];let k=0;
const P=(x,y,z)=>({x,y,z});
function hole(id,x,y,intervals){for(const [from,to,lith,ni] of intervals)rows.push({sourceIndex:k++,hole_id:id,from_m:String(from),to_m:String(to),lith,ni,start:P(x,y,100-from),end:P(x,y,100-to)});}
for(let i=0;i<5;i++)for(let j=0;j<5;j++){
  const x=i*25,y=j*25,d=4+0.04*x+0.02*y;
  hole(`H${i}${j}`,x,y,[[0,d,'LIM',0.9],[d,d+6,'SAP',1.6],[d+6,d+10,'BRK',0.2]]);
}
// Missing-data and edge cases away from the grid.
hole('UNLOGGED',200,0,[[0,2,null,null],[2,5,'LIM',0.8],[5,9,'SAP',1.5]]);   // unknown above the contact
hole('GAP',200,25,[[0,3,'LIM',0.8],[4,9,'SAP',1.5]]);                         // 3-4 m not sampled
hole('NOSAP',200,50,[[0,8,'LIM',0.8],[8,12,'BRK',0.1]]);                     // never reaches saprolite
hole('COLLAR',200,75,[[0,6,'SAP',1.4],[6,9,'BRK',0.1]]);                      // saprolite from the collar
hole('DEEP',200,100,[[0,5,'LIM',0.8],[5,9,'SAP',1.5]]);                       // ends in saprolite
hole('LATE',200,125,[[3,5,'LIM',0.8],[5,9,'SAP',1.5]]);                       // logging starts at 3 m
hole('BADXYZ',200,150,[[0,5,'LIM',0.8],[5,9,'SAP',1.5]]);rows.at(-1).start=null; // no desurveyed endpoint

const lith=r=>r.lith==null?null:r.lith==='SAP';
const top=c.pickContacts(rows,'first_from',lith),by=Object.fromEntries(top.map(p=>[p.hole,p]));
ok(top.length===32,'one pick per hole');
close(by.H00.depth,4,'H00 saprolite top depth');close(by.H00.point[2],96,'H00 saprolite top elevation');
close(by.H42.depth,4+0.04*100+0.02*50,'H42 saprolite top depth');
ok(by.UNLOGGED.status==='uncertain'&&by.UNLOGGED.reason==='unlogged-before-contact','an unlogged interval above the contact makes it uncertain');
ok(by.GAP.status==='uncertain','an unsampled gap above the contact makes it uncertain');
ok(by.NOSAP.status==='absent','a hole without saprolite is absent, not zero');
ok(by.COLLAR.status==='contact'&&by.COLLAR.depth===0&&by.COLLAR.atCollar===true,'saprolite from the collar is a contact flagged at the collar');
ok(by.LATE.status==='uncertain','logging that starts below the collar leaves the top uncertain');
ok(by.BADXYZ.status==='uncertain'&&by.BADXYZ.reason==='no-endpoint','a missing endpoint is reported, never guessed');

const base=c.pickContacts(rows,'last_to',lith),bb=Object.fromEntries(base.map(p=>[p.hole,p]));
close(bb.H00.depth,10,'H00 saprolite base depth');close(bb.H00.point[2],90,'H00 saprolite base elevation');
ok(bb.DEEP.status==='open'&&bb.DEEP.reason==='domain-reaches-end-of-hole','saprolite to the end of hole has no base');
ok(bb.COLLAR.status==='contact'&&bb.COLLAR.depth===6,'collar saprolite has a base at 6 m');

// Grade rule: Ni >= 1.2 %; a hole already in grade at its first sample has no crossing.
const grade=r=>Number.isFinite(r.ni)?r.ni>=1.2:null;
const gx=Object.fromEntries(c.pickContacts(rows,'grade_cross',grade).map(p=>[p.hole,p]));
close(gx.H11.depth,4+1+0.5,'H11 grade crossing depth');
ok(gx.COLLAR.status==='open'&&gx.COLLAR.reason==='starts-in-domain','grade from the first sample is not a crossing');
ok(gx.NOSAP.status==='absent','no interval reaches the threshold');

assert.throws(()=>c.pickContacts(rows,'middle',lith),/DOMAIN_CONTACT_RULE_INVALID/);checks++;

// Surface: 27 contacts (25 grid + COLLAR + DEEP); the default maxEdge is 2.5 x the 25 m spacing.
const s=c.contactSurface(top);
ok(s.status==='surface'&&s.used===27,'surface uses only the contact picks');
ok(s.counts.uncertain===4&&s.counts.absent===1,'excluded holes are counted by reason');
close(s.medianSpacing,25,'median nearest-neighbour spacing');
ok(s.maxEdge===62.5&&s.maxEdgeSource==='default','default maxEdge is 2.5 x spacing and recorded as default');
const g=ctx.OrebitGeometryPrimitives.prepareTIN(s.tin);
close(g.sample(37,61).z,96-0.04*37-0.02*61,'planar contact is reproduced inside the grid');
ok(g.sample(-10,50)===null,'no surface outside the data support');
// COLLAR and DEEP sit 100 m east of the grid: every edge reaching them exceeds 62.5 m.
ok(g.sample(150,75)===null,'no surface across the 100 m gap to an isolated hole');
const wide=c.contactSurface(top,{maxEdge:200});
ok(wide.maxEdge===200&&wide.maxEdgeSource==='user'&&wide.tin.triangles.length>s.tin.triangles.length,'a typed maxEdge is used and recorded');
assert.throws(()=>c.contactSurface(top,{maxEdge:-1}),/DOMAIN_SURFACE_MAXEDGE_INVALID/);checks++;
ok(c.contactSurface(top.slice(0,2)).status==='insufficient','fewer than 3 contacts give no surface');
// Two logged lenses must not become one first/last envelope through waste.
const separated=[[0,2,'LIM'],[2,4,'SAP'],[4,7,'BRK'],[7,10,'SAP'],[10,12,'BRK']].map(([from_m,to_m,lith],sourceIndex)=>
  ({hole_id:'LENSES',from_m,to_m,lith,sourceIndex,start:P(0,0,100-from_m),end:P(0,0,100-to_m)}));
for(const rule of c.RULES){
 const pick=c.pickContacts(separated,rule,lith)[0];
 ok(pick.status==='uncertain'&&pick.reason==='repeated-domain-intervals','separate logged bodies block '+rule);
 ok(JSON.stringify(pick.spans.map(p=>[p.from,p.to]))==='[[2,4],[7,10]]','exact target ranges retain intervening non-member support');
 const surface=c.contactSurface([...top,pick]);
 ok(surface.status==='ambiguous'&&!surface.tin&&surface.affected[0].hole==='LENSES','valid neighbours cannot hide a separated-body hole');
}
const gap=separated.filter(r=>r.lith!=='BRK');
const unknown=c.pickContacts(gap,'first_from',lith)[0];
ok(unknown.reason==='domain-support-gap','an unsampled internal gap cannot imply continuous target');
assert.throws(()=>c.pickContacts(separated,'first_from',()=>undefined),/DOMAIN_CONTACT_MEMBER_INVALID/);checks++;
const intervals=parts=>parts.map(([from_m,to_m,lith],sourceIndex)=>({hole_id:'OWNER_EXAMPLE',from_m,to_m,lith,sourceIndex,start:P(0,0,100-from_m),end:P(0,0,100-to_m)}));
const repeated=intervals([[0,1,'OVB'],[1,4,'SAP'],[4,6,'LIM'],[6,7,'SAP'],[7,8,'BRK']]);
for(const rule of ['first_from','last_to']){
 const pick=c.pickContacts(repeated,rule,lith)[0];
 ok(pick.reason==='repeated-domain-intervals'&&pick.depth===undefined&&JSON.stringify(pick.spans.map(s=>[s.from,s.to]))==='[[1,4],[6,7]]','SAP1–4/6–7 preserves two bodies and cannot supply an outermost '+rule+' contact');
}
const contiguous=intervals([[0,1,'OVB'],[1,4,'SAP'],[4,7,'SAP'],[7,8,'BRK']]);
ok(c.pickContacts(contiguous,'first_from',lith)[0].depth===1&&c.pickContacts(contiguous,'last_to',lith)[0].depth===7,'adjacent SAP logging rows form one continuous body with measured top1/base7');
console.log(`domain contacts S4: ${checks} known answers passed`);
