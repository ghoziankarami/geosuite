import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';

const base=existsSync(new URL('../../../src/shared/io/project-capsule.js',import.meta.url))?'../../../':'../../';
const columns = readFileSync(new URL(base+'src/shared/io/columns.js', import.meta.url), 'utf8');
const capsule = readFileSync(new URL(base+'src/shared/io/project-capsule.js', import.meta.url), 'utf8');
const sandbox = { crypto: webcrypto, TextEncoder, console };
runInNewContext(columns + '\n' + capsule + '\nglobalThis.api={createProjectHandoffContext,validateProjectHandoffContext,validateProjectParentContext,sealProjectCapsule,validateProjectCapsule,createCoreHandoffContext,validateCoreHandoffContext,createAssayEDAReference,validateAssayEDAReference,compactAssayEDAReference,createAssayCheckpointReturn,validateAssayCheckpointReturn,reviewedGeologicalSnapshot,_opcAssayReferenceDigest,_opcCompactDomainMeasurements,_opcDomainMeasurements};', sandbox);
const { sealProjectCapsule, validateProjectCapsule, createCoreHandoffContext, validateCoreHandoffContext, createAssayEDAReference, validateAssayEDAReference, compactAssayEDAReference, createAssayCheckpointReturn, validateAssayCheckpointReturn } = sandbox.api;
let passed = 0;
function check(ok, message) { if (!ok) throw new Error(message); passed++; console.log('PASS', message); }
async function rejects(promise, code, message) {
  try { await promise; } catch (error) { check(error.code === code, message + ': ' + error.code); return; }
  check(false, message + ': accepted');
}

const core = {
  schema: 'orebit-project', schemaVersion: 3, sourcePhase: 'Core', name: 'legacy core',
  phase1: {
    collar_csv: 'hole_id,x,y,z,depth\nH1,10,20,30,40\n',
    survey_csv: 'hole_id,depth,dip,azimuth\nH1,0,-90,0\n',
    assay_csv: 'hole_id,from_m,to_m,ni_pct\nH1,0,1,1.2\n',
    geology_csv: 'hole_id,from_m,to_m,lithology\nH1,0,1,SAP\n',
  },
};
await sealProjectCapsule(core);
const valid = await validateProjectCapsule(core);
check(!valid.legacy && valid.revision === core.sourceCapsule.revision, 'Core tables seal and validate with a content revision');
check(core.sourceCapsule.sources.length === 4 && core.schemaVersion === 4, 'New Core capsule declares all source table roles and current version');
const modified = structuredClone(core); modified.phase1.collar_csv = modified.phase1.collar_csv.replace('10,20', '11,20');
await rejects(validateProjectCapsule(modified), 'PROJECT_SOURCE_REVISION_MISMATCH:collar', 'Modified source is rejected by its role revision');
const missingRole = structuredClone(core); missingRole.sourceCapsule.sources.pop();
await rejects(validateProjectCapsule(missingRole), 'PROJECT_SOURCE_ROLES_INVALID', 'Missing source role is rejected');
const wrongRevision = structuredClone(core); wrongRevision.sourceCapsule.revision = '0'.repeat(64);
await rejects(validateProjectCapsule(wrongRevision), 'PROJECT_CAPSULE_REVISION_MISMATCH', 'Modified capsule revision is rejected');
await rejects(validateProjectCapsule({ schema: 'orebit-project', schemaVersion: 4, sourcePhase: 'Core', phase1: core.phase1 }), 'PROJECT_CAPSULE_MISSING', 'Current schema cannot omit its capsule');
await rejects(validateProjectCapsule({ schema: 'orebit-project', schemaVersion: 99 }), 'PROJECT_SCHEMA_UNSUPPORTED', 'Unknown future schema is rejected');
check((await validateProjectCapsule({ schema: 'orebit-project', schemaVersion: 2, sourcePhase: 'Core', phase1: core.phase1 })).legacy,
  'Legacy Core projects remain readable for additive migration');

