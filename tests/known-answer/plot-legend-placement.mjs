// A horizontal legend placed below a plot collides with the x-axis title; plotFinish moves it above.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const privateRoot = new URL('../../../package.json', import.meta.url);
const theme = new URL(existsSync(privateRoot) ? '../../../src/shared/plots/plot-theme.js' : '../../src/shared/plots/plot-theme.js', import.meta.url);
const { plotFinish } = require(fileURLToPath(theme));

const below = { legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 } };
plotFinish([], below);
assert.deepEqual([below.legend.y, below.legend.yanchor, below.legend.x, below.legend.xanchor], [1.02, 'bottom', 0.5, 'center']);

const vertical = { legend: { orientation: 'v', x: 1.02, y: -0.2 } };
plotFinish([], vertical);
assert.equal(vertical.legend.y, -0.2, 'a vertical legend is the caller\'s choice');

const above = { legend: { orientation: 'h', y: 1.1, yanchor: 'bottom' } };
plotFinish([], above);
assert.equal(above.legend.y, 1.1, 'a legend already above the plot is kept');
console.log('PASS: below-plot horizontal legends move above the plot; other placements are kept');

const dense={type:'scatter',mode:'markers',x:Array(201).fill(0),marker:{line:{width:1,color:'#123456'}}};
plotFinish([dense],{});
assert.equal(dense.marker.line.width,0,'default dense scatter cleanup is preserved');
const required={type:'scatter',mode:'markers',x:Array(201).fill(0),meta:{orebit:{preserveMarkerOutline:true}},marker:{line:{width:1,color:'#123456'}}};
plotFinish([required],{});
assert.deepEqual(required.marker.line,{width:1,color:'#123456'},'explicit semantic/contrast outlines survive dense scatter cleanup');
console.log('PASS: dense defaults and explicit required marker outlines remain distinct');
