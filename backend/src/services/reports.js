import PDFDocument from 'pdfkit';

export function reportRows(checklists,filter='all') {
  return checklists.flatMap(({property:p,documents,progress})=>documents
    .filter(d=>filter==='all' || (filter==='pending' ? !d.is_collected || !d.files.length : d.verification_status.toLowerCase()===filter))
    .map(d=>({survey:p.survey_number,property:p.property_name,location:[p.village,p.taluk,p.district].filter(Boolean).join(', ') || 'To be entered',
      category:d.category.name,collected:d.is_collected&&d.files.length?'Yes':'No',status:d.verification_status,match:d.survey_match_status,
      files:d.files.map(f=>f.original_file_name).join('; '),reviewer:d.reviewer?.full_name || '',reviewed_at:d.reviewed_at||'',remarks:d.remarks,rejection:d.rejection_reason,
      collection:`${progress.collection_percentage}%`,verification:`${progress.verification_percentage}%`,updated:d.updated_at})));
}
export function csvReport(rows) {
  const keys=['survey','property','location','category','collected','status','match','files','reviewer','remarks','rejection','collection','verification','updated','reviewed_at'];
  const escape=value=>{let s=String(value??''); if(/^[\s]*[=+\-@]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"';};
  return '\ufeff'+[keys,...rows.map(r=>keys.map(k=>r[k]))].map(row=>row.map(escape).join(',')).join('\r\n');
}
export function pdfReport(rows) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:'DNAssets Survey Checklist',Author:'DNAssets'}});
    if(process.env.PDF_FONT_PATH) doc.font(process.env.PDF_FONT_PATH);
    const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const header=()=>{doc.fillColor('#123b3b').fontSize(22).text('DNAssets');doc.fillColor('#18252e').fontSize(13).text('Survey number verification & document report');doc.moveDown();};
    header();doc.fontSize(9).fillColor('#52616b').text(`Generated ${new Date().toISOString()} | ${rows.length} checklist entries`);doc.moveDown();
    if(!rows.length) doc.text('No documents match this report.');
    for(const row of rows) {
      const lines=[`${row.survey} | ${row.category}`,`${row.property || 'Property name not entered'} | ${row.location}`,
        `Collected: ${row.collected} | Status: ${row.status} | Survey: ${row.match}`,
        `Files: ${row.files || 'None'}`,`Reviewer: ${row.reviewer || 'Not assigned'} | Review date: ${row.reviewed_at || 'Not reviewed'}`,
        `Remarks: ${row.remarks || '-'}${row.rejection ? '\nRejection reason: '+row.rejection : ''}`,
        `Collection: ${row.collection} | Verification: ${row.verification} | Updated: ${row.updated}`];
      if(doc.y>650) {doc.addPage();header();}
      doc.fontSize(11).fillColor('#123b3b').text(lines[0]);doc.fontSize(9).fillColor('#18252e');
      for(const line of lines.slice(1)) doc.text(line,{lineGap:3});
      doc.moveDown();
    }
    const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#667').text(`DNAssets • ${i+1} / ${range.count}`,42,800,{lineBreak:false});}
    doc.end();
  });
}
