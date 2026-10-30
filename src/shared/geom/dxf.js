/* Domain S10: closed solids as DXF R12 3DFACE (one triangle per face, fourth corner = third),
   and the reader that brings them back. Coordinates are written with full double precision.
   The reader counts every entity it does not use instead of dropping it silently. */
(function(root) {
  'use strict';
  const num = x => { const s = String(x); return Number(s) === x ? s : x.toPrecision(17); };
  // R12 comment values stay within 255 bytes, including long analyst notes.
  // Split on Unicode code points so adjoining 999 values reconstruct the text.
  function comments(value) {
    const result=[];let text='',bytes=0;
    for(const ch of String(value).replace(/[\r\n]+/g,' ')){
      const cp=ch.codePointAt(0),size=cp<128?1:cp<2048?2:cp<65536?3:4;
      if(bytes+size>250){result.push('999',text);text='';bytes=0;}
      text+=ch;bytes+=size;
    }
    if(text)result.push('999',text);
    return result;
  }

  // domains: [{code, mesh:{v,f}}]. Each domain goes to its own layer named after its code.
  function writeSolids(domains, options = {}) {
    const L = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6'];
    if (options.comment) L.splice(0, 0, ...comments(options.comment));
    L.push('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    const used=new Set();
    for (const d of domains) {
      const base=layerName(d.code);let layer=base,n=1;
      while(used.has(layer)){const suffix='_'+(++n);layer=base.slice(0,31-suffix.length)+suffix;}
      used.add(layer);
      L.push(...comments(JSON.stringify({domain:d.code,layer})));
      for (const face of d.mesh.f) {
        const p = [face[0], face[1], face[2], face[2]].map(i => d.mesh.v[i]);
        L.push('0', '3DFACE', '8', layer);
        p.forEach((q, n) => L.push(String(10 + n), num(q[0]), String(20 + n), num(q[1]), String(30 + n), num(q[2])));
      }
    }
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\r\n') + '\r\n';
  }
  // R12 layer names: letters, digits, $ - _ only, upper case, at most 31 characters.
  function layerName(code) {
    const s = String(code ?? '').toUpperCase().replace(/[^A-Z0-9$_-]/g, '_').slice(0, 31);
    return s || 'DOMAIN';
  }

  // Returns {layers: {name: {v, f}}, unsupported: {TYPE: count}, faces}. Identical corners are merged per layer.
  function readSolids(text) {
    const lines = String(text).split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1]]);
    const layers = Object.create(null), unsupported = Object.create(null);
    let inEntities = false, faces = 0;
    for (let i = 0; i < pairs.length; i++) {
      const [code, value] = pairs[i];
      if (code === '2' && i > 0 && pairs[i - 1][1].trim() === 'SECTION') { inEntities = value.trim() === 'ENTITIES'; continue; }
      if (code !== '0' || !inEntities) continue;
      const type = value.trim();
      if (type === 'ENDSEC' || type === 'EOF' || type === 'SECTION') continue;
      const group = {};
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== '0'; j++) group[pairs[j][0]] = pairs[j][1].trim();
      i = j - 1;
      if (type !== '3DFACE') { unsupported[type] = (unsupported[type] || 0) + 1; continue; }
      const corners = [0, 1, 2, 3].map(n => [group[String(10 + n)], group[String(20 + n)], group[String(30 + n)] ?? '0'].map(v=>v==null||v.trim()===''?NaN:Number(v)));
      if (corners.some(c => !c.every(Number.isFinite))) throw Error('DOMAIN_DXF_COORDINATE_INVALID');
      const name = group['8'] || '0', mesh = layers[name] || (layers[name] = {v:[], f:[], index:new Map()});
      const id = c => { const k = c.join(','); if (!mesh.index.has(k)) { mesh.index.set(k, mesh.v.length); mesh.v.push(c); } return mesh.index.get(k); };
      const [a, b, c, d] = corners.map(id);
      mesh.f.push([a, b, c]);
      if (d !== c) mesh.f.push([a, c, d]);
      faces++;
    }
    for (const m of Object.values(layers)) delete m.index;
    return {layers, unsupported, faces};
  }

  root.OrebitDomainDXF = Object.freeze({writeSolids, readSolids, layerName});
})(typeof window === 'undefined' ? globalThis : window);
