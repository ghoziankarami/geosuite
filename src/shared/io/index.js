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
