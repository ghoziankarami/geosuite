// Versioned, content-bound source metadata for portable Orebit projects.
// Inline this into each phase next to the shared CSV/dataset owners.
const OREBIT_PROJECT_CAPSULE_VERSION = 1;
const OREBIT_PROJECT_VERSION = 4;

function _opcFail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function _opcCsvFirstRecord(text) {
  const result = [];
  let value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { result.push(value); value = ''; }
    else if (c === '\n' || c === '\r') break;
    else value += c;
  }
  result.push(value);
  return result;
}

function _opcCsvRecordCount(text) {
  let rows = 0, quoted = false, hasValue = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') i++;
      else if (c === '"') quoted = false;
      else hasValue = true;
    } else if (c === '"') { quoted = true; hasValue = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (hasValue) rows++;
      hasValue = false;
    } else if (c.trim()) hasValue = true;
  }
  if (hasValue) rows++;
  return Math.max(0, rows - 1);
}

function _opcColumnRoles(phase, sourceRole, columns, rowCount) {
  if (typeof classifyColumns !== 'function') _opcFail('PROJECT_COLUMN_SCHEMA_UNAVAILABLE');
  if (!columns.length && rowCount === 0) return [];
  const roles = classifyColumns(columns, []).columns.map(column => ({ header: column.header, role: column.role }));
  const present = new Set(roles.map(column => column.role));
  const required = phase === 'Core' ? {
    collar: ['hole_id', 'x', 'y', 'z', 'at'],
    survey: ['hole_id', 'at', 'dip', 'az'],
    assay: ['hole_id', 'from', 'to', 'grade'],
    geology: ['hole_id', 'from', 'to', 'category'],
  }[sourceRole] : phase === 'Assay' ? ['hole_id', 'from', 'to', 'grade'] : ['hole_id', 'grade'];
  if (!required || required.some(role => !present.has(role))) _opcFail('PROJECT_SOURCE_ROLES_INVALID:' + sourceRole);
  return roles;
}

async function _opcSha256(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') _opcFail('PROJECT_HASH_UNAVAILABLE');
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// A readiness label is not evidence of a reviewed geometry snapshot. These
// packet checks preserve Core's ownership; they do not infer geological truth.
function hasCurrentGeologicalReview(value) {
  const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  if(!value||value.schemaVersion!==1||value.handoff?.readiness!=='validated'||!hex(value.source?.sha256)||
     value.crs?.units!=='m'||!['local','epsg'].includes(value.crs.kind)||
     !Array.isArray(value.domains)||!value.domains.length||value.domains.length>100)return false;
  let volume=0;const codes=new Set();
  for(const domain of value.domains){
    const b=domain?.build,r=b?.review,m=b?.mesh;
    if(typeof domain?.code!=='string'||!domain.code.trim()||codes.has(domain.code)||b?.stale!==false||
       !Number.isFinite(b?.volume)||b.volume<=0||!hex(b.inputsHash)||!hex(b.meshHash)||!hex(b.reviewHash)||
       !b.inputs||typeof b.inputs!=='object'||Array.isArray(b.inputs)||
       !b.inputs.material||b.inputs.material.unit!=='t/m3'||(domain.density??null)!==(b.inputs.material.density??null)||
       (domain.density!=null&&(!Number.isFinite(domain.density)||domain.density<=0))||!m||!Array.isArray(m.v)||m.v.length<4||!Array.isArray(m.f)||m.f.length<4||
       m.v.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))||
       m.f.some(f=>!Array.isArray(f)||f.length!==3||!f.every(i=>Number.isInteger(i)&&i>=0&&i<m.v.length))||
       ['topology','selfIntersection','topography','surfaceCrossings','overlap','honouring','geologistReview'].some(k=>b.validation?.[k]!==true)||
       !r||typeof r.reviewer!=='string'||!r.reviewer.trim()||r.reviewer.length>120||/[\u0000-\u001f\u007f]/.test(r.reviewer)||
       typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>2000||/\u0000/.test(r.reason)||
       typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||r.code!==domain.code||r.volume!==b.volume||r.sourceHash!==value.source.sha256||r.inputsHash!==b.inputsHash||r.meshHash!==b.meshHash)return false;
    codes.add(domain.code);volume+=b.volume;
  }
  return Number.isFinite(value.handoff.volume)&&value.handoff.volume>0&&Number.isFinite(volume)&&
    Math.abs(value.handoff.volume-volume)<=Math.max(1,volume)*1e-8;
}

