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
// trust. The Desktop EXEs use a short-lived file bridge through pywebview; the web
// build keeps using same-origin IndexedDB.
var OrebitHandoff = (function () {
  var DB = 'orebit-handoff', STORE = 'handoff', MAX_AGE_MS = 30 * 60 * 1000, DOMAIN_MAX = 8 * 1024 * 1024, SOURCE_MAX = 32 * 1024 * 1024;
  // S8: an accepted geological-domain solid rides with the CSV. Core supplies it through
  // window.__orebitDomainHandoff; Assay forwards what it received. Receivers treat it as data to check.
  var received = null, boundDataset = null, pendingDomain = null, receivedContexts = [], pendingSource = null;
  var pendingCheckpointReturn = null, returnedCheckpointReturn = null;
  var domainJob=0, domainValidation=Promise.resolve();
  var handoffWindows = Object.create(null);
  var importSources = new WeakMap();
  function currentDomain() { return typeof DATA !== 'undefined' && DATA === boundDataset ? received : null; }
  // Attach geometry only after the normal import gate activates the exact CSV
  // delivered with it. Tokens remain private and cannot survive dataset switches.
  function bindTextImport(input, files) {
    if (pendingDomain && files.length === 1 && files[0].name === pendingDomain.name && files[0].text === pendingDomain.text)
      importSources.set(input, pendingDomain);
    return input;
  }
  function bindFileImport(input, file) {
    if (pendingDomain && file === pendingDomain.file) importSources.set(input, pendingDomain);
    return input;
  }
  function inheritImport(from, to) {
    var token = importSources.get(from);
    if (token) importSources.set(to, token);
    return to;
  }
  function activated(input, dataset, projectContexts, projectDomain) {
    var token = importSources.get(input), record = pendingDomain;
    domainJob++;domainValidation=Promise.resolve();
    received = null; boundDataset = null; pendingDomain = null; receivedContexts = []; returnedCheckpointReturn=null;
    if (Array.isArray(projectContexts) && projectContexts.length) receivedContexts = projectContexts.slice();
    if (record && token === record) {
      boundDataset = dataset;
      acceptDomain(record.domain,record);
      if (record.source) receivedContexts = [record.source];
    } else if (projectDomain) {
      boundDataset = dataset;
      acceptDomain(JSON.stringify(projectDomain));
    } else {
      showDomain();
      try { window.dispatchEvent(new CustomEvent('orebit-domain-handoff', {detail:null})); } catch (e) { /* ignore */ }
    }
    if(pendingCheckpointReturn){var queued=pendingCheckpointReturn;pendingCheckpointReturn=null;
      setTimeout(function(){receiveAssayCheckpointReturn(queued);},0);}
  }
  function sourcePayload(file, target) {
    if(file.source){
      return validateProjectHandoffContext(file.source,file.name,file.text,target==='Resource'?'Assay':'Core').then(function(){
        var text=JSON.stringify(file.source);
        if(new TextEncoder().encode(text).length>SOURCE_MAX)throw Error('HANDOFF_SOURCE_CONTEXT_TOO_LARGE');
        return text;
      });
    }
    if (target !== 'Assay' || typeof window.__orebitSourceHandoff !== 'function' ||
        !/^drillhole-clean(?:-cropped)?\.csv$/i.test(file.name) ||
        !/^# orebit-schema=v1 source=phase1-core/m.test(file.text)) return Promise.resolve(null);
    return Promise.resolve().then(function () { return window.__orebitSourceHandoff(file); }).then(function (context) {
      var text = context ? JSON.stringify(context) : null;
      if (text && text.length > SOURCE_MAX) throw Error('HANDOFF_SOURCE_CONTEXT_TOO_LARGE');
      return text;
    });
  }
  function domainPayload(file) {
    var provide = typeof window.__orebitDomainHandoff === 'function' ? window.__orebitDomainHandoff : currentDomain;
    var mine=domainJob,coreRevision=window.OrebitCoreDomain?.sourceRevision();
    return domainValidation.then(() => provide(file)).then(async function (p) {
      if(mine!==domainJob||coreRevision!==window.OrebitCoreDomain?.sourceRevision())throw Error('HANDOFF_SOURCE_CHANGED');
      var text = p ? JSON.stringify(p) : null;
      if(text&&text.length>DOMAIN_MAX)throw Error('HANDOFF_DOMAIN_TOO_LARGE');
      if(p?.handoff?.readiness==='validated'){
        var verified=await reviewedGeologicalSnapshot(p);
        if(mine!==domainJob||coreRevision!==window.OrebitCoreDomain?.sourceRevision())throw Error('HANDOFF_SOURCE_CHANGED');
        if(!verified){p=JSON.parse(text);p.handoff={...p.handoff,readiness:'stale',volume:null};return JSON.stringify(p);}
      }
      return text;
    });
  }
  function acceptDomain(text, sourceFile) {
    var mine=++domainJob,dataset=boundDataset;
    received = null;
    if (typeof text !== 'string' || text.length > DOMAIN_MAX) return;
    var p;
    try { p = JSON.parse(text); if (!p || p.schemaVersion !== 1 || !Array.isArray(p.domains))return; } catch (e) { return; }
    showDomain();
    domainValidation=Promise.resolve().then(async function(){
      var membership=p.intervalMembership;
      if (/^drillhole-clean\.csv$/i.test(sourceFile?.name || '') && membership?.sourceExportRevision) {
        // The normal Assay owner orders/renames columns. Retain the incoming
        // CSV binding, then bind this verified packet to that activated view.
        var body=JSON.parse(JSON.stringify(membership));delete body.revision;
        var original=parseResultToColsRows(parseDrillholeCSV(sourceFile.text,{delimiter:'comma',decimal:'dot'}));
        if (membership.revision!==await _opcSha256(body) ||
            membership.sourceExportRevision!==await _opcSha256(sourceFile.text) ||
            membership.sourceRevision!==await _opcAssayDataRevision(original)) throw Error('ESTIMATION_MEMBERSHIP_SOURCE_MISMATCH');
        membership.sourceRevision=await _opcAssayDataRevision(dataset);
        delete membership.revision;membership.revision=await _opcSha256(membership);
      }
      var verified=p.handoff?.readiness==='validated'?await reviewedGeologicalSnapshot(p):null;
      if(mine!==domainJob||dataset!==boundDataset)return;
      if(!verified&&p.handoff?.readiness==='validated')p.handoff={...p.handoff,readiness:'stale',volume:null};
      received=verified||_opcFreezeGeologicalSnapshot(p);showDomain();
      try{window.dispatchEvent(new CustomEvent('orebit-domain-handoff',{detail:received}));}catch(e){/* ignore */}
    }).catch(function(){
      if(mine!==domainJob||dataset!==boundDataset)return;
      p.handoff={...p.handoff,readiness:'stale',volume:null};received=_opcFreezeGeologicalSnapshot(p);showDomain();
      try{window.dispatchEvent(new CustomEvent('orebit-domain-handoff',{detail:received}));}catch(e){/* ignore */}
    });
  }
  // Receiver notice: what arrived and its readiness when Core sent it. Imported names are escaped.
  function showDomain() {
    var box = document.getElementById('domainHandoffNote');
    if (!box) return;
    box.hidden = !received;
    if (!received) { box.innerHTML = ''; return; }
    var esc = function (v) { return String(v).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
    var h = received.handoff || {}, state = ['validated', 'stale', 'invalid'].indexOf(h.readiness) >= 0 ? h.readiness : 'invalid';
    var codes = received.domains.map(function (d) { return esc(d.code); }).join(', ');
    var vol = state === 'validated' && Number.isFinite(h.volume) ? ' · ' + Math.round(h.volume).toLocaleString('en-US') + ' m³' : '';
    var isResource = !!document.getElementById('blockModelContent');
    var applied = isResource && state === 'validated' && window.__resourceBlockSupport && window.__resourceBlockSupport.received === received;
    var note = applied ? 'dom.handoff.noteApplied' : 'dom.handoff.note';
    box.dataset.readiness = state;
    box.innerHTML = '<strong data-i18n="dom.handoff.title">Geological domain from Core</strong> '
      + '<span class="domain-handoff-codes">' + codes + vol + '</span> · '
      + '<span data-i18n="dom.handoff.' + state + '"></span>'
      + '<p data-i18n="' + note + '"></p>';
    if (typeof translateTree === 'function') translateTree(box);
  }
  function available() {
    try { return !!window.__OREBIT_RT__ || typeof indexedDB !== 'undefined'; } catch (e) { return false; }
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
  // target: 'Assay' | 'Resource'. Web opens the next page; Desktop stores
  // a short-lived CSV and opens the sibling EXE if it is installed.
  function sourceStateKey(){
    if(typeof DATA!=='undefined')return JSON.stringify({columns:DATA.cols||DATA.columns,rows:DATA.rows,units:DATA.units||{}});
    if(typeof STATE!=='undefined')return JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology,STATE.units,STATE.crs,window.OrebitCoreScope?.record()]);
    return null;
  }
  function send(target, exportFn) {return sendFile(target,capture(exportFn));}
  function sendFile(target,file,openedWindow) {
    if(!['Assay','Resource'].includes(target)||!file||typeof file.name!=='string'||typeof file.text!=='string'||!file.name||!file.text)return Promise.resolve(false);
    var job=domainJob,key=sourceStateKey();
    function current(){if(job!==domainJob||sourceStateKey()!==key||typeof file.isCurrent==='function'&&!file.isCurrent())throw Error('HANDOFF_SOURCE_CHANGED');}

    if (window.__OREBIT_RT__) {
      var api = window.pywebview && window.pywebview.api;
      if (!api || typeof api.send_handoff !== 'function') {
        downloadFile(file.name, file.text, 'text/csv');
        if (typeof toast === 'function') toast('Desktop bridge unavailable; CSV exported for manual import.', 'bad');
        return Promise.resolve(false);
      }
      return Promise.all([domainPayload(file), sourcePayload(file, target)]).then(function (payloads) {
        current();
        var domain = payloads[0], source = payloads[1];
        if (source) return api.send_handoff(target, file.name, file.text, domain, source);
        return domain ? api.send_handoff(target, file.name, file.text, domain) : api.send_handoff(target, file.name, file.text);
      }).then(function (result) {
        if (!result || !result.ok) {
          if (typeof toast === 'function') toast('Handoff failed: ' + (result && result.error || 'unknown error'), 'bad');
          return false;
        }
        if (!result.launched && typeof toast === 'function')
          toast('Handoff ready. Open Orebit-' + target + '.exe within 30 minutes to import.', 'good');
        return true;
      }).catch(function (err) {
        if (typeof toast === 'function') toast('Handoff failed: ' + (err && err.message || err), 'bad');
        return false;
      });
    }
    var w = openedWindow === undefined ? null : openedWindow;
    if(openedWindow === undefined)try { w = window.open('', '_blank'); } catch (e) { w = null; }
    var url = target + '.html?handoff=1';
    return Promise.all([domainPayload(file), sourcePayload(file, target)]).then(function (payloads) {
      current();
      return put(target, { name: file.name, text: file.text, domain: payloads[0], source: payloads[1], ts: Date.now() });
    }).then(function () {
      if (w) handoffWindows[target] = w;
      if (w) w.location.href = url; else window.location.href = url;
      return true;
    }, function (err) {
      if (w) try { w.close(); } catch (e) { /* ignore */ }
      if (typeof toast === 'function') toast('Could not hand the data over (' + (err && err.message || err) + '). Use the CSV export instead.', 'bad');
      return false;
    });
  }
  function sendEDAReference(reference) {
    return Promise.resolve().then(function () { return validateAssayEDAReference(reference); }).then(function () {
      var outgoing = reference, text = JSON.stringify(outgoing);
      if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) {
        return compactAssayEDAReference(reference, 50).then(function (compact) {
          outgoing = compact; text = JSON.stringify(outgoing);
          if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw Error('EDA_REFERENCE_TOO_LARGE');
          return transmitEDAReference(outgoing, text);
        });
      }
      return transmitEDAReference(outgoing, text);
    });
  }
  function sendAssayCheckpointReturn(packet) {
    return Promise.resolve().then(function () { return validateAssayCheckpointReturn(packet); }).then(function () {
      var text = JSON.stringify(packet);
      if (new TextEncoder().encode(text).length > DOMAIN_MAX) throw Error('ASSAY_CHECKPOINT_RETURN_TOO_LARGE');
      if (window.__OREBIT_RT__) {
        var api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.send_assay_checkpoint_return !== 'function') throw Error('ASSAY_CHECKPOINT_RETURN_BRIDGE_UNAVAILABLE');
        return api.send_assay_checkpoint_return(text).then(function (result) {
          return result && result.ok ? {ok:true,status:'pending'} : {ok:false,error:result && result.error};
        });
      }
      var assay = handoffWindows.Assay;
      if (!assay || assay.closed) {
        downloadFile('Orebit-Assay-checkpoint-return.json', JSON.stringify(packet, null, 2), 'application/json');
        return {ok:false,error:'ASSAY_CHECKPOINT_RETURN_TAB_UNAVAILABLE',recovery:'download'};
      }
      var requestId = 'assay-return-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      return new Promise(function (resolve) {
        var done=false, timer=setTimeout(function(){finish({ok:false,error:'ASSAY_CHECKPOINT_RETURN_ACK_TIMEOUT'});},8000);
        function finish(result){if(done)return;done=true;clearTimeout(timer);window.removeEventListener('message',onAck);resolve(result);}
        function onAck(event){if(event.origin!==location.origin||event.data?.type!=='orebit-assay-checkpoint-return-ack'||event.data.requestId!==requestId)return;finish(event.data);}
        window.addEventListener('message',onAck);
        try { assay.postMessage({type:'orebit-assay-checkpoint-return',requestId,packet},location.origin); }
        catch(error){finish({ok:false,error:'ASSAY_CHECKPOINT_RETURN_POST_FAILED'});}
      }).then(function(result){
        if(!result.ok){downloadFile('Orebit-Assay-checkpoint-return.json',JSON.stringify(packet,null,2),'application/json');result.recovery='download';}
        return result;
      });
    });
  }
  function receiveDesktopAssayCheckpointReturn() {
    if (!window.__OREBIT_RT__) return;
    var tries=0,timer=setInterval(function(){
      var api=window.pywebview&&window.pywebview.api;
      if(api&&typeof api.take_assay_checkpoint_return==='function'){
        clearInterval(timer);
        api.take_assay_checkpoint_return().then(function(text){
          if(!text)return;
          var packet=typeof text==='string'?JSON.parse(text):text;
          return receiveAssayCheckpointReturn(packet);
        }).catch(function(error){console.warn('[Assay checkpoint return]',error);});
      } else if(++tries>=50) clearInterval(timer);
    },200);
  }
  function receiveAssayCheckpointReturn(packet) {
    if(typeof DATA==='undefined'||!DATA?.rows?.length||!receivedContexts.length){
      pendingCheckpointReturn=packet;
      window.OrebitAssayWorkflow?.setCheckpointReturnStatus({status:'pending'});
      return Promise.resolve({ok:true,status:'pending'});
    }
    return window.OrebitAssayWorkflow.receiveCheckpointReturn(packet);
  }
  function recordAssayCheckpointReturn(packet){returnedCheckpointReturn=packet?JSON.parse(JSON.stringify(packet)):null;return returnedCheckpointReturn;}
  function restoreAssayCheckpointReturn(packet){return receiveAssayCheckpointReturn(packet);}
  function importAssayCheckpointReturnFile(file) {
    if(!file||file.size>DOMAIN_MAX)return Promise.reject(Error('ASSAY_CHECKPOINT_RETURN_TOO_LARGE'));
    return file.text().then(function(text){return receiveAssayCheckpointReturn(JSON.parse(text));});
  }
  if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
    window.addEventListener('message',async function(event){
      if(event.origin!==location.origin||event.data?.type!=='orebit-assay-checkpoint-return')return;
      var result;
      try { result=await receiveAssayCheckpointReturn(event.data.packet); }
      catch(error){result={ok:false,error:error.code||error.message||'ASSAY_CHECKPOINT_RETURN_REJECTED'};}
      try { event.source?.postMessage({type:'orebit-assay-checkpoint-return-ack',requestId:event.data.requestId,...result},event.origin); } catch(error){/* closed target */}
    });
    window.addEventListener('load',receiveDesktopAssayCheckpointReturn,{once:true});
  }
  function transmitEDAReference(reference, text) {
      if (window.__OREBIT_RT__) {
        var api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.send_eda_reference !== 'function') throw Error('EDA_REFERENCE_DESKTOP_BRIDGE_UNAVAILABLE');
        return api.send_eda_reference(text).then(function (result) {
          return result && result.ok ? {ok:true,status:reference.proposal.summaryOnly?'summary-only':'pending'} : {ok:false,error:result && result.error};
        });
      }
      var opener = window.opener;
      if (!opener || opener.closed) {
        downloadFile('Orebit-Assay-EDA-reference.json', JSON.stringify(reference, null, 2), 'application/json');
        return {ok:false,error:'EDA_REFERENCE_OPENER_UNAVAILABLE',recovery:'download',status:reference.proposal.summaryOnly?'summary-only':null};
      }
      var requestId = 'eda-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () { finish({ok:false,error:'EDA_REFERENCE_ACK_TIMEOUT'}); }, 8000);
        function finish(result) {
          if (done) return; done = true; clearTimeout(timer);
          window.removeEventListener('message', onAck); resolve(result);
        }
        function onAck(event) {
          if (event.origin !== location.origin || event.data?.type !== 'orebit-assay-eda-reference-ack' || event.data.requestId !== requestId) return;
          finish(event.data);
        }
        window.addEventListener('message', onAck);
        try { opener.postMessage({type:'orebit-assay-eda-reference',requestId,reference}, location.origin); }
        catch (error) { finish({ok:false,error:'EDA_REFERENCE_POST_FAILED'}); }
      }).then(function (result) {
        if (!result.ok) {
          downloadFile('Orebit-Assay-EDA-reference.json', JSON.stringify(reference, null, 2), 'application/json');
          result.recovery = 'download';
        }
        return result;
      });
  }
  function receiveDesktopAssayReference() {
    if (!window.__OREBIT_RT__) return;
    var tries = 0, timer = setInterval(function () {
      var api = window.pywebview && window.pywebview.api;
      if (api && typeof api.take_eda_reference === 'function') {
        clearInterval(timer);
        api.take_eda_reference().then(function (text) {
          if (!text) return;
          var reference = typeof text === 'string' ? JSON.parse(text) : text;
          return window.OrebitCoreEDAReference.receive(reference);
        }).catch(function (error) { console.warn('[Core EDA reference]', error); });
      } else if (++tries >= 50) clearInterval(timer);
    }, 200);
  }
  function importRecord(rec,target) {
    if (!rec) return Promise.resolve(false);
    var verifiedSource = Promise.resolve(null);
    if (rec.source) {
      verifiedSource = Promise.resolve().then(function () {
        var context = typeof rec.source === 'string' ? JSON.parse(rec.source) : rec.source;
        if (typeof validateProjectHandoffContext !== 'function') throw Error('PROJECT_CONTEXT_VALIDATOR_UNAVAILABLE');
        return validateProjectHandoffContext(context,rec.name,rec.text,target==='Resource'?'Assay':'Core');
      }).catch(function (error) { console.warn('[handoff] source context rejected; importing CSV without parent context', error); return null; });
    }
    return verifiedSource.then(function (source) {
    var input = document.getElementById('fileInput');
    if (!input || typeof DataTransfer === 'undefined') return false;
    var dt = new DataTransfer();
    var file = new File([rec.text], rec.name, { type: 'text/csv' });
    pendingSource = source;
    pendingDomain = {name:rec.name,text:rec.text,domain:rec.domain,file:file,source:source};
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof showTab === 'function') { try { showTab(2); } catch (e) { /* ignore */ } }
    return true;
    });
  }
  // Web consumes the IndexedDB record only when explicitly opened by handoff.
  // Desktop checks its own short-lived record once after pywebview is ready.
  function receive(target) {
    if (window.__OREBIT_RT__) {
      if (target !== 'Assay' && target !== 'Resource') return;
      var started = false, tries = 0;
      var timer = setInterval(function () {
        var api = window.pywebview && window.pywebview.api;
        if (api && typeof api.take_handoff === 'function') {
          clearInterval(timer);
          if (started) return;
          started = true;
          api.take_handoff().then(function (rec) {
            if (rec) setTimeout(function () { importRecord(rec,target); }, 600);
          }).catch(function (e) { console.warn('[handoff]', e); });
        } else if (++tries >= 50) clearInterval(timer);
      }, 200);
      return;
    }
    if (!available() || !/[?&]handoff=1(&|$)/.test(location.search)) return;
    var go = function () {
      take(target).then(function (rec) {
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
        importRecord(rec,target);
      }).catch(function (e) { console.warn('[handoff]', e); });
    };
    if (document.readyState === 'complete') setTimeout(go, 600);
    else window.addEventListener('load', function () { setTimeout(go, 600); });
  }
  return { available: available, capture: capture, send: send, sendFile:sendFile, receive: receive,
    bindTextImport:bindTextImport, bindFileImport:bindFileImport, inheritImport:inheritImport, activated:activated,
    domainReady:function(){return domainValidation;}, domain: currentDomain, contexts: function () { return receivedContexts.slice(); }, showDomain: showDomain,
    sendEDAReference: sendEDAReference, receiveDesktopAssayReference: receiveDesktopAssayReference,
    sendAssayCheckpointReturn:sendAssayCheckpointReturn, receiveDesktopAssayCheckpointReturn:receiveDesktopAssayCheckpointReturn,
    receiveAssayCheckpointReturn:receiveAssayCheckpointReturn, importAssayCheckpointReturnFile:importAssayCheckpointReturnFile,
    recordAssayCheckpointReturn:recordAssayCheckpointReturn, restoreAssayCheckpointReturn:restoreAssayCheckpointReturn,
    checkpointReturnRecord:function(){return returnedCheckpointReturn?JSON.parse(JSON.stringify(returnedCheckpointReturn)):null;},
    acceptReturnedDomain:async function(domain){
      if(typeof DATA==='undefined')return false;
      var dataset=DATA,mine=++domainJob,pending=reviewedGeologicalSnapshot(domain);
      domainValidation=pending.then(function(){},function(){});
      var verified=await pending;
      if(!verified||DATA!==dataset||mine!==domainJob)return false;
      boundDataset=DATA;received=verified;showDomain();
      try{window.dispatchEvent(new CustomEvent('orebit-domain-handoff',{detail:received}));}catch(e){/* ignore */}
      return true;
    } };
})();
