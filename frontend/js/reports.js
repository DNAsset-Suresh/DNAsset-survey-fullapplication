import { api } from './api.js';
import { esc,icon,toast } from './ui.js';

export function renderReports(properties){
  return `<div class="page-heading"><div><span class="eyebrow">RECORDS YOU CAN SHARE</span><h1>Reports<span class="heading-dot">.</span></h1><p>Turn property records into clear, portable checklists.</p></div></div>
  <section class="panel report-options"><h2>Build your report</h2>
  <div class="form-grid"><label>Property scope<select id="report-property"><option value="">All accessible survey numbers</option>${properties.map(p=>`<option value="${p.id}">${esc(p.survey_number)} · ${esc(p.property_name||p.village||'Details pending')}</option>`).join('')}</select></label><label>Document status<select id="report-filter"><option value="all">Complete checklist</option><option value="pending">Pending collection</option><option value="verified">Verified documents</option><option value="rejected">Rejected documents</option></select></label></div>
  <div class="report-formats">
    <article>${icon('documents')}<h3>PDF checklist</h3><p>A formatted record of document status, files, reviewer findings, and progress.</p><button class="button primary" data-export="pdf">${icon('download')} Download PDF</button></article>
    <article>${icon('reports')}<h3>Excel-compatible CSV</h3><p>All report fields in a spreadsheet-friendly format for filtering and analysis.</p><button class="button" data-export="csv">${icon('download')} Download CSV</button></article>
    <article>${icon('verification')}<h3>Email report (Gmail)</h3><p>Send the checklist and verification report directly to any email address via Gmail.</p><button class="button" data-email-report>${icon('arrow')} Email report</button></article>
    <article>${icon('survey')}<h3>Print this view</h3><p>A clean survey register with collection and verification percentages.</p><button class="button" data-print>Print register</button></article>
  </div></section>
  <section class="panel print-register"><div class="section-top"><h2>Survey progress report</h2></div><div id="report-table"></div></section>`;
}

export async function exportReport(format,propertyId='',filter='all',projectId=''){
  const query=new URLSearchParams({format,filter});
  if(propertyId) query.set('property_id',propertyId);
  if(projectId) query.set('project_id',projectId);
  const blob=await api('/reports/export?'+query,{blob:true});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`dnassets-${filter}.${format}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Report downloaded.');
}

export async function emailReport(propertyId='',filter='all',defaultEmail='dna.space.sm@gmail.com',projectId=''){
  const targetEmail=window.prompt('Enter recipient email address:',defaultEmail);
  if(!targetEmail)return;
  toast('Sending report via Gmail…');
  try{
    await api('/reports/email',{method:'POST',body:{property_id:propertyId||null,project_id:projectId||null,filter,format:'pdf',to:targetEmail}});
    toast(`Report emailed to ${targetEmail}!`);
  }catch(error){
    toast(`Email failed: ${error.message}`,true);
  }
}