function _opcGeometryCanonical(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(_opcGeometryCanonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+_opcGeometryCanonical(value[k])).join(',')+'}';
}

function _opcCompactDomainMeasurements(intervals) {
  const catalog=[],known=new Map();
  return {measurementEncoding:'catalog-v1',domainMeasurementCatalog:catalog,intervals:intervals.map(row=>{
    if(!Array.isArray(row.domains))throw Error('ESTIMATION_MEMBERSHIP_AUDIT_INVALID');
    const domainMeasurementIds=row.domains.map(measurement=>{
      const text=JSON.stringify(measurement);
      if(!known.has(text)){known.set(text,catalog.length);catalog.push(measurement);}
      return known.get(text);
    });
    const result={...row,domainMeasurementIds};delete result.domains;return result;
  })};
}

function _opcDomainMeasurements(packet,row) {
  if(packet.measurementEncoding==null)return row.domains;
  if(packet.measurementEncoding!=='catalog-v1'||!Array.isArray(packet.domainMeasurementCatalog)||!Array.isArray(row.domainMeasurementIds)||
     row.domainMeasurementIds.some(id=>!Number.isInteger(id)||id<0||id>=packet.domainMeasurementCatalog.length))throw Error('ESTIMATION_MEMBERSHIP_AUDIT_INVALID');
  return row.domainMeasurementIds.map(id=>packet.domainMeasurementCatalog[id]);
}

async function reviewedGeologicalSnapshot(value) {
  if(!hasCurrentGeologicalReview(value))return null;
  const text=JSON.stringify(value);
  if(text.length>8*1024*1024)return null;
  const snapshot=JSON.parse(text);
  for(const domain of snapshot.domains){
    const b=domain.build;
    if(await _opcSha256(_opcGeometryCanonical(b.review))!==b.reviewHash||
       await _opcSha256(_opcGeometryCanonical(b.mesh))!==b.meshHash||
       await _opcSha256(_opcGeometryCanonical(b.inputs))!==b.inputsHash)return null;
  }
  return _opcFreezeGeologicalSnapshot(snapshot);
}

function _opcFreezeGeologicalSnapshot(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.values(value).forEach(_opcFreezeGeologicalSnapshot);Object.freeze(value);
  }
  return value;
}

async function _opcAssayDataRevision(data) {
  const columns=Array.isArray(data?.cols)?data.cols:data?.columns;
  if(!Array.isArray(columns)||!Array.isArray(data?.rows))_opcFail('ASSAY_DATASET_INVALID');
  return _opcSha256({columns,rows:data.rows});
}

function _opcDescribe(bundle) {
  const phase = bundle?.sourcePhase;
  if (phase === 'Core') {
    if (!bundle.phase1 || typeof bundle.phase1 !== 'object' || Array.isArray(bundle.phase1)) _opcFail('PROJECT_SOURCE_INVALID');
    return ['collar', 'survey', 'assay', 'geology'].map(role => {
      const key = role + '_csv';
      const text = bundle.phase1[key];
      if (typeof text !== 'string') _opcFail('PROJECT_SOURCE_ROLE_MISSING:' + role);
      const columns = text.trim() ? _opcCsvFirstRecord(text.replace(/^\uFEFF/, '')) : [];
      const rowCount = _opcCsvRecordCount(text);
      return { role, content: text, rowCount, columns,
        columnRoles: _opcColumnRoles(phase, role, columns, rowCount) };
    });
  }
  if (phase === 'Assay' || phase === 'Resource') {
    const data = bundle.data;
    const columns = Array.isArray(data?.cols) ? data.cols.slice()
      : Array.isArray(data?.columns) ? data.columns.slice() : null;
    if (!columns || !Array.isArray(data?.rows)) _opcFail('PROJECT_SOURCE_INVALID');
    if (columns.some(c => typeof c !== 'string') || new Set(columns).size !== columns.length) _opcFail('PROJECT_SOURCE_ROLES_INVALID');
    for (const row of data.rows) {
      if (Array.isArray(row) && row.length !== columns.length) _opcFail('PROJECT_SOURCE_ROW_INVALID');
      if (!Array.isArray(row) && (!row || typeof row !== 'object' || Array.isArray(row))) _opcFail('PROJECT_SOURCE_ROW_INVALID');
    }
    const role = phase === 'Assay' ? 'assay-intervals' : 'resource-intervals';
    return [{ role, content: JSON.stringify({ columns, rows: data.rows }), rowCount: data.rows.length,
      columns, columnRoles: _opcColumnRoles(phase, role, columns, data.rows.length) }];
  }
  _opcFail('PROJECT_SOURCE_PHASE_INVALID');
}

