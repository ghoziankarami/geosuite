/* UX-QUICK-1 work order 4: carry one quick run across Core -> Assay -> Resource.
   A module that sends the user onward records which module is expected next.
   When that module has activated the handed-over dataset through its normal
   import gate, its registered step runs once. Resource prepares the settings
   review; the user's explicit action calls the existing calculation owner.
   This file computes nothing, approves nothing and changes no parameter. */
(function () {
  'use strict';
  var KEY = 'orebit.quickRun.v1', MAX_AGE_MS = 5 * 60 * 1000;
  var here = (location.pathname.match(/(Core|Assay|Resource)\.html$/) || [])[1] || null;
  var steps = Object.create(null);
  function read() {
    try {
      var run = JSON.parse(localStorage.getItem(KEY) || 'null');
      return run && typeof run.next === 'string' && Date.now() - run.ts < MAX_AGE_MS ? run : null;
    } catch (e) { return null; }
  }
  function expect(next) {
    try { localStorage.setItem(KEY, JSON.stringify({ next: next, ts: Date.now() })); return true; } catch (e) { return false; }
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* nothing stored */ } }
  window.addEventListener('orebit-handoff-activated', function () {
    var run = read();
    if (!run || run.next !== here) return;
    clear();
    var step = steps[here];
    if (step) setTimeout(function () {
      Promise.resolve().then(step).catch(function (error) { clear(); console.error('Quick run stopped', error); });
    }, 0);
  });
  window.OrebitQuickRun = {
    available: function () { return !(window.__OREBIT_RT__ && !window.__OREBIT_RT__.single) && typeof OrebitHandoff === 'object' && OrebitHandoff.available(); },
    expect: expect, clear: clear,
    pending: function () { return !!read(); },
    on: function (module, step) { steps[module] = step; }
  };
})();
