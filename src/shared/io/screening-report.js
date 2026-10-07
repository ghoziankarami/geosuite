(function () {
 const ascii = value => String(value == null ? 'not available' : value).replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/×/g,'x').replace(/→/g,'->').replace(/[–—]/g,'-').replace(/³/g,'3').replace(/²/g,'2').replace(/°/g,' deg').replace(/[^\x20-\x7e\n]/g,'');
 function append(pdf, module, rows) {
   window._reportAuditSnapshot = {module,rows:rows.map(row=>row.map(ascii)),generated:new Date().toISOString()};
   const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight();let y=35;
   const page=()=>{pdf.addPage();pdf.setFillColor(0,128,128);pdf.rect(0,0,W,25,'F');pdf.setTextColor(255);pdf.setFont('helvetica','bold');pdf.setFontSize(14);pdf.text('Screening due-diligence insight',15,13);pdf.setFontSize(9);pdf.text('Orebit '+module+' - data, assumptions and calculation audit',15,20);pdf.setTextColor(15,23,42);y=35;};
   page();
   for(const [label,value] of window._reportAuditSnapshot.rows){
     pdf.setFont('helvetica','bold');pdf.setFontSize(9);const lines=pdf.splitTextToSize(label+': '+value,W-30);
     for(const line of lines){if(y>H-24)page();pdf.text(line,15,y);y+=4.5;pdf.setFont('helvetica','normal');}y+=3;
   }
   const n=pdf.internal.getNumberOfPages();
   for(let i=1;i<=n;i++){pdf.setPage(i);pdf.setFillColor(255);pdf.rect(10,H-12,W-20,8,'F');pdf.setTextColor(120);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text('Orebit '+module+' - '+new Date().toISOString().slice(0,10),15,H-8);pdf.text('Page '+i+' of '+n,W-15,H-8,{align:'right'});}
 }
 function prepend(pdf, module, sections) {
   const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight();
   const prefix={Core:'core',Assay:'asy',Resource:'res'}[module];
   const tr=key=>ascii(window.__t(prefix+'.reportSummary.'+key));
   window._reportExecutiveSnapshot={module,sections:sections.map(row=>row.map(ascii))};
   let pageIndex=1,y=36;
   const page=()=>{
     pdf.insertPage(pageIndex++);pdf.setPage(pageIndex-1);
     pdf.setFillColor(0,128,128);pdf.rect(0,0,W,26,'F');
     pdf.setTextColor(255);pdf.setFont('helvetica','bold');pdf.setFontSize(17);
     pdf.text(tr('title'),15,13);
     pdf.setFont('helvetica','normal');pdf.setFontSize(9);
     pdf.text('Orebit '+module+' | '+tr('subtitle'),15,21);
     pdf.setTextColor(15,23,42);y=37;
   };
   page();
   for(const [label,value] of window._reportExecutiveSnapshot.sections){
     pdf.setFont('helvetica','normal');pdf.setFontSize(10);
     const lines=pdf.splitTextToSize(value,W-38);
     if(y+12+lines.length*5>H-23)page();
     pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.setTextColor(0,110,110);
     pdf.text(label,15,y);y+=7;
     pdf.setFont('helvetica','normal');pdf.setFontSize(10);pdf.setTextColor(15,23,42);
     for(const line of lines){if(y>H-24)page();pdf.text(line,19,y);y+=5;}
     y+=8;
   }
   pdf.setPage(pdf.internal.getNumberOfPages());
 }
 function unitLabel(unit) {
   const labels={gpt:'g/t',pct:'%',kgm3:'kg/m3',gm3:'g/m3',unitless:''};
   return Object.prototype.hasOwnProperty.call(labels,unit)?labels[unit]:String(unit||'');
 }
 async function save(pdf,module,filename) {
   const data=pdf.output('datauristring');
   try { await window.orebitSaveFile(filename,data,'application/pdf'); }
   catch(error) { console.warn('PDF bridge failed, jsPDF fallback:',error);pdf.save(filename); }
   if(typeof window._recordExport==='function')window._recordExport('PDF','Orebit '+module+' - PDF Report',{
     filename,mime:'application/pdf',content:data.length<=1900000?data:''
   });
 }
 window.OrebitScreeningReport={append,prepend,unitLabel,save};
})();