async function sealProjectCapsule(bundle, fallbackPhase) {
  if (!bundle || typeof bundle !== 'object' || (bundle.schema != null && bundle.schema !== 'orebit-project')) _opcFail('PROJECT_SCHEMA_INVALID');
  const phase = bundle.sourcePhase || (bundle.phase1 ? 'Core' : fallbackPhase);
  if (bundle.parentContexts != null) {
    if (!Array.isArray(bundle.parentContexts)) _opcFail('PROJECT_PARENT_CONTEXT_INVALID');
    const allowedParents = phase === 'Assay' ? ['Core'] : phase === 'Resource' ? ['Core','Assay'] : [];
    for (const context of bundle.parentContexts) {
      if (!allowedParents.includes(context?.project?.sourcePhase)) _opcFail('PROJECT_PARENT_CONTEXT_INVALID');
      await validateProjectParentContext(context);
    }
  }
  if(bundle.assayCheckpointReturn) await validateAssayCheckpointReturnContext(bundle.assayCheckpointReturn,bundle.data,bundle.parentContexts);
  const candidate = Object.assign({}, bundle, { schema: 'orebit-project', sourcePhase: phase });
  const sources = [];
  for (const source of _opcDescribe(candidate)) {
    const sha256 = await _opcSha256(source.content);
    sources.push({ role: source.role, revision: sha256, rowCount: source.rowCount,
      columns: source.columns, columnRoles: source.columnRoles });
  }
  const revision = await _opcSha256(sources);
  bundle.schema = 'orebit-project';
  bundle.sourcePhase = phase;
  bundle.schemaVersion = OREBIT_PROJECT_VERSION;
  bundle.sourceCapsule = {
    schemaVersion: OREBIT_PROJECT_CAPSULE_VERSION,
    sourcePhase: bundle.sourcePhase,
    revision,
    sources,
    parents: Array.isArray(bundle.parentContexts)
      ? bundle.parentContexts.map(context => ({ sourcePhase: context.project?.sourcePhase, revision: context.project?.sourceCapsule?.revision }))
      : (Array.isArray(bundle.sourceCapsule?.parents) ? bundle.sourceCapsule.parents : []),
  };
  return bundle;
}