const assay = { schema: 'orebit-project', schemaVersion: 2, sourcePhase: 'Assay', data: {
  cols: ['hole_id', 'from_m', 'to_m', 'ni_pct'], rows: [['H1', 0, 1, 1.2]],
}};
await sealProjectCapsule(assay);
check(!(await validateProjectCapsule(assay)).legacy, 'Standalone Assay data seals and validates');
core.metadata = { crs: 'EPSG:32750', units: { ni_pct: '%' }, audit: { validationScope: { excluded: [] } } };
const handoffText = '# orebit-schema=v1 source=phase1-core\nhole_id,ni_pct\nH1,1.2\n';
const parent = await createCoreHandoffContext(core, 'drillhole-clean.csv', handoffText);
check((await validateCoreHandoffContext(parent, 'drillhole-clean.csv', handoffText)).project.sourcePhase === 'Core', 'Core context binds source capsule, metadata and exact handoff text');
const downstream = { schema: 'orebit-project', schemaVersion: 3, sourcePhase: 'Assay', data: assay.data, parentContexts: [parent] };
await sealProjectCapsule(downstream);
check(downstream.sourceCapsule.parents.length === 1 && (await validateProjectCapsule(downstream)).revision === downstream.sourceCapsule.revision,
  'Assay capsule records and validates the Core parent revision');
const changedExport = structuredClone(parent); changedExport.export.text += 'H2,2\n';
await rejects(validateCoreHandoffContext(changedExport, 'drillhole-clean.csv', handoffText), 'PROJECT_PARENT_CONTEXT_REVISION_MISMATCH', 'Changed parent export is rejected before activation');
const badParent = structuredClone(downstream); badParent.parentContexts[0].project.metadata.units.ni_pct = 'ppm';
await rejects(validateProjectCapsule(badParent), 'PROJECT_PARENT_CONTEXT_REVISION_MISMATCH', 'Tampered parent units are rejected');
const returnedData={cols:['hole_id','from_m','to_m','ni_pct','domain'],units:{ni_pct:'%'},rows:[['H1',0,1,1.2,'raw SAP']]};
const reference = await createAssayEDAReference([parent], returnedData,
  {schema:'orebit-assay-interpretation',version:1,dataset:{name:'Core handoff',rows:1,columns:returnedData.cols},stages:[]},
  {audit:{method:'reviewed proposal',element:'ni_pct'},labels:['candidate M1']}, ['raw SAP']);
check((await validateAssayEDAReference(reference)).proposal.intervals[0].sourceLabel === 'raw SAP', 'EDA reference retains original labels/endpoints with the Core parent revision');
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const mesh={f:[[0,2,1],[0,1,3],[1,2,3],[2,0,3]],v:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]]},inputs={material:{density:1.6,source:'Core declared material',unit:'t/m3'},rules:{method:'section-loft'}};
const sourceHash=digest('synthetic protocol source'),inputsHash=digest(inputs),meshHash=digest(mesh);
const review={at:'2026-10-20T00:00:00Z',code:'SAP',inputsHash,meshHash,reason:'Synthetic tetrahedron inspection',reviewer:'Protocol fixture reviewer',sourceHash,volume:1/6};
const geologicalDomain={schemaVersion:1,source:{sha256:sourceHash},crs:{kind:'local',units:'m'},domains:[{code:'SAP',density:1.6,build:{mesh,volume:1/6,inputs,inputsHash,meshHash,review,reviewHash:digest(review),stale:false,validation:Object.fromEntries(['topology','selfIntersection','topography','surfaceCrossings','overlap','honouring','geologistReview'].map(k=>[k,true]))}}],handoff:{from:'Core',readiness:'validated',volume:1/6}};
const regeneratedExport=await createCoreHandoffContext(core,'drillhole-clean.csv',handoffText+'# generated at a later time\n');
await rejects(createAssayCheckpointReturn(reference,regeneratedExport,{schemaVersion:1,domains:[{code:'SAP'}],handoff:{readiness:'validated'}}),'ASSAY_CHECKPOINT_RETURN_GEOLOGY_NOT_VALIDATED','A reviewed flag without geometry/reviewer/bindings is not an accepted geological return');
const verifiedSnapshot=await sandbox.api.reviewedGeologicalSnapshot(geologicalDomain);
check(Object.isFrozen(verifiedSnapshot.domains[0].build.mesh.v[0])&&!Object.isFrozen(geologicalDomain),
  'Receiver owns a recursively immutable clone without freezing the caller packet');
