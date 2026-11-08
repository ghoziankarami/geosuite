// UX-REV-1: one revision counter per module so a downstream module can say
// "Core changed since this import" and refresh through the normal import gate.
// State lives in localStorage (shared by same-origin tabs); nothing here
// changes data, only reports and requests a resend.
var OrebitRevision = (function () {
  var KEY = 'orebit.project.rev.v1', UP = {Assay: 'Core', Resource: 'Assay'}, ME = null, chip = null, channel = null, pending = false, debounceTimer = null;
  var resend = {};
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: chip stays local-only */ } }
  function fnv(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + str.length; }
  // Bump this module's revision only when its source state really changed.
  function touch() {
    if (!ME || typeof OrebitHandoff === 'undefined') return 0;
    var key = OrebitHandoff.sourceStateKey();
    if (!key) return 0;
    var s = read(), mine = s[ME] || {rev: 0, hash: ''}, hash = fnv(key);
    if (hash !== mine.hash) { s[ME] = {rev: mine.rev + 1, hash: hash, ts: Date.now()}; write(s); mine = s[ME]; }
    return mine.rev;
  }
  // rev == null: the data did not come from a handoff, so no upstream link.
  function consume(rev) {
    if (!ME) return;
    var s = read(), c = s.consumed || {};
    if (rev == null) delete c[ME]; else c[ME] = {from: UP[ME], rev: rev};
    s.consumed = c; write(s);
    paint();
  }
  function status() {
    var s = read(), mine = (s[ME] || {}).rev || 0, up = UP[ME], link = (s.consumed || {})[ME];
    if (!up || !link || link.from !== up) return {state: 'local', rev: mine, up: up};
    var upRev = (s[up] || {}).rev || 0;
    return {state: upRev > link.rev ? 'stale' : 'current', rev: mine, up: up, upRev: upRev};
  }
  function fill(key, vars) { var text = t(key); for (var k in vars) text = text.replace('{' + k + '}', vars[k]); return text; }
  function paint() {
    if (!chip) return;
    var st = status();
    chip.dataset.state = st.state;
    chip.textContent = '';
    var label = document.createElement('span');
    if (st.state === 'stale') label.textContent = fill('rev.stale', {src: st.up});
    else if (st.state === 'current') label.textContent = fill('rev.current', {src: st.up});
    chip.appendChild(label);
    if (st.state === 'stale') {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn secondary'; btn.dataset.revUpdate = '1';
      btn.textContent = pending ? t('rev.updating') : t('rev.update');
      btn.disabled = pending;
      btn.addEventListener('click', update);
      chip.appendChild(btn);
    }
    chip.hidden = st.state === 'local'; // no upstream link: nothing to report
  }
  // Upstream registers how its last handoff was produced; a quiet resend stores
  // the record without opening a window so the downstream tab can import it.
  function register(target, fn) { resend[target] = fn; }
  function update() {
    if (!channel || pending) return;
    pending = true; paint();
    channel.postMessage({type: 'request', target: ME});
    setTimeout(function () {
      if (!pending) return;
      pending = false;
      if (typeof toast === 'function') toast(fill('rev.noUpstream', {src: UP[ME]}), 'warn');
      paint();
    }, 2500);
  }
  function onMessage(ev) {
    var m = ev.data || {};
    if (m.type === 'request' && resend[m.target]) {
      Promise.resolve().then(function () { touch(); return resend[m.target](); })
        .then(function (ok) { channel.postMessage({type: ok ? 'ready' : 'failed', target: m.target}); })
        .catch(function () { channel.postMessage({type: 'failed', target: m.target}); });
    } else if (m.type === 'ready' && m.target === ME && pending) {
      pending = false;
      OrebitHandoff.receive(ME, true);
      paint();
    } else if (m.type === 'failed' && m.target === ME && pending) {
      pending = false;
      if (typeof toast === 'function') toast(fill('rev.noUpstream', {src: UP[ME]}), 'warn');
      paint();
    }
  }
  function mount() {
    var host = document.getElementById('orebitToolbar');
    // Desktop keeps one origin per EXE until the single shell lands.
    if (!host || chip || window.__OREBIT_RT__) return;
    chip = document.createElement('div');
    chip.setAttribute('data-orebit-collapse-mobile', ''); chip.id = 'orebitRevision'; chip.className = 'orebit-rev'; chip.setAttribute('role', 'status'); chip.hidden = true;
    host.insertBefore(chip, host.firstChild);
    try { channel = new BroadcastChannel('orebit-project'); channel.onmessage = onMessage; } catch (e) { channel = null; }
    window.addEventListener('storage', function (ev) { if (ev.key === KEY) paint(); });
    setInterval(paint, 3000); // also picks up a language switch
    paint();
  }
  function init(module) {
    ME = module;
    var wire = function () {
      touch(); mount();
      if (typeof AutoSave !== 'undefined' && AutoSave.schedule && !AutoSave.__rev) {
        var original = AutoSave.schedule; AutoSave.__rev = true;
        AutoSave.schedule = function () {
          original.apply(this, arguments);
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function () { touch(); paint(); }, 1500);
        };
      }
    };
    document.addEventListener('visibilitychange', function () { if (document.hidden) touch(); });
    window.addEventListener('pagehide', touch);
    if (document.readyState === 'complete') setTimeout(wire, 800); else window.addEventListener('load', function () { setTimeout(wire, 800); });
  }
  return {init: init, touch: touch, consume: consume, status: status, register: register, paint: paint};
})();
