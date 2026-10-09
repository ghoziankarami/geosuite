// One export owner for all modules. Export a private Plotly snapshot rather than
// relayout/redraw the live graph twice; filters, camera and viewport stay intact.
async function plotlyToImageWhiteBg(gd, opts) {
  if (!gd || !window.Plotly) return Plotly.toImage(gd, opts);
  const layout = gd.layout || gd._fullLayout || {};
  const full = gd._fullLayout || layout;
  // Preserve typed arrays, missing values and zeroes. These are plot inputs, not
  // the analytical population; no JSON conversion or display thinning is used.
  const image = {
    data: structuredClone(gd.data || []),
    layout: structuredClone(layout),
    config: { ...gd._context, displayModeBar: false }
  };
  const out = image.layout;
  out.paper_bgcolor = '#ffffff';
  out.plot_bgcolor = '#ffffff';
  out.font = { ...out.font, color: '#0f172a' };
  const axisKeys = Object.keys(layout).filter(k => /^[xy]axis\d*$/.test(k));
  axisKeys.forEach(k => {
    out[k] = { ...out[k], gridcolor: '#f1f5f9', zerolinecolor: '#cbd5e1' };
    if (layout[k].linecolor) out[k].linecolor = '#cbd5e1';
  });

  const onW = gd.getBoundingClientRect().width || full.width || 800;
  const exW = opts && opts.width || onW;
  const fontK = Math.min(2.5, Math.max(1, exW / onW));
  const sc = (value, fallback, factor = fontK) =>
    Math.round((typeof value === 'number' ? value : fallback) * factor * 10) / 10;
  if (fontK > 1.05) {
    out.font.size = sc(full.font && full.font.size, 12.5);
    if (full.title && full.title.font) {
      out.title = typeof out.title === 'string' ? { text: out.title } : { ...out.title };
      out.title.font = { ...out.title.font, size: sc(full.title.font.size, 17) };
    }
    if (full.legend && full.legend.font) {
      out.legend = { ...out.legend, font: { ...out.legend?.font, size: sc(full.legend.font.size, 12.5) } };
    }
    axisKeys.forEach(k => {
      const axis = full[k] || {};
      out[k].tickfont = { ...out[k].tickfont, size: sc(axis.tickfont?.size, 11, Math.min(fontK, 1.8)) };
      if (axis.title && axis.title.font) {
        const title = typeof out[k].title === 'string' ? { text: out[k].title } : { ...out[k].title };
        out[k].title = { ...title, font: { ...title.font, size: sc(axis.title.font.size, 15) } };
      }
    });
    (out.annotations || []).forEach((annotation, i) => {
      const resolved = full.annotations && full.annotations[i];
      annotation.font = { ...annotation.font, size: sc(resolved?.font?.size || full.font?.size, 12.5) };
    });
    out.margin = { ...out.margin };
    ['l', 'r', 't', 'b'].forEach(side => {
      if (typeof full.margin?.[side] === 'number') out.margin[side] = Math.round(full.margin[side] * fontK);
    });
  }

  // Plotly's default title anchors its bottom near the top edge. Enlarging its
  // font can put the upper glyphs outside the PNG. Anchor the export title's top
  // inside the canvas and reserve its actual line height above the plot.
  const title = typeof out.title === 'string' ? { text: out.title } : out.title;
  if (title && title.text) {
    const edge = Math.max(12, Math.round(12 * fontK));
    const size = title.font?.size || full.title?.font?.size || out.font.size || 17;
    const lines = String(title.text).split(/<br\s*\/?>/i).length;
    out.title = { ...title, y: 1, yref: 'container', yanchor: 'top', pad: { ...title.pad, t: edge } };
    out.margin = { ...out.margin, t: Math.max(out.margin?.t || full.margin?.t || 0, Math.ceil(edge * 2 + size * 1.5 * lines)) };
  }

  // A 3D scene otherwise has zero bottom/side margins: its axis labels can
  // extend beyond the exported canvas after the output aspect ratio changes.
  // Reserve label space on this snapshot while retaining the analyst's camera.
  if (out.scene) {
    out.scene.bgcolor = '#ffffff';
    for (const name of ['xaxis', 'yaxis', 'zaxis']) {
      const axis = out.scene[name] || {};
      const title = typeof axis.title === 'string' ? { text: axis.title } : axis.title;
      out.scene[name] = { ...axis, color: '#0f172a', tickfont: { ...axis.tickfont, color: '#0f172a' },
        title: { ...title, font: { ...title?.font, color: '#0f172a' } } };
    }
    out.margin = { ...out.margin };
    for (const [side, space] of [['l', 64], ['r', 64], ['b', 80]]) {
      out.margin[side] = Math.max(out.margin[side] || 0, space);
    }
  }

  // The bundled Plotly API accepts a data/layout/config object and owns its
  // temporary export graph. No live DOM/theme mutation needs restoring on error.
  const exportOpts = opts && { ...opts };
  // null means the active graph size in Plotly's DOM overload. Retain that
  // contract when sending a plain snapshot to the same API.
  if (exportOpts?.width === null && typeof full.width === 'number') exportOpts.width = full.width;
  if (exportOpts?.height === null && typeof full.height === 'number') exportOpts.height = full.height;
  return Plotly.toImage(image, exportOpts);
}
