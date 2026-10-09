(function () {
 'use strict';
 const ascii = value => String(value == null ? 'not available' : value).replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/×/g,'x').replace(/→/g,'->').replace(/[–—]/g,'-').replace(/³/g,'3').replace(/²/g,'2').replace(/°/g,' deg').replace(/•/g,'-').replace(/±/g,'+/-').replace(/[Δδ]/g,'delta').replace(/σ/g,'sigma').replace(/γ/g,'gamma').replace(/[Σ∑]/g,'sum').replace(/μ/g,'u').replace(/ρ/g,'rho').replace(/λ/g,'lambda').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e\n]/g,'');
 function prepare(pdf){
   if(pdf._orebitPrepared)return pdf;pdf._orebitPrepared=true;
   const clean=value=>typeof value==='string'?ascii(value):Array.isArray(value)?value.map(clean):value;
   const originalText=pdf.text,originalSplit=pdf.splitTextToSize;
   // Built-in Helvetica has no Unicode glyph map. Sanitize before measuring
   // and drawing so arrows/bullets cannot inflate width or become unreadable UTF-16.
   pdf.text=function(value,...args){return originalText.call(this,clean(value),...args);};
   pdf.splitTextToSize=function(value,...args){return originalSplit.call(this,clean(value),...args);};
   return pdf;
 }
 const ink=[24,41,54],teal=[0,112,108],muted=[94,111,122];
 function header(pdf,module,title,subtitle){
   pdf.internal.getCurrentPageInfo().pageContext.orebitSectionTitle=ascii(title);
   const W=pdf.internal.pageSize.getWidth();
   pdf.setFillColor(...teal);pdf.rect(0,0,W,4,'F');
   pdf.setFont('helvetica','bold');pdf.setTextColor(...teal);pdf.setFontSize(10);pdf.text('OREBIT / '+ascii(module).toUpperCase(),15,16);
   pdf.setTextColor(...ink);pdf.setFontSize(19);pdf.text(ascii(title),15,28);
   pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.setTextColor(...muted);pdf.text(ascii(subtitle),15,36);
   pdf.setDrawColor(219,228,231);pdf.line(15,41,W-15,41);
 }
 // Content is paginated before the footer. A long note/parameter record is never clipped.
 function cards(pdf,module,rows,opts={}){
   const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight();let y=49,index=opts.afterPage||0;
   const newPage=()=>{opts.insert?pdf.insertPage(++index):pdf.addPage();if(opts.insert)pdf.setPage(index);header(pdf,module,opts.title,opts.subtitle);y=49;};
   newPage();
   rows.forEach(([label,value],rowIndex)=>{
     const first=!!opts.executive&&rowIndex===0,bodySize=first?11:9.5,lineHeight=first?5.6:4.7;
     pdf.setFont('helvetica','normal');pdf.setFontSize(bodySize);
     const lines=pdf.splitTextToSize(readable(value,label),W-46);
     pdf.setFont('helvetica','bold');pdf.setFontSize(10);
     const labels=pdf.splitTextToSize(ascii(label).replace(/^\d+\.\s*/,''),W-55);let at=0,continued=false;
     do{
       const titleHeight=labels.length*4.8+5;
       if(H-22-y<titleHeight+lineHeight+14)newPage();
       const count=Math.max(1,Math.min(lines.length-at,Math.floor((H-22-y-titleHeight-14)/lineHeight)));
       const height=titleHeight+count*lineHeight+10;
       pdf.setFillColor(...(first?[230,245,242]:[245,248,249]));pdf.roundedRect(15,y,W-30,height,2,2,'F');
       pdf.setFillColor(...teal);pdf.roundedRect(15,y,1.2,height,0.5,0.5,'F');
       pdf.setFont('helvetica','bold');pdf.setFontSize(9);pdf.setTextColor(...teal);pdf.text(String(rowIndex+1).padStart(2,'0'),20,y+8);
       pdf.setFontSize(10);pdf.text(labels,29,y+8);
       if(continued){pdf.setFontSize(7);pdf.text('(continued)',W-22,y+7,{align:'right'});}
       pdf.setFont('helvetica','normal');pdf.setFontSize(bodySize);pdf.setTextColor(...ink);
       let lineY=y+titleHeight+4;for(const line of lines.slice(at,at+count)){pdf.text(line,23,lineY);lineY+=lineHeight;}
       y+=height+6;at+=count;continued=true;if(at<lines.length)newPage();
     }while(at<lines.length);
   });
   pdf.setPage(pdf.internal.getNumberOfPages());
 }
 function append(pdf,module,rows){
   window._reportAuditSnapshot={module,rows:rows.map(row=>row.map(ascii)),generated:new Date().toISOString()};
   cards(pdf,module,window._reportAuditSnapshot.rows,{title:'Screening due-diligence insight',subtitle:'Data, assumptions and calculation audit | Orebit '+module});
 }
 function quantity(value,digits=6){
   if(value==null||!Number.isFinite(Number(value)))return null;
   const n=Number(value),locale=document.documentElement.lang==='id'?'id-ID':'en-US';
   return n!==0&&Math.abs(n)<10**-digits?n.toExponential(2):n.toLocaleString(locale,{maximumFractionDigits:digits});
 }
 // Keep machine-readable originals in the audit snapshot, but print labelled fields.
 function readable(value,label=''){
   const source=ascii(value).replace(/^#\s*/gm,'').trim();
   try{
     const parsed=JSON.parse(source);
     if(parsed&&typeof parsed==='object'){
       if(label==='Search pass counts')return Object.entries(parsed).map(([pass,n])=>
         ({0:'Unestimated',1:'Primary search',2:'Fallback search'}[pass]||'Search pass '+pass)+': '+n).join('\n');
       // Generic audit JSON is not an Assay review schema: a model's unit may
       // describe distance rather than grade. Preserve every field and its meaning.
       const human=key=>String(key).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,c=>c.toUpperCase());
       const lines=[];
       const visit=(item,path)=>{
         if(item&&typeof item==='object'){
           const entries=Object.entries(item);
           if(!entries.length)lines.push(path+': not available');
           for(const [key,v] of entries)visit(v,path?path+' / '+human(key):human(key));
         }else lines.push(path+': '+(item==null?'not available':String(item)));
       };
       visit(parsed,'');return lines.join('\n');
     }
   }catch(_){/* ordinary prose */}
   return source;
 }
 function executive(pdf,module,brief,tr){
   pdf.insertPage(1);pdf.setPage(1);
   const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight(),width=W-30;
   header(pdf,module,tr('title'),tr('subtitle'));
   // A bounded cover is a reading aid, not a replacement for full notes/settings.
   // Every original section follows on page 2, including text shortened here.
   const text=(value,x,y,maxWidth,maxLines,size=10,color=ink,bold=false)=>{
     pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);
     let lines=pdf.splitTextToSize(readable(value),maxWidth);
     if(lines.length>maxLines){lines=lines.slice(0,maxLines);lines[maxLines-1]=lines[maxLines-1].replace(/\s+\S*$/,'')+'...';}
     pdf.text(lines,x,y,{lineHeightFactor:1.3});
   };
   text(tr('brief.scope'),15,48,width,1,8,muted,true);
   text(brief.scope,15,54,width,2,10);
   const gap=6,cell=(width-gap)/2,top=69,cardH=34;
   brief.metrics.slice(0,4).forEach((metric,i)=>{
     const x=15+(i%2)*(cell+gap),y=top+Math.floor(i/2)*(cardH+gap);
     pdf.setFillColor(245,248,249);pdf.roundedRect(x,y,cell,cardH,2,2,'F');
     text(metric.label,x+5,y+7,cell-10,1,8,muted,true);
     const value=ascii(metric.value==null?tr('brief.unavailable'):metric.value);
     pdf.setFont('helvetica','bold');let size=22;pdf.setFontSize(size);
     while(size>12&&pdf.getTextWidth(value)>cell-10){size--;pdf.setFontSize(size);}
     text(value,x+5,y+19,cell-10,1,size,teal,true);
     text(metric.detail||'',x+5,y+28,cell-10,1,8,muted);
   });
   const y=151,warning=brief.attentionRequired;
   pdf.setFillColor(...(warning?[255,246,225]:[230,245,242]));pdf.roundedRect(15,y,width,23,2,2,'F');
   text(tr('brief.readout'),20,y+7,width-10,1,8,warning?[125,83,8]:teal,true);
   text(brief.interpretation,20,y+14,width-10,2,10);
   text(tr('brief.attentionTitle'),15,185,width,1,9,teal,true);
   text(brief.attention,15,193,width,3,10);
   pdf.setDrawColor(219,228,231);pdf.line(15,210,W-15,210);
   text(tr('brief.nextTitle'),15,221,width,1,9,teal,true);
   text(brief.next,15,229,width,3,11);
   text(tr('brief.limits'),15,H-38,width,2,9,muted);
   text(tr('brief.details'),15,H-23,width,1,8,teal,true);
   window._reportBriefSnapshot={module,...brief,detailStartPage:2};
 }
 function prepend(pdf,module,sections,brief){
   const prefix={Core:'core',Assay:'asy',Resource:'res'}[module],tr=key=>ascii(window.__t(prefix+'.reportSummary.'+key));
   window._reportExecutiveSnapshot={module,sections:sections.map(row=>row.map(ascii))};
   if(brief){
     executive(pdf,module,brief,tr);
     cards(pdf,module,window._reportExecutiveSnapshot.sections,{insert:true,afterPage:1,title:tr('brief.detailTitle'),subtitle:'Orebit '+module+' | '+tr('subtitle')});
   }else cards(pdf,module,window._reportExecutiveSnapshot.sections,{insert:true,executive:true,title:tr('title'),subtitle:'Orebit '+module+' | '+tr('subtitle')});
 }
 // Keep JSON in the downloadable machine record; reports use labelled values.
 // Recorded labels belong to the review snapshot, including a stale review.
 // Legacy records remain readable through generic names without discarding fields.
 function formatParameters(parameters){
   const tr=key=>window.__t('asy.workflow.pdf.'+key);
   const human=key=>String(key).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,c=>c.toUpperCase());
   const names={element:tr('element'),unit:tr('unit'),scope:tr('scope'),controls:tr('controls'),actualDomain:tr('domain'),actualTreatment:tr('treatment'),composite:tr('composite'),length:tr('length'),minimumTail:tr('tail'),breakAtLithology:tr('breakLithology')};
   const scalar=value=>value==null||value===''?tr('none'):typeof value==='boolean'?tr(value?'yes':'no'):String(value);
   const lines=[];
   const visit=(value,path)=>{
     if(Array.isArray(value)){
       if(value.every(item=>item==null||typeof item!=='object'))lines.push(path+': '+value.map(scalar).join(', '));
       else value.forEach((item,i)=>visit(item,path+' '+(i+1)));
     }else if(value&&typeof value==='object'){
       const entries=Object.entries(value);
       if(!entries.length)lines.push(path+': '+tr('none'));
       for(const [key,item] of entries)visit(item,path+' / '+human(key));
     }else lines.push(path+': '+scalar(value).replace(/^#\s*/gm,'').trim());
   };
   for(const [key,value] of Object.entries(parameters||{})){
     if(key==='controlLabels')continue;
     if(key==='controls'&&value&&typeof value==='object'){
       for(const [id,item] of Object.entries(value))visit(item,parameters.controlLabels?.[id]||human(id));
       if(!Object.keys(value).length)lines.push(names.controls+': '+tr('none'));
     }else if(key==='unit')visit(value?unitLabel(value):value,names.unit);
     else if(key==='composite'&&value&&typeof value==='object'){
       for(const [field,item] of Object.entries(value))visit(item,names.composite+' / '+(names[field]||human(field)));
     }else visit(value,names[key]||human(key));
   }
   return lines.join('\n');
 }
 function interpretation(pdf,module,record){
   if(!record||!Array.isArray(record.stages))return;
   window._reportInterpretationSnapshot=record;
   const tr=key=>ascii(window.__t('asy.workflow.'+key)),active=record.stages.filter(r=>r.parameters||r.note),pending=record.stages.filter(r=>!r.parameters&&!r.note);
   const rows=active.map(r=>{
     const status=tr(r.status==='not-reviewed'?'notReviewed':r.status);
     const body=[status,r.reviewedAt?'Reviewed at: '+r.reviewedAt:'',r.insight||'',r.note?'Interpretation: '+r.note:'Interpretation: no note provided',r.parameters?'Recorded settings (at review):\n'+formatParameters(r.parameters):'No reviewed settings recorded'].filter(Boolean).join('\n\n');
     return [r.title,body];
   });
   if(pending.length)rows.push([tr('notReviewed'),pending.map(r=>r.title).join(', ')]);
   rows.unshift([tr('reviewRecord'),'Dataset: '+ascii(record.dataset?.name)+' | '+(record.dataset?.rows||0)+' rows. Only an explicit review records settings. Stale reviews refer to an earlier data/parameter state; re-review before relying on them. Optional tools are not a prerequisite for export.']);
   cards(pdf,module,rows,{title:tr('reviewRecord'),subtitle:'Orebit Assay | Stage decisions, notes and actual recorded settings'});
 }
 function footers(pdf,module){
   pdf.setProperties({title:'Orebit '+module+' screening report',author:'Orebit',subject:'Results, assumptions, interpretation and calculation audit',keywords:'screening, geology, due diligence'});
   const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight(),n=pdf.internal.getNumberOfPages();
   const seen=new Set();
   if(pdf.outline){for(let i=1;i<=n;i++){const title=pdf.internal.getPageInfo(i).pageContext.orebitSectionTitle;if(title&&!seen.has(title)){pdf.outline.add(null,title,{pageNumber:i});seen.add(title);}}}
   for(let i=1;i<=n;i++){
     pdf.setPage(i);pdf.setFillColor(255);pdf.rect(10,H-14,W-20,10,'F');pdf.setDrawColor(219,228,231);pdf.line(15,H-15,W-15,H-15);
     pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(...muted);pdf.text('Orebit '+module+' | Screening | '+new Date().toISOString().slice(0,10),15,H-9);pdf.text(i+' / '+n,W-15,H-9,{align:'right'});
   }
   pdf.setPage(n);
 }
 function unitLabel(unit){
   const labels={gpt:'g/t',pct:'%',kgm3:'kg/m3',gm3:'g/m3',unitless:''};
   return Object.prototype.hasOwnProperty.call(labels,unit)?labels[unit]:String(unit||'');
 }
 async function save(pdf,module,filename){
   footers(pdf,module);const data=pdf.output('datauristring');
   try{await window.orebitSaveFile(filename,data,'application/pdf');}
   catch(error){console.warn('PDF bridge failed, jsPDF fallback:',error);pdf.save(filename);}
   if(typeof window._recordExport==='function')window._recordExport('PDF','Orebit '+module+' - PDF Report',{filename,mime:'application/pdf',content:data.length<=1900000?data:''});
 }
 // Carry source-declared exclusions through the CSV chain; this is provenance,
 // never a claim that a downstream app independently validated the raw source.
 function sourceScope(meta){
   const line=Array.isArray(meta?.raw)?meta.raw.find(row=>typeof row==='string'&&row.startsWith('validation-scope: {')):null;
   if(!line)return {lines:[],summary:''};
   try{const r=JSON.parse(line.slice('validation-scope: '.length));
     if(r.schema!=='orebit-core-validation-scope'||r.version!==1||!Array.isArray(r.included)||!Array.isArray(r.excluded)||typeof r.note!=='string')return {lines:[],summary:''};
     const id=document.documentElement.lang==='id';
     return {lines:['# '+line],summary:(id?'Lingkup sumber Core: ':'Core source scope: ')+r.included.length+(id?' lubang dipakai; ':' holes retained; ')+r.excluded.length+(id?' baris sumber dikecualikan. Alasan: ':' source records excluded. Reason: ')+r.note};
   }catch(_error){return {lines:[],summary:''};}
 }
 window.OrebitScreeningReport={prepare,append,prepend,interpretation,formatParameters,unitLabel,quantity,save,sourceScope};
})();