for(const [name,mutate] of [
  ['legacy review',b=>delete b.review],['review rationale',b=>b.review.reason='changed'],
  ['review digest',b=>b.reviewHash='0'.repeat(64)],['mesh coordinates',b=>b.mesh.v[1][0]=2],
  ['input rules',b=>b.inputs.rules.method='changed'],['domain identity',b=>b.review.code='LIM'],
  ['volume',b=>b.volume=2],['empty mesh',b=>b.mesh.v=[]],
]){
  const packet=structuredClone(geologicalDomain);mutate(packet.domains[0].build);
  check(await sandbox.api.reviewedGeologicalSnapshot(packet)===null,'Receiver rejects changed '+name);
  await rejects(createAssayCheckpointReturn(reference,regeneratedExport,packet),
    'ASSAY_CHECKPOINT_RETURN_GEOLOGY_NOT_VALIDATED','Producer rejects changed '+name);
}
const changedDensity=structuredClone(geologicalDomain);changedDensity.domains[0].density=2;
check(await sandbox.api.reviewedGeologicalSnapshot(changedDensity)===null,'Receiver rejects density detached from reviewed material inputs');
const checkpointReturn=await createAssayCheckpointReturn(reference,regeneratedExport,geologicalDomain);
check((await validateAssayCheckpointReturn(checkpointReturn)).source.exportRevision===reference.source.exportRevision,
  'Checkpoint return retains Assay’s exact prior export binding while allowing a regenerated Core watermark');
const changedReturn=structuredClone(checkpointReturn);changedReturn.geologicalDomain.domains[0].code='changed';
await rejects(validateAssayCheckpointReturn(changedReturn),'ASSAY_CHECKPOINT_RETURN_REVISION_MISMATCH','Changed returned geology fails its bound revision');
const returnedProject={schema:'orebit-project',schemaVersion:3,sourcePhase:'Assay',data:{cols:returnedData.cols,rows:returnedData.rows},
  parentContexts:[parent],assayCheckpointReturn:checkpointReturn};
await sealProjectCapsule(returnedProject);
check((await validateProjectCapsule(returnedProject)).sourcePhase==='Assay','Assay bundle seals its verified Core checkpoint return for save/reopen');
const changedSavedReturn=structuredClone(returnedProject);changedSavedReturn.assayCheckpointReturn.geologicalDomain.domains[0].code='tampered';
await rejects(validateProjectCapsule(changedSavedReturn),'ASSAY_CHECKPOINT_RETURN_REVISION_MISMATCH','Tampered saved return fails capsule preflight');
const changedProposal = structuredClone(reference); changedProposal.proposal.intervals[0].candidateLabel = 'changed';
await rejects(validateAssayEDAReference(changedProposal), 'EDA_REFERENCE_REVISION_MISMATCH', 'Tampered candidate proposal is rejected');
const badInterval = structuredClone(reference); badInterval.proposal.intervals[0].to = -1; badInterval.revision = await sandbox.api._opcAssayReferenceDigest(badInterval);
await rejects(validateAssayEDAReference(badInterval), 'EDA_REFERENCE_INTERVAL_INVALID', 'Invalid raw interval endpoints are rejected');
const compact = await compactAssayEDAReference(reference);
check(compact.proposal.summaryOnly && compact.proposal.totalIntervals === 1 && (await validateAssayEDAReference(compact)).proposal.intervals.length === 1,
  'Oversized-route recovery can be represented as an explicit review-only summary packet');
const ragged = structuredClone(assay); ragged.data.rows[0].pop();
await rejects(validateProjectCapsule(ragged), 'PROJECT_SOURCE_ROW_INVALID', 'Malformed standalone rows fail preflight');
const assayParent = await sandbox.api.createProjectHandoffContext(returnedProject,'reviewed.csv','hole_id,ni_pct\nH1,1.2\n');
check((await sandbox.api.validateProjectHandoffContext(assayParent,'reviewed.csv',assayParent.export.text,'Assay')).project.sourcePhase==='Assay',
  'Typed Assay parent binds its reviewed project and actual exported CSV');
const resourceProject={schema:'orebit-project',schemaVersion:2,sourcePhase:'Resource',data:structuredClone(assay.data),parentContexts:[assayParent]};
await sealProjectCapsule(resourceProject);
check((await validateProjectCapsule(resourceProject)).sourcePhase==='Resource'&&resourceProject.sourceCapsule.parents[0].sourcePhase==='Assay',
  'Resource capsule preserves the Assay to Core parent chain');
