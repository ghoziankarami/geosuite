function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function csvSafeCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Formula-injection guard. A leading = + - @ (or tab/CR) is executed as a formula by
  // Excel/Sheets. BUT a plain finite number (e.g. -31.2, +5, 1.2e-3) is NOT a formula —
  // prefixing it corrupts numeric data (negative elevations, etc). Only guard non-numbers.
  const isPlainNumber = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s);
  if (!isPlainNumber && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // formula-injection guard
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';  // RFC4180 quoting
  return s;
}

function fmtNum(v, sig) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const digits = sig || 4;
  const a = Math.abs(n);
  // Deliberately NOT routed through fmtNum again - this is the base case.
  if (a >= 1e7 || a < 1e-4) return n.toExponential(3);
  const decimals = Math.max(0, Math.min(10, digits - 1 - Math.floor(Math.log10(a))));
  return n.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function downloadFile(filename, content, mime) {
  // OrebitHandoff.capture() runs an existing export and takes the file it
  // produces instead of saving it (module-to-module handoff, below).
  if (typeof window !== 'undefined' && typeof window.__orebitCaptureDownload === 'function') {
    window.__orebitCaptureDownload(filename, content, mime);
    return true;
  }
  const _r = orebitSaveFile(filename, content, mime);
  try {
    if (typeof window._recordExport === 'function') {
      if (!window._orebitSkipRecord) {
        window._recordExport('FILE', 'Export: ' + filename, { filename: filename, mime: mime, content: content });
      }
    }
  } catch (e) { console.warn('recordExport', e); }
  return _r;
}

function _blobToB64(blob) {
  // Returns a FULL data: URL (e.g. data:application/zip;base64,UEsD...) so
  // orebitSaveFile parses the payload as base64. A bare base64 string would be
  // re-encoded (btoa) → double-encoded corrupt file.
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () { resolve(String(fr.result)); };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function ensurePlotly() {
  return window._plotlyReady;
}

// ---- Module-to-module handoff (web build and installed app) ----
// Core -> Assay -> Resource used to mean: export a CSV, find it in Downloads,
// open the next module, upload it. The three modules share one origin, so the
// file the existing export would have written is handed over through
// IndexedDB instead, and the next module feeds it into its own upload input --
// the same import path, report and checks as a manual upload, nothing new to
// trust. The Desktop EXE runs each module separately (window.__OREBIT_RT__),
// so the buttons are not shown there. 2026-09-25.
var OrebitHandoff = (function () {
  var DB = 'orebit-handoff', STORE = 'handoff', MAX_AGE_MS = 30 * 60 * 1000;
  function available() {
    try { return typeof indexedDB !== 'undefined' && !window.__OREBIT_RT__; } catch (e) { return false; }
  }
  function db() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function (e) { var d = e.target.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function put(target, rec) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec, target);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function take(target) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE), got = null;
        var g = st.get(target);
        g.onsuccess = function () { got = g.result || null; st.delete(target); };
        tx.oncomplete = function () { resolve(got && (Date.now() - got.ts) < MAX_AGE_MS ? got : null); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  // Run an export function and capture the file it would have downloaded.
  function capture(exportFn) {
    var got = null;
    window.__orebitCaptureDownload = function (name, content) { if (!got) got = { name: name, text: String(content) }; };
    try { exportFn(); } finally { window.__orebitCaptureDownload = null; }
    return got;
  }
  // target: 'Assay' | 'Resource'. Opens <target>.html next to this module.
  function send(target, exportFn) {
    var file = capture(exportFn);
    if (!file) return Promise.resolve(false);
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    var url = target + '.html?handoff=1';
    return put(target, { name: file.name, text: file.text, ts: Date.now() }).then(function () {
      if (w) w.location.href = url; else window.location.href = url;
      return true;
    }, function (err) {
      if (w) try { w.close(); } catch (e) { /* ignore */ }
      if (typeof toast === 'function') toast('Could not hand the data over (' + (err && err.message || err) + '). Use the CSV export instead.', 'bad');
      return false;
    });
  }
  // Called once by the receiving module: if opened with ?handoff=1, load the file
  // through the module's own #fileInput, exactly like a manual upload.
  function receive(target) {
    if (!available() || !/[?&]handoff=1(&|$)/.test(location.search)) return;
    var go = function () {
      take(target).then(function (rec) {
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
        if (!rec) return;
        var input = document.getElementById('fileInput');
        if (!input || typeof DataTransfer === 'undefined') return;
        var dt = new DataTransfer();
        dt.items.add(new File([rec.text], rec.name, { type: 'text/csv' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof showTab === 'function') { try { showTab(2); } catch (e) { /* ignore */ } }
      }).catch(function (e) { console.warn('[handoff]', e); });
    };
    if (document.readyState === 'complete') setTimeout(go, 600);
    else window.addEventListener('load', function () { setTimeout(go, 600); });
  }
  return { available: available, capture: capture, send: send, receive: receive };
})();
