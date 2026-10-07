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
   const W=pdf.internal.pageSize.getWidth();
   pdf.setFillColor(...teal);pdf.rect(0,0,W,4,'F');
   pdf.setFont('helvetica','bold');pdf.setTextColor(...teal);pdf.setFontSize(10);pdf.text('OREBIT / '+ascii(module).toUpperCase(),15,16);
   pdf.setTextColor(...ink);pdf.setFontSize(19);pdf.text(ascii(title),15,28);
   pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.setTextColor(...muted);pdf.text(ascii(subtitle),15,36);
   pdf.setDrawColor(219,228,231);pdf.line(15,41,W-15,41);
 }
 // Content is paginated before the footer. A long note/parameter record is never clipped.
 function cards(pdf,module,rows,opts={}){
   const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight();let y=49,index=0;
   const newPage=()=>{opts.insert?pdf.insertPage(++index):pdf.addPage();if(opts.insert)pdf.setPage(index);header(pdf,module,opts.title,opts.subtitle);y=49;};
   newPage();
   rows.forEach(([label,value],rowIndex)=>{
     const first=!!opts.executive&&rowIndex===0,bodySize=first?11:9.5,lineHeight=first?5.6:4.7;
     pdf.setFont('helvetica','normal');pdf.setFontSize(bodySize);
     const lines=pdf.splitTextToSize(ascii(value),W-46);
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
 function prepend(pdf,module,sections){
   const prefix={Core:'core',Assay:'asy',Resource:'res'}[module],tr=key=>ascii(window.__t(prefix+'.reportSummary.'+key));
   window._reportExecutiveSnapshot={module,sections:sections.map(row=>row.map(ascii))};
   cards(pdf,module,window._reportExecutiveSnapshot.sections,{insert:true,executive:true,title:tr('title'),subtitle:'Orebit '+module+' | '+tr('subtitle')});
 }
 function interpretation(pdf,module,record){
   if(!record||!Array.isArray(record.stages))return;
   window._reportInterpretationSnapshot=record;
   const tr=key=>ascii(window.__t('asy.workflow.'+key)),active=record.stages.filter(r=>r.parameters||r.note),pending=record.stages.filter(r=>!r.parameters&&!r.note);
   const rows=active.map(r=>{
     const status=tr(r.status==='not-reviewed'?'notReviewed':r.status);
     const body=[status,r.reviewedAt?'Reviewed at: '+r.reviewedAt:'',r.insight||'',r.note?'Interpretation: '+r.note:'Interpretation: no note provided',r.parameters?'Recorded settings (at review):\n'+JSON.stringify(r.parameters,null,2):'No reviewed settings recorded'].filter(Boolean).join('\n\n');
     return [r.title,body];
   });
   if(pending.length)rows.push([tr('notReviewed'),pending.map(r=>r.title).join(', ')]);
   rows.unshift([tr('reviewRecord'),'Dataset: '+ascii(record.dataset?.name)+' | '+(record.dataset?.rows||0)+' rows. Only an explicit review records settings. Stale reviews refer to an earlier data/parameter state; re-review before relying on them. Optional tools are not a prerequisite for export.']);
   cards(pdf,module,rows,{title:tr('reviewRecord'),subtitle:'Orebit Assay | Stage decisions, notes and actual recorded settings'});
 }
 function footers(pdf,module){
   const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight(),n=pdf.internal.getNumberOfPages();
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
 window.OrebitScreeningReport={prepare,append,prepend,interpretation,unitLabel,save};
})();
