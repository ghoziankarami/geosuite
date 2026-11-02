// ============= PLOT THEME + LABELS (one owner for Core, Assay and Resource) =============
// Every Plotly layout spreads plotTheme(); every displayed column/element name in a
// figure passes through plotLabel(). Colours come from the UI CSS tokens, so the same
// figure follows the light/dark theme. Display only: no data, population or export
// value is touched here.

// Palette roles -> CSS token index (plot-theme.css). c1 primary, c2 secondary,
// c3 model/threshold, c6 reference.
const PLOT_ROLES = { primary: 1, secondary: 2, model: 3, threshold: 3, reference: 6 };
// Light values, used only when the stylesheet is absent (Node tests).
const PLOT_FALLBACK = ['#0f766e', '#d97706', '#dc2626', '#0284c7', '#7c3aed', '#64748b', '#4d7c0f', '#be185d', '#92400e', '#4338ca'];

function _plotToken(name, fallback) {
  try {
    const v = getComputedStyle(document.body || document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) { return fallback; }
}

function plotPalette() {
  return PLOT_FALLBACK.map((c, i) => _plotToken('--plot-c' + (i + 1), c).toLowerCase());
}

// plotColor('primary') / plotColor(4) / plotColor('c4') -> current hex.
function plotColor(role) {
  const n = typeof role === 'number' ? role : (PLOT_ROLES[role] || parseInt(String(role).replace(/^c/, ''), 10) || 1);
  return plotPalette()[(n - 1) % 10];
}

// n distinct series colours (cycles only beyond the 10 palette entries).
function plotColors(n) {
  const p = plotPalette();
  return Array.from({ length: n }, (_, i) => p[i % p.length]);
}

function plotTheme() {
  const font = _plotToken('--font-sans', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif');
  const fg = _plotToken('--fg', '#0f172a');
  const mute = _plotToken('--fg-mute', '#64748b');
  const grid = _plotToken('--border', '#e2e8f0');
  const line = _plotToken('--border-strong', '#cbd5e1');
  const axis = () => ({ gridcolor: grid, gridwidth: 1, zerolinecolor: line, zerolinewidth: 1.5,
    linecolor: line, tickcolor: line, tickfont: { size: 11, color: mute }, automargin: true });
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: fg, family: font, size: 12.5 },
    margin: { l: 64, r: 24, t: 28, b: 56 },
    colorway: plotPalette(),
    xaxis: axis(),
    yaxis: axis(),
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)', font: { color: fg } },
    // Explicit hover label: otherwise Plotly tints it from the trace colour and the
    // text becomes unreadable in one of the themes.
    hoverlabel: {
      bgcolor: _plotToken('--bg-card', '#ffffff'),
      bordercolor: line,
      font: { color: fg, family: font, size: 12.5 }
    },
  };
}

// Map-like plots: equal metres on both axes and full coordinate ticks.
function plotMapAxes(xTitle, yTitle) {
  const t = plotTheme();
  return {
    xaxis: { ...t.xaxis, title: xTitle, tickformat: ',.0f' },
    yaxis: { ...t.yaxis, title: yTitle, tickformat: ',.0f', scaleanchor: 'x', scaleratio: 1 },
  };
}

// 1:1 comparison plots: identical x/y ranges, no anchor that widens one axis.
function plotOneToOneRange(xs, ys) {
  let lo = Infinity, hi = -Infinity;
  for (const arr of [xs, ys]) for (const v of arr || []) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) { if (n < lo) lo = n; if (n > hi) hi = n; }
  }
  if (!Number.isFinite(lo)) return undefined;
  const pad = (hi - lo) * 0.04 || Math.abs(hi) * 0.04 || 1;
  // Non-negative data (grades) never gets a negative axis.
  return [lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad];
}

// ---- Labels -----------------------------------------------------------------
const _PLOT_ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Rb Sr Y Zr Nb Mo Ru Rh Pd Ag Cd In Sn Sb Te I Cs Ba La Ce Pr Nd Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
  'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Th U').split(' '));
