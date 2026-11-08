// P4.03: exact source population accounting and separated review roles.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const ctx=vm.createContext({});
vm.runInContext(readFileSync(fileURLToPath(new URL((existsSync(fileURLToPath(new URL('../../../package.json',import.meta.url))) ? '../../../src/' : '../../src/')+'shared/geostat/estimation-spec.js',import.meta.url)),'utf8'),ctx);
const owner=ctx.OrebitEstimationSpec;let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const parents=['assay:0:H1:0:10','assay:1:H1:10:20','assay:2:H1:20:30'];
const membershipByParent={
 [parents[0]]:{status:'inside',spans:[{state:'inside',entryMD:0,exitMD:10,geologicalDomainId:'SAP'}]},
 [parents[1]]:{status:'crossing',spans:[{state:'inside',entryMD:10,exitMD:14,geologicalDomainId:'SAP'},{state:'inside',entryMD:14,exitMD:20,geologicalDomainId:'LIM'}]},
 [parents[2]]:{status:'outside',spans:[{state:'outside',entryMD:20,exitMD:30}]}};
const current={sourceRevision:'source-7',geologicalRevision:'geo-3',membershipRevision:'a'.repeat(64),geologicalDomainIds:['SAP','LIM'],membershipByParent,parentObservationIds:parents};
const spec={schema:'orebit-estimation-spec',version:1,sourceRevision:'source-7',geologicalRevision:'geo-3',membershipRevision:current.membershipRevision,roles:{source:'assay-source',statistical:'reviewed-statistical-population',geological:'accepted-geological-membership',estimation:'approved-estimation-population'},elements:[{elementId:'Ni',unit:'%',populationId:'SAP-NI',geologicalDomainIds:['SAP'],boundaryPolicy:'hard',boundaryReason:'Accepted SAP boundary',reviewReason:'Single current SAP estimation population',decisions:[
  {parentObservationId:parents[0],statisticalPopulationId:'Ni-SAP',geologicalMembership:['SAP'],membershipStatus:'inside',action:'retain',reason:'Inside accepted SAP'},
  {parentObservationId:parents[1],statisticalPopulationId:'Ni-boundary',geologicalMembership:['SAP','LIM'],membershipStatus:'crossing',action:'split',support:{fromMD:10,toMD:20},parts:[{fromMD:10,toMD:14,geologicalDomainId:'SAP'},{fromMD:14,toMD:20,geologicalDomainId:'LIM'}],reason:'Measured boundary crossing'},
  {parentObservationId:parents[2],statisticalPopulationId:'Ni-LIM',geologicalMembership:[],membershipStatus:'outside',action:'reject',reason:'Outside selected estimation population'}
]}]};
ok(owner.validate(spec,current).ok,'Well-formed per-element source/statistical/geological/estimation roles are distinct and valid');
const unmeasured={...current,membershipByParent:{}};
ok(owner.validate(spec,unmeasured).findings.includes('PARENT_MEMBERSHIP_MISSING'),'An approval without one measured membership decision for every parent is rejected');
const hardCrossing=structuredClone(spec);hardCrossing.elements[0].decisions[1].action='retain';
ok(owner.validate(hardCrossing,current).findings.includes('HARD_BOUNDARY_DECISION_REQUIRED'),'Hard boundaries require an explicit support split or rejection');
const wrongGeology=structuredClone(spec);wrongGeology.elements[0].decisions[0].geologicalMembership=['UNREVIEWED'];
ok(owner.validate(wrongGeology,current).findings.includes('GEOLOGICAL_DOMAIN_UNKNOWN'),'A decision cannot invent a geological domain absent from the accepted revision');
const approved=owner.approve(spec,current,{reviewer:'reviewer-1',reason:'Reviewed synthetic population'});
ok(owner.readiness(approved,current).status==='approved','Approved spec is current for the exact source and geology revision');
assert.throws(()=>{approved.elements[0].decisions[0].action='reject';});checks++;
const tampered=structuredClone(approved);tampered.elements[0].decisions[0].reason='';
ok(owner.readiness(tampered,current).status==='invalid','A mutable/tampered persisted approval is rejected on restore readiness');
ok(approved.sourceObservationIds.length===3,'All original observations stay parent IDs; split parts do not create assay observations');
const splitGap=structuredClone(spec);splitGap.elements[0].decisions[1].parts[0].toMD=13;
ok(owner.validate(splitGap,current).findings.includes('SPLIT_SUPPORT_INVALID'),'A split with a support gap is rejected');
const missing=structuredClone(spec);missing.elements[0].decisions.pop();
ok(owner.validate(missing,current).findings.includes('SOURCE_POPULATION_NOT_ACCOUNTED'),'An undecided source observation cannot silently disappear from reviewed scope');
const merge=structuredClone(spec);merge.elements[0].decisions=[
 {parentObservationId:parents[0],statisticalPopulationId:'s',geologicalMembership:['SAP'],membershipStatus:'inside',action:'merge',parents:[parents[0],parents[1]],targetPopulationId:'Ni-SAP',reason:'Same accepted estimation population'},
 {parentObservationId:parents[1],statisticalPopulationId:'s',geologicalMembership:['SAP','LIM'],membershipStatus:'crossing',action:'merge',parents:[parents[0],parents[1]],targetPopulationId:'Ni-SAP',reason:'Soft boundary accepted by review'},
 {parentObservationId:parents[2],statisticalPopulationId:'s',geologicalMembership:[],membershipStatus:'outside',action:'reject',reason:'Outside selected population'}];merge.elements[0].boundaryPolicy='soft';merge.elements[0].boundaryReason='Retain measured soft-boundary support';