async function validateProjectCapsule(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) _opcFail('PROJECT_SCHEMA_INVALID');
  if (bundle.schema != null && bundle.schema !== 'orebit-project') _opcFail('PROJECT_SCHEMA_UNSUPPORTED');
  const version = bundle.schemaVersion == null ? 1 : bundle.schemaVersion;
  if (!Number.isInteger(version) || version < 1 || version > OREBIT_PROJECT_VERSION) _opcFail('PROJECT_SCHEMA_UNSUPPORTED');
  if (!bundle.sourceCapsule) {
    if (version === OREBIT_PROJECT_VERSION) _opcFail('PROJECT_CAPSULE_MISSING');
    return { legacy: true, migratedFrom: version, sourcePhase: bundle.sourcePhase || 'standalone' };
  }
  const capsule = bundle.sourceCapsule;
  if (capsule.schemaVersion !== OREBIT_PROJECT_CAPSULE_VERSION || capsule.sourcePhase !== bundle.sourcePhase ||
      !Array.isArray(capsule.sources) || !Array.isArray(capsule.parents) ||
      !/^[a-f0-9]{64}$/.test(capsule.revision || '')) _opcFail('PROJECT_CAPSULE_INVALID');
  const actual = _opcDescribe(bundle);
  if (actual.length !== capsule.sources.length) _opcFail('PROJECT_SOURCE_ROLES_INVALID');
  const checked = [];
  for (let i = 0; i < actual.length; i++) {
    const source = actual[i], saved = capsule.sources[i];
    if (!saved || saved.role !== source.role || saved.rowCount !== source.rowCount ||
        !Array.isArray(saved.columns) || JSON.stringify(saved.columns) !== JSON.stringify(source.columns) ||
        JSON.stringify(saved.columnRoles) !== JSON.stringify(source.columnRoles) ||
        !/^[a-f0-9]{64}$/.test(saved.revision || '')) _opcFail('PROJECT_SOURCE_ROLES_INVALID');
    const revision = await _opcSha256(source.content);
    if (revision !== saved.revision) _opcFail('PROJECT_SOURCE_REVISION_MISMATCH:' + source.role);
    checked.push({ role: source.role, revision, rowCount: source.rowCount,
      columns: source.columns, columnRoles: source.columnRoles });
  }
  if (await _opcSha256(checked) !== capsule.revision) _opcFail('PROJECT_CAPSULE_REVISION_MISMATCH');
  if (capsule.parents.some(parent => !parent || typeof parent.sourcePhase !== 'string' || !/^[a-f0-9]{64}$/.test(parent.revision || ''))) _opcFail('PROJECT_CAPSULE_PARENT_INVALID');
  if (capsule.parents.length && bundle.parentContexts == null) _opcFail('PROJECT_CAPSULE_PARENT_INVALID');
  if (bundle.parentContexts != null) {
    if (!Array.isArray(bundle.parentContexts)) _opcFail('PROJECT_PARENT_CONTEXT_INVALID');
    // Phase order bounds ancestry and rejects cycles before recursive validation.
    const allowedParents = bundle.sourcePhase === 'Assay' ? ['Core'] : bundle.sourcePhase === 'Resource' ? ['Core','Assay'] : [];
    for (const context of bundle.parentContexts) {
      if (!allowedParents.includes(context?.project?.sourcePhase)) _opcFail('PROJECT_PARENT_CONTEXT_INVALID');
      await validateProjectParentContext(context);
    }
    const expectedParents = bundle.parentContexts.map(context => ({ sourcePhase: context.project.sourcePhase, revision: context.project.sourceCapsule.revision }));
    if (JSON.stringify(expectedParents) !== JSON.stringify(capsule.parents)) _opcFail('PROJECT_CAPSULE_PARENT_INVALID');
  }
  if(bundle.assayCheckpointReturn) await validateAssayCheckpointReturnContext(bundle.assayCheckpointReturn,bundle.data,bundle.parentContexts);
  return { legacy: false, migratedFrom: null, sourcePhase: capsule.sourcePhase, revision: capsule.revision };
}

async function _opcCoreContextRevision(context) {
  return _opcSha256({ schemaVersion: context.schemaVersion, projectRevision: context.project?.sourceCapsule?.revision,
    projectStateRevision: context.projectStateRevision, export: context.export, metadata: context.project?.metadata || {} });
}

async function _opcParentProjectStateRevision(project, revision) {
  // Preserve the established Core context digest. Assay's reviewed decisions,
  // treatment ledger and returned geology are also part of its parent state.
  return _opcSha256(project.sourcePhase === 'Core'
    ? {sourceRevision:revision,metadata:project.metadata || {}}
    : {sourceRevision:revision,project});
}

