// Display-only grade filters and colours. No dependency on the estimation
// state or DOM; every projection uses the same full filtered population.
function blockGradeRange(lower, upper) {
  const bound = value => {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('range');
    return n;
  };
  const min = bound(lower), max = bound(upper);
  if (min !== null && max !== null && min > max) throw new Error('range');
  return {min, max};
}
function blockGradeIncluded(value, range) {
  return Number.isFinite(value) && (range.min === null || value >= range.min)
    && (range.max === null || value <= range.max);
}
function blockGradeNumber(value) {
  return Number(value.toPrecision(6)).toString();
}
const BLOCK_GRADE_PALETTES = {
  warm: ['#fef3c7', '#fbbf24', '#f97316', '#dc2626', '#7f1d1d'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  cividis: ['#00224e', '#434e6c', '#7d7c78', '#bcae6c', '#fee838']
};
function blockGradePalette(name, count) {
  const base = BLOCK_GRADE_PALETTES[name] || BLOCK_GRADE_PALETTES.warm;
  return Array.from({length: count}, (_, i) => {
    const p = count === 1 ? 2 : i * (base.length - 1) / (count - 1);
    const lo = Math.floor(p), hi = Math.ceil(p), f = p - lo;
    const rgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
    const a = rgb(base[lo]), b = rgb(base[hi]);
    return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
  });
}
function blockGradeScale(values, options = {}, unit = '') {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const method = options.method || 'quantile';
  let breaks = [];
  if (method === 'custom') {
    const tokens = String(options.breaks || '').trim().split(/[,;\s]+/);
    if (!tokens[0] || tokens.length > 12) throw new Error('breaks');
    breaks = tokens.map(Number);
    if (breaks.some((v, i) => !Number.isFinite(v) || (i > 0 && v <= breaks[i - 1]))) throw new Error('breaks');
  } else if (!['quantile', 'linear'].includes(method)) throw new Error('method');
  const min = sorted.length ? sorted[0] : null, max = sorted.length ? sorted[sorted.length - 1] : null;
  if (method === 'linear') {
    const colors = blockGradePalette(options.palette, 5);
    return {map: x => x, breaks, labels: [], colors, colorscale: colors.map((c, i) => [i / 4, c]),
      cmin: min == null ? 0 : min, cmax: max == null ? 1 : max === min ? min + Math.max(Math.abs(min) * 1e-6, 1e-9) : max,
      ticks: null};
  }
  if (method === 'quantile' && min !== null && min < max) {
    for (let i = 1; i < 5; i++) {
      const at = i / 5 * (sorted.length - 1), lo = Math.floor(at), hi = Math.ceil(at);
      const v = sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
      if (v > min && v < max && !breaks.includes(v)) breaks.push(v);
    }
  }
  const fmt = x => blockGradeNumber(x) + (unit ? ' ' + unit : '');
  const labels = breaks.length ? [
    '≤ ' + fmt(breaks[0]),
    ...breaks.slice(1).map((b, i) => fmt(breaks[i]) + ' < g ≤ ' + fmt(b)),
    '> ' + fmt(breaks[breaks.length - 1])
  ] : [min == null ? 'No finite grades' : min === max ? fmt(min) : fmt(min) + '–' + fmt(max)];
  const colors = blockGradePalette(options.palette, labels.length);
  const colorscale = colors.flatMap((c, i) => [[i / colors.length, c], [(i + 1) / colors.length, c]]);
  return {map: x => {if (!Number.isFinite(x)) return null;let i = 0;while (i < breaks.length && x > breaks[i]) i++;return i;},
    breaks, labels, colors, colorscale, cmin: 0, cmax: Math.max(colors.length - 1, 1e-6), ticks: labels.map((_, i) => i)};
}
