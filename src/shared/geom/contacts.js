/* Domain S4: contact picks per hole and the surface through them (primitive A,
   between surfaces). Pure geometry: rows come from OrebitCoreDomain.intervalGeometry(),
   membership from the geologist's chosen codes or grade threshold. A hole whose
   contact cannot be placed from the data is reported with its reason, never guessed. */
(function(root) {
  'use strict';
  const RULES = ['first_from', 'last_to', 'grade_cross'];
  const TOL = 1e-6;
  const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

  // member(row) -> true | false | null (null: no code or no grade, so membership is unknown).
  function pickContacts(rows, rule, member) {
    if (!RULES.includes(rule)) throw Error('DOMAIN_CONTACT_RULE_INVALID');
    if (typeof member !== 'function') throw Error('DOMAIN_CONTACT_MEMBER_INVALID');
    const holes = new Map();
    for (const row of rows) {
      const from = Number(row.from_m), to = Number(row.to_m);
      if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) continue;
      if (!holes.has(row.hole_id)) holes.set(row.hole_id, []);
      const m = member(row);
      if (m !== true && m !== false && m !== null) throw Error('DOMAIN_CONTACT_MEMBER_INVALID');
      holes.get(row.hole_id).push({row, from, to, m});
    }
    const out = [];
    for (const [hole, list] of holes) {
      list.sort((a, b) => a.from - b.from);
      out.push({hole, ...pickHole(list, rule)});
    }
    return out;
  }

  // A first/last envelope cannot represent multiple logged bodies. Do not
  // bridge a known non-member or an unknown internal interval into ore.
  function splitSupport(list) {
    const first=list.findIndex(s=>s.m===true);
    let last=-1;for(let i=list.length-1;i>=0;i--)if(list[i].m===true){last=i;break;}
    if(first<0||last<=first)return null;
    const spans=[];let previous=null, knownBreak=false, unknownBreak=false;
    for(let i=first;i<=last;i++) {
      const s=list[i];
      if(previous && s.from-previous.to>TOL)unknownBreak=true;
      if(s.m===false)knownBreak=true;
      else if(s.m===null)unknownBreak=true;
      if(s.m===true) {
        const span=spans.at(-1);
        if(span && previous?.m===true && s.from-previous.to<=TOL) {
          span.to=Math.max(span.to,s.to);span.endIndex=s.row.sourceIndex;
        } else spans.push({from:s.from,to:s.to,startIndex:s.row.sourceIndex,endIndex:s.row.sourceIndex});
      }
      previous=s;
    }
    if(!knownBreak&&!unknownBreak)return null;
    return {status:'uncertain',reason:knownBreak?'repeated-domain-intervals':'domain-support-gap',
      sourceIndex:list[first].row.sourceIndex,spans};
  }

  function pickHole(list, rule) {
    const ambiguity=splitSupport(list);if(ambiguity)return ambiguity;
    const last = rule === 'last_to';
    const seq = last ? list.slice().reverse() : list;
    // Each step walks away from the collar (or, for last_to, up from the end of hole).
    const gapBefore = (i) => i === 0 ? (last ? false : seq[0].from > TOL)
      : (last ? seq[i - 1].from - seq[i].to : seq[i].from - seq[i - 1].to) > TOL;
    let unknown = false, sawNonMember = false;
    for (let i = 0; i < seq.length; i++) {
      const s = seq[i];
      if (gapBefore(i)) { unknown = true; sawNonMember = false; }
      if (s.m === null) { unknown = true; sawNonMember = false; continue; }
      if (s.m === false) { sawNonMember = true; continue; }
      // First member interval met from this side.
      if (unknown) return {status: 'uncertain', reason: 'unlogged-before-contact', sourceIndex: s.row.sourceIndex};
      if (rule === 'grade_cross' && !sawNonMember) return {status: 'open', reason: 'starts-in-domain', sourceIndex: s.row.sourceIndex};
      if (last && i === 0) return {status: 'open', reason: 'domain-reaches-end-of-hole', sourceIndex: s.row.sourceIndex};
      const p = last ? s.row.end : s.row.start;
      if (!finite(p)) return {status: 'uncertain', reason: 'no-endpoint', sourceIndex: s.row.sourceIndex};
      return {status: 'contact', depth: last ? s.to : s.from, point: [p.x, p.y, p.z], atCollar: !last && i === 0, sourceIndex: s.row.sourceIndex};
    }
    return unknown ? {status: 'uncertain', reason: 'unlogged-no-member'} : {status: 'absent', reason: 'no-member-interval'};
  }

  function medianSpacing(points) {
    const d = points.map((p, i) => {
      let best = Infinity;
      for (let j = 0; j < points.length; j++) if (j !== i) best = Math.min(best, Math.hypot(p[0] - points[j][0], p[1] - points[j][1]));
      return best;
    }).sort((a, b) => a - b);
    const m = d.length >> 1;
    return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
  }

  // TIN through the 'contact' picks, bounded by their hull and maxEdge. The default
  // maxEdge is 2.5 x the median XY nearest-neighbour spacing; a typed value is kept.
  function contactSurface(picks, options = {}) {
    const counts = {};
    for (const p of picks) counts[p.status] = (counts[p.status] || 0) + 1;
    const points = picks.filter(p => p.status === 'contact').map(p => p.point);
    const ambiguous=picks.filter(p=>['repeated-domain-intervals','domain-support-gap'].includes(p.reason));
    if(ambiguous.length)return {status:'ambiguous',counts,used:points.length,affected:ambiguous.map(p=>({hole:p.hole,reason:p.reason,spans:p.spans}))};
    if (points.length < 3) return {status: 'insufficient', counts, used: points.length};
    const spacing = medianSpacing(points);
    const user = options.maxEdge != null;
    if (user && !(Number.isFinite(options.maxEdge) && options.maxEdge > 0)) throw Error('DOMAIN_SURFACE_MAXEDGE_INVALID');
    const maxEdge = user ? options.maxEdge : 2.5 * spacing;
    const tin = root.OrebitGeometryPrimitives.makeTIN(points, maxEdge);
    return {status: tin.triangles.length ? 'surface' : 'no-triangles', counts, used: points.length, medianSpacing: spacing,
      maxEdge, maxEdgeSource: user ? 'user' : 'default', tin};
  }

  root.OrebitDomainContacts = Object.freeze({RULES, pickContacts, contactSurface, medianSpacing});
})(typeof window === 'undefined' ? globalThis : window);