async function validateProjectParentContext(context) {
  if (!context || context.schemaVersion !== 1 || !context.project || !context.export ||
      !['Core','Assay'].includes(context.project.sourcePhase) ||
      typeof context.export.name !== 'string' || typeof context.export.text !== 'string' || !/^[a-f0-9]{64}$/.test(context.export.revision || '') ||
      !/^[a-f0-9]{64}$/.test(context.revision || '')) _opcFail('PROJECT_PARENT_CONTEXT_INVALID');
  const capsule = await validateProjectCapsule(context.project);
  if (capsule.legacy) _opcFail('PROJECT_CAPSULE_MISSING');
  const state = await _opcParentProjectStateRevision(context.project,capsule.revision);
  if (state !== context.projectStateRevision || await _opcSha256(context.export.text) !== context.export.revision ||
      await _opcCoreContextRevision(context) !== context.revision) _opcFail('PROJECT_PARENT_CONTEXT_REVISION_MISMATCH');
  return context;
}

async function validateCoreParentContext(context) {
  await validateProjectParentContext(context);
  if (context.project.sourcePhase !== 'Core') _opcFail('PROJECT_PARENT_CONTEXT_REVISION_MISMATCH');
  return context;
}

async function createProjectHandoffContext(project, filename, csvText) {
  const capsule = await validateProjectCapsule(project);
  if (capsule.legacy) _opcFail('PROJECT_CAPSULE_MISSING');
  if (!['Core','Assay'].includes(capsule.sourcePhase) || typeof filename !== 'string' || typeof csvText !== 'string')
    _opcFail('PROJECT_PARENT_CONTEXT_INVALID');
  const context = {schemaVersion:1,project,export:{name:filename,revision:await _opcSha256(csvText),text:csvText}};
  context.projectStateRevision = await _opcParentProjectStateRevision(project,capsule.revision);
  context.revision = await _opcCoreContextRevision(context);
  return context;
}

async function createCoreHandoffContext(project, filename, csvText) {
  if (project?.sourcePhase !== 'Core') _opcFail('PROJECT_PARENT_CONTEXT_INVALID');
  return createProjectHandoffContext(project,filename,csvText);
}

async function validateProjectHandoffContext(context, filename, csvText, expectedPhase) {
  await validateProjectParentContext(context);
  if (context.project.sourcePhase !== expectedPhase || context.export.name !== filename || context.export.text !== csvText ||
      context.export.revision !== await _opcSha256(csvText)) _opcFail('PROJECT_PARENT_EXPORT_MISMATCH');
  return context;
}

async function validateCoreHandoffContext(context, filename, csvText) {
  await validateCoreParentContext(context);
  if (context.export.name !== filename || context.export.text !== csvText || context.export.revision !== await _opcSha256(csvText)) _opcFail('PROJECT_PARENT_EXPORT_MISMATCH');
  return context;
}

async function _opcAssayReferenceDigest(reference) {
  const payload = Object.assign({}, reference);
  delete payload.revision;
  return _opcSha256(payload);
}

async function createAssayEDAReference(parentContexts, data, workflow, proposal, originalLabels) {
  if (!Array.isArray(parentContexts) || parentContexts.length !== 1 || !data ||
      !Array.isArray(data.cols || data.columns) || !Array.isArray(data.rows) ||
      !proposal || !Array.isArray(proposal.labels) || proposal.labels.length !== data.rows.length ||
      !proposal.audit || typeof proposal.audit.method !== 'string') _opcFail('EDA_REFERENCE_INVALID');
  const parent = await validateCoreParentContext(parentContexts[0]);
  const columns = data.cols || data.columns, ix = Object.fromEntries(['hole_id','from_m','to_m','domain'].map(key => [key, columns.indexOf(key)]));
  if (ix.hole_id < 0 || ix.from_m < 0 || ix.to_m < 0) _opcFail('EDA_REFERENCE_SOURCE_COLUMNS_INVALID');
  const labels = Array.isArray(originalLabels) && originalLabels.length === data.rows.length
    ? originalLabels : data.rows.map(row => ix.domain < 0 ? '' : String(row[ix.domain] ?? ''));
  const rows = data.rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== columns.length) _opcFail('EDA_REFERENCE_ROW_INVALID');
    return { row: index, holeId: String(row[ix.hole_id] ?? ''), from: row[ix.from_m], to: row[ix.to_m],
      sourceLabel: String(labels[index] ?? ''), candidateLabel: String(proposal.labels[index] ?? '') };
  });
  const reference = {
    schema: 'orebit-assay-eda-reference', version: 1,
    source: { coreProject: parent.project.name || '', coreRevision: parent.project.sourceCapsule.revision,
      coreProjectStateRevision: parent.projectStateRevision,
      exportName: parent.export.name, exportRevision: parent.export.revision,
      assayDatasetRevision: await _opcAssayDataRevision({columns,rows:data.rows}) },
    checkpoint: workflow && typeof workflow === 'object' ? workflow : null,
    proposal: { audit: proposal.audit, intervals: rows },
  };
  reference.revision = await _opcAssayReferenceDigest(reference);
  return reference;
}