ok(owner.validate(merge,current).ok,'Merge retains and cross-references every contributing parent');
const badMerge=structuredClone(merge);badMerge.elements[0].decisions[1].action='retain';
ok(owner.validate(badMerge,current).findings.includes('MERGE_PARENT_DECISION_MISSING'),'Merge cannot omit a parent decision');
const noReason=structuredClone(spec);noReason.elements[0].decisions[2].reason='';
ok(owner.validate(noReason,current).findings.includes('DECISION_REASON_REQUIRED'),'Every split/retain/reject decision requires its reason');
const noBoundary=structuredClone(spec);noBoundary.elements[0].boundaryReason='';
ok(owner.validate(noBoundary,current).findings.includes('BOUNDARY_REASON_REQUIRED'),'Hard boundary requires an explicit policy reason');
ok(owner.readiness(approved,{...current,sourceRevision:'source-8'}).reason==='SOURCE_REVISION_STALE','Source revision changes stale the approved spec');
ok(owner.readiness(approved,{...current,geologicalRevision:'geo-4'}).reason==='GEOLOGICAL_REVISION_STALE','Accepted geology changes stale the approved spec');
ok(owner.readiness(approved,{...current,membershipRevision:'b'.repeat(64)}).reason==='MEMBERSHIP_REVISION_STALE','Measured interval membership changes stale the approved spec');
ok(owner.readiness(approved,{...current,parentObservationIds:parents.slice(0,2)}).reason==='SOURCE_POPULATION_CHANGED','Changing source parent population stales the spec');
const preparationSource={revision:'source-7',columns:['hole_id','from_m','to_m','Ni'],rows:[['H1',0,10,1],['H1',10,20,3],['H1',20,30,9]],parentObservationIds:parents};
const preparationMembership={sourceRevision:'source-7',geologicalRevision:'geo-3',revision:current.membershipRevision,intervals:parents.map(parentObservationId=>({parentObservationId,...current.membershipByParent[parentObservationId]}))};
const prepared=owner.prepareComposites(preparationSource,preparationMembership,approved,{length:4,minimumLength:1});
ok(prepared.prepared.length===2&&prepared.prepared[1].fromMD===10&&prepared.prepared[1].toMD===14&&prepared.prepared[1].geologicalDomainId==='SAP','Hard-boundary preparation clips the crossing parent to the accepted four-metre domain support');
ok(prepared.prepared.map(row=>row.supportLength).reduce((a,b)=>a+b,0)===14&&prepared.prepared[1].gradeSupport.Ni.weightedValue===12&&prepared.counts.retainedParents===2,'Prepared hard-boundary support and grade-length are conserved without creating a new parent observation');
const boundarySource={revision:'boundary-source',columns:['hole_id','from_m','to_m','Ni'],rows:[['H10',0,10,2]],parentObservationIds:['parent-10m']};
const boundaryPrepared={schema:'orebit-prepared-composites',sourceRevision:'boundary-source',membershipRevision:current.membershipRevision,
 compositeSpec:{length:10,minimumLength:1},prepared:[
  {sourceRowIndex:0,holeId:'H10',parentObservationId:'parent-10m',fromMD:0,toMD:4,supportLength:4,geologicalDomainId:'SAP',gradeSupport:{Ni:{grade:2,supportLength:4,weightedValue:8}}},
  {sourceRowIndex:0,holeId:'H10',parentObservationId:'parent-10m',fromMD:4,toMD:10,supportLength:6,geologicalDomainId:'LIM',gradeSupport:{Ni:{grade:2,supportLength:6,weightedValue:12}}}
 ]};
const boundaryComposites=owner.aggregatePreparedComposites(boundarySource,boundaryPrepared);
ok(boundaryComposites.composites.length===2&&boundaryComposites.composites[0].supportLength===4&&boundaryComposites.composites[1].supportLength===6&&boundaryComposites.counts.supportLength===10,'Actual prepared aggregation keeps a 10 m parent as independent 4 m and 6 m domain composites');
ok(boundaryComposites.composites.every(c=>c.parentObservationIds[0]==='parent-10m'&&c.grades.Ni.weightedValue===c.supportLength*2&&c.parentContributions[0].elements.Ni.weightedValue===c.supportLength*2&&c.coordinateStatus==='unavailable-within-measured-stations'),'Hard-boundary aggregation conserves per-parent grade-length and declares unsupported coordinates unusable');
assert.throws(()=>owner.aggregatePreparedComposites(boundarySource,{...boundaryPrepared,sourceRevision:'stale'}),/PREPARATION_SOURCE_STALE/);checks++;
assert.throws(()=>owner.prepareComposites(preparationSource,preparationMembership,{...approved,status:'draft'},{length:4,minimumLength:1}),/ESTIMATION_SPEC_NOT_CURRENT/);checks++;
assert.throws(()=>owner.prepareComposites(preparationSource,{...preparationMembership,sourceRevision:'source-8'},approved,{length:4,minimumLength:1}),/MEMBERSHIP_REVISION_MISMATCH/);checks++;
const aborted={aborted:true};assert.throws(()=>owner.prepareComposites(preparationSource,preparationMembership,approved,{length:4,minimumLength:1},aborted),/PREPARATION_ABORTED/);checks++;
assert.throws(()=>owner.approve(spec,current,{reviewer:'',reason:'x'}),/ESTIMATION_REVIEW_REQUIRED/);checks++;
console.log(`estimation specification P4.03/P4.04 preparation: ${checks} checks passed`);
