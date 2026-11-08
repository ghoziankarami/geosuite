/* UX-RES-5: the one Resource orchestrator.
   Guided "Calculate & continue" and the dashboard "Compute all" shortcut both
   read this step map and this gate list and run stage owners through run().
   Owners keep their own validation, confirmation, cancellation and numerics;
   nothing here computes, approves or changes a parameter. */
(function () {
  'use strict';
  // Rail: five steps. The first panel is the rail entry; the rest are on-screen tabs.
  const STEPS = [
    {key: 'data', panels: [2, 3]},
    {key: 'continuity', panels: [4]},
    {key: 'support', panels: [5]},
    {key: 'estimate', panels: [6]},
    {key: 'validate', panels: [7, 8, 9, 10, 12]},
  ];
  const VIEWER = 11; // 3D panel: opened from any step, never a rail step.
  const ORDER = STEPS.flatMap(s => s.panels);
  const stepOf = n => STEPS.find(s => s.panels.includes(n)) || null;
  const rows = () => (typeof DATA !== 'undefined' && DATA?.rows) || [];
  let active = null; // 'guided' | 'all' while an orchestrated run owns the owners

  const busy = () => !!(estimState._running || estimState._confirming || crossvalState._running);
  // The single gate list. `at`: the stage being continued from / calculated.
  // `remedy`: the panel that resolves it. Checked in order; first failure wins.
  const GATES = [
    {id: 'busy', at: [4, 5, 6, 7], test: mode => !busy() && (!active || active === mode), remedy: null},
    {id: 'data', at: [2, 3, 4, 5, 6, 7], test: () => rows().length > 0, remedy: 2},
    {id: 'minRows', at: [4], test: () => rows().length >= 30, remedy: 2},
    {id: 'element', at: [3, 4, 5, 6, 7], test: () => !!setupState.element, remedy: 3},
    {id: 'model', at: [6, 7], test: () => !!variogramState.model, remedy: 4},
    {id: 'blocks', at: [6], test: () => !!blockState.blocks?.length, remedy: 5},
  ];
  function blocker(stage, mode = 'guided') {
    return GATES.find(g => g.at.includes(stage) && !g.test(mode)) || null;
  }
  // Result identity per calculation stage; a run advances only on a new result.
  const RESULT = {4: () => variogramState.model, 5: () => blockState.blocks, 6: () => estimState.results, 7: () => crossvalState.metrics};
  const DONE = {4: () => !!variogramState.model, 5: () => !!blockState.blocks?.length, 6: () => !!estimState.done, 7: () => !!crossvalState.metrics};
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const call = name => async () => { if (typeof window[name] === 'function') await window[name](); };
  // Owners per mode. Guided runs the stage owner; Compute-all also renders the
  // diagnostics it has always produced (down-hole nugget, auto-fit, map, scan).
  const OWNERS = {
    guided: {4: [call('computeVariogram')], 5: [call('generateBlocks')], 6: [call('runEstimation')], 7: [call('runCrossVal')]},
    all: {
      4: [call('computeDownholeVariogram'), call('computeVariogram'), call('autoFitVariogram'),
        async () => { if (typeof computeVariogramMap === 'function') { computeVariogramMap(); await pause(800); } },
        async () => { if (typeof computeDirectionalScan === 'function') { computeDirectionalScan(); await pause(800); } }],
      5: [call('generateBlocks'), () => pause(500)],
      6: [call('runEstimation')],
      7: [call('renderCrossVal'), () => pause(300), call('runCrossVal')],
    },
  };
  async function settle(aborted, onWait) {
    let cancelled = false;
    while (busy()) {
      if (!cancelled && aborted?.() && estimState._running && typeof cancelEstimation === 'function') { cancelled = true; cancelEstimation(); }
      onWait?.();
      await pause(100);
    }
  }
  // Runs one calculation stage. Returns {ok, gate}; gate explains a refusal.
  async function run(stage, {mode = 'guided', aborted, onWait} = {}) {
    const gate = blocker(stage, mode);
    if (gate) return {ok: false, gate};
    const source = rows(), before = RESULT[stage]();
    const outer = active; active = mode;
    try {
      for (const owner of OWNERS[mode][stage]) { if (aborted?.()) break; await owner(); }
      await settle(aborted, onWait);
      // Compute-all has always widened an empty cross-validation search once.
      if (mode === 'all' && stage === 7 && !aborted?.() && crossvalState.results && crossvalState.results.actual.length === 0 && typeof autoFixCrossValRadius === 'function') {
        autoFixCrossValRadius(); await settle(aborted, onWait);
      }
    } finally { active = outer; }
    const ok = rows() === source && !aborted?.() && RESULT[stage]() !== before && DONE[stage]();
    return {ok, gate: ok ? null : {id: 'result', remedy: stage}};
  }
  const reason = gate => window.__t(gate.id === 'minRows' ? 'res.cancelComputePipeline.needLeast30CompositeRows' : 'flow.gate.' + gate.id);
  window.OrebitResourceFlow = {
    STEPS, VIEWER, GATES, blocker, run, reason, stepOf,
    begin: mode => { active = mode; }, end: () => { active = null; },
    get active() { return active; },
    isEntry: n => STEPS.some(s => s.panels[0] === n),
    order: n => ORDER.indexOf(n) + 1,
  };
})();