const _PLOT_UNITS = { pct: '%', percent: '%', ppm: 'ppm', ppb: 'ppb', gpt: 'g/t', gt: 'g/t', kgm3: 'kg/m³', gm3: 'g/m³' };
const _PLOT_WORDS = { loi: 'LOI', reeo: 'REO', treo: 'TREO' };
const _SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };

// "sio2" -> "SiO₂", "NI" -> "Ni", "mgo" -> "MgO". Accepts a single element symbol
// or an oxide formula; anything else (e.g. "PC1", "depth") returns null.
function _plotFormula(token) {
  const s = String(token);
  if (!/^[a-z0-9]+$/i.test(s) || !/[a-z]/i.test(s)) return null;
  if (s !== s.toLowerCase() && s !== s.toUpperCase() && !/^([A-Z][a-z]?\d*)+$/.test(s)) return null;
  const lc = s.toLowerCase();
  const parts = [];
  const walk = (i) => {
    if (i === lc.length) return true;
    for (const len of [2, 1]) {
      const sym = lc.slice(i, i + len);
      const El = sym.charAt(0).toUpperCase() + sym.slice(1);
      if (sym.length !== len || !_PLOT_ELEMENTS.has(El)) continue;
      let j = i + len;
      while (j < lc.length && /\d/.test(lc[j])) j++;
      parts.push(El + lc.slice(i + len, j));
      if (walk(j)) return true;
      parts.pop();
    }
    return false;
  };
  if (!walk(0)) return null;
  const elems = parts.length;
  // Oxides only (MgO, SiO2, Al2O3): one cation group then a final O, so words
  // such as SECTION (Se-C-Ti-O-N) are not mistaken for formulas.
  if (elems > 1 && (elems > 3 || !/^O\d*$/.test(parts[elems - 1]) || parts.slice(0, -1).some(p => /^O\d*$/.test(p)))) return null;
  if (elems === 1 && /\d/.test(parts[0])) return null;               // "C1", "S2"
  return parts.join('').replace(/\d/g, d => _SUB[d]);
}

