/* Validation actions share Core's import/edit owners; never infer measurements. */
(function () {
  'use strict';
  const tables = ['collar', 'survey', 'assay', 'geology'];
  const tr = key => window.__t('core.repair.' + key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const snapshot = () => JSON.stringify(tables.map(name => [name, STATE[name], STATE.rawHeaders[name], STATE.rawRows[name], STATE.isSample[name], [...STATE.edits[name]], STATE.newRows[name], [...STATE.deletedIdx[name]]]));
  let undo = null;
  function candidate() {
    if (STATE.lengthUnitSource !== 'm' || window._coreLengthUnit !== 'm' || STATE.crs !== 'EPSG:32751') return false;
    return tables.every(name => STATE.isSample[name] && !STATE.edits[name].size && !STATE.newRows[name].length && !STATE.deletedIdx[name].size) &&
      tables.every(name => JSON.stringify(STATE[name]) === JSON.stringify(SAMPLE_DATA[name]));
  }
  function entry(action, detail, diffs = []) {
    const at = new Date().toISOString();
    STATE.CHANGE_LOG.push({table:'validation', timestamp:at, summary:detail, diffs});
    logPipeline(action, detail);
  }
  function refresh() {
    STATE.desurvey = null; STATE.merged = null; STATE.composite = null;
    updateDataTag(); rerenderAll();
    if (typeof AutoSave !== 'undefined') AutoSave.schedule();
    window.OrebitScreeningWorkflow?.refresh();
  }
  async function applySource() {
    if (!candidate()) return false;
    const before = snapshot();
    if (!await orebitConfirm(tr('confirm'))) return false;
    // A delayed dialog must never restore synthetic rows into a new project.
    if (!candidate() || snapshot() !== before) { toast(tr('changed'), 'warn'); return false; }
    const prior = Object.fromEntries(['collar','geology'].map(name => [name, {
      rows:copy(STATE[name]), headers:copy(STATE.rawHeaders[name]), raw:copy(STATE.rawRows[name])
    }]));
    for (const name of ['collar','geology']) {
      const rows = copy(SAMPLE_SOURCE_DATA[name]);
      _coreLoadTable(name, rows, Object.keys(rows[0] || {}), copy(rows));
      STATE.isSample[name] = true; // Known synthetic source; never presented as customer data.
    }
    entry('Validation repair', 'Restored collar and geology from the bundled synthetic source; no assay or survey measurements changed.',
      ['collar','geology'].map(name => ({col:name, old:prior[name].rows.length, new:STATE[name].length})));
    undo = {before:prior, after:snapshot()};
    UNDO.push({type:'validation-repair'});
    refresh(); toast(tr('applied'), 'good'); return true;
  }
  function undoSource() {
    if (!undo || undo.after !== snapshot()) { undo = null; toast(tr('changed'), 'warn'); return false; }
    for (const [name, prior] of Object.entries(undo.before)) {
      STATE[name] = copy(prior.rows); STATE.rawHeaders[name] = copy(prior.headers); STATE.rawRows[name] = copy(prior.raw);
      STATE.isSample[name] = true;
    }
    undo = null;
    entry('Undo validation repair', 'Restored the prior synthetic collar/geology findings; downstream geometry must be recomputed.');
    refresh(); return true;
  }
  function tableFor(check) {
    if (/Duplicate collar|projected metres|Collar without/.test(check.name)) return 'collar';
    if (/in Assay|^assay|Assay interval/.test(check.name)) return 'assay';
    if (/in Survey|^survey/.test(check.name)) return 'survey';
    if (/in Geology|^geology/.test(check.name)) return 'geology';
    return window._coreUseProvidedXYZ ? 'assay' : 'survey';
  }
  function showTable(name) { showTab({collar:3,survey:4,assay:5,geology:6}[name]); }
  function render() {
    const host = document.getElementById('coreValidationRemedies'); if (!host) return;
    host.replaceChildren();
    const checks = _p1RunValidationChecks().filter(c => c.severity === 'fail');
    if (!checks.length) { host.hidden = true; return; }
    host.hidden = false;
    const el = (tag,text) => {const n=document.createElement(tag); n.textContent=text; return n;};
    const button = (text,fn,primary=false) => {const n=el('button',text);n.type='button';n.className='btn'+(primary?'':' secondary');n.onclick=fn;return n;};
    host.append(el('h3',tr('title')), el('p',tr('scope')));
    if (candidate()) {
      const note=el('p',tr('sourcePreview')); note.className='hint';host.append(note);
      const repair=button(tr('applySource'),applySource,true);repair.id='coreRepairSource';host.append(repair);
    }
    // Aggregate verdict repeats the actionable checks; show only when no concrete issue exists.
    const items=checks.filter(c=>c.name !== 'Linkage and geometry verdict');
    for (const check of items.length?items:checks) {
      const row=document.createElement('section');row.className='core-repair-issue';
      const name=tableFor(check);
      const count=Number.parseInt(check.value,10);
      const value=Number.isFinite(count)?(check.value.includes('%')?check.value:tr('count').replace('{n}',count)):tr('needsReview');
      row.append(el('strong',window.__t('core.table.'+name)+' · '+value));
      const reason = /orphan/.test(check.value)?'linkage':/Duplicate/.test(check.name)?'duplicate':/projected metres/.test(check.name)?'crs':/interval/.test(check.name)?'interval':'measurement';
      row.append(el('p',tr(reason)));
      const actions=document.createElement('div');actions.className='workflow-actions';
      actions.append(button(tr('edit'),()=>showTable(name)),button(tr('import'),()=>showTab(2)));
      if (reason==='linkage') actions.append(button(tr('collar'),()=>showTable('collar')));
      row.append(actions);host.append(row);
    }
    if (undo && undo.after === snapshot()) host.append(button(tr('undo'),()=>undoLast()));
  }
  window.OrebitCoreRepair = {render, applySource, undoSource, candidate, reset:()=>{undo=null;}};
})();
