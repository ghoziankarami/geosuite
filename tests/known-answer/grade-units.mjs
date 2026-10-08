// Physical unit oracle: metric definitions, independent of any UI/model population.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
let root=path.dirname(fileURLToPath(import.meta.url));
while(!fs.existsSync(path.join(root,'build/build.mjs'))) {const p=path.dirname(root);assert.notEqual(p,root);root=p;}
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'src/shared/geostat/grade-units.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(root,'src/shared/io/parse.js'),'utf8'),ctx);
const u=ctx.OrebitGradeUnits;
let checks=0;
function close(a,b) {checks++;assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=1e-12*Math.max(1,Math.abs(b)),`${a} != ${b}`);}
for(const [unit,grade] of [['%',.0001],['g/t',1],['ppm',1],['ppb',1000]]) {
  close(u.containedTonnes(2700,1000,grade,unit),.0027);
  for(const [other,value] of [['%',.0001],['g/t',1],['ppm',1],['ppb',1000]]) close(u.convertGrade(grade,unit,other),value);
}
for(const [unit,grade] of [['kg/m³',1],['g/m³',1000]]) {
  close(u.containedTonnes(2700,1000,grade,unit),1);
  close(u.containedTonnes(9900,1000,grade,unit),1); // Density cannot change volumetric metal.
}
close(u.convertGrade(1,'kg/m3','g/m3'),1000);
assert.throws(()=>u.convertGrade(1,'g/t','kg/m3'),/GRADE_UNIT_CONVERSION/);
assert.throws(()=>u.containedTonnes(1,1,1,'unknown'),/GRADE_UNIT_UNSUPPORTED/);
assert.ok(Number.isNaN(u.containedTonnes(1,1,-1,'ppb')));
assert.ok(Number.isNaN(u.containedTonnes(1,undefined,1,'g/m³')));
close(u.containedTonnes(2700,undefined,1,'g/t'),.0027);
close(u.containedTonnes(0,0,0,'ppb'),0);
for(const [label,unit] of [['Au_ppb','ppb'],['Ag_pct','%'],['Cu (ppm)','ppm'],['Ni (wt%)','%'],['Au (g/t)','g/t'],['Sn_gm3','g/m³'],['Sn (kg/m³)','kg/m³'],['generic_grade_ppb','ppb']]) {checks++;assert.equal(u.fromHeader(label),unit);}
assert.equal(u.fromHeader('ambiguous_grade'),null);
for(const unit of u.options) {checks++;assert.equal(u.normalize(u.schemaToken(unit)),unit);}
const parsed=vm.runInContext("_parseSchemaComments('# units: sn_gm3=g/m³, sn_kgm3=kg/m³, au_ppb=ppb\\nhole_id,au_ppb\\nH1,1000')",ctx);
assert.equal(parsed.meta.units.sn_gm3,'g/m3');assert.equal(parsed.meta.units.sn_kgm3,'kg/m3');assert.equal(parsed.meta.units.au_ppb,'ppb');
console.log(`${checks} physical grade-unit checks passed`);
