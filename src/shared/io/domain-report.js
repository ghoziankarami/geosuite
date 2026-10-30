/* A readable geometry audit shared by native Core / Assay / Resource reports.
   Solid volume, filled volume and estimated rock tonnage are distinct quantities. */
(function(){
  'use strict';
  function rows(state,module,clip=null){
    const id=document.documentElement.lang==='id',say=(en,indo)=>id?indo:en;
    const n=v=>Number.isFinite(v)?OrebitScreeningReport.quantity(v,6):say('Not declared','Belum dinyatakan');
    if(!state?.domains?.length)return [[say('Explicit geological geometry','Geometri geologi eksplisit'),say('No accepted solid accompanies this data. Domain labels and sample proximity do not define ore volume.','Data ini tidak membawa solid yang diterima. Label domain dan kedekatan sampel tidak menentukan volume bijih.')]];
    const status=state.handoff?.readiness||'invalid',valid=status==='validated';
    const out=[
      [say('Geological interpretation status','Status interpretasi geologi'),say('Core handoff: ','Handoff Core: ')+status+say('. Review belongs to that source and time; it is not a Resource certification.','. Tinjauan berlaku untuk sumber dan waktu itu; bukan sertifikasi Resource.')],
      [say('Solid source and coordinate frame','Sumber solid dan sistem koordinat'),(state.source?.sha256||say('Source hash unavailable','Hash sumber tidak tersedia'))+' | '+(state.crs?.kind==='epsg'?'EPSG:'+state.crs.epsg:state.crs?.kind||'unconfirmed')+' | m'],
      [say('Geometry and screening quantities','Geometri dan angka screening'),say('Solid volume is the interpreted body before cutoff. Resource quantities follow its explicitly applied block support, density and current cutoff. Without applied support, whole screening blocks remain the screening basis.','Volume solid adalah tubuh hasil interpretasi sebelum cutoff. Angka Resource mengikuti dukungan blok yang diterapkan eksplisit, densitas dan cutoff saat ini. Tanpa dukungan yang diterapkan, blok screening utuh tetap menjadi basis screening.')]
    ];
    for(const d of state.domains){
      const b=d.build,r=b?.inputs?.rules||{},volume=valid&&!b?.stale?b?.volume:null;
      const parts=[say('Geological solid volume: ','Volume solid geologi: ')+n(volume)+(Number.isFinite(volume)?' m³':''),
        say('Core-declared density: ','Densitas yang dinyatakan di Core: ')+n(d.density)+(Number.isFinite(d.density)?' t/m³':''),
        say('Interpretation method: ','Metode interpretasi: ')+(r.method==='section-loft'?say('section loft','loft section'):say('between contact surfaces','antara permukaan kontak'))];
      if(r.method==='surface-pair'){parts.push(say('Upper surface: ','Surface atas: ')+r.upperSurface);parts.push(say('Lower surface: ','Surface bawah: ')+r.lowerSurface);parts.push(say('Lateral support: intersection only; no extrapolation.','Dukungan lateral: hanya irisan; tanpa extrapolation.'));}
      if(r.endRule)parts.push(say('End rule: ','Aturan ujung: ')+r.endRule);
      if(b?.review){
        parts.push(say('Reviewer: ','Peninjau: ')+b.review.reviewer+' | '+b.review.at);
        parts.push(say('Review rationale: ','Alasan tinjauan: ')+b.review.reason);
        parts.push(say('Reviewed source: ','Sumber yang ditinjau: ')+b.review.sourceHash);
      }else parts.push(say('Reviewer identity and rationale require a new review.','Identitas peninjau dan alasan memerlukan tinjauan ulang.'));
      if(r.snapRadius!=null)parts.push(say('Contact snap radius: ','Radius snap kontak: ')+n(r.snapRadius)+' m');
      if(r.target)parts.push(say('Membership rule: ','Aturan keanggotaan: ')+r.target);
      if(b?.inputs?.codebook)parts.push(say('Included logged lithologies: ','Litologi log yang disertakan: ')+b.inputs.codebook.lithologies.join(', '));
      const honour=b?.inputs?.honouringAudit;
      if(honour){parts.push(say('Manual interpretation vertices (not measured anchors): ','Verteks interpretasi manual (bukan anchor terukur): ')+n(honour.manualVertices));}
      if(honour)parts.push(say('Section contact projection; maximum off-plane distance: ','Proyeksi kontak ke section; jarak maksimum di luar bidang: ')+n(honour.maxOffPlaneMetres)+' m');
      const topo=b?.inputs?.topographyAudit;
      const surfaceMethod=topo?.type==='per-hole collar elevation check'?say('top contacts compared with their collar elevations','kontak atas dibandingkan dengan elevasi collar masing-masing'):
        topo?.type==='collar-TIN vertex check'?say('loft vertices compared with a TIN interpolated from collar elevations','verteks loft dibandingkan dengan TIN dari elevasi collar'):
        topo?.type||r.topography||say('not recorded','belum dicatat');
      parts.push(say('Ground-surface check (approximate): ','Pemeriksaan permukaan tanah (perkiraan): ')+surfaceMethod);
      if(topo?.outsideVertices)parts.push(say('Vertices outside checked surface: ','Verteks di luar permukaan yang diperiksa: ')+topo.outsideVertices);
      parts.push(topo?.fullSurfaceClipping===true?say('Terrain clipping follows the recorded surface and coverage audit; geological interpretation does not infer ore classification.','Clipping topografi mengikuti surface dan audit cakupan yang tercatat; interpretasi geologi tidak menentukan klasifikasi bijih otomatis.'):
        say('Geological honouring and topography have limited recorded checks; no full topographic clipping or inferred ore classification.','Honouring geologi dan topografi memiliki pemeriksaan terbatas yang tercatat; belum ada clipping topografi penuh atau klasifikasi bijih otomatis.'));
      out.push([say('Explicit domain: ','Domain eksplisit: ')+d.code,parts.join('\n')]);
    }
    if(module==='Resource'&&clip?.status==='measured')for(const d of clip.rows)out.push([
      say('Volume reconciliation: ','Rekonsiliasi volume: ')+d.code,
      say('Solid: ','Solid: ')+n(d.solid)+' m³; '+say('filled in model: ','terisi dalam model: ')+n(d.inModel)+' m³; '+
      say('outside screening blocks: ','di luar blok screening: ')+n(d.outsideEnvelope)+' m³; '+say('outside grid: ','di luar grid: ')+n(d.outsideGrid)+' m³. '+
      say('The comparison alone does not apply block support or a cutoff; quantities follow the explicit Resource result snapshot.','Perbandingan saja tidak menerapkan dukungan blok atau cutoff; angka mengikuti snapshot hasil Resource yang eksplisit.')]);
    return out;
  }
  window.OrebitDomainReport=Object.freeze({rows});
})();
