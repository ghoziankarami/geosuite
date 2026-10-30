// Domain S10: DXF R12 3DFACE roundtrip for solids, with volume, layers and unsupported entities checked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({});
for(const name of ['primitives','mesh','solid','domain-state','loft','interop','dxf','surface-import']) vm.runInContext(fs.readFileSync(path.join(root,`src/shared/geom/${name}.js`),'utf8'),ctx);
const D=ctx.OrebitDomainDXF,G=ctx.OrebitDomainGeometry;
let checks=0;
const ok=(cond,msg)=>{assert.ok(cond,msg);checks++;};
const close=(a,b,msg,tol=1e-9)=>ok(Math.abs(a-b)<=tol,`${msg}: ${a} != ${b}`);

// Box [0,200]x[0,200]x[90,100] as a closed prism: 400,000 m3.
const c=[[0,0],[200,0],[200,200],[0,200]];
const box={v:[...c.map(([x,y])=>[x,y,100]),...c.map(([x,y])=>[x,y,90])],f:[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]]};
const text=D.writeSolids([{code:'SAP',mesh:box}],{comment:'synthetic'});
const auditText=JSON.stringify({reviewer:'Synthetic 測試 🙂'.repeat(10),reason:'Independent geometry review. '.repeat(100)});
const auditDXF=D.writeSolids([{code:'SAP',mesh:box}],{comment:auditText}),auditLines=auditDXF.split('\r\n'),auditChunks=[];
for(let i=0;auditLines[i]==='999';i+=2)auditChunks.push(auditLines[i+1]);
ok(auditChunks.length>1&&auditChunks.every(line=>Buffer.byteLength(line,'utf8')<=250),'long UTF-8 review comments stay within R12 value-line limits');
ok(auditChunks.join('')===auditText,'review comments reconstruct without truncating or splitting Unicode');
close(Math.abs(G.inspectMesh(D.readSolids(auditDXF).layers.SAP).volume),400000,'review metadata changes no roundtrip geometry');
ok(text.startsWith('999') || text.startsWith('0\r\nSECTION'),'file opens with a comment or the HEADER section');
ok(text.includes('3DFACE') && text.endsWith('0\r\nEOF\r\n'),'entities are 3DFACE and the file ends with EOF');
ok(text.split('3DFACE').length-1===box.f.length,'one 3DFACE per triangle');
const back=D.readSolids(text);
ok(Object.keys(back.layers).join()==='SAP','layer name is the domain code');
ok(back.faces===box.f.length && back.unsupported && Object.keys(back.unsupported).length===0,'every face read back, nothing unsupported');
const r=G.inspectMesh(back.layers.SAP);
close(Math.abs(r.volume),400000,'roundtrip mesh has the same volume');
ok(r.closed===false || r.boundaryEdges===0,'roundtrip mesh is watertight or the open edges are reported');
// Coordinates keep full precision.
const tiny={v:[[0.1+0.2,1e-7,123456.789012345],[1,0,0],[0,1,0],[0,0,1]],f:[[0,1,2],[0,2,3],[0,3,1],[1,3,2]]};
const t2=D.readSolids(D.writeSolids([{code:'X',mesh:tiny}]));
ok(t2.layers.X.v[0][0]===0.1+0.2 && t2.layers.X.v[0][2]===123456.789012345,'coordinates survive the roundtrip exactly');
// Unsupported entities are counted, not discarded silently.
const mixed=text.replace('0\r\nENDSEC\r\n0\r\nEOF','0\r\nLINE\r\n8\r\nX\r\n10\r\n0\r\n20\r\n0\r\n0\r\nPOLYLINE\r\n0\r\nENDSEC\r\n0\r\nEOF');
const m=D.readSolids(mixed);
ok(m.unsupported.LINE===1 && m.unsupported.POLYLINE===1,'LINE and POLYLINE are counted as unsupported');
// Layer names are cleaned and limited.
ok(D.layerName('sap/lith 1')==='SAP_LITH_1','unsupported layer characters become underscores');
ok(D.layerName('x'.repeat(40)).length===31,'layer names are at most 31 characters');
ok(D.layerName('')==='DOMAIN','empty code gets a default layer');
// Bad coordinates are refused.
assert.throws(()=>D.readSolids('0\nSECTION\n2\nENTITIES\n0\n3DFACE\n8\nA\n10\nabc\n20\n0\n30\n0\n11\n0\n21\n0\n31\n0\n12\n0\n22\n0\n32\n0\n13\n0\n23\n0\n33\n0\n0\nENDSEC\n0\nEOF\n'),/DOMAIN_DXF_COORDINATE_INVALID/);checks++;
// Distinct names that sanitize to the same R12 layer must remain separate.
const collisions=D.readSolids(D.writeSolids([{code:'SAP/A',mesh:box},{code:'SAP A',mesh:box}]));
ok(Object.keys(collisions.layers).join(',')==='SAP_A,SAP_A_2','sanitized layer collisions stay separate');
const own=text.replaceAll('\r\nSAP\r\n','\r\n__proto__\r\n');
ok(D.readSolids(own).layers.__proto__.f.length===box.f.length,'prototype-like imported layer is literal data');
assert.throws(()=>D.readSolids(text.replace('10\r\n0\r\n','10\r\n\r\n')),/DOMAIN_DXF_COORDINATE_INVALID/);checks++;
const state=ctx.OrebitDomainState.create(),ring=[[0,90],[10,90],[10,100],[0,100]];
state.source={sha256:'a'.repeat(64)};state.crs={kind:'epsg',epsg:32751,units:'m',renderOrigin:[0,0,0]};
const frame=ctx.OrebitGeometryPrimitives.sectionPlane([700000,9800000,0],90);
const body=ctx.OrebitDomainLoft.loft({plane:frame,endRule:'zero',sections:[{station:0,ring:ring.map(([h,z])=>[h,-z])},{station:10,ring:ring.map(([h,z])=>[h,-z])}]});
const sections=[0,10].map((station,n)=>({station,origin:[700000,9800000+station],azimuth:90,points:ring,snaps:ring.map((_,i)=>i===0?{hole:'H'+n,depth:10,off:0}:null)}));
state.domains=[{code:'SAP "A", group',density:1.6,build:{mesh:body.mesh,volume:body.volume,inputs:{rules:{method:'section-loft',endRule:'zero',snapRadius:0},sections},inputsHash:'b'.repeat(64),meshHash:'c'.repeat(64)}}];
assert.throws(()=>ctx.OrebitDomainSolid.prepareSolid({v:box.v.map(p=>p.map(v=>v*1e110)),f:box.f}),/DOMAIN_SOLID_(TOPOLOGY|DEGENERATE)/);checks++;
const I=ctx.OrebitDomainInterop,obj=I.writeOBJ(state,{version:'test-version',generated:'2026-10-13T00:00:00Z'}),verts=[],faces=[];
for(const line of obj.split('\n')){if(line.startsWith('v '))verts.push(line.slice(2).split(' ').map(Number));if(line.startsWith('f '))faces.push(line.slice(2).split(' ').map(x=>Number(x)-1));}
ok(verts.length===body.mesh.v.length&&faces.length===body.mesh.f.length,'OBJ keeps every vertex and face');
close(G.inspectMesh({v:verts,f:faces}).volume,1000,'OBJ roundtrip retains independently known 1000 m3',1e-7);
ok(obj.includes('test-version')&&obj.includes(state.source.sha256)&&obj.includes('screening'),'OBJ carries source, version and interpretation limit');
ok(JSON.parse(obj.split('\n').find(l=>l.startsWith('# domain ')).slice(9)).code===state.domains[0].code,'OBJ comments preserve the literal domain code');
const csv=I.writePolylines(state,{generated:'2026-10-13T00:00:00Z'});
ok(csv.split('\r\n').length===10&&csv.includes('SAP ""A"", group')&&csv.includes('"700000","9800000","90"'),'section CSV writes every original point, quoted code and true projected XYZ');
ok(csv.includes('"H0","10","0"')&&csv.includes(state.source.sha256),'section CSV keeps snap and source provenance');
state.domains[0].build.inputs.sections=[];
assert.throws(()=>I.writePolylines(state),/DOMAIN_POLYLINES_UNAVAILABLE/);checks++;

