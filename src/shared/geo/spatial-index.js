/* Exact planar nearest neighbours. Full data, stable ties, no display subsampling. */
(function (root) {
  'use strict';
  function createIndex(points) {
    if (!Array.isArray(points)) throw new Error('Spatial points must be an array');
    const records = points.map((point, order) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Spatial coordinates must be finite');
      return {point, order};
    });
    function build(items, depth) {
      if (!items.length) return null;
      const axis = depth % 2 ? 'y' : 'x';
      items.sort((a, b) => a.point[axis] - b.point[axis] || a.order - b.order);
      const middle = Math.floor(items.length / 2);
      return {record: items[middle], axis, left: build(items.slice(0, middle), depth + 1), right: build(items.slice(middle + 1), depth + 1)};
    }
    return {tree: build(records, 0), size: records.length};
  }
  function nearest(index, x, y, count = 1, excludeOrder = -1) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(count) || count < 1) throw new Error('Invalid spatial query');
    const best = [];
    const compare = (a, b) => a.distanceSquared - b.distanceSquared || a.order - b.order;
    function visit(node) {
      if (!node) return;
      const {point, order} = node.record;
      const dx = x - point.x, dy = y - point.y;
      if (order !== excludeOrder) {
        const candidate = {point, order, distanceSquared: dx * dx + dy * dy};
        if (best.length < count || compare(candidate, best[best.length - 1]) < 0) {
          best.push(candidate); best.sort(compare); if (best.length > count) best.pop();
        }
      }
      const delta = node.axis === 'x' ? dx : dy;
      visit(delta <= 0 ? node.left : node.right);
      if (best.length < count || delta * delta <= best[best.length - 1].distanceSquared) visit(delta <= 0 ? node.right : node.left);
    }
    visit(index.tree);
    return best;
  }
  root.OrebitSpatial = Object.freeze({createIndex, nearest});
})(typeof window === 'undefined' ? globalThis : window);