// One display formatter for axis titles, trace names, categories, colour-bar titles
// and element selects: ni_pct -> "Ni (%)", NI (%) -> "Ni (%)", sio2 -> "SiO₂",
// density -> "Density", "Cutoff (NI (%))" -> "Cutoff, Ni (%)". Unknown text is kept.
function plotLabel(name) {
  if (name === null || name === undefined) return name;
  const s = String(name).trim();
  if (s.length < 2) return name; // "r", "x": symbols, not names
  let m = s.match(/^([A-Za-z][\w ]*?) \((.+\(.+\))\)$/); // "Cutoff (NI (%))"
  if (m) return `${m[1]}, ${plotLabel(m[2])}`;
  m = s.match(/^([A-Za-z0-9_]+)\s*\(([^()]+)\)$/);         // "NI (%)"
  if (m) {
    const base = plotLabel(m[1]);
    return /\(/.test(base) ? base : `${base} (${m[2]})`;
  }
  if (!/^[A-Za-z0-9_]+$/.test(s)) return s;
  const words = s.split('_').filter(Boolean);
  let unit = '';
  if (words.length > 1 && _PLOT_UNITS[words[words.length - 1].toLowerCase()]) unit = _PLOT_UNITS[words.pop().toLowerCase()];
  const head = words.join('_');
  const formula = _PLOT_WORDS[head.toLowerCase()] || (words.length === 1 ? _plotFormula(head) : null);
  let text = formula;
  if (!text) {
    text = words.join(' ');
    // Authored case ("IDW", "NN", "MgO") is kept; plain snake_case is capitalised.
    if (!/[A-Z]/.test(text)) text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return unit ? `${text} (${unit})` : text;
}

// The same display name without its unit: co_pct -> "Co", mgo_pct -> "MgO".
function plotName(name) {
  return String(plotLabel(name)).replace(/\s*\([^()]*\)$/, '');
}

// ---- Applied to every Plotly.newPlot (see each phase's patchPlotlyDefaults) ----
// Fills theme keys a layout left out, passes displayed names through plotLabel()
// and drops optional marker outlines on dense scatters. A caller can preserve
// outlines that carry category/contrast meaning via trace meta. Display only.
const PLOT_DENSE = 200;
// Colour-bar class labels: display numbers at 2 decimals ("0.8346 < g ≤ 1.1214"
// becomes "0.83 < g ≤ 1.12"). Values below 0.1 keep 2 significant digits so ppm
// classes do not collapse to 0.00. Display only; class breaks are unchanged.
function plotClassLabel(text) {
  return typeof text !== 'string' ? text : text.replace(/-?\d+\.\d{3,}(?:e-?\d+)?/gi, (s) => {
    const v = Number(s);
    return !Number.isFinite(v) ? s : Math.abs(v) >= 0.1 ? v.toFixed(2) : String(Number(v.toPrecision(2)));
  });
}

function plotFinish(data, layout, div) {
  const fmtTitle = (title) => typeof title === 'string' ? plotLabel(title)
    : (title && typeof title.text === 'string' ? { ...title, text: plotLabel(title.text) } : title);
  // Plotly cannot parse CSS variables; resolve 'var(--fg)' style colours to the token.
  const resolveVars = (o) => {
    if (!o || typeof o !== 'object' || ArrayBuffer.isView(o)) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && v.startsWith('var(--')) {
        const m = v.match(/^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/);
        if (m) o[k] = _plotToken(m[1], m[2] || '#64748b');
      } else if (v && typeof v === 'object' && k !== 'x' && k !== 'y' && k !== 'z' && k !== 'customdata') resolveVars(v);
    }
  };
  resolveVars(layout);
  (Array.isArray(data) ? data : []).forEach(resolveVars);
  if (layout && typeof layout === 'object') {
    const t = plotTheme();
    for (const k of ['font', 'hoverlabel', 'colorway', 'paper_bgcolor', 'plot_bgcolor']) if (layout[k] === undefined) layout[k] = t[k];
    const axes = [layout, layout.scene].filter(Boolean);
    for (const host of axes) for (const k of Object.keys(host)) {
      if (/^[xyz]axis\d*$/.test(k) && host[k] && host[k].title !== undefined) host[k] = { ...host[k], title: fmtTitle(host[k].title) };
    }
    // 2D axes written without the theme spread still get its colours and automargin
    // (keys the caller set are kept).
    for (const k of Object.keys(layout)) {
      if (/^[xy]axis\d*$/.test(k) && layout[k] && typeof layout[k] === 'object') layout[k] = { ...t.xaxis, ...layout[k] };
    }
  }
  // A horizontal legend below the plot lands on the x-axis title and tick labels
  // (its offset is a fraction of the plot height, so it moves with every resize).
  // Put it above the plot instead, where the margin below reserves room for it.
  if (layout && layout.legend && layout.legend.orientation === 'h' && typeof layout.legend.y === 'number' && layout.legend.y < 0) {
    layout.legend = { ...layout.legend, y: 1.02, yanchor: 'bottom' };
  }
  // A figure title and the top legend share the top margin. Anchor the title at
  // the top edge and reserve one row per wrapped legend line, so narrow (phone)
  // plots do not draw the legend over the title.
  const titleText = layout && (typeof layout.title === 'string' ? layout.title : layout.title && layout.title.text);
  const named = (Array.isArray(data) ? data : []).filter(tr => tr && tr.name && tr.showlegend !== false).length;
  if (titleText && named > 1 && layout.showlegend !== false && (!layout.legend || layout.legend.yanchor === 'bottom')) {
    const node = typeof div === 'string' ? document.getElementById(div) : div;
    const width = (node && node.clientWidth) || 800;
    const rows = Math.ceil(named / Math.max(1, Math.floor((width - 80) / 150)));
    const title = typeof layout.title === 'string' ? { text: layout.title } : layout.title;
    layout.title = { ...title, yref: 'container', y: 1, yanchor: 'top', pad: { ...(title.pad || {}), t: 8 } };
    layout.margin = { ...(layout.margin || plotTheme().margin), t: Math.max((layout.margin && layout.margin.t) || 0, 36 + rows * 20) };
  }
  (Array.isArray(data) ? data : []).forEach(trace => {
    if (!trace || typeof trace !== 'object') return;
    if (typeof trace.name === 'string') trace.name = plotLabel(trace.name);
    for (const holder of [trace, trace.marker]) {
      if (holder && holder.colorbar && holder.colorbar.title !== undefined) holder.colorbar = { ...holder.colorbar, title: fmtTitle(holder.colorbar.title) };
      if (holder && holder.colorbar && Array.isArray(holder.colorbar.ticktext)) holder.colorbar = { ...holder.colorbar, ticktext: holder.colorbar.ticktext.map(plotClassLabel) };
    }
    const n = trace.x && trace.x.length;
    if ((trace.type === 'scatter' || trace.type === 'scattergl' || trace.type === undefined) && n > PLOT_DENSE &&
        (!trace.mode || trace.mode.includes('markers')) && trace.marker && trace.marker.line &&
        trace.meta?.orebit?.preserveMarkerOutline !== true) {
      trace.marker = { ...trace.marker, line: { width: 0 } };
    }
  });
}

