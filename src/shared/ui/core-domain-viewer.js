/* Domain S3 preview: one Plan / Section / 3D workspace over Core's own interval endpoints.
   Section digitizing/editing and validated solid previews reuse the Core data owners. */
(function () {
  'use strict';
  const BUDGET_MS = 33;
  const PAD = 52;
  const MISSING = '#9ca3af';
  const RAMP = ['#440154','#46327e','#365c8d','#277f8e','#1fa187','#4ac16d','#a0da39','#fde725'];
  const VE_STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 50];
  const LABEL_LIMIT = 60;
  const view = {mode:'plan', colour:'lith', azimuth:90, width:25, offset:0, ve:1, veAuto:true, stride:1, hidden:new Set()};
  let workflowStep='book', buildMethod='contacts';
  let fit = null;
  // Display-only camera: never part of ring coordinates, Undo or accepted science.
  const sectionCamera={key:null,range:null,zoom:1};
  let sectionRange=null;
  function zoomSection(factor,anchor=null) {
    if(view.mode!=='section'||!fit||!sectionRange)return;
    const zoom=Math.max(0.25,Math.min(32,sectionCamera.zoom*factor));
    if(zoom===sectionCamera.zoom)return;
    const ratio=zoom/sectionCamera.zoom;
    const centre=anchor?fit.toWorld(...anchor):['h','v'].map(axis=>(sectionRange[axis][0]+sectionRange[axis][1])/2);
    const next={};
    for(const [i,axis] of ['h','v'].entries())next[axis]=sectionRange[axis].map(value=>centre[i]+(value-centre[i])/ratio);
    sectionCamera.range=next;sectionCamera.zoom=zoom;render();
  }
  function fitSection(){sectionCamera.range=null;sectionCamera.zoom=1;render();}
  let planHits=[],planFrame=null;
  let here = null; // the section shown now: {offset, origin, plane}
  // S4 contact picks. Recomputed only when a contact control changes or the tab is reopened (the TIN is O(n²)).
  const contact = {rule:'first_from', target:'', threshold:null, maxEdge:null, result:null, error:null};
  // S7 solid between the top (chosen rule, or first_from) and base (last_to) of the same domain. Built only on request.
  const solid = {sourceMode:'interval',upperSurface:'',lowerSurface:'',topography:'', terrainSurface:null, density:null, result:null, error:null, reviewed:false, code:'', accepted:null};
  function clearReview(){solid.reviewed=false;solid.reviewer='';solid.reason='';}
  let surfaceCandidate=null;
  // Layer isolation is a transient view, never a visibility or interpretation edit.
  let selectedLayer=null,layerJob=0;
  async function selectLayer(kind,id){
    const job=++layerJob,source=OrebitCoreDomain.sourceRevision(),opener=document.activeElement;
    try{
      const surface=kind==='surface'?await OrebitCoreDomain.previewContactSurface(id):null;
      if(job!==layerJob||source!==OrebitCoreDomain.sourceRevision())return;
      if(kind==='solid'&&!OrebitCoreDomain.displaySolids().some(d=>d.code===id))return;
      selectedLayer={kind,id,surface,source,revision:OrebitCoreDomain.interpretationRevision()};
      view.mode='3d';render();
      if(document.activeElement===opener||!opener?.isConnected){
        [...document.querySelectorAll('#domainTree button')].find(b=>kind==='surface'?b.dataset.surfaceId===id:b.dataset.domainCode===id)?.focus({preventScroll:true});
      }
    }catch(error){if(job===layerJob)toast(error.message||'DOMAIN_SURFACE_STALE','warn');}
  }
  // S5/S6 section loft: one ring per section, digitised in Section view (distance, RL). Undo/redo keeps 60 steps.
  const loft = {tool:'navigate', draft:[], sections:[], endRule:'', snap:2, undo:[], redo:[], error:null, selection:null, domainCode:null};
  const UNDO_LIMIT = 60;
  // Editable contexts are separate from accepted scientific builds. Switching
  // definitions must never reuse another domain's rings, review or Undo stack.
  let domainDrafts=[];
  const copy=value=>JSON.parse(JSON.stringify(value));
  function editorContext(){
    return {loft:{draft:loft.draft,draftAt:loft.draftAt||null,sections:loft.sections,domainCode:loft.domainCode,
      endRule:loft.endRule,snap:loft.snap,undo:loft.undo,redo:loft.redo},
      contact:{rule:contact.rule,target:contact.target,threshold:contact.threshold,maxEdge:contact.maxEdge},
      solid:{sourceMode:solid.sourceMode,upperSurface:solid.upperSurface,lowerSurface:solid.lowerSurface,topography:solid.topography,terrainSurface:solid.terrainSurface,density:solid.density,code:solid.code},method:buildMethod};
  }
  function stashDomain(){
    if(!contact.target.startsWith('book:'))return;
    const snapshot=copy(editorContext());
    domainDrafts=domainDrafts.filter(d=>d.contact.target!==contact.target).concat(snapshot);
  }
  function selectDomain(target){
    if(target===contact.target)return;
    const previous=contact.target;
    stashDomain();
    const saved=domainDrafts.find(d=>d.contact.target===target);
    const code=target.startsWith('book:')?target.slice(5):'';
    const accepted=OrebitCoreDomain.exportState().domains.find(d=>d.code===code);
    // An untargeted new draft can acquire its first definition. Otherwise the
    // next definition starts empty or resumes its own saved editor context.
    if(saved||previous||accepted){
      Object.assign(loft,{draft:[],draftAt:null,sections:[],domainCode:null,endRule:'',snap:2,undo:[],redo:[]});
      Object.assign(contact,{rule:'first_from',threshold:null,maxEdge:null});
      Object.assign(solid,{sourceMode:'interval',upperSurface:'',lowerSurface:'',topography:'',terrainSurface:null,density:null,code});
      if(saved){
        const restored=copy(saved);
        Object.assign(loft,restored.loft);Object.assign(contact,restored.contact);Object.assign(solid,restored.solid);buildMethod=restored.method;
      }else if(accepted){
        // Legacy projects have only one workspace. Recover another accepted
        // loft's editable rings from its provenance; never manufacture review.
        const inputs=accepted.build.inputs,rules=inputs?.rules;
        if(rules?.method==='section-loft'){
          loft.sections=copy(inputs.sections).map(s=>({...s,normal:OrebitGeometryPrimitives.sectionPlane([...s.origin,0],s.azimuth).normal.slice()}));
          loft.endRule=rules.endRule;loft.snap=rules.snapRadius;buildMethod='loft';
        }else if(rules?.method==='surface-pair'){solid.sourceMode='pair';solid.upperSurface=rules.upperSurface;solid.lowerSurface=rules.lowerSurface;buildMethod='contacts';
        }else if(rules){contact.rule=rules.top;contact.threshold=rules.threshold??null;contact.maxEdge=rules.maxEdge??null;buildMethod='contacts';}
        solid.topography=rules?.topography||'';solid.terrainSurface=solid.topography==='imported'?copy(inputs.terrainSurface):null;
        solid.density=accepted.density??null;
      }
    }
    contact.target=target;loft.domainCode=code||null;
    Object.assign(loft,{selection:null,error:null,tool:'navigate'});
    Object.assign(contact,{result:null,error:null});Object.assign(solid,{result:null,error:null,accepted:null});clearReview();
  }
  let workspaceSource = -1, cachedScene = null, renderJob=0, webgl=null, fallback3d=false;
  let cachedPlanGroups=null;
  const drawnPaths=new WeakMap();
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const tt = (key, values = {}) => Object.entries(values).reduce((out, [k, v]) => out.replaceAll('{' + k + '}', String(v)), t(key));
  const span = values => { let lo = Infinity, hi = -Infinity; for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; } return lo <= hi ? [lo, hi] : [-1, 1]; };
  const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const fmt = (v, digits = 0) => Number(v).toLocaleString(undefined, {maximumFractionDigits:digits, minimumFractionDigits:digits});
  const niceStep = range => { const raw = range / 6, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map(m => m * p).find(s => s >= raw); };
  const stepVE = need => (need > 1 ? (VE_STEPS.find(v => v >= need) || VE_STEPS[VE_STEPS.length - 1]) : 1);
  // Smallest listed VE that gives the vertical extent at least `share` of the room it has.
  // A zoomed phone can leave fewer than 2*PAD layout pixels; keep a positive plot.
  const plotPadding = (w,h) => Math.min(PAD,w/4,h/4);
  const fitVE = (hSpan, vSpan, w, h, share) => {
    const pad=plotPadding(w,h);
    return stepVE(share * (h - 2 * pad) / ((w - 2 * pad) / Math.max(hSpan, 1e-9) * Math.max(vSpan, 1e-9)));
  };
  const collarsOf = holes => STATE.collar.filter(c => holes.has(c.hole_id) && [c.x, c.y, c.z].every(v => v !== '' && v != null && Number.isFinite(Number(v))))
    .map(c => ({id:c.hole_id, x:Number(c.x), y:Number(c.y), z:Number(c.z)}));

  function colourer() {
    if (view.colour === 'lith') {
      const rows = STATE.geology;
      const counts = new Map();
      for (const r of rows) { const k = r.lith1 == null || r.lith1 === '' ? '' : String(r.lith1); counts.set(k, (counts.get(k) || 0) + 1); }
      const colour = v => (v == null || v === '' ? MISSING : lithoColor(v));
      return {table:'geology', value:i => rows[i].lith1, colour, key:v => (v == null ? '' : String(v)), counts};
    }
    const rows = STATE.assay, col = view.colour;
    const num = v => (v === '' || v == null ? NaN : Number(v));
    const [lo, hi] = span(rows.map(r => num(r[col])).filter(Number.isFinite));
    const bin = v => { const x = num(v); return Number.isFinite(x) ? (hi > lo ? Math.min(RAMP.length - 1, Math.floor((x - lo) / (hi - lo) * RAMP.length)) : 0) : null; };
    return {table:'assay', value:i => rows[i][col], colour:v => { const b = bin(v); return b == null ? MISSING : RAMP[b]; },
      key:v => { const b = bin(v); return b == null ? '' : 'bin' + b; }, ramp:{label:plotName(col), lo, hi}};
  }
  // One path or trace per colour keeps the draw batched. Hidden key entries and stride > 1 thin the display only.
  function groupByColour(items, paint, project) {
    const groups = new Map();
    let hidden = 0;
    for (let i = 0; i < items.length; i += view.stride) {
      if (view.hidden.has(paint.key(items[i].value))) { hidden++; continue; }
      const c = paint.colour(items[i].value);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(project(items[i]));
    }
    return {groups, hidden};
  }
  // CSS zoom/container changes do not emit a window resize. Refresh the bitmap/fit together.
  let canvasObserver=null,canvasResizeFrame=0;
  function observeCanvas(canvas) {
    canvasObserver?.disconnect();
    if(canvasResizeFrame){cancelAnimationFrame(canvasResizeFrame);canvasResizeFrame=0;}
    if(typeof ResizeObserver==='undefined')return;
    let width=canvas.clientWidth,height=canvas.clientHeight;
    canvasObserver=new ResizeObserver(()=>{
      const nextWidth=canvas.clientWidth,nextHeight=canvas.clientHeight;
      if(!nextWidth||!nextHeight||nextWidth===width&&nextHeight===height)return;
      width=nextWidth;height=nextHeight;
      if(canvasResizeFrame)return;
      canvasResizeFrame=requestAnimationFrame(()=>{
        canvasResizeFrame=0;
        if(canvas.isConnected&&$('domainViewerCanvas')===canvas&&$('tab14')?.classList.contains('active')&&view.mode!=='3d')render();
      });
    });
    canvasObserver.observe(canvas);
  }
  // Client events use rendered pixels; the fit and hit radii use canvas layout pixels.
  function canvasPoint(canvas,event) {
    const rect=canvas.getBoundingClientRect();
    return [(event.clientX-rect.left)*canvas.clientWidth/rect.width,(event.clientY-rect.top)*canvas.clientHeight/rect.height];
  }
  function planSectionAt(x,y){
    if(view.mode!=='plan'||!planFrame||x<planFrame.left||x>planFrame.right||y<planFrame.top||y>planFrame.bottom)return null;
    let selected=null,best=9;
    for(const line of planHits){
      const dx=line.b[0]-line.a[0],dy=line.b[1]-line.a[1],den=dx*dx+dy*dy;
      if(!den)continue;
      const u=Math.max(0,Math.min(1,((x-line.a[0])*dx+(y-line.a[1])*dy)/den));
      const distance=Math.hypot(x-line.a[0]-u*dx,y-line.a[1]-u*dy);
      if(distance<best){selected=line;best=distance;}
    }
    return selected;
  }
  // Grid, axes, coloured intervals, then collar markers, hole labels and the section trace on top.
  function draw(canvas, range, groups, opt) {
    const ratio = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad=plotPadding(w,h);
    fit = OrebitDomainViewerScene.fitView(range, w, h, opt.ve, pad);
    const [x0, y1] = fit.toScreen(range.h[0], range.v[0]), [x1, y0] = fit.toScreen(range.h[1], range.v[1]);
    const fg = token('--fg', '#0f172a'), mute = token('--fg-mute', '#64748b'), card = token('--bg-card', '#ffffff'), accent = token('--accent', '#0f766e');
    // Frame is the whole plot area, so labels above the top collars and outside the data stay visible.
    const inset=Math.min(34,pad*34/PAD);
    const left = inset, right = w - pad / 2, top = pad / 2, bottom = h - inset;
    planFrame={left,right,top,bottom};planHits=[];
    ctx.font = '11px system-ui, sans-serif'; ctx.lineWidth = 1;
    const hStep = niceStep(range.h[1] - range.h[0] || 1), vStep = niceStep(range.v[1] - range.v[0] || 1);
    ctx.strokeStyle = token('--border', '#e2e8f0'); ctx.fillStyle = mute;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(range.h[0] / hStep) * hStep; v <= range.h[1]; v += hStep) {
      const [sx] = fit.toScreen(v, 0); ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx, bottom); ctx.stroke();
      ctx.fillText(fmt(v), sx, bottom + 5);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (let v = Math.ceil(range.v[0] / vStep) * vStep; v <= range.v[1]; v += vStep) {
      const [, sy] = fit.toScreen(0, v); ctx.beginPath(); ctx.moveTo(left, sy); ctx.lineTo(right, sy); ctx.stroke();
      ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = token('--bg-alt', '#f8fafc'); ctx.strokeText(fmt(v), left + 4, sy - 2); ctx.restore();
      ctx.fillText(fmt(v), left + 4, sy - 2);
    }
    ctx.fillStyle = fg; ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(opt.axes[0], (left + right) / 2, h - 4);
    ctx.save(); ctx.translate(11, (top + bottom) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(opt.axes[1], 0, 0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    for (const line of opt.traces || []) {
      const [a, b] = line.points.map(p => fit.toScreen(p[0], p[1]));
      planHits.push({...line,a,b});
      ctx.setLineDash(line.selected ? [10, 6] : [3, 5]); ctx.lineWidth = line.selected ? 2.5 : 1; ctx.strokeStyle = line.selected ? accent : mute;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      if(line.label&&line.labelAnchor&&(line.selected||line.showLabel)){
        const [x,y]=fit.toScreen(...line.labelAnchor);ctx.font='600 11px system-ui, sans-serif';ctx.textAlign='left';ctx.textBaseline='bottom';
        ctx.save();ctx.setLineDash([]);ctx.lineWidth=3;ctx.strokeStyle=card;ctx.strokeText(line.label,x+5,y-3);ctx.fillStyle=line.selected?accent:mute;ctx.fillText(line.label,x+5,y-3);ctx.restore();
      }
    }
    ctx.setLineDash([]);
    ctx.lineCap = opt.lineCap;
    if (opt.outline) {
      // A darker casing under the colours separates touching intervals and frames each hole trace.
      const casing = new Path2D();
      for (const segs of groups.values()) for (const [h0, v0, h1, v1] of segs) { const a = fit.toScreen(h0, v0), b = fit.toScreen(h1, v1); casing.moveTo(a[0], a[1]); casing.lineTo(b[0], b[1]); }
      ctx.lineWidth = opt.lineWidth + 3; ctx.strokeStyle = fg; ctx.globalAlpha = 0.55; ctx.stroke(casing); ctx.globalAlpha = 1;
    }
    ctx.lineWidth = opt.lineWidth;
    for (const [colour, segs] of groups) {
      const projectionKey=[w,h,...range.h,...range.v,opt.ve,pad].join('|');
      let cached=drawnPaths.get(segs);
      if(!cached||cached.key!==projectionKey){
        const path=new Path2D();
        for (const [h0,v0,h1,v1] of segs){const a=fit.toScreen(h0,v0),b=fit.toScreen(h1,v1);path.moveTo(a[0],a[1]);path.lineTo(b[0],b[1]);}
        cached={key:projectionKey,path};drawnPaths.set(segs,cached);
      }
      ctx.strokeStyle=colour;ctx.stroke(cached.path);
    }
    const marks = new Path2D();
    for (const [hh, vv] of opt.collars) { const [sx, sy] = fit.toScreen(hh, vv); marks.moveTo(sx + 4, sy); marks.arc(sx, sy, 4, 0, 2 * Math.PI); }
    ctx.fillStyle = card; ctx.fill(marks); ctx.lineWidth = 1.5; ctx.strokeStyle = fg; ctx.stroke(marks);
    if (opt.collars.length <= LABEL_LIMIT) {
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3; ctx.strokeStyle = card; ctx.fillStyle = fg; ctx.lineJoin = 'round';
      for (const [hh, vv, name] of opt.collars) { const [sx, sy] = fit.toScreen(hh, vv); ctx.strokeText(name, sx, sy - 7); ctx.fillText(name, sx, sy - 7); }
    }
    if (opt.contacts) {
      const c = opt.contacts, warn = token('--warn', '#b45309');
      if (c.edges.length) {
        const mesh = new Path2D();
        for (const [h0, v0, h1, v1] of c.edges) { const a = fit.toScreen(h0, v0), b = fit.toScreen(h1, v1); mesh.moveTo(a[0], a[1]); mesh.lineTo(b[0], b[1]); }
        ctx.lineWidth = 1; ctx.strokeStyle = accent; ctx.globalAlpha = 0.6; ctx.stroke(mesh); ctx.globalAlpha = 1;
      }
      const hit = new Path2D(), miss = new Path2D();
      for (const [hh, vv] of c.points) { const [sx, sy] = fit.toScreen(hh, vv); hit.moveTo(sx + 5, sy); hit.arc(sx, sy, 5, 0, 2 * Math.PI); }
      for (const [hh, vv] of c.missing) { const [sx, sy] = fit.toScreen(hh, vv); miss.moveTo(sx - 5, sy - 5); miss.lineTo(sx + 5, sy + 5); miss.moveTo(sx + 5, sy - 5); miss.lineTo(sx - 5, sy + 5); }
      ctx.fillStyle = accent; ctx.fill(hit); ctx.lineWidth = 1.5; ctx.strokeStyle = card; ctx.stroke(hit);
      ctx.lineWidth = 2.5; ctx.strokeStyle = warn; ctx.stroke(miss);
    }
    if (opt.loft) {
      const warn = token('--warn', '#b45309');
      ctx.lineWidth = 2; ctx.strokeStyle = warn; ctx.fillStyle = warn; ctx.setLineDash([]);
      for (const ring of opt.loft.rings) {
        const path = new Path2D();
        ring.forEach(([hh, vv], i) => { const [sx, sy] = fit.toScreen(hh, vv); if (i) path.lineTo(sx, sy); else path.moveTo(sx, sy); });
        path.closePath(); ctx.globalAlpha = 0.18; ctx.fill(path); ctx.globalAlpha = 1; ctx.stroke(path);
        if (opt.loft.edit) for (const [hh, vv] of ring) { const [sx, sy] = fit.toScreen(hh, vv); ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 2 * Math.PI); ctx.fill(); }
      }
      if (opt.loft.draft.length) {
        const path = new Path2D(), dots = new Path2D();
        opt.loft.draft.forEach(([hh, vv], i) => { const [sx, sy] = fit.toScreen(hh, vv); if (i) path.lineTo(sx, sy); else path.moveTo(sx, sy); dots.moveTo(sx + 4, sy); dots.arc(sx, sy, 4, 0, 2 * Math.PI); });
        ctx.setLineDash([6, 4]); ctx.stroke(path); ctx.setLineDash([]); ctx.fill(dots);
      }
    }
    if (opt.loft?.selected) {
      const [sx, sy] = fit.toScreen(...opt.loft.selected); ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.strokeStyle = accent; ctx.stroke();
    }
    ctx.restore();
    const chosen = (opt.traces || []).find(l => l.selected);
    if (chosen) {
      ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const [a, b] = chosen.points.map(p => fit.toScreen(p[0], p[1])).map(([sx, sy]) => [Math.min(Math.max(sx, left + 10), right - 10), Math.min(Math.max(sy, top + 10), bottom - 10)]);
      ctx.fillText('A', a[0], a[1]); ctx.fillText('A′', b[0], b[1]);
    }
    return {vFill:(range.v[1] - range.v[0]) * fit.scale * opt.ve / (h - 2 * pad)};
  }
  function keyList(paint, drawnCounts) {
    const box = $('domainKeyList'), legend = $('domainViewerLegend'); box.textContent = ''; legend.textContent = '';
    if(selectedLayer){
      const chip=el('span','domain-legend-chip'),swatch=el('i');
      swatch.style.background=selectedLayer.kind==='solid'?OrebitCoreDomain.displaySolids().find(d=>d.code===selectedLayer.id)?.colour||token('--accent','#0f766e'):token('--accent','#0f766e');
      chip.append(swatch,document.createTextNode(t('dom.layers.'+selectedLayer.kind+'Type')+' · '+selectedLayer.id));box.append(chip);legend.append(chip.cloneNode(true));return;
    }
    if (paint.ramp) {
      const bar = el('div', 'domain-ramp'); bar.style.background = 'linear-gradient(90deg,' + RAMP.join(',') + ')';
      const ends = el('div', 'domain-ramp-ends'); ends.append(el('span', null, fmt(paint.ramp.lo, 3)), el('span', null, fmt(paint.ramp.hi, 3)));
      box.append(el('p', 'domain-key-name', paint.ramp.label), bar, ends);
      legend.append(el('span', null, paint.ramp.label), el('span', 'domain-ramp domain-ramp-small'));
      legend.lastChild.style.background = bar.style.background;
      return;
    }
    const codes = [...paint.counts.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
    for (const code of codes) {
      const row = el('button', 'domain-key');
      row.type = 'button'; row.dataset.code = code; row.setAttribute('aria-pressed', String(!view.hidden.has(code)));
      const sw = el('i'); sw.style.background = paint.colour(code);
      row.append(sw, el('span', 'domain-key-name', code || t('dom.noCode')), el('span', 'domain-key-count', fmt(paint.counts.get(code))));
      row.title = t('dom.toggleKey');
      row.addEventListener('click', () => { view.hidden.has(code) ? view.hidden.delete(code) : view.hidden.add(code); render(); });
      box.append(row);
      if (!view.hidden.has(code) && (drawnCounts.get(code) || 0) > 0 && legend.childElementCount < 10) {
        const chip = el('span', 'domain-legend-chip'); const s = el('i'); s.style.background = paint.colour(code); chip.append(s, code || t('dom.noCode')); legend.append(chip);
      }
    }
  }
  function domainTree() {
    const box = $('domainTree'); if (!box) return;
    box.textContent = '';
    const entries = OrebitCoreDomain.codebook();
    const bodies=OrebitCoreDomain.displaySolids(),surfaces=OrebitCoreDomain.surfaces();
    for(const d of bodies)if(!entries.some(e=>e.code===d.code))entries.push({...d,lithologies:[],acceptedOnly:true});
    box.setAttribute('role', entries.length||surfaces.length ? 'list' : 'group');
    if (!entries.length) {
      box.append(el('p', 'domain-note', t('dom.tree.empty')));
      const define = el('button', 'btn secondary', t('dom.tree.define'));
      Object.assign(define, {type:'button', id:'domainTreeDefine'});
      define.addEventListener('click', () => {
        selectWorkflowStep('book');
        $('domainCodebookCode')?.focus();
      });
      box.append(define);
      if(!surfaces.length)return;
    }
    const codebookSelect = $('domainCodebookSelect');
    const active = (solid.sourceMode==='pair'?solid.code:'') || codebookSelect?.value || (contact.target.startsWith('book:') ? contact.target.slice(5) : '');
    for (const domain of entries) {
      const item = el('div', 'domain-tree-item'); item.setAttribute('role', 'listitem');
      const row = el('button', 'domain-tree-row');
      Object.assign(row, {type:'button'});
      row.dataset.domainCode = domain.code;
      const isSolid=bodies.some(d=>d.code===domain.code);
      if(isSolid){row.dataset.layerKind='solid';row.setAttribute('aria-pressed',String(selectedLayer?.kind==='solid'&&selectedLayer.id===domain.code));}
      if(domain.code===(selectedLayer?(selectedLayer.kind==='solid'?selectedLayer.id:''):active))row.setAttribute('aria-current','true');
      const count=isSolid?t('dom.surfacePair.savedSolid'):domain.lithologies.length===1?t('dom.tree.oneLithology'):tt('dom.tree.lithologies',{n:domain.lithologies.length});
      row.setAttribute('aria-label',isSolid?tt('dom.layers.solid',{name:domain.code}):tt('dom.tree.row',{name:domain.label,code:domain.code,count}));
      const swatch = el('i', 'domain-tree-swatch'); swatch.style.background = domain.colour || '#0f766e';
      const name = el('span', 'domain-tree-name');
      name.append(el('b', null, domain.label || domain.code), el('small', null, domain.code));
      row.append(swatch, name, el('span', 'domain-key-count', count));
      row.addEventListener('click', () => {
        if(domain.acceptedOnly){selectDomain('book:'+domain.code);saveWorkspace();contactForm();computeContacts();solidForm();render();selectWorkflowStep('solid');selectLayer('solid',domain.code);return;}
        selectWorkflowStep('book');
        const select = $('domainCodebookSelect');
        if (select) {
          select.value = domain.code;
          select.dispatchEvent(new Event('change', {bubbles:true}));
          select.focus();
        }
        if(isSolid)selectLayer('solid',domain.code);
      });
      item.append(row); box.append(item);
    }
    for(const surface of surfaces){
      const item=el('div','domain-tree-item');item.setAttribute('role','listitem');
      const row=el('button','domain-tree-row');row.type='button';row.dataset.surfaceId=surface.id;
      row.setAttribute('aria-label',tt('dom.layers.surface',{name:surface.name}));
      row.setAttribute('aria-pressed',String(selectedLayer?.kind==='surface'&&selectedLayer.id===surface.id));
      const name=el('span','domain-tree-name');name.append(el('b',null,surface.name),el('small',null,t('dom.layers.surfaceType')));row.append(name);
      row.addEventListener('click',()=>selectLayer('surface',surface.id));item.append(row);box.append(item);
    }
    if(bodies.length||surfaces.length){
      const all=el('button','btn secondary',t('dom.layers.all'));all.type='button';all.id='domainLayersShowAll';all.setAttribute('aria-pressed',String(!selectedLayer));
      all.addEventListener('click',()=>{layerJob++;selectedLayer=null;render();$('domainLayersShowAll')?.focus({preventScroll:true});});box.append(all);
    }
  }
  // Parallel section lines across the data, one slab width apart; each counts the collars inside its slab.
  function sectionLines(b, holes) {
    const centre = [(b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, 0];
    const plane = OrebitGeometryPrimitives.sectionPlane(centre, view.azimuth);
    const ns = holes.map(c => OrebitGeometryPrimitives.project(plane, [c.x, c.y, c.z])[2]);
    const [lo, hi] = span(ns), step = 2 * view.width, first = Math.ceil((lo - view.width) / step - 1e-9), last = Math.floor((hi + view.width) / step + 1e-9); // holes exactly on the outer line keep it despite rounding
    // The current section snaps to the new spacing; only the 41 lines around it are listed.
    const at = Math.min(Math.max(Math.round(view.offset / step), first), Math.max(first, last));
    view.offset = at * step;
    const lines = [];
    for (let k = Math.max(first, at - 20); k <= Math.min(last, at + 20); k++) {
      const offset = k * step, origin = [centre[0] + plane.normal[0] * offset, centre[1] + plane.normal[1] * offset];
      lines.push({k, offset, origin, count:ns.filter(n => Math.abs(n - offset) <= view.width).length});
    }
    return {plane, centre, lines};
  }
  function sectionName(line) {
    const az = ((view.azimuth % 180) + 180) % 180;
    const where = az === 90 ? 'N ' + fmt(line.origin[1]) : az === 0 ? 'E ' + fmt(line.origin[0]) : (line.offset >= 0 ? '+' : '') + fmt(line.offset) + ' m';
    return 'XS ' + (line.k >= 0 ? '+' : '−') + String(Math.abs(line.k)).padStart(2, '0') + ' · ' + where + ' · Az ' + view.azimuth + '°';
  }
  function sectionList(sections) {
    const box = $('domainSectionList'), scrollTop=box.scrollTop; box.textContent = '';
    sections.lines.forEach(line => {
      const row = el('button', 'domain-section'); row.type = 'button';
      row.setAttribute('aria-pressed', String(view.mode === 'section' && line.offset === view.offset));
      row.dataset.sectionOffset=line.offset;row.title=sectionName(line);
      row.append(el('span', null, sectionName(line)), el('span', 'domain-key-count', tt('dom.holesN', {n:line.count})));
      row.addEventListener('click', () => { view.offset = line.offset; setMode('section'); });
      box.append(row);
    });
    if (!sections.lines.length) box.append(el('p', 'domain-note', t('dom.noData')));
    // Canvas resize after a map pick must not scroll the active row away.
    box.scrollTop=scrollTop;
  }
  function facts(rows) {
    const box = $('domainInspector'); box.textContent = '';
    for (const [k, v] of rows) box.append(el('dt', null, k), el('dd', null, v));
  }
  function medianSpacing(holes) {
    if (holes.length < 2) return null;
    const near = holes.map((a, i) => { let best = Infinity; holes.forEach((b, j) => { if (i !== j) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y)); }); return best; }).sort((a, b) => a - b);
    return near[Math.floor(near.length / 2)];
  }
  function empty(message) {
    $('domainViewerStatus').textContent = message;
    for (const id of ['domainViewerCanvas', 'domainViewer3d', 'domainViewerThin', 'domainViewerLegend']) $(id).hidden = true;
    domainTree();
    $('domainKeyList').textContent = ''; $('domainSectionList').textContent = ''; facts([]);
    window.__domainViewerLastDraw = null; fit = null;
    contactFacts();
    solidFacts();
    loftPanel();
  }
  function syncControls() {
    const zoom=$('domainSectionZoom');if(zoom)zoom.hidden=view.mode!=='section';
    const zoomValue=$('domainSectionZoomValue');if(zoomValue)zoomValue.textContent=Number(sectionCamera.zoom.toFixed(2)).toLocaleString()+'×';
    if($('domainSectionZoomIn'))$('domainSectionZoomIn').disabled=!fit||sectionCamera.zoom>=32;
    if($('domainSectionZoomOut'))$('domainSectionZoomOut').disabled=!fit||sectionCamera.zoom<=0.25;
    for (const id of ['domainViewerVE', 'domainViewerVERange']) { const e = $(id); if (e) e.value = view.ve; }
    $('domainViewerVEAuto')?.setAttribute('aria-pressed', String(view.veAuto));
    document.querySelectorAll('#domainViewerPanel [data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === view.mode)));
    const s = $('domainViewerSectionFields'); if (s) s.hidden = view.mode === '3d';
    const planHelp=$('domainPlanHelp');if(planHelp)planHelp.hidden=view.mode!=='plan';
    const v = $('domainViewerVEField'); if (v) v.hidden = view.mode === 'plan';
    $('domainToolNavigate')?.setAttribute('aria-pressed', String(loft.tool === 'navigate'));
    $('domainToolDigitize')?.setAttribute('aria-pressed', String(loft.tool === 'digitize'));
    $('domainToolEdit')?.setAttribute('aria-pressed', String(loft.tool === 'edit'));
    $('domainViewerCanvas')?.classList.toggle('is-digitizing', ['digitize', 'edit'].includes(loft.tool) && view.mode === 'section');
  }
  function setMode(m) { if(m!=='3d'){layerJob++;selectedLayer=null;}view.mode = m; render(); }
  function supports3D(){
    if(webgl!==null)return webgl;
    try{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      webgl=!!gl;gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }catch{webgl=false;}
    return webgl;
  }
  function render() {
    if (!$('domainViewerStatus')) return;
    const thisRender=++renderJob,sourceRevision=OrebitCoreDomain.sourceRevision();
    if(selectedLayer&&(selectedLayer.source!==sourceRevision||selectedLayer.revision!==OrebitCoreDomain.interpretationRevision())){layerJob++;selectedLayer=null;}
    if(view.mode==='3d'&&!supports3D()){view.mode='section';fallback3d=true;layerJob++;selectedLayer=null;}
    else if(view.mode==='3d')fallback3d=false;
    const fallback=$('domain3dFallback');if(fallback){fallback.hidden=!fallback3d;fallback.textContent=t('dom.noWebgl');}
    syncControls();
    domainTree();
    const paint = colourer();
    if (!STATE[paint.table]?.length) return empty(tt('dom.noData'));
    const geometry = OrebitCoreDomain.intervalGeometry(paint.table);
    if (geometry.status === 'endpoints-unavailable') return empty(tt('dom.noEndpoints'));
    if(cachedScene?.geometry!==geometry||cachedScene.colour!==view.colour){cachedPlanGroups=null;cachedScene={geometry,colour:view.colour,scene:OrebitDomainViewerScene.buildScene(geometry.intervals,r=>paint.value(r.sourceIndex))};}
    const scene=cachedScene.scene;
    if (!scene.bounds) return empty(tt('dom.noData'));
    const b = scene.bounds, origin = [Math.floor(b.x[0]), Math.floor(b.y[0])];
    const canvas = $('domainViewerCanvas'), plot = $('domainViewer3d');
    $('domainViewerLegend').hidden = false;
    const holeIds = new Set(scene.segments.map(s => s.hole)), collars = collarsOf(holeIds);
    const sections = sectionLines(b, collars);
    const started = performance.now();
    let shown = 0, inView = scene.segments.length, vFill = null, hidden = 0, holesInView = holeIds.size;
    const drawn = new Map();
    const tally = items => { for (let i = 0; i < items.length; i += view.stride) { const k = paint.key(items[i].value); drawn.set(k, (drawn.get(k) || 0) + 1); } };
    if (view.mode === '3d') {
      canvas.hidden = true; plot.hidden = false; fit = null;
      const dx = Math.max(b.x[1] - b.x[0], 1), dy = Math.max(b.y[1] - b.y[0], 1), dz = Math.max(b.z[1] - b.z[0], 1);
      if (view.veAuto) view.ve = stepVE(0.35 * Math.max(dx, dy) / dz);
      tally(scene.segments);
      const out = groupByColour(scene.segments, paint, s => [s.a.x - origin[0], s.a.y - origin[1], s.a.z, s.b.x - origin[0], s.b.y - origin[1], s.b.z]);
      hidden = out.hidden;
      const traces = [];
      for (const [colour, segs] of out.groups) {
        const x = [], y = [], z = [];
        for (const s of segs) { x.push(s[0], s[3], null); y.push(s[1], s[4], null); z.push(s[2], s[5], null); }
        shown += segs.length;
        traces.push({type:'scatter3d', mode:'lines', x, y, z, line:{color:colour, width:7}, hoverinfo:'skip', showlegend:false});
      }
      traces.push({type:'scatter3d', mode:collars.length <= LABEL_LIMIT ? 'markers+text' : 'markers', x:collars.map(c => c.x - origin[0]), y:collars.map(c => c.y - origin[1]), z:collars.map(c => c.z),
        text:collars.map(c => c.id), textposition:'top center', textfont:{size:10}, marker:{size:3, color:token('--fg', '#0f172a')}, hovertemplate:'%{text}<extra></extra>', showlegend:false});
      const built=solid.result?.mesh,accepted=OrebitCoreDomain.displaySolids();
      const stored=accepted.filter(d=>d.visible&&d.mesh&&(!built||d.code!==solid.code.trim()));
      const chosen=OrebitCoreDomain.codebook().find(d=>'book:'+d.code===contact.target);
      const showPreview=built&&accepted.find(d=>d.code===solid.code.trim())?.visible!==false;
      const bodies=stored.concat(showPreview?[{mesh:built,code:solid.code,colour:chosen?.colour||token('--warn','#d97706'),stale:false}]:[]);
      for(const d of bodies){const mesh=d.mesh;
        traces.push({type:'mesh3d',name:d.code,x:mesh.v.map(p=>p[0]-origin[0]),y:mesh.v.map(p=>p[1]-origin[1]),z:mesh.v.map(p=>p[2]),
          i:mesh.f.map(f=>f[0]),j:mesh.f.map(f=>f[1]),k:mesh.f.map(f=>f[2]),
          color:d.stale?token('--fg-mute','#64748b'):d.colour||token('--accent','#0f766e'),opacity:d.stale?0.15:0.35,
          flatshading:true,hoverinfo:'skip',showlegend:false});
      }
      const surf = contact.result?.tin;
      if (!built && !accepted.length && surf?.triangles.length) {
        traces.push({type:'mesh3d', x:surf.v.map(p => p[0] - origin[0]), y:surf.v.map(p => p[1] - origin[1]), z:surf.v.map(p => p[2]),
          i:surf.triangles.map(f => f[0]), j:surf.triangles.map(f => f[1]), k:surf.triangles.map(f => f[2]),
          color:token('--accent', '#0f766e'), opacity:0.45, flatshading:true, hoverinfo:'skip', showlegend:false});
      }
      const hits = (contact.result?.picks || []).filter(p => p.status === 'contact');
      if (hits.length) traces.push({type:'scatter3d', mode:'markers', x:hits.map(p => p.point[0] - origin[0]), y:hits.map(p => p.point[1] - origin[1]), z:hits.map(p => p.point[2]),
        text:hits.map(p => p.hole + ' · ' + fmt(p.depth, 2) + ' m'), marker:{size:3, color:token('--accent', '#0f766e')}, hovertemplate:'%{text}<extra></extra>', showlegend:false});
      if(selectedLayer){
        const body=accepted.find(d=>d.code===selectedLayer.id),mesh=selectedLayer.kind==='surface'?selectedLayer.surface.tin:body?.mesh;
        if(mesh){
          const faces=mesh.f||mesh.triangles;
          traces.splice(0,traces.length,{type:'mesh3d',name:selectedLayer.id,x:mesh.v.map(p=>p[0]-origin[0]),y:mesh.v.map(p=>p[1]-origin[1]),z:mesh.v.map(p=>p[2]),
            i:faces.map(f=>f[0]),j:faces.map(f=>f[1]),k:faces.map(f=>f[2]),color:body?.colour||token('--accent','#0f766e'),opacity:body?.stale?0.15:0.65,flatshading:true,hoverinfo:'skip',showlegend:false});
        }
      }
      const m = Math.max(dx, dy);
      Promise.resolve(Plotly.react(plot, traces, {...plotTheme(), height:Math.min(560,Math.max(320,plot.clientWidth)), margin:{l:plot.clientWidth<420?24:0,r:plot.clientWidth<420?24:0,t:0,b:plot.clientWidth<420?24:0},
        scene:{uirevision:'domain-'+sourceRevision,...(plot.clientWidth<420?{camera:{eye:{x:1.8,y:1.8,z:1.4}}}:{}),aspectmode:'manual', aspectratio:{x:dx / m, y:dy / m, z:dz / m * view.ve},
          xaxis:{title:'E − ' + fmt(origin[0])}, yaxis:{title:'N − ' + fmt(origin[1])}, zaxis:{title:tt('dom.axis.rl', {ve:view.ve})}}}, {displaylogo:false, responsive:true})).catch(()=>{
        if(thisRender!==renderJob||sourceRevision!==OrebitCoreDomain.sourceRevision()||view.mode!=='3d'||$('domainViewer3d')!==plot)return;
        fallback3d=true;view.mode='section';layerJob++;selectedLayer=null;render();
      });
    } else {
      plot.hidden = true; canvas.hidden = false;
      let out, range, opt;
      here = null;
      if (view.mode === 'plan') {
        // Cache display paths only. Every interval and full legend count are
        // retained; source, palette, mask or sampling changes replace the cache.
        const stamp=JSON.stringify([view.colour,view.stride,[...view.hidden].sort(),paint.ramp?.lo??null,paint.ramp?.hi??null,
          view.colour==='lith'?[...paint.counts.keys()].map(code=>[code,paint.colour(code)]):RAMP]);
        if(cachedPlanGroups?.scene===scene&&cachedPlanGroups.stamp===stamp){
          out=cachedPlanGroups.out;for(const [key,value] of cachedPlanGroups.counts)drawn.set(key,value);
        }else{
          tally(scene.segments);out=groupByColour(scene.segments,paint,s=>[s.a.x,s.a.y,s.b.x,s.b.y]);
          cachedPlanGroups={scene,stamp,out,counts:[...drawn]};
        }
        range = {h:span([b.x[0], b.x[1], ...collars.map(c => c.x)]), v:span([b.y[0], b.y[1], ...collars.map(c => c.y)])};
        const az = view.azimuth * Math.PI / 180, reach = Math.hypot(b.x[1] - b.x[0], b.y[1] - b.y[0]), dir = [Math.sin(az) * reach, Math.cos(az) * reach];
        opt = {ve:1, axes:[t('dom.axis.east'), t('dom.axis.north')], lineWidth:5, lineCap:'round',
          collars:collars.map(c => [c.x, c.y, c.id]),
          traces:sections.lines.map(l => ({selected:l.offset === view.offset,offset:l.offset,name:sectionName(l),label:'XS '+(l.k>=0?'+':'−')+String(Math.abs(l.k)).padStart(2,'0'),labelAnchor:l.origin,showLabel:l.k%Math.max(1,Math.ceil(sections.lines.length/12))===0,points:[[l.origin[0] - dir[0], l.origin[1] - dir[1]], [l.origin[0] + dir[0], l.origin[1] + dir[1]]]})),
          contacts:contactOverlay(collars, p => [p[0], p[1]])};
      } else {
        const line = sections.lines.find(l => l.offset === view.offset);
        const plane = OrebitGeometryPrimitives.sectionPlane([...(line ? line.origin : sections.centre.slice(0, 2)), 0], view.azimuth);
        const cut = OrebitDomainViewerScene.sectionSlab(scene, plane, view.width);
        here = {offset:view.offset, origin:(line ? line.origin : sections.centre.slice(0, 2)).slice(), plane};
        const drawn2 = loftOverlay();
        inView = cut.length;
        tally(cut);
        out = groupByColour(cut, paint, c => [c.p.u, c.p.z, c.q.u, c.q.z]);
        holesInView = new Set(cut.map(c => c.hole)).size;
        // Only collars that sit inside the slab are marked; a hole that merely passes through shows its trace alone.
        const marks = collars.map(c => [OrebitGeometryPrimitives.project(plane, [c.x, c.y, c.z]), c]).filter(([p]) => Math.abs(p[2]) <= view.width).map(([p, c]) => [p[0], c.z, c.id]);
        const own = [...drawn2.rings.flat(), ...drawn2.draft];
        range = {h:span([...cut.flatMap(c => [c.p.u, c.q.u]), ...marks.map(m => m[0]), ...own.map(q => q[0])]), v:span([...cut.flatMap(c => [c.p.z, c.q.z]), ...marks.map(m => m[1]), ...own.map(q => q[1])])};
        if (view.veAuto) view.ve = fitVE(range.h[1] - range.h[0], range.v[1] - range.v[0], canvas.clientWidth, canvas.clientHeight, 0.5);
        // Contact picks inside the slab are marked at their projected position; the surface itself is not cut here.
        const inSlab = p => { const q = OrebitGeometryPrimitives.project(plane, p); return Math.abs(q[2]) <= view.width ? [q[0], p[2]] : null; };
        const overlay = contactOverlay(collars, inSlab);
        if (overlay) overlay.edges = [];
        opt = {ve:view.ve, axes:[t('dom.axis.distance'), tt('dom.axis.rl', {ve:view.ve})], lineWidth:10, lineCap:'butt', collars:marks, outline:true, contacts:overlay, loft:drawn2};
        const cameraKey=JSON.stringify([sourceRevision,view.azimuth,view.offset,view.width,here.origin]);
        if(sectionCamera.key!==cameraKey){sectionCamera.key=cameraKey;sectionCamera.range=null;sectionCamera.zoom=1;}
        if(sectionCamera.range)range=sectionCamera.range;
        sectionRange={h:range.h.slice(),v:range.v.slice()};
      }
      hidden = out.hidden;
      for (const segs of out.groups.values()) shown += segs.length;
      vFill = draw(canvas, range, out.groups, opt).vFill;
    }
    syncControls();
    keyList(paint, drawn);
    sectionList(sections);
    const ms = performance.now() - started;
    contactFacts();
    solidFacts();
    loftPanel();
    window.__domainViewerLastDraw = {mode:view.mode, ms, shown, inView, total:scene.total, skipped:scene.skipped, stride:view.stride, ve:view.ve, veAuto:view.veAuto, vFill, hidden};
    const spacing = medianSpacing(collars);
    facts([
      [t('dom.fact.holes'), fmt(holesInView) + ' / ' + fmt(holeIds.size)],
      [t('dom.fact.intervals'), fmt(shown) + ' / ' + fmt(inView)],
      [t('dom.fact.skipped'), fmt(scene.skipped)],
      ...(hidden ? [[t('dom.fact.hidden'), fmt(hidden)]] : []),
      ...(view.mode === 'plan' ? [] : [[t('dom.fact.ve'), view.ve + '×' + (view.veAuto ? ' (' + t('dom.veAuto') + ')' : '')]]),
      ...(view.mode === 'section' ? [[t('dom.fact.slab'), view.azimuth + '° ± ' + fmt(view.width, 1) + ' m']] : []),
      [t('dom.fact.spacing'), spacing == null ? '—' : fmt(spacing, 1) + ' m'],
    ]);
    const status = $('domainViewerStatus');
    status.textContent = '';
    const line = text => status.append(el('span', null, text));
    if(selectedLayer)line(tt('dom.layers.only',{name:selectedLayer.id,type:t('dom.layers.'+selectedLayer.kind+'Type')}));
    else line(tt('dom.status', {holes:holeIds.size, shown, inView, total:scene.total, skipped:scene.skipped}));
    if (view.stride > 1) line(tt('dom.thinned', {stride:view.stride}));
    line(tt('dom.crs', {crs:STATE.crs || t('dom.crsUnconfirmed'), e:origin[0], n:origin[1]}));
    if(view.mode==='section')line(sectionName(sections.lines.find(l=>l.offset===view.offset)));
    const thin = $('domainViewerThin');
    thin.hidden = view.stride === 1 && !(ms > BUDGET_MS && view.mode !== '3d');
    thin.textContent = view.stride > 1 ? t('dom.showAll') : tt('dom.thinOffer', {ms:Math.round(ms)});
  }
  // Membership is read from the raw table cell: a blank code or grade is unknown (null), never a non-member.
  function contactMember() {return OrebitCoreDomain.contactMembership(contact.target,contact.threshold);}
  function computeContacts() {
    contact.result = null; contact.error = null;
    if (!contact.target || (contact.target.startsWith('grade:') && !Number.isFinite(contact.threshold))) return;
    const {table, member} = contactMember();
    if (!STATE[table]?.length) return;
    try {
      const geometry = OrebitCoreDomain.intervalGeometry(table);
      if (geometry.status === 'endpoints-unavailable') { contact.error = t('dom.noEndpoints'); return; }
      const picks = OrebitDomainContacts.pickContacts(geometry.intervals, contact.rule, member);
      contact.result = {picks, ...OrebitDomainContacts.contactSurface(picks, contact.maxEdge == null ? {} : {maxEdge:contact.maxEdge})};
    } catch (e) {
      const known = ['DOMAIN_SURFACE_MULTIVALUED', 'DOMAIN_TIN_COLLINEAR', 'DOMAIN_TIN_INPUT'].includes(e.message);
      contact.error = tt('dom.contact.error', {code:known ? t('dom.contact.err.' + e.message) : e.message});
    }
  }
  // Contact points (and, in plan, TIN edges) plus a cross at the collar of every hole the surface could not use.
  function contactOverlay(collars, place) {
    const r = contact.result; if (!r) return null;
    const at = new Map(collars.map(c => [c.id, [c.x, c.y, c.z]]));
    const points = r.picks.filter(p => p.status === 'contact').map(p => place(p.point)).filter(Boolean);
    const missing = r.picks.filter(p => p.status !== 'contact' && at.has(p.hole)).map(p => place(at.get(p.hole))).filter(Boolean);
    const edges = [];
    for (const f of r.tin?.triangles || []) for (let j = 0; j < 3; j++) { const a = r.tin.v[f[j]], b = r.tin.v[f[(j + 1) % 3]]; edges.push([a[0], a[1], b[0], b[1]]); }
    return {points, missing, edges};
  }
  function focusContactHole(hole, digitize=false) {
    const collar=STATE.collar.find(c=>c.hole_id===hole),b=cachedScene?.scene?.bounds;
    if(collar&&b){
      const centre=[(b.x[0]+b.x[1])/2,(b.y[0]+b.y[1])/2,0];
      const plane=OrebitGeometryPrimitives.sectionPlane(centre,view.azimuth);
      view.offset=OrebitGeometryPrimitives.project(plane,[Number(collar.x),Number(collar.y),Number(collar.z)])[2];
    }
    view.hidden.clear();selectWorkflowStep('contacts',false);
    if(digitize)$('domainToolDigitize')?.click();
    else{loft.tool='navigate';setMode('section');}
    saveWorkspace();$('domainViewerCanvas')?.focus();
  }
  function contactFacts() {
    const facts = $('domainContactFacts'), issues = $('domainContactIssues'), note = $('domainContactNote');
    if (!facts) return;
    surfaceLibraryForm();
    facts.textContent = ''; issues.textContent = ''; note.textContent = contact.error || '';
    const r = contact.result;
    window.__domainContacts = r ? {rule:contact.rule, target:contact.target, threshold:contact.threshold, status:r.status, counts:{...r.counts}, used:r.used,
      maxEdge:r.maxEdge ?? null, maxEdgeSource:r.maxEdgeSource ?? null, medianSpacing:r.medianSpacing ?? null, triangles:r.tin?.triangles.length ?? 0} : null;
    if (!r) { if (!contact.error) note.textContent = t('dom.contact.prompt'); return; }
    const add = (k, v) => facts.append(el('dt', null, k), el('dd', null, v));
    for (const s of ['contact', 'uncertain', 'open', 'absent']) add(t('dom.contact.status.' + s), fmt(r.counts[s] || 0));
    if (r.maxEdge != null) {
      add(t('dom.contact.spacing'), fmt(r.medianSpacing, 1) + ' m');
      add(t('dom.contact.maxEdge'), fmt(r.maxEdge, 1) + ' m (' + t('dom.contact.source.' + r.maxEdgeSource) + ')');
      add(t('dom.contact.triangles'), fmt(r.tin.triangles.length));
    }
    note.textContent = t('dom.contact.result.' + r.status);
    const bad = r.picks.filter(p => p.status !== 'contact');
    for (const p of bad.slice(0, 50)) {
      const li = el('li'); li.dataset.hole=String(p.hole);
      li.append(el('b', null, p.hole), ' ' + t('dom.contact.reason.' + p.reason));
      if(p.spans?.length)li.append(' · '+p.spans.map(span=>Number(span.from).toLocaleString(undefined,{maximumFractionDigits:6})+'–'+Number(span.to).toLocaleString(undefined,{maximumFractionDigits:6})+' m').join(' / '));
      if(p.spans?.length){const inspect=el('button','btn secondary',t('dom.contact.inspectHole'));inspect.type='button';inspect.dataset.hole=String(p.hole);inspect.addEventListener('click',()=>focusContactHole(p.hole));li.append(inspect);}
      issues.append(li);
    }
    if (bad.length > 50) issues.append(el('li', null, tt('dom.contact.more', {n:bad.length - 50})));
    if(r.status==='ambiguous'){
      const remedy=el('button','btn secondary',t('dom.contact.separateBodies'));remedy.type='button';remedy.id='domainSeparateBodies';
      remedy.addEventListener('click',()=>focusContactHole(r.affected[0].hole,true));
      note.append(document.createElement('br'),remedy);
    }
  }
  function codebookForm(){
    const box=$('domainCodebookForm');if(!box)return;box.textContent='';
    domainGuide($('domainCodebook')?.querySelector('p[data-i18n="dom.book.hint"]'));
    const entries=OrebitCoreDomain.codebook();
    const choose=el('select');choose.id='domainCodebookSelect';choose.append(new Option(t('dom.book.new'),''));
    for(const d of entries)choose.append(new Option(d.label+' · '+d.code,d.code));
    const code=el('input'),label=el('input'),lith=el('fieldset','domain-lithology-choices'),colour=el('input'),density=el('input'),precedence=el('input'),weather=el('input'),geotech=el('input'),visible=el('input');
    Object.assign(code,{id:'domainCodebookCode',maxLength:100});Object.assign(label,{id:'domainCodebookLabel',maxLength:100});
    lith.id='domainCodebookLithologies';lith.append(el('legend',null,t('dom.book.lithologies')));
    for(const c of [...new Set(STATE.geology.map(r=>r.lith1).filter(v=>v!=null&&v!=='').map(String))].sort((a,b)=>a.localeCompare(b))){
      const input=el('input');Object.assign(input,{type:'checkbox',value:c});
      const choice=el('label','domain-check');choice.append(input,document.createTextNode(c));lith.append(choice);
    }
    Object.assign(colour,{id:'domainCodebookColour',type:'color',value:'#0f766e'});
    Object.assign(density,{id:'domainCodebookDensity',type:'number',min:0,step:'any'});
    Object.assign(precedence,{id:'domainCodebookPrecedence',type:'number',min:0,max:100,step:1,value:0});
    Object.assign(weather,{id:'domainCodebookWeathering',maxLength:1000});Object.assign(geotech,{id:'domainCodebookGeotechnical',maxLength:1000});
    Object.assign(visible,{id:'domainCodebookVisible',type:'checkbox',checked:true});
    const note=el('p','domain-note');note.id='domainCodebookNote';note.setAttribute('role','status');
    const apply=el('button','btn btn-primary',t('dom.book.apply'));Object.assign(apply,{id:'domainCodebookApply',type:'button'});
    const remove=el('button','btn secondary',t('dom.book.remove'));Object.assign(remove,{id:'domainCodebookRemove',type:'button',disabled:true});
    choose.addEventListener('change',()=>{
      const d=entries.find(d=>d.code===choose.value);remove.disabled=!d;code.readOnly=!!d;
      code.value=d?.code||'';label.value=d?.label||'';colour.value=d?.colour||'#0f766e';density.value=d?.density??'';precedence.value=d?.precedence??0;weather.value=d?.weathering||'';geotech.value=d?.geotechnical||'';visible.checked=d?.visible??true;
      for(const o of lith.querySelectorAll('input'))o.checked=!!d?.lithologies.includes(o.value);
      note.textContent='';
      if(d){selectDomain('book:'+d.code);saveWorkspace();contactForm();computeContacts();render();syncBuildMethod();}
    });
    apply.addEventListener('click',()=>{
      const d={code:code.value.trim(),label:label.value.trim()||code.value.trim(),lithologies:[...lith.querySelectorAll('input:checked')].map(o=>o.value),colour:colour.value,
        density:density.value===''?null:Number(density.value),precedence:Number(precedence.value),weathering:weather.value,geotechnical:geotech.value,visible:visible.checked};
      try{
        if(!precedence.value.trim()||!d.lithologies.length)throw Error('DOMAIN_CODEBOOK_INVALID');
        const all=OrebitCoreDomain.codebook();
        if(!choose.value&&all.some(e=>e.code===d.code))throw Error('DOMAIN_CODEBOOK_INVALID');
        OrebitCoreDomain.setCodebook(all.filter(e=>e.code!==choose.value).concat(d));
        selectDomain('book:'+d.code);solid.code=d.code;solid.density=d.density;solid.result=null;saveWorkspace();
        show();selectWorkflowStep('contacts');$('domainContactTarget')?.focus();
      }catch{note.textContent=t('dom.book.invalid');}
    });
    remove.addEventListener('click',async()=>{
      if(!await window.orebitConfirm(t('dom.book.removeConfirm')))return;
      const target='book:'+choose.value;
      OrebitCoreDomain.setCodebook(OrebitCoreDomain.codebook().filter(d=>d.code!==choose.value));
      if(contact.target===target){selectDomain('');contact.target='';}
      domainDrafts=domainDrafts.filter(d=>d.contact.target!==target);saveWorkspace();show();
    });
    const advanced=el('details');advanced.append(el('summary',null,t('dom.book.attributes')));
    const tick=el('label','domain-check');tick.append(visible,' '+t('dom.book.visible'));
    advanced.append(field(t('dom.book.colour'),colour),field(t('dom.solid.density'),density),field(t('dom.book.precedence'),precedence),field(t('dom.book.weathering'),weather),field(t('dom.book.geotechnical'),geotech),tick);
    box.append(field(t('dom.book.edit'),choose),field(t('dom.solid.code'),code),field(t('dom.book.label'),label),lith,advanced,apply,remove,note);
  }
  function contactForm() {
    const box = $('domainContactForm'); if (!box) return;
    box.textContent = '';
    const rule = el('select'); rule.id = 'domainContactRule';
    for (const r of OrebitDomainContacts.RULES) rule.append(new Option(t('dom.contact.rule.' + r), r));
    rule.value = contact.rule;
    const target = el('select'); target.id = 'domainContactTarget';
    target.append(new Option(t('dom.contact.choose'), ''));
    const codes = [...new Set(STATE.geology.map(r => r.lith1).filter(v => v != null && v !== '').map(String))].sort((a, b) => a.localeCompare(b));
    const columns = getActualGradeColumns();
    const group = (label, items) => { const g = document.createElement('optgroup'); g.label = label; for (const [v, text] of items) g.append(new Option(text, v)); if (items.length) target.append(g); };
    group(t('dom.book.title'),OrebitCoreDomain.codebook().filter(d=>d.lithologies.length).map(d=>['book:'+d.code,d.label+' · '+d.code]));
    const bookCodes=new Set(OrebitCoreDomain.codebook().map(d=>d.code));
    group(t('dom.surfacePair.savedSolid'),OrebitCoreDomain.displaySolids().filter(d=>!bookCodes.has(d.code)).map(d=>['book:'+d.code,d.label+' · '+d.code]));
    group(t('dom.colour.lith'), codes.map(c => ['lith:' + c, c]));
    group(t('dom.contact.grade'), columns.map(c => ['grade:' + c, plotName(c)]));
    if (![...target.options].some(o => o.value === contact.target)) contact.target = '';
    target.value = contact.target;
    const threshold = document.createElement('input');
    Object.assign(threshold, {type:'number', id:'domainContactThreshold', step:'any', value:contact.threshold ?? ''});
    const thresholdField = field(t('dom.contact.threshold'), threshold); thresholdField.id = 'domainContactThresholdField';
    const maxEdge = document.createElement('input');
    Object.assign(maxEdge, {type:'number', id:'domainContactMaxEdge', min:0, step:'any', value:contact.maxEdge ?? ''});
    maxEdge.placeholder = t('dom.contact.maxEdgeDefault');
    const sync = () => { thresholdField.hidden = !contact.target.startsWith('grade:'); };
    const update = () => {
      if(target.value!==contact.target){selectDomain(target.value);saveWorkspace();contactForm();computeContacts();render();syncBuildMethod();return;}
      contact.rule = rule.value; contact.target = target.value;
      const x = threshold.value === '' ? null : Number(threshold.value); contact.threshold = Number.isFinite(x) ? x : null;
      const m = maxEdge.value === '' ? null : Number(maxEdge.value);
      // A typed value is the geologist's explicit decision; anything not a positive length falls back to the default.
      contact.maxEdge = Number.isFinite(m) && m > 0 ? m : null; if (contact.maxEdge == null) maxEdge.value = '';
      solid.result = null; solid.error = null;
      saveWorkspace();sync(); computeContacts(); render();
    };
    for (const i of [rule, target, threshold, maxEdge]) i.addEventListener('change', update);
    box.append(field(t('dom.contact.rule'), rule), field(t('dom.contact.target'), target), thresholdField, field(t('dom.contact.maxEdgeLabel'), maxEdge));
    const edgeHelp=el('p','domain-note',t('dom.contact.maxEdgeHelp'));edgeHelp.id='domainContactMaxEdgeHelp';edgeHelp.style.gridColumn='1 / -1';domainGuide(edgeHelp);
    maxEdge.setAttribute('aria-describedby',edgeHelp.id);box.append(edgeHelp);
    const help=el('p','domain-note',t('dom.contact.boundaryHelp'));help.id='domainContactBoundaryHelp';help.style.gridColumn='1 / -1';rule.setAttribute('aria-describedby',help.id);domainGuide(help);box.append(help);
    sync();
    solidForm();
  }
  function buildSolid() {
    solid.result = null; solid.error = null;
    if (!contact.result || !solid.topography) return;
    try {
      const {table, member} = contactMember();
      const intervals = OrebitCoreDomain.intervalGeometry(table).intervals;
      const pick = rule => OrebitDomainContacts.pickContacts(intervals, rule, member);
      const top = pick(contact.rule === 'last_to' ? 'first_from' : contact.rule), base = pick('last_to');
      const terrainSurface=solid.topography==='imported'?solid.terrainSurface:null;
      if(solid.topography==='imported'&&!terrainSurface)throw Error('SURFACE_IMPORT_REQUIRED');
      const terrainIndex=terrainSurface?OrebitGeometryPrimitives.prepareTIN(terrainSurface):null;
      const topography = solid.topography === 'collars' ? new Map(STATE.collar.filter(c => c.z !== '' && c.z != null && Number.isFinite(Number(c.z))).map(c => [c.hole_id, Number(c.z)])) :
        terrainIndex?new Map(STATE.collar.map(c=>{const p=terrainIndex.sample(Number(c.x),Number(c.y));return [c.hole_id,p?.z];})):null;
      solid.result = OrebitDomainBetween.buildBetween(top, base, {maxEdge:contact.maxEdge ?? undefined, topography});
      if(solid.result.status==='solid'&&solid.topography==='collars'){
        const collarSurface=OrebitGeometryPrimitives.makeTIN(collarsOf(new Set(STATE.collar.map(c=>c.hole_id))).map(c=>[c.x,c.y,c.z]));
        solid.result.inputs={...(solid.result.inputs||{}),terrainSurface:{kind:'reviewed-collar-tin',...collarSurface},
          topographyAudit:{type:'reviewed collar-elevation TIN',pointCount:collarSurface.v.length,triangleCount:collarSurface.triangles.length,fullSurfaceClipping:true},
          rules:{method:'between-surfaces',top:contact.rule==='last_to'?'first_from':contact.rule,base:'last_to',target:contact.target,threshold:contact.threshold,
            maxEdge:solid.result.maxEdge,maxEdgeSource:solid.result.maxEdgeSource,topography:solid.topography}};
      }
      if(solid.result.status==='solid'&&terrainSurface){
        const coverage=OrebitSurfaceImport.assessCoverage(terrainSurface,solid.result.mesh),audit={outside:0,above:0};
        for(const q of solid.result.mesh.v){const s=terrainIndex.sample(q[0],q[1]);if(!s)audit.outside++;else if(q[2]>s.z+1e-6)audit.above++;}
        solid.result.validation.topography=coverage.fullSurfaceCoverage&&audit.outside===0&&audit.above===0;
        solid.result.topography='imported';
        solid.result.inputs={...(solid.result.inputs||{}),terrainSurface,
          topographyAudit:{type:'imported DXF terrain TIN',pointCount:terrainSurface.v.length,triangleCount:terrainSurface.triangles.length,
            fullSurfaceClipping:coverage.fullSurfaceCoverage,coverage,aboveVertices:audit.above,outsideVertices:audit.outside},
          rules:{method:'between-surfaces',top:contact.rule==='last_to'?'first_from':contact.rule,base:'last_to',target:contact.target,threshold:contact.threshold,
            maxEdge:solid.result.maxEdge,maxEdgeSource:solid.result.maxEdgeSource,topography:'imported'}};
      }
      clearReview();
      solid.code = contact.target.slice(contact.target.indexOf(':') + 1) + (contact.target.startsWith('grade:') ? ' ≥ ' + contact.threshold : '');
    } catch (e) {
      const known = ['DOMAIN_SURFACE_MULTIVALUED', 'DOMAIN_TIN_COLLINEAR', 'DOMAIN_TIN_INPUT'].includes(e.message);
      solid.error = tt('dom.contact.error', {code:known ? t('dom.contact.err.' + e.message) : e.message});
    }
  }
  function selectWorkflowStep(step, focus=true) {
    if(!['book','contacts','solid','handoff'].includes(step))return;
    workflowStep=step;
    document.querySelectorAll('#tab14 [data-domain-panel]').forEach(panel=>{panel.hidden=panel.dataset.domainPanel!==step;});
    document.querySelectorAll('.domain-steps [data-domain-step]').forEach(button=>{
      if(button.dataset.domainStep===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
    });
    const target=step==='book'?$('domainCodebook'):$(step==='contacts'?'domainContactTitle':step==='solid'?'domainSolidTitle':'domainExportTitle');
    if(step==='book'&&target)target.open=true;
    if(focus&&target){const heading=step==='book'?$('domainBuildMethod'):target;if(step!=='book')heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}
    syncBuildMethod();
    updateContinuation($('domainWorkflowNext'));
  }
  function syncBuildMethod() {
    const method=$('domainBuildMethod');if(method)method.value=buildMethod;
    const step=document.querySelector('.domain-steps [data-domain-step="contacts"] [data-i18n]');
    if(step){const key=buildMethod==='loft'?'dom.workflow.sections':'dom.workflow.contacts';step.dataset.i18n=key;step.textContent=t(key);}
    const guide=$('domainMethodGuide');if(guide)guide.textContent=t(buildMethod==='loft'?'dom.workflow.guide.loft':'dom.workflow.guide.contacts');
    const source=$('domainSolidTopo');if(source)source.closest('label').hidden=buildMethod==='loft';
    const ground=$('domainGroundCheck');if(ground)ground.hidden=buildMethod==='loft';
    const contactBuild=$('domainSolidBuild');if(contactBuild)contactBuild.hidden=buildMethod!=='contacts';
    const basis=document.querySelector('.domain-basis');if(basis)basis.hidden=buildMethod!=='contacts'||solid.sourceMode==='pair';
    const pairBox=$('domainSurfacePairForm');if(pairBox)pairBox.hidden=buildMethod!=='contacts';
    const loftBuild=$('domainLoftBuildForm');if(loftBuild)loftBuild.hidden=buildMethod!=='loft';
    const note=$('domainLoftBuildNote');if(note)note.hidden=buildMethod!=='loft';
  }
  function selectBuildMethod(method, interpret=false) {
    if(!['contacts','loft'].includes(method))return;
    buildMethod=method;
    if(interpret||workflowStep==='book')selectWorkflowStep('contacts');
    loft.tool=method==='loft'&&workflowStep==='contacts'?'digitize':'navigate';
    if(workflowStep==='contacts'){
      // The card and dropdown are two entrances to the same interpretation
      // tools. Changing the entrance must never clear either method's draft.
      if(method==='loft'){
        $('domainLoftMethod').open=true;
        if(view.mode!=='section'){setMode('section');return;}
      }
    }
    render();
    syncBuildMethod();
  }
  function setTopography(value,terrain=null) {
    const surfaceChanged=value==='imported'&&JSON.stringify(terrain)!==JSON.stringify(solid.terrainSurface);
    if (solid.topography === value&&!surfaceChanged) return;
    solid.topography=value;if(value==='imported')solid.terrainSurface=terrain||solid.terrainSurface;else solid.terrainSurface=null; solid.result=null; clearReview();
    OrebitCoreDomain.invalidateInterpretation('Topography decision changed',solid.code.trim());
    saveWorkspace();
    syncTerrainHelp();
    // Both methods share this decision. Refresh both actions immediately,
    // without requiring an unrelated density or end-rule edit.
    solidForm(); loftPanel(); solidFacts(); readiness();syncBuildMethod();
  }
  function domainGuide(target){
    if(!target||target.querySelector('a[data-docs]'))return;
    const a=el('a',null,t('dom.guide.read'));a.href='#';a.dataset.docs='ref/tabs';a.dataset.docsFind='Core Domain';target.append(' ',a);
  }
  function syncTerrainHelp(){const help=$('domainSurfaceHelp');if(help){help.textContent=t(solid.topography==='imported'?'dom.solid.topo.importedHelp':'dom.solid.topo.help');domainGuide(help);}}
  function surfaceLibraryForm(){
    const box=$('domainSurfaceLibraryForm');if(!box)return;
    const previous=$('domainSurfaceName')?.value||'';box.textContent='';
    const name=el('input');Object.assign(name,{id:'domainSurfaceName',type:'text',maxLength:80,value:previous});
    const save=el('button','btn',t('dom.surfaceLibrary.save'));save.type='button';save.id='domainSurfaceSave';
    save.disabled=!contact.result||contact.result.status!=='surface';
    const status=el('p','domain-note');status.id='domainSurfaceSaveStatus';status.setAttribute('role','status');
    save.onclick=async()=>{save.disabled=true;try{
      await OrebitCoreDomain.saveContactSurface(name.value,{target:contact.target,rule:contact.rule,threshold:contact.threshold,maxEdge:contact.maxEdge});
      name.value='';surfaceLibraryForm();solidForm();render();$('domainSurfaceSaveStatus').textContent=t('dom.surfaceLibrary.saved');
    }catch(e){status.textContent=String(e.message);save.disabled=!contact.result||contact.result.status!=='surface';}};
    box.append(field(t('dom.surfaceLibrary.name'),name),save,status);
    status.style.gridColumn='1 / -1';
    const list=el('ul','domain-contact-issues');list.id='domainSavedSurfaces';list.style.gridColumn='1 / -1';
    for(const s of OrebitCoreDomain.surfaces())list.append(el('li',null,s.name+' · '+t('dom.contact.rule.'+s.recipe.rule)+' · '+s.recipe.target+' · '+s.points+' '+t('dom.surfaceLibrary.points')));
    box.append(list);
  }
  function pairReady(){return solid.sourceMode==='pair'&&solid.upperSurface&&solid.lowerSurface&&solid.upperSurface!==solid.lowerSurface&&solid.code.trim();}
  function contactBuildReady(){return (solid.sourceMode==='pair'||!!solid.topography)&&(solid.topography!=='imported'||!!solid.terrainSurface)&&
    (solid.sourceMode==='pair'?!!pairReady():!!contact.result&&contact.result.status!=='ambiguous');}
  function surfacePairForm(box){
    const mode=el('select');mode.id='domainSolidSourceMode';
    for(const v of ['interval','pair'])mode.append(new Option(t('dom.surfacePair.mode.'+v),v));mode.value=solid.sourceMode;
    mode.onchange=()=>{solid.sourceMode=mode.value;solid.result=null;solid.error=null;clearReview();saveWorkspace();solidForm();render();syncBuildMethod();};
    box.append(field(t('dom.surfacePair.mode'),mode));
    if(solid.sourceMode!=='pair')return;
    const fresh=el('button','btn secondary',t('dom.surfacePair.new'));fresh.id='domainSurfacePairNew';fresh.type='button';
    fresh.onclick=()=>{selectDomain('');Object.assign(solid,{sourceMode:'pair',upperSurface:'',lowerSurface:'',code:''});clearReview();saveWorkspace();contactForm();computeContacts();solidForm();render();};
    box.append(fresh);
    const controls=[];
    for(const [key,id,label] of [['upperSurface','domainUpperSurface','dom.solid.topBoundary'],['lowerSurface','domainLowerSurface','dom.solid.baseBoundary']]){
      const select=el('select');select.id=id;select.append(new Option(t('dom.surfacePair.choose'),''));
      for(const s of OrebitCoreDomain.surfaces())select.append(new Option(s.name,s.id));select.value=solid[key];
      select.onchange=()=>{solid[key]=select.value;solid.result=null;solid.error=null;clearReview();saveWorkspace();updateLimits();render();};
      controls.push(field(t(label),select));
    }
    const code=el('input');Object.assign(code,{id:'domainSurfacePairCode',type:'text',maxLength:40,value:solid.code});
    code.oninput=()=>{solid.code=code.value;solid.result=null;clearReview();saveWorkspace();solidFacts();};
    const swap=el('button','btn secondary',t('dom.surfacePair.swap'));swap.id='domainSurfacePairSwap';swap.type='button';
    swap.onclick=()=>{[solid.upperSurface,solid.lowerSurface]=[solid.lowerSurface,solid.upperSurface];solid.result=null;solid.error=null;clearReview();saveWorkspace();solidForm();render();};
    box.append(...controls,swap,field(t('dom.surfacePair.output'),code),el('p','domain-note',t('dom.surfacePair.help')),el('p','domain-note',t('dom.surfacePair.previewHelp')));
    const limits=el('section','domain-surface-limit-review');limits.id='domainSurfacePairLimits';limits.style.gridColumn='1 / -1';box.append(limits);
    function updateLimits(){
      limits.replaceChildren(el('h4',null,t('dom.surfacePair.settingsTitle')),el('p','domain-note',t('dom.surfacePair.settingsHelp')));
      for(const [key,label,id]of [['upperSurface','dom.solid.topBoundary','domainReviewUpperSurface'],['lowerSurface','dom.solid.baseBoundary','domainReviewLowerSurface']]){
        const surface=OrebitCoreDomain.surfaces().find(s=>s.id===solid[key]);if(!surface)continue;
        const row=el('div','domain-note'),source=t(surface.recipe.maxEdge==null?'dom.surfacePair.limitDefault':'dom.surfacePair.limitExplicit');
        row.append(el('p',null,t(label)+': '+surface.name+' · '+fmt(surface.maxEdge,2)+' m · '+source));
        const review=el('button','btn secondary',tt('dom.surfacePair.reviewSettings',{name:surface.name}));review.type='button';review.id=id;
        review.onclick=()=>{
          Object.assign(contact,surface.recipe,{result:null,error:null});selectWorkflowStep('contacts');contactForm();computeContacts();
          const name=$('domainSurfaceName');if(name){let candidate=surface.name.slice(0,66)+'-review',suffix=2;while(OrebitCoreDomain.surfaces().some(s=>s.id===candidate))candidate=surface.name.slice(0,60)+'-review-'+suffix++;name.value=candidate;}
          const input=$('domainContactMaxEdge');input?.scrollIntoView({block:'center'});input?.focus();
        };
        row.append(review);limits.append(row);
      }
    }
    updateLimits();
  }
  let surfacePairBuildSequence=0;
  async function buildSavedSurfacePair(){
    const request=++surfacePairBuildSequence,source=OrebitCoreDomain.sourceRevision(),version=OrebitCoreDomain.interpretationRevision();
    const context=()=>JSON.stringify([buildMethod,contact.target,solid.sourceMode,solid.upperSurface,solid.lowerSurface,solid.topography,solid.terrainSurface,solid.code]);
    const selected=context();solid.result=null;solid.error=null;clearReview();
    let result=null,error=null;
    try{result=await OrebitCoreDomain.buildContactSurfacePair(solid.upperSurface,solid.lowerSurface,solid.topography||'unavailable',solid.terrainSurface);}
    catch(e){error=String(e.message);}
    // A later selection/build/project owns the UI now. The scientific owner
    // rejects outdated input; its late result/error must not overwrite that UI.
    if(request!==surfacePairBuildSequence||source!==OrebitCoreDomain.sourceRevision()||version!==OrebitCoreDomain.interpretationRevision()||selected!==context())return;
    solid.result=result;solid.error=error;saveWorkspace();render();
  }

  function solidForm() {
    const box = $('domainSolidForm'); if (!box) return;
    box.textContent = '';
    const pairBox=el('div');pairBox.id='domainSurfacePairForm';pairBox.style.gridColumn='1 / -1';pairBox.style.minWidth='0';surfacePairForm(pairBox);box.append(pairBox);
    const topo = el('select'); topo.id = 'domainSolidTopo'; topo.setAttribute('aria-describedby', 'domainSurfaceHelp');
    for (const v of ['', 'collars', ...(solid.terrainSurface?['imported']:[]), 'unavailable']) topo.append(new Option(t('dom.solid.topo.' + (v || 'choose')), v));
    topo.value = solid.topography;
    const density = document.createElement('input');
    Object.assign(density, {type:'number', id:'domainSolidDensity', min:0, step:'any', value:solid.density ?? ''});
    const go = el('button', 'btn btn-primary', t(solid.sourceMode==='pair'?'dom.surfacePair.build':'dom.solid.buildFromContacts')); Object.assign(go, {type:'button', id:'domainSolidBuild'});
    const ready = () => { go.disabled = !contactBuildReady(); };
    topo.addEventListener('change', () => setTopography(topo.value));
    density.addEventListener('change', () => { const x=Number(density.value),previous=solid.density;solid.density=density.value!==''&&Number.isFinite(x)&&x>0?x:null;
      if(solid.density==null)density.value='';
      if(previous!==solid.density){clearReview();if(solid.result?.validation)solid.result.validation.geologistReview=false;
        OrebitCoreDomain.invalidateInterpretation('Material density decision changed',solid.code.trim());saveWorkspace();}
      solidFacts();readiness(); });
    go.addEventListener('click', async () => { if(solid.sourceMode==='pair'){go.disabled=true;await buildSavedSurfacePair();}else{buildSolid();render();} });
    const ground=el('section','domain-ground-check');ground.id='domainGroundCheck';
    const heading=el('h4',null,t('dom.solid.groundTitle'));heading.id='domainGroundCheckTitle';
    ground.setAttribute('aria-labelledby',heading.id);ground.append(heading,field(t('dom.solid.topoLabel'),topo));
    box.append(ground, field(t('dom.solid.density'), density), go);
    ready();
  }
  function solidFacts() {
    const facts = $('domainSolidFacts'), note = $('domainSolidNote'), checks = $('domainSolidChecks');
    if (!facts) return;
    facts.textContent = ''; checks.textContent = '';
    const go = $('domainSolidBuild'); if (go) go.disabled = !contactBuildReady();
    const r = solid.result;
    window.__domainSolid = r ? {kind:r.kind || 'between', endRule:r.endRule ?? null, above:r.above ?? null, outside:r.outside ?? null, status:r.status, shellError:r.shellError??null, meshDiagnostics:r.meshDiagnostics??null, volume:r.volume ?? null, meshVolume:r.meshVolume ?? null, density:solid.density, topography:r.topography,
      validation:r.validation ? {...r.validation} : null, excluded:r.excluded.length, inverted:[...r.inverted || []], pinched:[...r.pinched || []], triangles:r.triangles ?? 0} : null;
    const saved=OrebitCoreDomain.displaySolids().find(d=>d.code===solid.code.trim());
    note.textContent = solid.error || (saved&&(!r||r.validation?.geologistReview===true)?tt(saved.stale?'dom.solid.savedStale':'dom.solid.savedView',{code:saved.code}):
      r?t((r.kind==='surface-pair'&&['inverted','pinched','no-triangles'].includes(r.status)?'dom.surfacePair.result.':'dom.solid.result.')+r.status):t('dom.solid.prompt'));
    if(r?.kind==='surface-pair'&&r.status==='invalid'){
      note.append(document.createElement('br'),document.createTextNode(t(r.meshDiagnostics?.nonManifoldEdges?'dom.surfacePair.fragmented':'dom.surfacePair.invalidDetail')+' '+r.shellError));
      if(r.supportJunctions?.length){
        const points=r.supportJunctions.map(j=>j.point.slice(0,2).map(x=>fmt(x,2)).join(', ')).join(' / ');
        note.append(document.createElement('br'),document.createTextNode(tt('dom.surfacePair.supportJunctions',{n:r.supportJunctions.length,points})));
      }
      if(r.meshDiagnostics?.nonManifoldEdges||r.shellError==='DOMAIN_SOLID_MULTISHELL'){
        const remedy=el('button','btn secondary',t('dom.surfacePair.reviewSupport'));remedy.id='domainSurfacePairReviewSupport';remedy.type='button';
        remedy.onclick=()=>{selectWorkflowStep('contacts');$('domainContactMaxEdge')?.focus();};
        note.append(document.createElement('br'),remedy);
      }
    }
    if(r?.status==='invalid')domainGuide(note);
    const add = (k, v) => facts.append(el('dt', null, k), el('dd', null, v));
    if(buildMethod==='contacts'&&solid.sourceMode==='pair'){
      add(t('dom.solid.topBoundary'),solid.upperSurface||'—');add(t('dom.solid.baseBoundary'),solid.lowerSurface||'—');
      for(const [key,label]of [['upperSurface','dom.surfacePair.upperEdge'],['lowerSurface','dom.surfacePair.lowerEdge']]){
        const surface=OrebitCoreDomain.surfaces().find(s=>s.id===solid[key]);if(surface)add(t(label),fmt(surface.maxEdge,2)+' m');
      }
    }else if(buildMethod==='contacts'&&contact.target){
      add(t('dom.solid.topBoundary'),t('dom.contact.rule.'+(contact.rule==='last_to'?'first_from':contact.rule)));
      add(t('dom.solid.baseBoundary'),t('dom.contact.rule.last_to'));
    }
    if (!r) { acceptBlock(null); acceptState(); return; }
    const named = list => list.slice(0, 12).join(', ') + (list.length > 12 ? ' …' : '');
    if (r.inverted?.length) add(t(r.kind==='surface-pair'?'dom.surfacePair.invertedPoints':'dom.solid.inverted'), named(r.inverted));
    if (r.pinched?.length) add(t(r.kind==='surface-pair'?'dom.surfacePair.pinchedPoints':'dom.solid.pinched'), named(r.pinched));
    if (r.status !== 'solid' && r.status !== 'invalid') return;
    add(t(r.status==='invalid'?'dom.solid.unvalidatedVolume':'dom.solid.volume'), r.volume == null ? '—' : fmt(r.volume, 0) + ' m³');
    if (solid.density != null && r.volume != null) add(t('dom.solid.tonnage'), fmt(r.volume * solid.density, 0) + ' t');
    if(r.kind==='surface-pair')add(t('dom.surfacePair.area'),fmt(r.commonArea,2)+' m²');
    else add(t('dom.solid.holes'), fmt(r.holes.length) + ' / ' + fmt(r.holes.length + r.excluded.length));
    if (r.kind === 'loft') {
      add(t('dom.loft.endRule'), t('dom.loft.end.' + r.endRule) + (r.endRule === 'zero' ? '' : ' · ' + fmt(r.extension.before, 1) + ' / ' + fmt(r.extension.after, 1) + ' m'));
      add(t('dom.loft.sectionsFact'), fmt(r.sections));
      add(t('dom.loft.offPlane'), fmt(r.offPlane, 2) + ' m');
      if(r.badAnchors?.length)add(t('dom.loft.anchorIssues'),r.badAnchors.slice(0,10).map(a=>a.hole+' @ '+fmt(a.depth,2)+' m · '+t('dom.loft.vertex')+' '+a.vertex).join('; '));
      if (r.above) add(t('dom.loft.above'), fmt(r.above));
      if (r.outside) add(t('dom.loft.outside'), fmt(r.outside));
    } else if(r.kind!=='surface-pair')add(t('dom.solid.baseDeviation'), fmt(r.baseDeviation, 3) + ' m');
    for (const k of OrebitDomainState.requiredChecks) {
      // The review is the geologist's own action, so it is pending here, never failed.
      const v = r.validation[k], state = v === true ? 'pass' : v === false && k !== 'geologistReview' ? 'fail' : 'open';
      const li = el('li', 'is-' + state); li.dataset.check = k;
      li.append(el('span', null, t('dom.solid.check.' + k)), el('b', null, t('dom.solid.state.' + state)));
      checks.append(li);
    }
    if(r.sourceRevision==null){r.sourceRevision=OrebitCoreDomain.sourceRevision();r.interpretationRevision=OrebitCoreDomain.interpretationRevision();}
    acceptBlock(r);
  }
  // S8: the geologist accepts a checked solid; it is then stored with the project and drives readiness.
  function acceptBlock(r) {
    const box = $('domainSolidAccept'); if (!box) return;
    box.textContent = '';
    const v = r?.validation;
    if (!v || r.status !== 'solid') return;
    const geometryOk = ['topology', 'selfIntersection', 'surfaceCrossings', 'honouring'].every(k => v[k] === true);
    const name = document.createElement('input'); Object.assign(name, {type:'text', id:'domainSolidCode', value:solid.code, maxLength:40});
    name.addEventListener('input', () => { solid.code=name.value;saveWorkspace();go.disabled=!ready(); });
    const tick = document.createElement('input'); Object.assign(tick, {type:'checkbox', id:'domainSolidReview', checked:solid.reviewed});
    const tickLabel = el('label', 'domain-check'); tickLabel.append(tick, el('span', null, t('dom.solid.review')));
    tick.addEventListener('change', () => { solid.reviewed = tick.checked; go.disabled = !ready(); });
    const reviewer=el('input');Object.assign(reviewer,{type:'text',id:'domainSolidReviewer',value:solid.reviewer,maxLength:OrebitDomainState.reviewLimits.reviewer,required:true});
    const reason=el('textarea');Object.assign(reason,{id:'domainSolidReason',value:solid.reason,rows:3,maxLength:OrebitDomainState.reviewLimits.reason,required:true});
    for(const control of [reviewer,reason]){
      control.setAttribute('aria-describedby','domainSolidAcceptWhy');
      control.addEventListener('input',()=>{solid.reviewer=reviewer.value;solid.reason=reason.value;go.disabled=!ready();explainReview();});
    }
    const go = el('button', 'btn btn-primary', t('dom.solid.accept')); Object.assign(go, {type:'button', id:'domainSolidAcceptBtn'});
    let accepting=false;
    const reviewReady=()=>{try{OrebitDomainState.reviewIdentity({reviewer:solid.reviewer,reason:solid.reason});return true;}catch{return false;}};
    const ready = () => !accepting && geometryOk && v.topography === true && solid.reviewed && solid.code.trim() !== '' && reviewReady();
    go.disabled = !ready();
    go.addEventListener('click', async () => {
      accepting=true;go.disabled=true;name.disabled=tick.disabled=reviewer.disabled=reason.disabled=true;
      try {
        const accepted=await OrebitCoreDomain.acceptSolid({sourceRevision:r.sourceRevision,code:solid.code, density:solid.density, mesh:r.mesh, volume:r.volume, validation:r.validation, review:solid.reviewed,reviewRecord:{reviewer:solid.reviewer,reason:solid.reason},
          inputs:r.inputs || {topographyAudit:{type:'per-hole collar elevation check',fullSurfaceClipping:false},rules:{top:contact.rule === 'last_to' ? 'first_from' : contact.rule, base:'last_to', target:contact.target, threshold:contact.threshold,
            maxEdge:r.maxEdge, maxEdgeSource:r.maxEdgeSource, topography:r.topography}, holes:r.holes}});
        if(solid.result===r&&r.sourceRevision===OrebitCoreDomain.sourceRevision()){
          Object.assign(r.validation,accepted.domains.find(d=>d.code===solid.code.trim()).build.validation);
          solid.accepted=null;if(r.kind==='loft')loft.domainCode=solid.code.trim();
          if(r.kind==='surface-pair'){contact.target='book:'+solid.code.trim();contact.result=null;contactForm();computeContacts();}
          saveWorkspace();render();
        }
      } catch (e) { if(solid.result===r&&r.sourceRevision===OrebitCoreDomain.sourceRevision())solid.accepted = {code:e.message,domain:e.domain,volume:e.volume}; }
      accepting=false;name.disabled=tick.disabled=reviewer.disabled=reason.disabled=false;go.disabled = !ready(); acceptState(); readiness();
    });
    const why = el('p', 'domain-note'); why.id = 'domainSolidAcceptWhy';
    function explainReview(){why.textContent=!geometryOk?t('dom.solid.acceptGeometry'):v.topography!==true?t('dom.solid.acceptTopo'):!reviewReady()?t('dom.solid.reviewRequired'):'';}
    explainReview();
    const rationale=field(t('dom.solid.reviewReason'),reason);rationale.classList.add('domain-review-reason');
    box.append(field(t('dom.solid.code'), name), tickLabel, field(t('dom.solid.reviewer'),reviewer),rationale,go,why);
    acceptState();
  }
  function acceptState() {
    const box = $('domainSolidAccept'); if (!box) return;
    box.querySelector('.domain-accepted')?.remove();
    const domains = OrebitCoreDomain.summaries(), stored = domains.find(d=>d.code===solid.code.trim()) || domains[0];
    window.__domainAccepted = stored ? {code:stored.code, volume:stored.build.volume, density:stored.density, validation:{...stored.build.validation}} : null;
    if (!stored && !solid.accepted) return;
    const done = el('div', 'domain-accepted');
    if (solid.accepted) {
      const reason=solid.accepted.code==='DOMAIN_CONTACT_SUPPORT_AMBIGUOUS'?t('dom.contact.result.ambiguous'):solid.accepted.code==='DOMAIN_CONTACT_ENDPOINTS_UNAVAILABLE'?t('dom.noEndpoints'):solid.accepted.code==='DOMAIN_SOLIDS_OVERLAP'?tt('dom.solid.overlapError',{code:solid.accepted.domain,volume:fmt(solid.accepted.volume,2)}):solid.accepted.code;
      done.append(el('p','domain-note',tt('dom.solid.acceptError',{reason})));
    }
    for (const [index,stored] of domains.entries()) {
      done.append(el('p', 'domain-note', tt('dom.solid.accepted', {code:stored.code, volume:fmt(stored.build.volume, 0)})));
      if(stored.build.review)done.append(el('p','domain-note domain-review-record',tt('dom.solid.reviewRecord',stored.build.review)));
      if(stored.build.stale)done.append(el('p','domain-note',t('dom.ready.stale')+' · '+t('dom.solid.staleReview')));
      const undo = el('button', 'btn secondary', t('dom.solid.remove')); Object.assign(undo, {type:'button', id:'domainSolidRemove'+(index?'-'+index:'')});
      undo.setAttribute('aria-label',t('dom.solid.remove')+' '+stored.code);
      undo.addEventListener('click', () => { OrebitCoreDomain.removeSolid(stored.code); acceptState(); readiness(); });
      const visible=el('input');Object.assign(visible,{type:'checkbox',checked:stored.visible!==false,id:'domainSolidVisible-'+index});
      const label=el('label','domain-check');label.append(visible,' '+t('dom.book.visible')+' · '+stored.code);
      visible.addEventListener('change',()=>{OrebitCoreDomain.setVisibility(stored.code,visible.checked);render();});
      done.append(label,undo);
    }
    box.append(done);
  }
  // S5/S6: a section is identified by its line origin and azimuth; a ring is (distance, RL) on that section.
  const sameKey = (a, b) => a && b && a.azimuth === b.azimuth && Math.hypot(a.origin[0] - b.origin[0], a.origin[1] - b.origin[1]) < 1e-6;
  const hereKey = () => here && {offset:here.offset, origin:here.origin, azimuth:view.azimuth};
  const draftHere = () => (sameKey(loft.draftAt, hereKey()) ? loft.draft : []);
  const LOFT_ERRORS = ['DOMAIN_POLYGON_SELF_INTERSECTION', 'DOMAIN_POLYGON_DUPLICATE', 'DOMAIN_POLYGON_DEGENERATE', 'DOMAIN_LOFT_NOT_PARALLEL',
    'DOMAIN_LOFT_STATION_DUPLICATE', 'DOMAIN_LOFT_CAP', 'DOMAIN_LOFT_BUDGET', 'DOMAIN_TIN_COLLINEAR'];
  const loftError = e => tt('dom.contact.error', {code:LOFT_ERRORS.includes(e.message) ? t('dom.loft.err.' + e.message) : e.message});
  function loftOverlay() {
    const key = hereKey();
    return {rings:loft.sections.filter(s => sameKey(s, key)).map(s => s.points), draft:draftHere().map(p => [p.h, p.rl]), edit:loft.tool === 'edit', selected:selectedVertex()?.point || null};
  }
  function remember() {
    loft.undo.push(JSON.stringify({draft:loft.draft, draftAt:loft.draftAt || null, sections:loft.sections, domainCode:loft.domainCode, endRule:loft.endRule, snap:loft.snap}));
    if (loft.undo.length > UNDO_LIMIT) loft.undo.shift();
    loft.redo = [];
  }
  function step(from, to) {
    if (!from.length) return;
    const next=JSON.parse(from[from.length-1]);
    OrebitDomainState.checkLoftSnapshot(next);
    to.push(JSON.stringify({draft:loft.draft, draftAt:loft.draftAt || null, sections:loft.sections, domainCode:loft.domainCode, endRule:loft.endRule, snap:loft.snap}));
    if(to.length>UNDO_LIMIT)to.shift();
    from.pop();
    for(const key of ['draft','draftAt','sections','domainCode','endRule','snap'])loft[key]=next[key];
    loft.error=null;
    if(!selectedVertex())loft.selection=null;
    changed();
  }
  function saveWorkspace() {
    stashDomain();
    OrebitCoreDomain.saveWorkspace({version:1,frame:{crs:STATE.crs||null,units:'m'},...editorContext(),domainDrafts,
      view:{mode:view.mode,azimuth:view.azimuth,width:view.width,offset:view.offset,ve:view.ve,veAuto:view.veAuto},
    });
  }
  function changed() {
    solid.accepted=null;saveWorkspace();
    if (solid.result?.kind === 'loft') { solid.result = null; solid.error = null; }
    // Draft edits must not silently export a prior accepted loft as the current interpretation.
    if (OrebitCoreDomain.hasAcceptedLoft(loft.domainCode)) {
      OrebitCoreDomain.invalidateInterpretation('Section interpretation changed',loft.domainCode); readiness();
    }
    render();
  }
  function verticesHere() {
    if (!here || view.mode !== 'section') return [];
    const section = loft.sections.find(s => sameKey(s, hereKey()));
    return [...(section ? section.points.map((point, index) => ({kind:'section', index, point, section})) : []),
      ...draftHere().map((p, index) => ({kind:'draft', index, point:[p.h, p.rl]}))];
  }
  function selectedVertex() {
    if (!sameKey(loft.selection?.at, hereKey())) return null;
    return verticesHere().find(p => p.kind === loft.selection.kind && p.index === loft.selection.index) || null;
  }
  function selectVertex(vertex) {
    loft.selection = vertex ? {kind:vertex.kind, index:vertex.index, at:hereKey()} : null;
    loft.error = null; render();
  }
  function editVertex(h, rl, remove = false) {
    const selected = selectedVertex();
    if (!selected || (!remove && ![h, rl].every(Number.isFinite))) return;
    const points = selected.kind === 'section' ? selected.section.points.map(p => p.slice()) : draftHere().map(p => [p.h, p.rl]);
    let snap = null;
    if (remove) points.splice(selected.index, 1);
    else {
      let best = null;
      if (loft.snap > 0) for (const p of snapTargets()) {
        const distance = Math.hypot(p.h - h, p.rl - rl);
        if (distance <= loft.snap && (!best || distance < best.distance)) best = {...p, distance};
      }
      if (best) { h = best.h; rl = best.rl; snap = {hole:best.hole, depth:best.depth, off:best.off,radius:loft.snap}; }
      points[selected.index] = [h, rl];
    }
    try {
      if (selected.kind === 'section' && points.length < 3) throw Error('DOMAIN_POLYGON_DEGENERATE');
      if (points.length >= 3) OrebitGeometryPrimitives.inspectPolygon(points);
    } catch (e) { loft.error = loftError(e); render(); return; }
    if (!remove && points[selected.index].every((v, i) => v === selected.point[i])) { loft.error = null; render(); return; }
    remember();
    if (selected.kind === 'section') {
      selected.section.points = points;
      if (remove) selected.section.snaps.splice(selected.index, 1);
      else selected.section.snaps[selected.index] = snap;
    } else {
      if (remove) loft.draft.splice(selected.index, 1);
      else loft.draft[selected.index] = {h, rl, snap};
    }
    loft.error = null;
    if (remove) loft.selection = null;
    changed();
    $('domainLoftVertexApply')?.focus();
  }

  function detachSnap(){
    const selected=selectedVertex();if(!selected)return;
    const current=selected.kind==='section'?selected.section.snaps[selected.index]:loft.draft[selected.index].snap;
    if(!current)return;
    remember();
    if(selected.kind==='section')selected.section.snaps[selected.index]=null;else loft.draft[selected.index].snap=null;
    changed();$('domainLoftVertexManual')?.focus();
  }

  // Contact picks inside the current slab; a click within the snap radius (true metres, not screen) takes the pick's position.
  function snapTargets() {
    if (!here || !contact.result) return [];
    return contact.result.picks.filter(p => p.status === 'contact').map(p => {
      const q = OrebitGeometryPrimitives.project(here.plane, p.point);
      return Math.abs(q[2]) <= view.width ? {h:q[0], rl:p.point[2], hole:p.hole, depth:p.depth, off:Math.abs(q[2])} : null;
    }).filter(Boolean);
  }
  function addPoint(h, rl) {
    if (!here || view.mode !== 'section' || ![h, rl].every(Number.isFinite)) return;
    const draft = draftHere();
    let best = null;
    if(loft.snap>0) for (const s of snapTargets()) { const d = Math.hypot(s.h - h, s.rl - rl); if (d <= loft.snap && (!best || d < best.d)) best = {...s, d}; }
    if (draft.length >= 3 && !best && Math.hypot(draft[0].h - h, draft[0].rl - rl) <= loft.snap) return closeRing();
    remember();
    if (!draft.length) { loft.draft = []; loft.draftAt = hereKey(); }
    loft.draft.push(best ? {h:best.h, rl:best.rl, snap:{hole:best.hole, depth:best.depth, off:best.off,radius:loft.snap}} : {h, rl, snap:null});
    loft.error = null;
    changed();
  }
  // One ring per section: closing a ring on a section that has one replaces it (undo brings it back).
  function closeRing() {
    const draft = draftHere();
    if (draft.length < 3) return;
    try { OrebitGeometryPrimitives.inspectPolygon(draft.map(p => [p.h, p.rl])); } catch (e) { loft.error = loftError(e); return render(); }
    remember();
    const at = loft.draftAt, plane = OrebitGeometryPrimitives.sectionPlane([at.origin[0], at.origin[1], 0], at.azimuth);
    loft.sections = loft.sections.filter(s => !sameKey(s, at)).concat({offset:at.offset, origin:at.origin.slice(), azimuth:at.azimuth, normal:plane.normal.slice(),
      points:draft.map(p => [p.h, p.rl]), snaps:draft.map(p => p.snap)});
    loft.draft = []; loft.draftAt = null; loft.error = null;
    changed();
  }
  function buildLoft() {
    solid.result = null; solid.error = null;
    if (loft.sections.length < 2 || loft.draft.length || !loft.endRule || !solid.topography || (solid.topography==='imported'&&!solid.terrainSurface)) return;
    const P = OrebitGeometryPrimitives;
    try {
      const first = loft.sections[0], plane = P.sectionPlane([first.origin[0], first.origin[1], 0], first.azimuth);
      const placed = loft.sections.map(s => { const d = [s.origin[0] - first.origin[0], s.origin[1] - first.origin[1], 0]; return {s, du:P.dot(d, plane.u), station:P.dot(d, plane.normal)}; });
      // The section plane's v axis points down from z = 0, so local v is −RL.
      const r = OrebitDomainLoft.loft({plane, endRule:loft.endRule, sections:placed.map(x => ({station:x.station, normal:x.s.normal, ring:x.s.points.map(([h, rl]) => [h + x.du, -rl])}))});
      // Honouring: every snapped contact is a vertex of the solid, in the plane of its section.
      let honouring = true, offPlane = 0;const badAnchors=[];
      const holes = new Set();
      for (const x of placed) x.s.snaps.forEach((snap, i) => {
        if (!snap) return;
        holes.add(snap.hole); offPlane = Math.max(offPlane, snap.off);
        const [h, rl] = x.s.points[i], q = P.unproject(plane, [h + x.du, -rl, x.station]);
        if (!r.mesh.v.some(w => Math.hypot(w[0] - q[0], w[1] - q[1], w[2] - q[2]) <= 1e-6)) honouring = false;
        // A historical projected anchor is not proof that the current trace
        // still passes through it. Missing/excluded/moved holes require repair.
        const measured=STATE.desurvey?.holes?.[snap.hole]?.curve?.atMD(snap.depth);
        if(!measured){honouring=false;badAnchors.push({hole:snap.hole,depth:snap.depth,vertex:i+1,sectionOffset:x.s.offset,reason:'missing-or-excluded-trace'});}
        else{
          const now=P.project(plane,[measured.x,measured.y,measured.z]),projected=P.unproject(plane,[now[0],now[1],x.station]);
          if(Math.hypot(...P.sub(projected,q))>1e-6||Math.abs(Math.abs(now[2]-x.station)-snap.off)>1e-6){honouring=false;badAnchors.push({hole:snap.hole,depth:snap.depth,vertex:i+1,sectionOffset:x.s.offset,reason:'trace-coordinate-changed'});}
        }
      });
      // Topography: compare the closed mesh with its selected, provenance-bound TIN.
      let topography = null, above = 0, outside = 0, terrainSurface=null;
      if (solid.topography === 'collars') {
        terrainSurface = {kind:'reviewed-collar-tin',...P.makeTIN(collarsOf(new Set(STATE.collar.map(c=>c.hole_id))).map(c=>[c.x,c.y,c.z]))};
      }else if(solid.topography==='imported')terrainSurface=solid.terrainSurface;
      let coverage=null;
      if(terrainSurface){
        const tin = P.prepareTIN(terrainSurface);
        for (const q of r.mesh.v) { const s = tin.sample(q[0], q[1]); if (!s) outside++; else if (q[2] > s.z + 1e-6) above++; }
        if(solid.topography==='imported')coverage=OrebitSurfaceImport.assessCoverage(terrainSurface,r.mesh);
        topography = above === 0 && (solid.topography!=='imported'||(outside===0&&coverage.fullSurfaceCoverage));
      }
      const sections = placed.map(x => ({station:x.station, origin:x.s.origin, offset:x.s.offset, azimuth:x.s.azimuth, points:x.s.points, snaps:x.s.snaps}));
      solid.result = {sourceRevision:OrebitCoreDomain.sourceRevision(),interpretationRevision:OrebitCoreDomain.interpretationRevision(),kind:'loft', status:r.status, volume:r.volume, meshVolume:r.volume, mesh:r.mesh, holes:[...holes], excluded:[], triangles:r.mesh.f.length,
        topography:solid.topography, endRule:r.endRule, sections:r.sections, extension:r.extension, offPlane, badAnchors,above, outside, shellError:r.shellError,
        validation:{topology:r.validation.topology, selfIntersection:r.validation.selfIntersection, topography, surfaceCrossings:true, overlap:null, honouring, geologistReview:false},
        inputs:{honouringAudit:{type:'section-projected contacts',maxOffPlaneMetres:offPlane,unmatchedAnchors:badAnchors,snappedVertices:loft.sections.reduce((n,s)=>n+s.snaps.filter(Boolean).length,0),manualVertices:loft.sections.reduce((n,s)=>n+s.snaps.filter(p=>!p).length,0)},
          ...(terrainSurface?{topographyAudit:{type:solid.topography==='imported'?'imported DXF terrain TIN':'reviewed collar-elevation TIN',pointCount:terrainSurface.v.length,triangleCount:terrainSurface.triangles.length,outsideVertices:outside,aboveVertices:above,fullSurfaceClipping:solid.topography==='imported'?coverage.fullSurfaceCoverage:true,...(coverage?{coverage}: {})},terrainSurface}:{}),
          rules:{method:'section-loft', target:contact.target, endRule:r.endRule, azimuth:first.azimuth, snapRadius:loft.snap, topography:solid.topography}, sections, holes:[...holes]}};
      clearReview();
      if (!solid.code) solid.code = contact.target ? contact.target.slice(contact.target.indexOf(':') + 1) : '';
    } catch (e) { solid.error = loftError(e); }
  }
  function loftPanel() {
    const box = $('domainLoftForm'); if (!box) return;
    box.textContent = '';
    const inSection = view.mode === 'section' && !!here, draft = draftHere();
    const button = (key, id, run, cls = 'btn secondary') => { const b = el('button', cls, t(key)); Object.assign(b, {type:'button', id}); b.addEventListener('click', run); return b; };
    const number = (id, value, min) => { const i = document.createElement('input'); Object.assign(i, {type:'number', id, step:'any', value:value ?? ''}); if (min != null) i.min = min; return i; };
    const h = number('domainLoftH'), rl = number('domainLoftRL');
    const add = button('dom.loft.add', 'domainLoftAdd', () => addPoint(h.value === '' ? NaN : Number(h.value), rl.value === '' ? NaN : Number(rl.value)));
    const close = button('dom.loft.close', 'domainLoftClose', closeRing);
    const undo = button('dom.loft.undo', 'domainLoftUndo', () => step(loft.undo, loft.redo));
    const redo = button('dom.loft.redo', 'domainLoftRedo', () => step(loft.redo, loft.undo));
    const newDomain = button('dom.loft.newDomain','domainLoftNewDomain',async()=>{
      if((loft.sections.length||loft.draft.length)&&typeof orebitConfirm==='function'&&!await orebitConfirm(t('dom.loft.newDomainConfirm')))return;
      const named=contact.target.startsWith('book:');stashDomain();contact.target='';
      if(named){loft.undo=[];loft.redo=[];}else remember();
      loft.domainCode=null;loft.selection=null;loft.draft=[];loft.draftAt=null;loft.sections=[];loft.endRule='';loft.error=null;
      solid.code='';solid.result=null;solid.error=null;solid.accepted=null;clearReview();saveWorkspace();render();
      // Start the next interpretation at its explicit definition. Rendering
      // replaces the old dialog opener; restore focus to the new-code owner.
      const choose=$('domainCodebookSelect');
      if(choose){choose.value='';choose.dispatchEvent(new Event('change',{bubbles:true}));}
      selectWorkflowStep('book');$('domainCodebookCode')?.focus({preventScroll:true});
    });
    const clear = button('dom.loft.clear', 'domainLoftClear', () => { remember(); loft.draft = []; loft.draftAt = null; changed(); });
    const snap = number('domainLoftSnap', loft.snap, 0);
    snap.addEventListener('change', () => { const x = Number(snap.value); if (snap.value !== '' && Number.isFinite(x) && x >= 0 && x!==loft.snap){remember();loft.snap=x;changed();}else snap.value=loft.snap; });
    const end = el('select'); end.id = 'domainLoftEnd';
    for (const v of ['', ...OrebitDomainLoft.RULES]) end.append(new Option(t('dom.loft.end.' + (v || 'choose')), v));
    end.value = loft.endRule;
    end.addEventListener('change', () => { loft.endRule = end.value; changed(); });
    const topo = el('select'); topo.id='domainLoftTopo'; topo.setAttribute('aria-describedby','domainLoftSurfaceHelp');
    for (const value of ['', 'collars', ...(solid.terrainSurface?['imported']:[]), 'unavailable']) topo.append(new Option(t('dom.solid.topo.'+(value||'choose')),value));
    topo.value=solid.topography;
    topo.addEventListener('change',()=>setTopography(topo.value));
    const go = button('dom.loft.build', 'domainLoftBuild', () => { buildLoft(); render(); }, 'btn btn-primary');
    go.setAttribute('aria-describedby','domainLoftBuildNote');
    add.disabled = !inSection; close.disabled = draft.length < 3; undo.disabled = !loft.undo.length; redo.disabled = !loft.redo.length; clear.disabled = !draft.length;
    go.disabled = loft.sections.length < 2 || !!loft.draft.length || !loft.endRule || !solid.topography || (solid.topography==='imported'&&!solid.terrainSurface);
    const points = el('div', 'domain-viewer-inputs domain-loft-points'); points.append(add, close, undo, redo, clear);
    if (loft.tool === 'edit') {
      const selected = selectedVertex(), choices = el('select'); choices.id = 'domainLoftVertex';
      choices.append(new Option(t('dom.loft.vertexChoose'), ''));
      for (const v of verticesHere()) choices.append(new Option((v.kind === 'draft' ? t('dom.loft.vertexDraft') : t('dom.loft.vertexRing')) + ' ' + (v.index + 1) + ' · ' + fmt(v.point[0], 2) + ' / ' + fmt(v.point[1], 2), v.kind + ':' + v.index));
      choices.value = selected ? selected.kind + ':' + selected.index : '';
      choices.addEventListener('change', () => selectVertex(verticesHere().find(v => v.kind + ':' + v.index === choices.value)));
      if (selected) { h.value = selected.point[0]; rl.value = selected.point[1]; }
      const apply = button('dom.loft.vertexApply', 'domainLoftVertexApply', () => editVertex(h.value === '' ? NaN : Number(h.value), rl.value === '' ? NaN : Number(rl.value)), 'btn btn-primary');
      const removeVertex = button('dom.loft.vertexRemove', 'domainLoftVertexRemove', () => editVertex(null, null, true));
      apply.disabled = !selected; removeVertex.disabled = !selected || (selected.kind === 'section' && selected.section.points.length <= 3);
      const manual=button('dom.loft.vertexManual','domainLoftVertexManual',detachSnap);
      manual.disabled=!selected||!(selected.kind==='section'?selected.section.snaps[selected.index]:loft.draft[selected.index].snap);
      points.prepend(field(t('dom.loft.vertex'), choices), apply, removeVertex,manual);
      add.hidden = close.hidden = clear.hidden = true;
    }
    box.append(field(t('dom.axis.distance'), h), field(t('dom.loft.rl'), rl), points, field(t('dom.loft.snap'), snap),newDomain);
    const buildBox=$('domainLoftBuildForm');buildBox.textContent='';
    buildBox.append(field(t('dom.loft.endRule'),end),field(t('dom.solid.topoLabel'),topo),go);
    const help=el('p','domain-note',t(solid.topography==='imported'?'dom.solid.topo.importedHelp':'dom.solid.topo.help'));help.id='domainLoftSurfaceHelp';buildBox.append(help);
    const note = $('domainLoftNote'); note.setAttribute('aria-live', 'polite');
    const missing=[];
    if(loft.sections.length<2)missing.push(tt('dom.loft.needRings',{n:loft.sections.length}));
    if(loft.draft.length)missing.push(t('dom.loft.finishDraft'));
    if(!loft.endRule)missing.push(t('dom.loft.needEnd'));
    if(!solid.topography||(solid.topography==='imported'&&!solid.terrainSurface))missing.push(t('dom.loft.needTopo'));
    note.textContent=loft.error || solid.error || (loft.sections.length>=2 ? (missing.length?missing.join(' '):t('dom.loft.ready'))
      : !inSection?t('dom.loft.notSection'):draft.length?tt('dom.loft.draft',{n:draft.length}):missing.join(' '));
    note.dataset.ready=String(!go.disabled);
    $('domainLoftBuildNote').textContent=note.textContent;
    const review=button('dom.workflow.nextSolid','domainLoftReview',()=>document.querySelector('.domain-steps [data-domain-step="solid"]')?.click());
    review.hidden=!solid.result||solid.result.kind!=='loft';box.append(review);syncBuildMethod();
    const list = $('domainLoftSections'); list.textContent = '';
    for (const s of loft.sections) {
      const li = el('li'), snapped = s.snaps.filter(Boolean).length;
      li.append(el('b', null, (s.offset >= 0 ? '+' : '') + fmt(s.offset, 1) + ' m · ' + s.azimuth + '°'), ' ' + tt('dom.loft.sectionItem', {n:s.points.length, snapped}));
      const remove = button('dom.loft.remove', '', () => { remember(); loft.sections = loft.sections.filter(x => x !== s); changed(); });
      remove.removeAttribute('id'); li.append(' ', remove); list.append(li);
    }
    window.__domainLoft = {tool:loft.tool, inSection, draft:draft.map(p => ({h:p.h, rl:p.rl, snap:p.snap})), endRule:loft.endRule, snap:loft.snap,
      sections:loft.sections.map(s => ({offset:s.offset, azimuth:s.azimuth, points:s.points.map(p => p.slice()), snapped:s.snaps.filter(Boolean).length})),
      undo:loft.undo.length, redo:loft.redo.length, error:loft.error, selected:selectedVertex() ? {kind:loft.selection.kind, index:loft.selection.index, point:selectedVertex().point.slice()} : null};
  }
  function field(label, ...inputs) { const l = el('label', 'domain-viewer-field'); const row = el('span', 'domain-viewer-inputs'); row.append(...inputs); l.append(label, row); return l; }
  function numberInput(id, key, min, step) {
    const i = document.createElement('input');
    Object.assign(i, {type:'number', id, value:view[key], min, step});
    i.addEventListener(key === 've' ? 'input' : 'change', () => {
      const x = Number(i.value);
      if (i.value !== '' && Number.isFinite(x) && x >= min) { view[key] = key === 'azimuth' ? x % 360 : x; if (key === 've') view.veAuto = false; render(); } else if (key !== 've') i.value = view[key];
    });
    if (key === 've') i.addEventListener('blur', () => { if (i.value === '' || !Number.isFinite(Number(i.value)) || Number(i.value) < min) i.value = view[key]; });
    return i;
  }
  function segmented(label, items) {
    const g = el('div', 'domain-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    for (const it of items) g.append(it);
    return g;
  }
  // Controls are rebuilt on every visit so grade columns follow the current data.
  function show() {
    if(workspaceSource!==OrebitCoreDomain.sourceRevision()) {
      layerJob++;selectedLayer=null;
      workspaceSource=OrebitCoreDomain.sourceRevision();
      const saved=OrebitCoreDomain.exportState().workspace;
      domainDrafts=[];
      Object.assign(loft,{tool:'navigate',draft:[],draftAt:null,sections:[],endRule:'',snap:2,undo:[],redo:[],error:null,selection:null,domainCode:null});
      Object.assign(solid,{sourceMode:'interval',upperSurface:'',lowerSurface:'',topography:'',terrainSurface:null,density:null,result:null,error:null,reviewed:false,reviewer:'',reason:'',code:'',accepted:null});
      if(saved?.version===1 && saved.frame.crs===(STATE.crs||null)) {
        domainDrafts=copy(saved.domainDrafts||[]);
        if(saved.method)buildMethod=saved.method;
        for(const [target,source,keys] of [[loft,saved.loft,['draft','draftAt','sections','domainCode','endRule','snap','undo','redo']],
          [view,saved.view,['mode','azimuth','width','offset','ve','veAuto']],
          [contact,saved.contact,['rule','target','threshold','maxEdge']], [solid,saved.solid,['sourceMode','upperSurface','lowerSurface','topography','terrainSurface','density','code']]])
          for(const key of keys)if(Object.prototype.hasOwnProperty.call(source,key))target[key]=source[key];
      }
    }

    const panel = $('domainViewerPanel'); if (!panel) return;
    panel.textContent = '';
    const bar = el('div', 'domain-viewer-toolbar');
    const modes = segmented(t('dom.view'), ['plan', 'section', '3d'].map(m => {
      const btn = el('button', null, t('dom.mode.' + m)); btn.type = 'button'; btn.dataset.mode = m;
      btn.addEventListener('click', () => setMode(m)); return btn;
    }));
    const colour = el('select'); colour.id = 'domainViewerColour';
    const columns = getActualGradeColumns();
    if (view.colour !== 'lith' && !columns.includes(view.colour)) view.colour = 'lith';
    for (const [value, text] of [['lith', t('dom.colour.lith')], ...columns.map(c => [c, plotName(c)])]) colour.append(new Option(text, value));
    colour.value = view.colour;
    colour.addEventListener('change', () => { view.colour = colour.value; view.stride = 1; view.hidden.clear(); render(); });
    const navigate = el('button', null, t('dom.navigate')); Object.assign(navigate, {type:'button', id:'domainToolNavigate'});
    navigate.addEventListener('click', () => { loft.tool = 'navigate'; render(); });
    const digitize = el('button', null, t('dom.later.digitize')); Object.assign(digitize, {type:'button', id:'domainToolDigitize', title:t('dom.digitizeWhy')});
    digitize.addEventListener('click', () => { buildMethod='loft';selectWorkflowStep('contacts',false);if ($('domainLoftMethod')) $('domainLoftMethod').open = true; loft.tool = 'digitize'; if (view.mode !== 'section') setMode('section'); else render(); });
    const edit = el('button', null, t('dom.loft.edit')); Object.assign(edit, {type:'button', id:'domainToolEdit'});
    edit.addEventListener('click', () => { buildMethod='loft';selectWorkflowStep('contacts',false);if ($('domainLoftMethod')) $('domainLoftMethod').open = true; loft.tool = 'edit'; if (view.mode !== 'section') setMode('section'); else render(); });
    const tools = segmented(t('dom.tool'), [navigate, digitize, edit]); tools.classList.add('domain-tools');
    const sectionFields = el('div', 'domain-viewer-section'); sectionFields.id = 'domainViewerSectionFields';
    sectionFields.append(
      field(t('dom.azimuth'), numberInput('domainViewerAzimuth', 'azimuth', 0, 'any')),
      field(t('dom.width'), numberInput('domainViewerWidth', 'width', 0.1, 1)));
    const slider = document.createElement('input');
    Object.assign(slider, {type:'range', id:'domainViewerVERange', min:1, max:VE_STEPS[VE_STEPS.length - 1], step:1, value:view.ve});
    slider.setAttribute('aria-label', t('dom.ve'));
    slider.addEventListener('input', () => { view.ve = Number(slider.value); view.veAuto = false; render(); });
    const auto = el('button', 'btn secondary', t('dom.veAuto')); Object.assign(auto, {type:'button', id:'domainViewerVEAuto'});
    auto.addEventListener('click', () => { view.veAuto = true; render(); });
    const veField = field(t('dom.ve'), slider, numberInput('domainViewerVE', 've', 0.1, 0.5), auto); veField.id = 'domainViewerVEField';
    const zoomControls=el('div','domain-viewer-field');zoomControls.id='domainSectionZoom';
    const zoomButtons=[];
    for(const [id,key,run] of [['domainSectionZoomOut','dom.zoom.out',()=>zoomSection(1/1.25)],['domainSectionZoomIn','dom.zoom.in',()=>zoomSection(1.25)],['domainSectionZoomFit','dom.zoom.fit',fitSection]]){
      const button=el('button','btn secondary',t(key));button.type='button';button.id=id;button.addEventListener('click',run);zoomButtons.push(button);
    }
    const zoomValue=el('span',null,'1×');zoomValue.id='domainSectionZoomValue';zoomValue.setAttribute('aria-live','polite');
    const zoomGroup=segmented(t('dom.zoom.title'),zoomButtons);zoomGroup.append(zoomValue);zoomControls.append(zoomGroup,el('small','hint',t('dom.zoom.help')));
    bar.append(modes, field(t('dom.colour'), colour), sectionFields, veField, tools,zoomControls);
    const stage = el('div', 'domain-canvas-wrap');
    const canvas = el('canvas', 'domain-viewer-canvas'); canvas.id = 'domainViewerCanvas'; canvas.tabIndex=0;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', t('dom.canvasLabel'));
    canvas.setAttribute('aria-describedby','domainSectionZoom');
    canvas.addEventListener('wheel',event=>{
      if(view.mode!=='section'||!fit||event.ctrlKey||event.metaKey||!event.deltaY)return;
      event.preventDefault();
      zoomSection(event.deltaY<0?1.2:1/1.2,canvasPoint(canvas,event));
    },{passive:false});
    canvas.addEventListener('keydown',event=>{
      if(view.mode!=='section'||event.ctrlKey||event.metaKey||event.altKey)return;
      if(['+','=','-','0'].includes(event.key)){
        event.preventDefault();if(event.key==='0')fitSection();else zoomSection(event.key==='-'?1/1.25:1.25);
      }
    });
    let pan=null,suppressClick=false;
    canvas.addEventListener('pointerdown',event=>{
      suppressClick=false;
      if(view.mode!=='section'||!fit||event.pointerType==='touch'||!(event.button===1||event.button===0&&event.altKey))return;
      event.preventDefault();suppressClick=true;
      pan={id:event.pointerId,point:fit.toWorld(...canvasPoint(canvas,event)),range:{h:sectionRange.h.slice(),v:sectionRange.v.slice()}};
      canvas.setPointerCapture(event.pointerId);canvas.classList.add('is-panning');
    });
    canvas.addEventListener('pointermove',event=>{
      if(!pan||pan.id!==event.pointerId||view.mode!=='section'||!fit)return;
      const now=fit.toWorld(...canvasPoint(canvas,event));
      // Use incremental world deltas because each draw refreshes the transform.
      const next={};for(const [i,axis] of ['h','v'].entries())next[axis]=pan.range[axis].map(value=>value+pan.point[i]-now[i]);
      sectionCamera.range=next;pan.range={h:next.h.slice(),v:next.v.slice()};render();
    });
    const stopPan=event=>{if(pan?.id!==event.pointerId)return;pan=null;canvas.classList.remove('is-panning');if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
    canvas.addEventListener('pointerup',stopPan);canvas.addEventListener('pointercancel',stopPan);canvas.addEventListener('lostpointercapture',stopPan);
    const cursor = el('span', 'domain-cursor'); cursor.id = 'domainViewerCursor';
    canvas.addEventListener('mousemove', e => {
      if (!fit) return;
      const [px,py]=canvasPoint(canvas,e),[hh,vv]=fit.toWorld(px,py);
      cursor.textContent = view.mode === 'plan' ? 'E ' + fmt(hh, 1) + ' · N ' + fmt(vv, 1) : t('dom.axis.distance') + ' ' + fmt(hh, 1) + ' m · RL ' + fmt(vv, 1);
      const line=planSectionAt(px,py);canvas.classList.toggle('is-section-pick',!!line);if(line)cursor.textContent+=' · '+line.name;
    });
    canvas.addEventListener('mouseleave', () => { cursor.textContent = '';canvas.classList.remove('is-section-pick'); });
    canvas.addEventListener('click', e => {
      if(suppressClick){suppressClick=false;return;}
      if(view.mode==='plan'&&fit){
        const line=planSectionAt(...canvasPoint(canvas,e));
        if(line){view.offset=line.offset;setMode('section');$('domainSectionList').querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest'});}
        return;
      }
      if (!['digitize', 'edit'].includes(loft.tool) || view.mode !== 'section' || !fit) return;
      const [px,py]=canvasPoint(canvas,e),[hh,vv]=fit.toWorld(px,py);
      if (loft.tool === 'edit') {
        const vertices = verticesHere().map(v => { const [x, y] = fit.toScreen(...v.point); return {...v, distance:Math.hypot(x-px,y-py)}; });
        const closest = vertices.filter(v => v.distance <= 14).sort((a, b) => a.distance - b.distance)[0];
        selectVertex(closest); return;
      }
      const first=draftHere()[0];
      if(first&&draftHere().length>=3){const [x,y]=fit.toScreen(first.h,first.rl);
        if(Math.hypot(x-px,y-py)<=10){closeRing();return;}}
      addPoint(hh, vv);
    });
    const plot = el('div'); plot.id = 'domainViewer3d'; plot.hidden = true;
    const legend = el('div', 'domain-viewer-legend'); legend.id = 'domainViewerLegend';
    stage.append(canvas, plot, legend);
    const status = el('p', 'domain-viewer-status'); status.id = 'domainViewerStatus'; status.setAttribute('aria-live', 'polite');
    const foot = el('div', 'domain-statusbar'); foot.append(status, cursor);
    const thin = el('button', 'btn secondary'); Object.assign(thin, {type:'button', id:'domainViewerThin', hidden:true});
    thin.addEventListener('click', () => {
      view.stride = view.stride > 1 ? 1 : Math.max(2, Math.ceil((window.__domainViewerLastDraw?.ms || 2 * BUDGET_MS) / BUDGET_MS));
      render();
    });
    const fallback=el('p','hint');fallback.id='domain3dFallback';fallback.setAttribute('role','status');fallback.hidden=true;
    const planHelp=el('p','domain-note',t('dom.section.planHelp'));planHelp.id='domainPlanHelp';domainGuide(planHelp);
    panel.append(fallback,bar, stage, foot,planHelp, thin);
    observeCanvas(canvas);
    const continueExport=$('domainContinueExport');if(continueExport)continueExport.onclick=()=>showTab(13);
    const surfaceFile=$('domainSurfaceFile');
    const useSurface=$('domainSurfaceUseButton');
    if(useSurface)useSurface.onclick=()=>{
      const status=$('domainSurfaceImportStatus');
      try{
        if(!surfaceCandidate)throw Error('SURFACE_IMPORT_REQUIRED');
        const projectCRS=String(STATE.crs||'').trim();if(!projectCRS||surfaceCandidate.crs!==projectCRS)throw Error('SURFACE_IMPORT_PROJECT_CRS_CHANGED');
        setTopography('imported',surfaceCandidate);if(status)status.textContent+=' '+t('dom.surfaceImport.selected');
        useSurface.disabled=true;
      }catch(error){if(status)status.textContent=tt('dom.surfaceImport.rejected',{reason:String(error&&error.message||error)});}
    };
    if(surfaceFile)surfaceFile.onchange=async()=>{
      const status=$('domainSurfaceImportStatus'),file=surfaceFile.files&&surfaceFile.files[0];
      if(!status)return;
      status.textContent='';
      surfaceCandidate=null;if(useSurface){useSurface.hidden=true;useSurface.disabled=true;}
      const preview=$('domainSurfacePreviewCanvas');if(preview)preview.hidden=true;
      if(!file){status.textContent=t('dom.surfaceImport.empty');return;}
      try{
        if(file.size>16*1024*1024)throw Error('SURFACE_IMPORT_FILE_BUDGET');
        if(!window.crypto?.subtle)throw Error('WEB_CRYPTO_UNAVAILABLE');
        const projectCRS=String(STATE.crs||'').trim();$('domainSurfaceTargetCRS').value=projectCRS;
        if(!projectCRS)throw Error('SURFACE_IMPORT_PROJECT_CRS_UNCONFIRMED');
        const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
        const sourceHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        const candidate=OrebitSurfaceImport.readDXF3DFaceTIN(text,{sourceCRS:$('domainSurfaceSourceCRS').value,
          targetCRS:projectCRS,layer:$('domainSurfaceLayer').value||undefined,
          sourceHash,fileName:file.name});
        surfaceCandidate=candidate;if(useSurface){useSurface.hidden=false;useSurface.disabled=false;}
        const xs=candidate.v.map(p=>p[0]),ys=candidate.v.map(p=>p[1]),zs=candidate.v.map(p=>p[2]);
        if(preview){
          preview.hidden=false;const rect=preview.getBoundingClientRect(),ratio=Math.min(2,window.devicePixelRatio||1),width=Math.max(240,rect.width),height=220;
          preview.width=Math.round(width*ratio);preview.height=Math.round(height*ratio);preview.style.width='100%';preview.style.height=height+'px';
          const ctx=preview.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
          const pad=20,xmin=Math.min(...xs),ymin=Math.min(...ys),spanX=Math.max(...xs)-xmin||1,spanY=Math.max(...ys)-ymin||1,scale=Math.min((width-pad*2)/spanX,(height-pad*2)/spanY);
          const point=p=>[pad+(p[0]-xmin)*scale,height-pad-(p[1]-ymin)*scale];
          ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#0f766e';ctx.lineWidth=1;
          for(const face of candidate.triangles){const pts=face.map(i=>point(candidate.v[i]));ctx.beginPath();ctx.moveTo(...pts[0]);ctx.lineTo(...pts[1]);ctx.lineTo(...pts[2]);ctx.closePath();ctx.stroke();}
        }
        const accepted=OrebitCoreDomain.exportState().domains.filter(d=>d.build?.mesh&&d.build.validation?.geologistReview===true);
        const coverage=accepted.map(d=>{
          if(d.build.stale)return d.code+': '+t('dom.surfaceImport.stale');
          try{const result=OrebitSurfaceImport.assessCoverage(candidate,d.build.mesh);return d.code+': '+t('dom.surfaceImport.'+result.status);}
          catch(error){return d.code+': '+tt('dom.surfaceImport.coverageError',{reason:String(error&&error.message||error)});}
        });
        const coverageText=coverage.length?tt('dom.surfaceImport.coverage',{results:coverage.join('; ')}):t('dom.surfaceImport.noTarget');
        status.textContent=tt('dom.surfaceImport.preview',{vertices:candidate.v.length,triangles:candidate.triangles.length,
          xmin:fmt(Math.min(...xs),2),xmax:fmt(Math.max(...xs),2),ymin:fmt(Math.min(...ys),2),ymax:fmt(Math.max(...ys),2),
          zmin:fmt(Math.min(...zs),2),zmax:fmt(Math.max(...zs),2),crs:candidate.crs,hash:sourceHash})+' '+coverageText;
      }catch(error){if(preview)preview.hidden=true;status.textContent=tt('dom.surfaceImport.rejected',{reason:String(error&&error.message||error)});}
    };
    for(const button of document.querySelectorAll('#tab14 [data-domain-step]'))button.onclick=()=>selectWorkflowStep(button.dataset.domainStep);
    for(const button of document.querySelectorAll('#tab14 [data-domain-method]'))button.onclick=()=>selectBuildMethod(button.dataset.domainMethod,true);
    const method=$('domainBuildMethod');if(method)method.onchange=()=>selectBuildMethod(method.value);
    syncTerrainHelp();
    codebookForm();contactForm();
    computeContacts();
    render();
    selectWorkflowStep(workflowStep,false);
    readiness();
  }
  // Read-only interpretation summary. Scientific readiness stays in its owner;
  // a built viewer candidate must never be described as an accepted solid.
  const insightRequests=new WeakMap();
  function updateInsight(target) {
    if(!target||target!==document.querySelector('#tab14 .assay-workflow-card .workflow-insight > p'))return Promise.resolve();
    const source=OrebitCoreDomain.sourceRevision(),interpretation=OrebitCoreDomain.interpretationRevision();
    const language=document.documentElement.lang,candidate=solid.result;
    const previous=insightRequests.get(target);
    if(previous&&previous.source===source&&previous.interpretation===interpretation&&previous.language===language&&previous.candidate===candidate)return previous.promise;
    const current=()=>target.isConnected&&target===document.querySelector('#tab14.panel.active .assay-workflow-card .workflow-insight > p')&&
      source===OrebitCoreDomain.sourceRevision()&&interpretation===OrebitCoreDomain.interpretationRevision()&&
      language===document.documentElement.lang&&candidate===solid.result;
    target.textContent=t('dom.insight.checking');target.dataset.domainInsight='checking';
    const promise=(async()=>{
      try {
        const ready=await OrebitCoreDomain.readiness();
        if(!current())return;
        const groups=OrebitCoreDomain.codebook().length;
        let state='draft',volume=null;
        const pendingCandidate=candidate&&candidate.sourceRevision===source&&candidate.validation?.geologistReview!==true;
        if(!STATE.assay.length&&!STATE.geology.length)state='empty';
        else if(pendingCandidate&&['solid','invalid'].includes(candidate.status)){
          const geometryOk=['topology','selfIntersection','surfaceCrossings','honouring','topography'].every(k=>candidate.validation?.[k]===true);
          if(candidate.status==='solid'&&geometryOk&&Number.isFinite(candidate.volume)){state='candidate';volume=candidate.volume;}
          else state='invalid';
        }
        else if(ready.status==='stale')state='stale';
        else if(ready.status==='validated'){state='ready';volume=ready.volume;}
        else if(ready.status==='invalid')state='invalid';
        const number=value=>new Intl.NumberFormat(language||'en',{maximumFractionDigits:2}).format(value);
        const message=state==='candidate'&&ready.status==='validated'?'candidateReviewed':state;
        target.textContent=tt('dom.insight.'+message,{groups:number(groups),volume:volume==null?'—':number(volume),reviewed:ready.volume==null?'—':number(ready.volume)});
        target.dataset.domainInsight=state;updateContinuation($('domainWorkflowNext'));
      } catch {
        if(current()){target.textContent=t('dom.insight.stale');target.dataset.domainInsight='stale';updateContinuation($('domainWorkflowNext'));}
      }
    })();
    insightRequests.set(target,{source,interpretation,language,candidate,promise});
    return promise;
  }
  function continuationAction() {
    const toStep=step=>()=>document.querySelector('.domain-steps [data-domain-step="'+step+'"]')?.click();
    if(workflowStep==='book')return {label:t('dom.workflow.nextContacts'),run:toStep('contacts')};
    if(workflowStep==='contacts')return {label:t('dom.workflow.nextSolid'),run:()=>{
      const review=$('domainLoftReview');
      if(buildMethod==='loft'&&review&&!review.hidden&&!review.disabled)review.click();else toStep('solid')();
    }};
    if(workflowStep==='solid'){
      const target=document.querySelector('#tab14 .assay-workflow-card .workflow-insight > p'),cached=target&&insightRequests.get(target);
      const current=cached&&cached.source===OrebitCoreDomain.sourceRevision()&&cached.interpretation===OrebitCoreDomain.interpretationRevision()&&
        cached.language===document.documentElement.lang&&cached.candidate===solid.result&&target.dataset.domainInsight==='ready';
      if(current)return {label:t('dom.workflow.nextHandoff'),run:toStep('handoff')};
      return {label:t('dom.workflow.finishReview'),run:()=>{
        selectWorkflowStep('solid');
        const reviewer=$('domainSolidReviewer'),control=solid.result?.validation?.topography===true&&reviewer&&!reviewer.disabled?reviewer:
          $(buildMethod==='loft'?'domainLoftTopo':'domainSolidTopo');
        if(control&&!control.disabled){control.focus({preventScroll:true});control.scrollIntoView({block:'center'});}
      }};
    }
    const contextual=$('returnAssayCheckpointFromCore');
    const owner=contextual&&contextual.getClientRects().length?contextual:$('domainContinueExport');
    return {label:owner?.textContent||t('dom.workflow.nextHandoff'),disabled:!owner||owner.disabled,run:()=>{if(owner?.isConnected&&!owner.disabled)owner.click();}};
  }
  function updateContinuation(button) {
    if(!button||button!==$('domainWorkflowNext'))return;
    const action=continuationAction();button.textContent=action.label.replace(/\s*→\s*$/,'');button.disabled=!!action.disabled;
    button.onclick=()=>{
      if(button!==$('domainWorkflowNext')||!$('tab14')?.classList.contains('active'))return;
      const current=continuationAction();if(!current.disabled)current.run();
    };
    window.OrebitScreeningWorkflow?.mirror?.();
  }
  async function readiness() {
    const box = $('domainReadiness'); if (!box) return;
    let status = 'none';
    try { status = (await OrebitCoreDomain.readiness()).status; } catch (e) { status = 'stale'; }
    box.querySelectorAll('[data-state]').forEach(chip => {
      const on = chip.dataset.state === status;
      chip.classList.toggle('is-current', on);
      if (on) chip.setAttribute('aria-current', 'true'); else chip.removeAttribute('aria-current');
    });    const dxf = $('domainSolidDxf');
    if (dxf) { dxf.disabled = status !== 'validated'; dxf.onclick = dxf.disabled ? null : exportDXF; }
    for(const [id,format] of [['domainSolidObj','obj'],['domainSectionsCsv','csv']]){
      const button=$(id);if(!button)continue;
      button.disabled=status!=='validated'||(format==='csv'&&!OrebitCoreDomain.exportState().sections.length);
      button.onclick=button.disabled?null:async()=>{
        try{downloadFile(format==='obj'?'domain-solids.obj':'domain-sections.csv',await OrebitCoreDomain.exportInterop(format),format==='obj'?'text/plain':'text/csv');}
        catch{if(typeof toast==='function')toast(t('dom.dxf.err'),'bad');}
      };
    }

  }
  async function exportDXF() {
    try {
      const text = await OrebitCoreDomain.exportSolidDXF();
      downloadFile('domain-solid.dxf', text, 'application/dxf');
    } catch (e) { if (typeof toast === 'function') toast(t('dom.dxf.err'), 'bad'); }
  }
  window.OrebitCoreDomainViewer = Object.freeze({show, render, updateInsight, updateContinuation, toScreen:(h, v) => (fit ? fit.toScreen(h, v) : null), state:() => ({...view, hidden:[...view.hidden], contact:{rule:contact.rule, target:contact.target, threshold:contact.threshold, maxEdge:contact.maxEdge}})});
})();