async function validateAssayEDAReference(reference) {
  if (!reference || reference.schema !== 'orebit-assay-eda-reference' || reference.version !== 1 ||
      !reference.source || !/^[a-f0-9]{64}$/.test(reference.source.coreRevision || '') ||
      !/^[a-f0-9]{64}$/.test(reference.source.coreProjectStateRevision || '') ||
      !/^[a-f0-9]{64}$/.test(reference.source.exportRevision || '') ||
      !/^[a-f0-9]{64}$/.test(reference.source.assayDatasetRevision || '') ||
      !reference.proposal || !Array.isArray(reference.proposal.intervals) ||
      !reference.proposal.audit || typeof reference.proposal.audit.method !== 'string' ||
      !/^[a-f0-9]{64}$/.test(reference.revision || '')) _opcFail('EDA_REFERENCE_INVALID');
  if (await _opcAssayReferenceDigest(reference) !== reference.revision) _opcFail('EDA_REFERENCE_REVISION_MISMATCH');
  for (const interval of reference.proposal.intervals) {
    if (!interval || !Number.isInteger(interval.row) || interval.row < 0 || typeof interval.holeId !== 'string' ||
        typeof interval.sourceLabel !== 'string' || typeof interval.candidateLabel !== 'string' ||
        !Number.isFinite(Number(interval.from)) || !Number.isFinite(Number(interval.to)) || Number(interval.to) <= Number(interval.from))
      _opcFail('EDA_REFERENCE_INTERVAL_INVALID');
  }
  if (reference.proposal.summaryOnly && (!Number.isInteger(reference.proposal.totalIntervals) ||
      reference.proposal.totalIntervals < reference.proposal.intervals.length)) _opcFail('EDA_REFERENCE_SUMMARY_INVALID');
  return reference;
}

async function compactAssayEDAReference(reference, sampleCount = 50) {
  await validateAssayEDAReference(reference);
  const compact = JSON.parse(JSON.stringify(reference));
  compact.proposal.totalIntervals = compact.proposal.intervals.length;
  compact.proposal.intervals = compact.proposal.intervals.slice(0, Math.max(1, Math.min(100, sampleCount)));
  compact.proposal.summaryOnly = true;
  const checkpoint = compact.checkpoint || {};
  compact.checkpoint = {schema:checkpoint.schema || '', version:checkpoint.version || 0,
    dataset:checkpoint.dataset ? {name:checkpoint.dataset.name || '', rows:checkpoint.dataset.rows || 0,
      columns:checkpoint.dataset.columns || 0} : null,
    stageCount:Array.isArray(checkpoint.stages)?checkpoint.stages.length:0, summaryOnly:true};
  const audit = compact.proposal.audit || {};
  compact.proposal.audit = {method:String(audit.method || ''),element:String(audit.element || ''),summaryOnly:true};
  compact.revision = await _opcAssayReferenceDigest(compact);
  return compact;
}

async function _opcCheckpointReturnDigest(packet) {
  const payload = Object.assign({}, packet);
  delete payload.revision;
  return _opcSha256(payload);
}