// A short display note (e.g. "2,500 of 7,419 samples shown") under the plot
// heading instead of inside the figure title. Kept on the node so the PNG export
// still carries it. Empty text removes it.
function plotCaption(node, text) {
  if (typeof node === 'string') node = document.getElementById(node);
  if (!node || !node.parentNode) return;
  let cap = node.previousElementSibling;
  if (!(cap && cap.classList.contains('plot-caption') && cap.dataset.for === node.id)) cap = null;
  if (!text) { if (cap) cap.remove(); delete node.dataset.plotCaption; return; }
  if (!cap) {
    cap = document.createElement('p');
    cap.className = 'plot-caption';
    cap.dataset.for = node.id;
    node.parentNode.insertBefore(cap, node);
  }
  cap.textContent = text;
  node.dataset.plotCaption = text;
}

// ---- Theme switch -----------------------------------------------------------
// Palette plus the UI tokens figures use for ink/surfaces ('var(--fg)' etc.).
const _PLOT_SWAP_TOKENS = ['--fg', '--fg-mute', '--bg-card', '--border', '--border-strong'];
function plotTokenSnapshot() {
  return plotPalette().concat(_PLOT_SWAP_TOKENS.map(n => _plotToken(n, '').toLowerCase()));
}

// Re-style every rendered figure after the UI theme changes. Colours taken from
// the previous theme's tokens (snapshot before the switch) move to the same role.
function restylePlots(previousTokens) {
  if (typeof Plotly === 'undefined' || typeof document === 'undefined') return;
  const next = plotTokenSnapshot();
  const swap = new Map((previousTokens || []).map((c, i) => [String(c).toLowerCase(), next[i]]).filter(([a, b]) => a && b));
  const skip = new Set(['x', 'y', 'z', 'text', 'hovertext', 'customdata', 'ids', 'labels', 'values', 'i', 'j', 'k', 'intensity', 'name', 'hovertemplate', 'texttemplate']);
  const walk = (o) => {
    if (!o || typeof o !== 'object' || ArrayBuffer.isView(o)) return;
    for (const key of Object.keys(o)) {
      if (Array.isArray(o) ? false : skip.has(key)) continue;
      const v = o[key];
      if (typeof v === 'string') { const hit = swap.get(v.toLowerCase()); if (hit) o[key] = hit; }
      else if (v && typeof v === 'object') walk(v);
    }
  };
  const t = plotTheme();
  document.querySelectorAll('.js-plotly-plot').forEach(gd => {
    if (!gd.layout || !gd.data) return;
    try {
      gd.data.forEach(walk);
      const layout = { ...gd.layout, font: { ...gd.layout.font, color: t.font.color, family: t.font.family },
        hoverlabel: t.hoverlabel, colorway: t.colorway, datarevision: Date.now() };
      if (gd.layout.legend) layout.legend = { ...gd.layout.legend, font: { ...(gd.layout.legend.font || {}), color: t.font.color } };
      // Axis colours came from tokens (plotFinish fills them), so the swap moves
      // them; an axis deliberately tinted with a palette role keeps its role.
      walk(layout);
      Plotly.react(gd, gd.data, layout);
    } catch (e) { console.warn('[Orebit] plot restyle failed', e); }
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { plotLabel, plotTheme, plotColor, plotColors, plotOneToOneRange, plotPalette, plotFinish };
