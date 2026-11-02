/* Statistical labels are proposals until an explicit, reasoned Apply.
 * This boundary does not infer geological solids or change raw assay values.
 */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const columns = data => data.cols || data.columns || data.headers;
  // Change detection only, not an authenticity hash. Full equality is checked at Apply.
  function signature(data) {
    const value = JSON.stringify({cols:columns(data), rows:data.rows, units:data.units || {}});
    let hash = 2166136261;
    for (let i=0; i<value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return {key:value.length+':'+(hash>>>0).toString(16), exact:value};
  }
  function labels(data) {
    const index = columns(data).indexOf('domain');
    return data.rows.map(row => index < 0 || row[index] == null ? '' : String(row[index]));
  }
  function preview(data, tagged, audit) {
    const indices = new Map(data.rows.map((row,index) => [row,index]));
    const proposed = labels(data);
    for (const tag of tagged) {
      const index = indices.get(tag.row);
      if (index === undefined) throw Error('PROPOSAL_SOURCE_MISMATCH');
      proposed[index] = String(tag.label ?? tag.domain ?? '');
    }
    return {data, input:signature(data), labels:proposed, audit:clone(audit)};
  }
  function apply(data, proposal, reason, previous) {
    if (!reason || !String(reason).trim()) throw Error('PROPOSAL_REASON_REQUIRED');
    if (!proposal || proposal.data !== data || proposal.input.exact !== signature(data).exact) throw Error('PROPOSAL_STALE');
    const cols = columns(data).slice(), rows = data.rows.map(row => row.slice());
    let index = cols.indexOf('domain');
    const before = labels(data), hadDomain = index >= 0;
    if (index < 0) { index=cols.length; cols.push('domain'); }
    rows.forEach((row,i) => { while(row.length <= index)row.push(''); row[index]=proposal.labels[i]; });
    const next = {...data, cols, columns:cols, headers:cols, rows};
    const at = new Date().toISOString();
    const record = {schema:'orebit-statistical-domain-review',version:1,
      role:'statistical_population',sourceDomains:previous ? previous.sourceDomains.slice() : before,
      sourceHadDomain:previous ? previous.sourceHadDomain : hadDomain,
      appliedLabels:proposal.labels.slice(),appliedSignature:signature(next).key,
      audit:clone(proposal.audit),reason:String(reason).trim(),appliedAt:at,
      history:[...(previous?.history || []),{at,reason:String(reason).trim(),method:proposal.audit.method,element:proposal.audit.element,before,after:proposal.labels.slice(),hadDomain,previousAudit:previous?.audit || null,previousReason:previous?.reason || null,previousAppliedAt:previous?.appliedAt || null}]};
    return {data:next, record, event:{action:'apply',at,reason:record.reason,method:record.audit.method,element:record.audit.element,before,after:proposal.labels.slice()}};
  }
  function undo(data, record) {
    if (!record || !record.history.length || JSON.stringify(labels(data)) !== JSON.stringify(record.appliedLabels)) throw Error('DOMAIN_REVIEW_LABEL_MISMATCH');
    const last=record.history[record.history.length-1], cols=columns(data).slice(), rows=data.rows.map(row=>row.slice());
    const index=cols.indexOf('domain');
    rows.forEach((row,i)=>{row[index]=last.before[i];});
    if(!last.hadDomain){cols.splice(index,1);rows.forEach(row=>row.splice(index,1));}
    const next={...data,cols,columns:cols,headers:cols,rows};
    const history=record.history.slice(0,-1);
    const previous=history.length?{...record,audit:last.previousAudit,reason:last.previousReason,appliedAt:last.previousAppliedAt,
      appliedLabels:last.before.slice(),appliedSignature:signature(next).key,history}:null;
    return {data:next,record:previous,event:{action:'undo',at:new Date().toISOString(),reason:'Undo last statistical population decision',method:last.method,element:last.element,before:record.appliedLabels.slice(),after:last.before.slice()}};
  }
  function restoreHistory(events, data) {
    if (events == null) return [];
    if (!Array.isArray(events) || events.some(event=> !event || !['apply','undo'].includes(event.action) || typeof event.at!=='string' ||
      typeof event.reason!=='string' || !event.reason.trim() || ![event.before,event.after].every(a=>Array.isArray(a)&&a.length===data.rows.length&&a.every(v=>typeof v==='string')))) throw Error('DOMAIN_HISTORY_INVALID');
    return clone(events);
  }
  function restore(record, data) {
    if (record == null) return null;
    if (record.schema !== 'orebit-statistical-domain-review' || record.version !== 1 || record.role !== 'statistical_population') throw Error('DOMAIN_REVIEW_UNSUPPORTED');
    if (![record.sourceDomains,record.appliedLabels].every(a => Array.isArray(a) && a.length === data.rows.length && a.every(v=>typeof v === 'string')) ||
      typeof record.sourceHadDomain !== 'boolean' || typeof record.reason !== 'string' || !record.reason.trim() ||
      !record.audit || typeof record.audit.method !== 'string' || !Array.isArray(record.history)) throw Error('DOMAIN_REVIEW_INVALID');
    if (!record.history.length || record.history.some(event => !event || typeof event.hadDomain !== 'boolean' ||
      typeof event.reason !== 'string' || !event.reason.trim() || ![event.before,event.after].every(a => Array.isArray(a) && a.length===data.rows.length && a.every(v=>typeof v==='string')))) throw Error('DOMAIN_REVIEW_INVALID');
    if (JSON.stringify(labels(data)) !== JSON.stringify(record.appliedLabels)) throw Error('DOMAIN_REVIEW_LABEL_MISMATCH');
    // Grades/treatments may legitimately change after review; approval is stale then.
    return {...clone(record),stale:record.appliedSignature !== signature(data).key};
  }
  root.OrebitDomainProposals = Object.freeze({signature,labels,preview,apply,undo,restore,restoreHistory});
})(typeof window === 'undefined' ? globalThis : window);