async function createAssayCheckpointReturn(reference, coreContext, geologicalDomain) {
  await validateAssayEDAReference(reference);
  await validateCoreParentContext(coreContext);
  if (reference.proposal.summaryOnly || !reference.checkpoint) _opcFail('ASSAY_CHECKPOINT_RETURN_CHECKPOINT_UNAVAILABLE');
  if (coreContext.project.sourceCapsule.revision !== reference.source.coreRevision) _opcFail('ASSAY_CHECKPOINT_RETURN_CORE_SOURCE_CONFLICT');
  geologicalDomain=await reviewedGeologicalSnapshot(geologicalDomain);
  if (!geologicalDomain)
    _opcFail('ASSAY_CHECKPOINT_RETURN_GEOLOGY_NOT_VALIDATED');
  const packet = {
    schema: 'orebit-assay-checkpoint-return', version: 1,
    source: {coreRevision:reference.source.coreRevision, exportRevision:reference.source.exportRevision,
      assayDatasetRevision:reference.source.assayDatasetRevision,
      coreProjectStateRevision:coreContext.projectStateRevision,
      geologicalRevision:await _opcSha256(geologicalDomain)},
    checkpoint:reference.checkpoint, geologicalDomain,
  };
  packet.revision = await _opcCheckpointReturnDigest(packet);
  return packet;
}

async function validateAssayCheckpointReturn(packet) {
  if (!packet || packet.schema !== 'orebit-assay-checkpoint-return' || packet.version !== 1 || !packet.source)
    _opcFail('ASSAY_CHECKPOINT_RETURN_SCHEMA_INVALID');
  if (!packet.checkpoint || packet.checkpoint.schema !== 'orebit-assay-interpretation' || packet.checkpoint.version !== 1 ||
      !Array.isArray(packet.checkpoint.stages) || packet.checkpoint.summaryOnly || !packet.checkpoint.dataset ||
      !Number.isInteger(packet.checkpoint.dataset.rows) || !Array.isArray(packet.checkpoint.dataset.columns))
    _opcFail('ASSAY_CHECKPOINT_RETURN_CHECKPOINT_INVALID');
  if (packet.checkpoint.stages.some(row => !row || !Number.isInteger(row.stage) || row.stage < 1 || row.stage > 13 ||
      (row.context != null && typeof row.context !== 'string') || typeof row.note !== 'string' ||
      (row.parameters != null && (typeof row.parameters !== 'object' || Array.isArray(row.parameters)))))
    _opcFail('ASSAY_CHECKPOINT_RETURN_STAGE_INVALID');
  if (!packet.geologicalDomain || packet.geologicalDomain.handoff?.readiness !== 'validated' ||
      !Array.isArray(packet.geologicalDomain.domains)) _opcFail('ASSAY_CHECKPOINT_RETURN_GEOLOGY_INVALID');
  if (!['coreRevision','exportRevision','assayDatasetRevision','coreProjectStateRevision','geologicalRevision']
      .every(key => /^[a-f0-9]{64}$/.test(packet.source[key] || ''))) _opcFail('ASSAY_CHECKPOINT_RETURN_SOURCE_INVALID');
  if (!/^[a-f0-9]{64}$/.test(packet.revision || '')) _opcFail('ASSAY_CHECKPOINT_RETURN_REVISION_INVALID');
  if (await _opcSha256(packet.geologicalDomain) !== packet.source.geologicalRevision ||
      await _opcCheckpointReturnDigest(packet) !== packet.revision) _opcFail('ASSAY_CHECKPOINT_RETURN_REVISION_MISMATCH');
  if(!await reviewedGeologicalSnapshot(packet.geologicalDomain))_opcFail('ASSAY_CHECKPOINT_RETURN_GEOLOGY_INVALID');
  return packet;
}

async function validateAssayCheckpointReturnContext(packet,data,parentContexts) {
  await validateAssayCheckpointReturn(packet);
  if(await _opcAssayDataRevision(data)!==packet.source.assayDatasetRevision)_opcFail('ASSAY_CHECKPOINT_RETURN_DATASET_CONFLICT');
  if(!Array.isArray(parentContexts)||!parentContexts.some(context=>
      context.project?.sourceCapsule?.revision===packet.source.coreRevision&&
      context.export?.revision===packet.source.exportRevision))_opcFail('ASSAY_CHECKPOINT_RETURN_PARENT_CONFLICT');
  return packet;
}