// P6.02 pre-converter: strict, meter-only DXF TIN parsing with explicit CRS
// and provenance. Coverage probes can never claim full area coverage.
const SI=ctx.OrebitSurfaceImport, tinMesh={v:[[0,0,100],[10,0,100],[10,10,90],[0,10,90]],f:[[0,1,2],[0,2,3]]};
const tinDXF=D.writeSolids([{code:'TOPO',mesh:tinMesh}]);
ok(SI.unitCode(tinDXF)===6,'surface unit reader sees R12 metre declaration');
const imported=SI.readDXF3DFaceTIN(tinDXF,{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'d'.repeat(64),fileName:'topo.dxf'});
ok(imported.kind==='imported-dxf-3dface-tin'&&imported.units==='m'&&imported.layer==='TOPO','supported 3DFACE layer imports as a metre TIN');
close(ctx.OrebitGeometryPrimitives.prepareTIN(imported).sample(2,2).z,98,'imported TIN interpolation retains material elevation');
ok(imported.provenance.fileName==='topo.dxf'&&imported.provenance.sourceHash==='d'.repeat(64)&&imported.provenance.transform==='identity','surface import provenance binds source hash and identity transform');
ok(imported.coverage.status==='not-assessed'&&imported.coverage.fullSurfaceCoverage===false,'unassessed terrain never starts green or full-coverage');
const probe=SI.probeCoverage(imported,[[1,1],[9,9],[12,5]]);
ok(probe.status==='partial'&&probe.outsidePointIndexes.join(',')==='2'&&probe.fullSurfaceCoverage===false,'outside terrain probes stay explicitly partial, never full coverage');
const shortCoverage=SI.assessCoverage(imported,box);
ok(shortCoverage.status==='partial'&&!shortCoverage.fullSurfaceCoverage&&shortCoverage.coveredArea<shortCoverage.targetArea,'terrain triangles covering only a small portion of the solid footprint cannot pass the exact area gate');
const fullTerrain=SI.readDXF3DFaceTIN(D.writeSolids([{code:'FULL',mesh:{v:[[0,0,100],[200,0,100],[200,200,90],[0,200,90]],f:[[0,1,2],[0,2,3]]}}]),{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'e'.repeat(64)});
const complete=SI.assessCoverage(fullTerrain,box);
ok(complete.status==='covered'&&complete.fullSurfaceCoverage&&Math.abs(complete.coveredArea-complete.targetArea)<1e-6,'non-overlapping terrain triangles covering the solid XY convex hull pass exact union-area coverage');
const holeTerrain=SI.readDXF3DFaceTIN(D.writeSolids([{code:'HOLE',mesh:{v:[[0,0,100],[200,0,100],[200,200,90],[0,200,90]],f:[[0,1,2]]}}]),{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'f'.repeat(64)});
ok(SI.assessCoverage(holeTerrain,box).status==='partial','an uncovered half-plane remains partial even when the surface TIN has finite vertices on all sides');
const overlapTerrain=SI.readDXF3DFaceTIN(D.writeSolids([{code:'OVERLAP',mesh:{v:[[0,0,100],[200,0,100],[200,200,90],[0,200,90]],f:[[0,1,2],[0,1,2]]}}]),{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'1'.repeat(64)});
ok(SI.assessCoverage(overlapTerrain,box).status==='overlap','overlapping terrain faces are rejected instead of inflating union coverage');
assert.throws(()=>SI.assessCoverage(fullTerrain,box,{maxPairs:0}),/SURFACE_IMPORT_COVERAGE_PAIR_BUDGET/);checks++;
const workspace={version:1,frame:{crs:'EPSG:32751',units:'m'},loft:{draft:[],draftAt:null,sections:[],domainCode:null,endRule:'',snap:2,undo:[],redo:[]},
  view:{mode:'plan',azimuth:90,width:25,offset:0,ve:1,veAuto:true},contact:{rule:'first_from',target:'',threshold:null,maxEdge:null},solid:{topography:'imported',terrainSurface:fullTerrain,density:null,code:''}};