for(const [label,mutate] of [
  ['reviewed decisions',p=>p.project.workflow={estimationSpecs:{ni_pct:{reason:'changed'}}}],
  ['export content',p=>p.export.text+='changed'],
  ['Core source metadata',p=>p.project.parentContexts[0].project.metadata.crs='EPSG:9999'],
]){
  const changed=structuredClone(assayParent);mutate(changed);
  let rejected=false;try{await sandbox.api.validateProjectParentContext(changed);}catch{rejected=true;}
  check(rejected,'Assay parent rejects changed '+label);
}
await rejects(sandbox.api.validateProjectHandoffContext(assayParent,'wrong.csv',assayParent.export.text,'Assay'),
  'PROJECT_PARENT_EXPORT_MISMATCH','Assay parent cannot bind a different imported filename');
await rejects(sandbox.api.validateProjectHandoffContext(assayParent,'reviewed.csv',assayParent.export.text,'Core'),
  'PROJECT_PARENT_EXPORT_MISMATCH','Assay parent cannot masquerade as Core');
const ancestry=structuredClone(resourceProject);delete ancestry.parentContexts;
await rejects(validateProjectCapsule(ancestry),'PROJECT_CAPSULE_PARENT_INVALID','Declared parent ancestry cannot be silently dropped');
const invalidParent=structuredClone(resourceProject);invalidParent.parentContexts=[{project:{sourcePhase:'Resource'}}];
await rejects(sealProjectCapsule(invalidParent),'PROJECT_PARENT_CONTEXT_INVALID','Phase ordering rejects Resource ancestry before recursion');
const backwards=structuredClone(returnedProject);backwards.parentContexts=[assayParent];
await rejects(sealProjectCapsule(backwards),'PROJECT_PARENT_CONTEXT_INVALID','Assay cannot recursively parent Assay');
await rejects(sandbox.api.createProjectHandoffContext({schema:'orebit-project',schemaVersion:2,sourcePhase:'Core',phase1:core.phase1},'legacy.csv','x\n1'),'PROJECT_CAPSULE_MISSING','Parent contexts require a sealed source even though legacy project loaders can migrate data');
const auditRows=Array.from({length:1000},(_,index)=>({parentObservationId:'parent:'+index,domains:[
 {code:'SAP',status:'inside',from:.2,to:.9,spans:[{state:'inside',entryMD:.2,exitMD:.9,supportLength:.7}],traceLinearization:{method:'minimum-curvature adaptive chords',maxDeviationMetres:1.25e-11,toleranceMetres:.005,segments:1}},
 {code:'LIM',status:'outside',from:.2,to:.9,reason:null,spans:[{state:'outside',entryMD:.2,exitMD:.9,supportLength:.7}]}]}));
const originalAudit=JSON.stringify(auditRows),encoded=sandbox.api._opcCompactDomainMeasurements(auditRows);
check(encoded.domainMeasurementCatalog.length===2&&encoded.intervals.length===1000,'Lossless audit dictionary deduplicates full repeated measurements, never observation identities');
const restored=encoded.intervals.map(row=>{const result={...row,domains:sandbox.api._opcDomainMeasurements(encoded,row)};delete result.domainMeasurementIds;return result;});
check(JSON.stringify(restored)===originalAudit&&JSON.stringify(auditRows)===originalAudit,'Every domain span, reason, linearization and floating precision round-trips exactly without changing original rows');
check(JSON.stringify(encoded).length<originalAudit.length/3,'Dictionary encoding reduces repeated metadata without raising any payload gate');
check(sandbox.api._opcDomainMeasurements({},auditRows[0])===auditRows[0].domains,'Legacy small-packet domain measurements retain their original shape');
for(const invalid of [{...encoded,measurementEncoding:'unknown'},{...encoded,domainMeasurementCatalog:null}]){
 let rejected=false;try{sandbox.api._opcDomainMeasurements(invalid,encoded.intervals[0]);}catch(e){rejected=e.message==='ESTIMATION_MEMBERSHIP_AUDIT_INVALID';}
 check(rejected,'Malformed audit encoding is rejected');
}
for(const ids of [[-1],[.5],[2],null]){
 let rejected=false;try{sandbox.api._opcDomainMeasurements(encoded,{domainMeasurementIds:ids});}catch(e){rejected=e.message==='ESTIMATION_MEMBERSHIP_AUDIT_INVALID';}
 check(rejected,'Invalid audit references cannot resolve to fabricated measurements');
}
console.log('shared project capsule:', passed, 'checks passed');
