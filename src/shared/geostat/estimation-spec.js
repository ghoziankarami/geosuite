/* P4.03: review an element's estimation population without rewriting source assays.
   Statistical labels, geological membership and estimation inclusion are distinct roles. */
(function(root){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const text=value=>typeof value==='string'?value.trim():'';
  const array=value=>Array.isArray(value)?value:[];
  function freezeDeep(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freezeDeep);Object.freeze(value);}return value;}
  const actions=new Set(['retain','split','merge','reject']);
  const boundaries=new Set(['none','hard','soft']);
  function validate(candidate,current={}){
    const findings=[];
    if(!candidate||candidate.schema!=='orebit-estimation-spec'||candidate.version!==1) findings.push('SPEC_UNSUPPORTED');
    if(!text(candidate?.sourceRevision)||!text(candidate?.geologicalRevision)) findings.push('REVISION_REQUIRED');
    if(!/^[a-f0-9]{64}$/.test(candidate?.membershipRevision||'')) findings.push('MEASURED_MEMBERSHIP_REQUIRED');
    const roles=candidate?.roles;
    if(!roles||roles.source!=='assay-source'||roles.statistical!=='reviewed-statistical-population'||roles.geological!=='accepted-geological-membership'||roles.estimation!=='approved-estimation-population') findings.push('POPULATION_ROLES_INVALID');
    if(current.sourceRevision!=null&&candidate?.sourceRevision!==current.sourceRevision) findings.push('SOURCE_REVISION_STALE');
    if(current.geologicalRevision!=null&&candidate?.geologicalRevision!==current.geologicalRevision) findings.push('GEOLOGICAL_REVISION_STALE');
    if(current.membershipRevision!=null&&candidate?.membershipRevision!==current.membershipRevision) findings.push('MEMBERSHIP_REVISION_STALE');
    if(candidate?.status==='approved'&&(!text(candidate.approval?.reviewer)||!text(candidate.approval?.reason)||!text(candidate.approval?.at))) findings.push('APPROVAL_RECORD_INVALID');
    if(!Array.isArray(candidate?.elements)||!candidate.elements.length) findings.push('ELEMENTS_REQUIRED');
    const elementIds=new Set(),sourceIds=array(current.parentObservationIds),observations=new Set(sourceIds),geologicalDomains=new Set(array(current.geologicalDomainIds));
    if(!sourceIds.length||sourceIds.length!==observations.size) findings.push('SOURCE_POPULATION_REQUIRED');
    for(const element of array(candidate?.elements)){
      const id=text(element?.elementId);
      if(!id||elementIds.has(id)){findings.push('ELEMENT_ID_INVALID');continue;}elementIds.add(id);
      if(!text(element?.unit)) findings.push('ELEMENT_UNIT_REQUIRED');
      if(!text(element?.populationId)) findings.push('POPULATION_ID_REQUIRED');
      if(element?.geologicalDomainIds!=null&&(!Array.isArray(element.geologicalDomainIds)||!element.geologicalDomainIds.length||element.geologicalDomainIds.some(v=>!text(v)))) findings.push('POPULATION_DOMAINS_INVALID');
      if(geologicalDomains.size&&array(element?.geologicalDomainIds).some(v=>!geologicalDomains.has(v))) findings.push('POPULATION_DOMAIN_UNKNOWN');
      if(!boundaries.has(element?.boundaryPolicy)) findings.push('BOUNDARY_POLICY_INVALID');
      if(['hard','soft'].includes(element?.boundaryPolicy)&&!text(element?.boundaryReason)) findings.push('BOUNDARY_REASON_REQUIRED');
      if(!text(element?.reviewReason)) findings.push('REVIEW_REASON_REQUIRED');
      if(!Array.isArray(element?.decisions)||!element.decisions.length){findings.push('DECISIONS_REQUIRED');continue;}
      const decisionIds=new Set();
      for(const decision of element.decisions){
        const parent=text(decision?.parentObservationId);
        if(!parent||decisionIds.has(parent)){findings.push('PARENT_ID_INVALID');continue;}decisionIds.add(parent);
        if(observations.size&&!observations.has(parent)) findings.push('PARENT_NOT_IN_SOURCE');
        if(!text(decision?.statisticalPopulationId)||!Array.isArray(decision?.geologicalMembership)||decision.geologicalMembership.some(v=>!text(v))) findings.push('POPULATION_ASSIGNMENT_REQUIRED');
        if(geologicalDomains.size&&decision?.geologicalMembership?.some(v=>!geologicalDomains.has(v))) findings.push('GEOLOGICAL_DOMAIN_UNKNOWN');
        const measured=current.membershipByParent?.[parent];
        if(current.membershipByParent!=null&&(!measured||!['inside','outside','boundary','crossing','ambiguous'].includes(measured.status))) findings.push('PARENT_MEMBERSHIP_MISSING');
        else if(measured){
          if(decision.membershipStatus!==measured.status) findings.push('PARENT_MEMBERSHIP_MISMATCH');
          const actualDomains=[...new Set(array(measured.spans).filter(span=>span.state==='inside').map(span=>span.geologicalDomainId))].sort();
          if(JSON.stringify([...decision.geologicalMembership].sort())!==JSON.stringify(actualDomains)) findings.push('GEOLOGICAL_MEMBERSHIP_MISMATCH');
          if(measured.status==='ambiguous'&&decision.action!=='reject') findings.push('AMBIGUOUS_MEMBERSHIP_MUST_REJECT');
          if(element.boundaryPolicy==='hard'&&['crossing','boundary'].includes(measured.status)&&!['split','reject'].includes(decision.action)) findings.push('HARD_BOUNDARY_DECISION_REQUIRED');
        }
        if(!actions.has(decision?.action)) findings.push('ACTION_INVALID');
        if(!text(decision?.reason)) findings.push('DECISION_REASON_REQUIRED');
        if(decision?.action==='reject'&&!text(decision?.reason)) findings.push('REJECTION_REASON_REQUIRED');
        if(decision?.action==='split'){
          if(!Array.isArray(decision.parts)||decision.parts.length<2||!Number.isFinite(decision.support?.fromMD)||!Number.isFinite(decision.support?.toMD)||decision.support.toMD<=decision.support.fromMD) findings.push('SPLIT_PARTS_REQUIRED');
          else {
            let cursor=decision.support.fromMD;
            for(const part of decision.parts){
              if(!Number.isFinite(part?.fromMD)||!Number.isFinite(part?.toMD)||part.toMD<=part.fromMD||part.fromMD!==cursor||!text(part?.geologicalDomainId)) findings.push('SPLIT_SUPPORT_INVALID');
              cursor=part?.toMD;
            }
            if(decision.parts[0]?.fromMD!==decision.support.fromMD||decision.parts.at(-1)?.toMD!==decision.support.toMD) findings.push('SPLIT_SUPPORT_NOT_CONSERVED');
            const measured=current.membershipByParent?.[parent];
            if(measured&&JSON.stringify(decision.parts.map(({fromMD,toMD,geologicalDomainId})=>({fromMD,toMD,geologicalDomainId})))!==JSON.stringify(array(measured.spans).map(span=>({fromMD:span.entryMD,toMD:span.exitMD,geologicalDomainId:span.geologicalDomainId|| (span.state==='outside'?'__OUTSIDE__':'__BOUNDARY__')})))) findings.push('SPLIT_SUPPORT_NOT_MEASURED');
          }
        }
        if(decision?.action==='merge'){
          if(!Array.isArray(decision.parents)||decision.parents.length<2||new Set(decision.parents).size!==decision.parents.length||!decision.parents.includes(parent)) findings.push('MERGE_PARENTS_REQUIRED');
          if(!text(decision.targetPopulationId)) findings.push('MERGE_TARGET_REQUIRED');
        }
      }
      if(observations.size&&([...observations].some(parent=>!decisionIds.has(parent))||decisionIds.size!==observations.size)) findings.push('SOURCE_POPULATION_NOT_ACCOUNTED');
    }
    for(const element of array(candidate?.elements))for(const decision of array(element?.decisions))if(decision?.action==='merge'){
      const target=decision.targetPopulationId;
      if(decision.parents?.some(parent=>!element.decisions.some(other=>other.parentObservationId===parent&&other.action==='merge'&&other.targetPopulationId===target))) findings.push('MERGE_PARENT_DECISION_MISSING');
    }
    return {ok:findings.length===0,findings:[...new Set(findings)]};
  }
  function approve(candidate,current,review={}){
    const check=validate(candidate,current);
    if(!check.ok){const error=Error('ESTIMATION_SPEC_INVALID');error.findings=check.findings;throw error;}
    if(!text(review.reviewer)||!text(review.reason)) throw Error('ESTIMATION_REVIEW_REQUIRED');
    return freezeDeep({...clone(candidate),status:'approved',approval:{reviewer:text(review.reviewer),reason:text(review.reason),at:text(review.at)||new Date().toISOString()},
      sourceObservationIds:[...new Set(candidate.elements.flatMap(e=>e.decisions.map(d=>d.parentObservationId)))].sort()});
  }
  function readiness(snapshot,current){
    if(!snapshot||snapshot.schema!=='orebit-estimation-spec'||snapshot.status!=='approved')return {status:'draft',reason:'SPEC_NOT_APPROVED'};
    if(snapshot.sourceRevision!==current?.sourceRevision)return {status:'stale',reason:'SOURCE_REVISION_STALE'};
    if(snapshot.geologicalRevision!==current?.geologicalRevision)return {status:'stale',reason:'GEOLOGICAL_REVISION_STALE'};
    if(snapshot.membershipRevision!==current?.membershipRevision)return {status:'stale',reason:'MEMBERSHIP_REVISION_STALE'};
    const ids=[...new Set(array(current?.parentObservationIds))].sort();
    if(JSON.stringify(ids)!==JSON.stringify(snapshot.sourceObservationIds))return {status:'stale',reason:'SOURCE_POPULATION_CHANGED'};
    const check=validate(snapshot,current);if(!check.ok)return {status:'invalid',reason:check.findings.join(',')};
    return {status:'approved',reason:null};
  }
  function prepareComposites(source,membership,treatmentSpec,compositeSpec,signal){
    const fail=code=>{const error=Error(code);error.code=code;throw error;};
    if(signal?.aborted)fail('PREPARATION_ABORTED');
    if(!source||!Array.isArray(source.columns)||!Array.isArray(source.rows)||!Array.isArray(source.parentObservationIds)||source.rows.length!==source.parentObservationIds.length)fail('SOURCE_POPULATION_INVALID');
    if(!membership||!Array.isArray(membership.intervals)||membership.sourceRevision!==(source.membershipSourceRevision||source.revision)||membership.revision!==treatmentSpec?.membershipRevision)fail('MEMBERSHIP_REVISION_MISMATCH');
    if(treatmentSpec?.status!=='approved'||treatmentSpec.sourceRevision!==source.revision||treatmentSpec.geologicalRevision!==membership.geologicalRevision)fail('ESTIMATION_SPEC_NOT_CURRENT');
    const length=Number(compositeSpec?.length),minimum=Number(compositeSpec?.minimumLength??compositeSpec?.minimumTail??0);
    if(!Number.isFinite(length)||length<=0||!Number.isFinite(minimum)||minimum<0||minimum>length)fail('COMPOSITE_SPEC_INVALID');
    const fi=source.columns.indexOf('from_m'),ti=source.columns.indexOf('to_m'),hi=source.columns.indexOf('hole_id');
    if(fi<0||ti<0||hi<0)fail('SOURCE_INTERVAL_COLUMNS_REQUIRED');
    const intervals=new Map(membership.intervals.map(row=>[row.parentObservationId,row]));
    const prepared=[],rejected=[];const seen=new Set();
    for(let index=0;index<source.rows.length;index++){
      if(signal?.aborted)fail('PREPARATION_ABORTED');
      const row=source.rows[index],parentObservationId=source.parentObservationIds[index],measured=intervals.get(parentObservationId);
      if(!parentObservationId||seen.has(parentObservationId)||!measured)fail('MEMBERSHIP_PARENT_ALIGNMENT_INVALID');seen.add(parentObservationId);
      const start=Number(row[fi]),end=Number(row[ti]);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('SOURCE_INTERVAL_INVALID');
      let accounted=0;for(const span of array(measured.spans)){if(!Number.isFinite(span.entryMD)||!Number.isFinite(span.exitMD)||span.exitMD<=span.entryMD)fail('MEASURED_SUPPORT_INVALID');accounted+=span.exitMD-span.entryMD;}
      if(measured.spans?.length&&Math.abs(accounted-(end-start))>1e-6)fail('MEASURED_SUPPORT_NOT_CONSERVED');
      const specElements=array(treatmentSpec.elements),decisions=specElements.map(element=>({element,decision:array(element.decisions).find(d=>d.parentObservationId===parentObservationId)}));
      if(!decisions.length||decisions.some(item=>!item.decision))fail('PARENT_DECISION_MISSING');
      if(decisions.some(item=>!Array.isArray(item.element.geologicalDomainIds)||!item.element.geologicalDomainIds.length))fail('SPEC_DOMAIN_SELECTION_REQUIRED');
      const hardSplits=decisions.filter(item=>item.element.boundaryPolicy==='hard'&&item.decision.action==='split');
      const rejects=decisions.filter(item=>item.decision.action==='reject');
      if(rejects.length){rejected.push({parentObservationId,reason:rejects.map(item=>item.decision.reason)});continue;}
      if(hardSplits.length){
        const partSource=hardSplits[0].decision.parts;
        if(hardSplits.some(item=>JSON.stringify(item.decision.parts)!==JSON.stringify(partSource)))fail('ELEMENT_BOUNDARY_SPLITS_CONFLICT');
        for(const part of partSource){
          const supportLength=part.toMD-part.fromMD,domain=part.geologicalDomainId;
          if(domain==='__OUTSIDE__'||domain==='__BOUNDARY__')continue;
          if(!hardSplits.every(item=>item.element.geologicalDomainIds.includes(domain)))continue;
          prepared.push({parentObservationId,sourceRowIndex:index,holeId:String(row[hi]),fromMD:part.fromMD,toMD:part.toMD,
            supportLength,geologicalDomainId:domain,gradeSupport:Object.fromEntries(specElements.map(item=>{
              const gi=source.columns.indexOf(item.elementId),grade=gi<0?null:row[gi];
              return [item.elementId,{grade:Number.isFinite(grade)?grade:null,supportLength:Number.isFinite(grade)?supportLength:0,
                weightedValue:Number.isFinite(grade)?grade*supportLength:0}];
            })),assumption:'measured parent grade represented over membership support; correlated, not an independent assay'});
        }
      }else{
        const decision=decisions[0].decision;
        if(decisions.some(item=>item.decision.action==='split'))fail('HARD_SPLIT_REQUIRED_FOR_PREPARATION');
        if(!decisions.every(item=>item.decision.action==='retain'||item.decision.action==='merge'))continue;
        const domains=[...new Set(decisions.flatMap(item=>item.decision.geologicalMembership))].sort();
        if(!decisions.some(item=>item.element.geologicalDomainIds.some(domain=>domains.includes(domain))))continue;
        prepared.push({parentObservationId,sourceRowIndex:index,holeId:String(row[hi]),fromMD:start,toMD:end,supportLength:end-start,
          geologicalDomainId:domains.length===1?domains[0]:null,geologicalDomainIds:domains,
          gradeSupport:Object.fromEntries(specElements.map(item=>{const gi=source.columns.indexOf(item.elementId),grade=gi<0?null:row[gi];return [item.elementId,
            {grade:Number.isFinite(grade)?grade:null,supportLength:Number.isFinite(grade)?end-start:0,weightedValue:Number.isFinite(grade)?grade*(end-start):0}];})),
          assumption:decisions.some(item=>item.decision.membershipStatus==='crossing')?'reviewed boundary representativity assumption; parent grade remains correlated':'measured parent interval support'});
      }
    }
    const parentIds=new Set(prepared.map(row=>row.parentObservationId));
    return freezeDeep({schema:'orebit-prepared-composites',version:1,sourceRevision:source.revision,geologicalRevision:membership.geologicalRevision,
      membershipRevision:membership.revision,estimationSpecRevision:treatmentSpec.membershipRevision,compositeSpec:{length,minimumLength:minimum},
      roles:{source:'assay-source',membership:'accepted-measured-support',population:'approved-estimation-spec'},prepared,rejected,
      counts:{source:source.rows.length,retainedParents:parentIds.size,preparedIntervals:prepared.length,rejectedParents:rejected.length},
      assumptions:['Split parts retain their one parent observation ID.','Reusing a parent grade over split support is an explicit representativity assumption, not independent sampling.']});
  }
  function aggregatePreparedComposites(source,preparation,signal){
    const fail=code=>{const error=Error(code);error.code=code;throw error;};
    if(signal?.aborted)fail('AGGREGATION_ABORTED');
    if(!source||!Array.isArray(source.parentObservationIds)||source.parentObservationIds.length!==source.rows?.length||preparation?.schema!=='orebit-prepared-composites'||preparation.sourceRevision!==source.revision)fail('PREPARATION_SOURCE_STALE');
    const length=Number(preparation.compositeSpec?.length),minimum=Number(preparation.compositeSpec?.minimumLength);
    if(!Number.isFinite(length)||length<=0||!Number.isFinite(minimum)||minimum<0||minimum>length)fail('COMPOSITE_SPEC_INVALID');
    const columns=source.columns,rows=source.rows,hi=columns.indexOf('hole_id'),xi=columns.indexOf('midx'),yi=columns.indexOf('midy'),zi=columns.indexOf('midz');
    if(hi<0||!Array.isArray(rows))fail('SOURCE_COORDINATE_COLUMNS_INVALID');
    const elementIds=Object.keys(preparation.prepared[0]?.gradeSupport||{}),groups=new Map();
    for(const part of preparation.prepared){
      if(signal?.aborted)fail('AGGREGATION_ABORTED');
      if(!Number.isInteger(part.sourceRowIndex)||!rows[part.sourceRowIndex]||String(rows[part.sourceRowIndex][hi])!==String(part.holeId)||source.parentObservationIds[part.sourceRowIndex]!==part.parentObservationId)fail('PREPARED_PARENT_ALIGNMENT_INVALID');
      if(!(part.toMD>part.fromMD)||Math.abs((part.toMD-part.fromMD)-part.supportLength)>1e-6)fail('PREPARED_SUPPORT_INVALID');
      const key=JSON.stringify([String(part.holeId),part.geologicalDomainId||'__UNASSIGNED__']);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(part);
    }
    const stations=new Map();
    if(xi>=0&&yi>=0&&zi>=0)rows.forEach(row=>{
      const hole=String(row[hi]),depths=columns.indexOf('from_m')>=0&&columns.indexOf('to_m')>=0?[(Number(row[columns.indexOf('from_m')])+Number(row[columns.indexOf('to_m')]))/2]:[];
      if(depths.length&&[row[xi],row[yi],row[zi]].every(Number.isFinite)){if(!stations.has(hole))stations.set(hole,[]);stations.get(hole).push({d:depths[0],x:row[xi],y:row[yi],z:row[zi]});}
    });
    const xyzAt=(hole,depth)=>{const points=(stations.get(hole)||[]).sort((a,b)=>a.d-b.d);if(!points.length||depth<points[0].d||depth>points[points.length-1].d)return null;
      if(points.length===1)return Math.abs(depth-points[0].d)<1e-9?{x:points[0].x,y:points[0].y,z:points[0].z}:null;
      let i=0;while(i<points.length-2&&points[i+1].d<depth)i++;const a=points[i],b=points[i+1],f=(depth-a.d)/(b.d-a.d);
      return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:a.z+(b.z-a.z)*f};};
    const composites=[];
    for(const parts of groups.values()){
      parts.sort((a,b)=>a.fromMD-b.fromMD||a.toMD-b.toMD);const hole=String(parts[0].holeId),domain=parts[0].geologicalDomainId||null;
      let start=parts[0].fromMD,end=parts[parts.length-1].toMD;
      for(let from=start;from<end-1e-9;from+=length){if(signal?.aborted)fail('AGGREGATION_ABORTED');const to=Math.min(from+length,end),supportByParent=new Map(),supportByElement={};let support=0;
        for(const part of parts){const overlap=Math.min(to,part.toMD)-Math.max(from,part.fromMD);if(overlap<=1e-9)continue;support+=overlap;
          const parent=supportByParent.get(part.parentObservationId)||{supportLength:0,elements:{}};parent.supportLength+=overlap;supportByParent.set(part.parentObservationId,parent);
          for(const id of elementIds){const grade=part.gradeSupport[id];if(!grade||grade.grade==null)continue;const item=supportByElement[id]||{supportLength:0,weightedValue:0};item.supportLength+=overlap;item.weightedValue+=grade.grade*overlap;supportByElement[id]=item;
            const parentElement=parent.elements[id]||{supportLength:0,weightedValue:0};parentElement.supportLength+=overlap;parentElement.weightedValue+=grade.grade*overlap;parent.elements[id]=parentElement;}
        }
        if(support<minimum||support<=1e-9)continue;
        const mid=(from+to)/2,xyz=xyzAt(hole,mid),contributions=[...supportByParent].map(([parentObservationId,v])=>({parentObservationId,supportLength:+v.supportLength.toFixed(6),
          elements:Object.fromEntries(Object.entries(v.elements).map(([id,e])=>[id,{supportLength:+e.supportLength.toFixed(6),weightedValue:+e.weightedValue.toFixed(10),mean:+(e.weightedValue/e.supportLength).toFixed(10)}]))}));
        composites.push({holeId:hole,fromMD:+from.toFixed(6),toMD:+to.toFixed(6),supportLength:+support.toFixed(6),geologicalDomainId:domain,
          grades:Object.fromEntries(Object.entries(supportByElement).map(([id,v])=>[id,{supportLength:+v.supportLength.toFixed(6),weightedValue:+v.weightedValue.toFixed(10),mean:+(v.weightedValue/v.supportLength).toFixed(10)}])),
          parentObservationIds:contributions.map(v=>v.parentObservationId),parentContributions:contributions,coordinates:xyz,
          coordinateStatus:xyz?'interpolated-from-measured-assay-stations':'unavailable-within-measured-stations'});
      }
    }
    return freezeDeep({schema:'orebit-composite-aggregation',version:1,sourceRevision:source.revision,membershipRevision:preparation.membershipRevision,
      compositeSpec:preparation.compositeSpec,composites,counts:{composites:composites.length,domains:new Set(composites.map(c=>c.geologicalDomainId)).size,
        supportLength:+composites.reduce((sum,c)=>sum+c.supportLength,0).toFixed(6),coordinateUnavailable:composites.filter(c=>!c.coordinates).length}});
  }
  root.OrebitEstimationSpec=Object.freeze({validate,approve,readiness,prepareComposites,aggregatePreparedComposites});
})(typeof window==='undefined'?globalThis:window);