ctx.OrebitDomainState.checkWorkspace(workspace);ok(true,'explicit imported terrain choice plus source hash and target CRS survive workspace validation');
assert.throws(()=>ctx.OrebitDomainState.checkWorkspace({...workspace,frame:{...workspace.frame,crs:'EPSG:32750'}}),/DOMAIN_WORKSPACE_INVALID/);checks++;
assert.throws(()=>ctx.OrebitDomainState.checkWorkspace({...workspace,solid:{...workspace.solid,terrainSurface:undefined}}),/DOMAIN_WORKSPACE_INVALID/);checks++;
assert.throws(()=>SI.readDXF3DFaceTIN(tinDXF,{sourceCRS:'',targetCRS:'EPSG:32751',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_CRS_REQUIRED/);checks++;
assert.throws(()=>SI.readDXF3DFaceTIN(tinDXF,{sourceCRS:'EPSG:32750',targetCRS:'EPSG:32751',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_CRS_MISMATCH/);checks++;
assert.throws(()=>SI.readDXF3DFaceTIN(tinDXF.replace('70\r\n6','70\r\n2'),{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_METRES_REQUIRED/);checks++;
assert.throws(()=>SI.readDXF3DFaceTIN(tinDXF.replace('9\r\n$INSUNITS\r\n70\r\n6\r\n',''),{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_METRES_REQUIRED/);checks++;
assert.throws(()=>SI.readDXF3DFaceTIN(tinDXF.replace('0\r\nENDSEC\r\n0\r\nEOF','0\r\nLINE\r\n8\r\nTOPO\r\n10\r\n0\r\n20\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF'),{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_UNSUPPORTED_ENTITIES/);checks++;
const twoLayers=D.writeSolids([{code:'A',mesh:tinMesh},{code:'B',mesh:tinMesh}]);
assert.throws(()=>SI.readDXF3DFaceTIN(twoLayers,{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_LAYER_REQUIRED/);checks++;
assert.throws(()=>SI.readDXF3DFaceTIN(tinDXF,{sourceCRS:'EPSG:32751',targetCRS:'EPSG:32751',sourceHash:'short'}),/SURFACE_IMPORT_SOURCE_HASH_REQUIRED/);checks++;
const doubled={v:[[0,0,0],[10,0,0],[0,10,0],[0,0,5],[10,0,5],[0,10,5]],f:[[0,1,2],[3,4,5]]};
assert.throws(()=>SI.readDXF3DFaceTIN(D.writeSolids([{code:'MULTI',mesh:doubled}]),{sourceCRS:'LOCAL-1',targetCRS:'LOCAL-1',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_MULTIVALUED_TERRAIN/);checks++;
const vertical={v:[[0,0,0],[0,10,1],[0,20,2]],f:[[0,1,2]]};
assert.throws(()=>SI.readDXF3DFaceTIN(D.writeSolids([{code:'WALL',mesh:vertical}]),{sourceCRS:'LOCAL-1',targetCRS:'LOCAL-1',sourceHash:'d'.repeat(64)}),/SURFACE_IMPORT_VERTICAL_OR_DEGENERATE_FACE/);checks++;
console.log(`domain interop S10: ${checks} known answers passed`);
