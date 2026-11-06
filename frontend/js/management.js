import {api} from './api.js';
import {esc,date,badge,empty,modal,toast,size,icon} from './ui.js';
import {openFile} from './uploads.js';

const heading=(title,subtitle)=>`<div class="page-heading"><div><span class="eyebrow">DNASSETS WORKSPACE</span><h1>${title}<span class="heading-dot">.</span></h1><p>${subtitle}</p></div></div>`;
const paramsFrom=id=>new URLSearchParams(decodeURIComponent(id||''));
const hash=(page,params)=>`#${page}/${encodeURIComponent(params.toString())}`;
const table=(headers,rows)=>`<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}">No matching records.</td></tr>`}</tbody></table></div>`;
const pager=(page,params,hasMore,limit)=>{const offset=Number(params.get('offset')||0),prev=new URLSearchParams(params),next=new URLSearchParams(params);prev.set('offset',Math.max(0,offset-limit));next.set('offset',offset+limit);return `<div class="panel-footer button-group">${offset?`<a class="button" href="${hash(page,prev)}">Previous</a>`:''}<span>Showing ${offset+1} onwards</span>${hasMore?`<a class="button" href="${hash(page,next)}">Next</a>`:''}</div>`;};
const field=(name,label,params,type='search')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(params.get(name)||'')}" ${type==='search'?'maxlength="160"':''}></label>`;
export async function renderManagement(page,id,state) {
  if(state.preview)return empty('Sign in required','Connect your database to manage records.');
  const params=paramsFrom(id);
  if(page==='history') {
    params.set('limit','25');const data=await api('/uploads/history?'+params);
    return heading('Upload History','Uploader identities and review decisions, recorded automatically. Dates use your device’s local time; date filters use UTC days.')+
    `<section class="panel"><form id="record-filters" class="record-filters">
      ${field('project','Project name',params)}${field('survey','Survey number',params)}${field('uploader','Uploaded username',params)}${field('reviewer','Reviewer username',params)}${field('from','Uploaded from',params,'date')}${field('to','Uploaded through',params,'date')}
      <label>Verification status<select name="status">${['','Pending','Verified','Rejected'].map(s=>`<option value="${s}" ${params.get('status')===s?'selected':''}>${s||'All statuses'}</option>`).join('')}</select></label>
      <div class="button-group"><button class="button primary">Apply filters</button><a class="button" href="#history">Clear</a></div></form>
      <div class="section-top"><h2>${data.total} upload records</h2><div class="button-group"><button class="button" data-history-export="csv">Export CSV</button><button class="button" data-history-export="xlsx">Export Excel</button></div></div>
      ${table(['Project','Survey','Document','File name','Uploaded by','Upload date','Reviewed by','Review date','Status','Remarks','Action'],data.history.map(h=>`<tr>
        <td>${esc(h.project_name||'Unassigned')}</td><td>${esc(h.survey_number)}</td><td>${esc(h.document_name)}</td><td>${esc(h.original_file_name)}${h.removed_at?'<small class="table-small">Removed · history retained</small>':''}</td>
        <td>${esc(h.user_name)}<small class="table-small record-id">${esc(h.user_id)}</small></td><td>${date(h.upload_timestamp)}</td><td>${esc(h.reviewer_name||'Not reviewed')}</td><td>${date(h.reviewed_at)}</td><td>${badge(h.verification_status)}</td><td class="record-remarks">${esc(h.review_remarks||'—')}</td>
        <td><div class="button-group">${h.upload_id?`<button class="text-button" data-record-view="${h.upload_id}">View</button><button class="text-button" data-record-download="${h.upload_id}">Download</button>`:'Unavailable'}${h.property_document_id?`<button class="text-button" data-review-events="${h.property_document_id}">Review history</button>`:''}</div></td></tr>`))}
      ${pager(page,params,data.hasMore,25)}</section>`;
  }
  if(page==='audit') {
    if(state.profile.role!=='admin')return empty('Administrator access required','Audit records are protected.');
    params.set('limit','50');const data=await api('/audit?'+params);
    return heading('Audit Logs','An append-only record of changes. These records remain available after deletion and database reset.')+
      `<section class="panel"><form id="record-filters" class="record-filters">${field('search','Project, survey or username',params)}${field('action','Action',params)}<button class="button primary">Search</button></form>`+
      table(['Date & time','Username / role','Action','Project / survey','Document ID','IP address','Description'],data.rows.map(a=>`<tr><td>${date(a.created_at)}</td><td>${esc(a.actor_name)}<small class="table-small">${esc(a.actor_role)} · ${esc(a.actor_id)}</small></td><td>${esc(a.action)}</td><td>${esc(a.project_name)}<small class="table-small">${esc(a.survey_number)}</small></td><td class="record-id">${esc(a.property_document_id||'—')}</td><td>${esc(a.ip_address||'Not recorded')}</td><td>${esc(a.description)}</td></tr>`))+pager(page,params,data.rows.length===50,50)+'</section>';
  }
  if(page==='database') {
    if(state.profile.role!=='admin')return empty('Administrator access required','Database management is restricted to administrators.');
    const [counts,projects,archived,properties]=await Promise.all([api('/management/summary'),api('/projects'),api('/projects?archived=1'),api('/properties')]);
    const allProjects=[...projects,...archived];
    return heading('Database Management','Inspect affected records, create a backup, and explicitly confirm any destructive action.')+
      `<div class="stat-grid">${[['Projects',counts.projects],['Survey numbers',counts.surveys],['Uploaded documents',counts.uploads],['Verification records',counts.verifications]].map(([label,n])=>`<article class="stat"><div class="stat-label">${label}</div><div class="stat-value">${n}</div></article>`).join('')}</div>
      <section class="panel management-panel"><h2>Backup & retention</h2><p>Automatic backup before deletion: <strong>${counts.backupEnabled?'Enabled':'Disabled by server configuration'}</strong>. Estimated known file storage: <strong>${size(counts.storage_bytes)}</strong>.</p><p>Individual deletions keep upload, review and audit history. Reset removes upload and review history but preserves audit logs, accounts, settings and document categories. File removal failures remain queued for retry.</p></section>
      ${Object.keys(counts.pendingOperations||{}).length?`<section class="panel management-panel"><h2>Pending file removals</h2>${Object.entries(counts.pendingOperations).map(([operation,n])=>`<p>${n} objects pending <button class="button" data-cleanup-operation="${operation}">Retry file removal</button></p>`).join('')}</section>`:''}
      <section class="panel management-panel"><h2>Delete a selected record</h2><div class="form-grid"><label>Project<select id="delete-project"><option value="">Select a project</option>${allProjects.map(p=>`<option value="${p.id}">${esc(p.project_name)}${p.archived_at?' (archived)':''}</option>`).join('')}</select></label><button class="button danger" data-delete-scope="project">Review project deletion</button>
      <label>Survey number<select id="delete-survey"><option value="">Select a survey</option>${properties.map(p=>`<option value="${p.id}">${esc(p.property_name)} · ${esc(p.survey_number)}${p.subdivision_number?'/'+esc(p.subdivision_number):''}</option>`).join('')}</select></label><button class="button danger" data-delete-scope="survey">Review survey deletion</button></div><p class="muted">Archived surveys can also be deleted from their checklist.</p></section>
      <section class="panel management-panel danger-zone"><h2>Delete All Projects & Survey Numbers</h2><p>Remove all projects, surveys, checklists and associated files, including archived projects. Preserve historical uploads, reviews and audit records.</p><button class="button danger" data-delete-scope="all">Review deletion of all projects</button></section>
      <section class="panel management-panel danger-zone"><h2>Reset Survey Database</h2><p>Also clear survey upload history, review records, analyses, extracted survey data and tracked temporary storage. Users, accounts, document categories, settings and audit logs remain.</p><button class="button danger" data-delete-scope="reset">Review database reset</button></section>`;
  }
  return '';
}

export function reviewRows(rows) {
  return table(['Review date','Project / survey','Document','Reviewer','Decision','Remarks'],rows.map(r=>`<tr><td>${date(r.reviewed_at)}</td><td>${esc(r.project_name)}<small class="table-small">${esc(r.survey_number)}</small></td><td>${esc(r.document_name)}</td><td>${esc(r.reviewer_name)}<small class="table-small record-id">${esc(r.reviewer_id)}</small></td><td>${badge(r.verification_status)}</td><td class="record-remarks">${esc(r.remarks)}${r.rejection_reason?`<small class="table-small">${esc(r.rejection_reason)}</small>`:''}</td></tr>`));
}
export async function renderRecentActivity() {
  const data=await api('/dashboard/activity');
  return `<section class="panel"><div class="section-top"><h2>Recent uploads</h2><a class="text-link" href="#history">Full upload history →</a></div>${table(['File','Project / survey','Uploaded by','Date'],data.uploads.map(h=>`<tr><td>${esc(h.original_file_name)}</td><td>${esc(h.project_name)} · ${esc(h.survey_number)}</td><td>${esc(h.user_name)}</td><td>${date(h.upload_timestamp)}</td></tr>`))}</section>
  <section class="panel"><div class="section-top"><h2>Recent reviews</h2><a class="text-link" href="#documents">Document checklist →</a></div>${reviewRows(data.reviews)}</section>
  ${data.activities.length?`<section class="panel"><div class="section-top"><h2>Recent activities</h2><a class="text-link" href="#audit">All audit logs →</a></div>${table(['Date','Action','By','Project'],data.activities.map(a=>`<tr><td>${date(a.created_at)}</td><td>${esc(a.description)}</td><td>${esc(a.actor_name)}</td><td>${esc(a.project_name)}</td></tr>`))}</section>`:''}`;
}

export async function confirmDeletion(scope,id,refresh) {
  if(['project','survey'].includes(scope)&&!id)throw new Error('Select a record first.');
  const plan=await api('/management/preview',{method:'POST',body:{scope,id:id||null}});
  const counts=[['Projects',plan.projects],['Survey numbers',plan.surveys],['Checklist records',plan.checklists],['Uploaded documents',plan.uploads],['Analyses',plan.analyses],['Extracted survey entries',plan.extracted],['Memberships',plan.memberships],['Upload history',plan.history],['Review records',plan.verifications],['Storage objects',plan.storageObjects]];
  const dialog=modal('Review '+(scope==='reset'?'database reset':'deletion'),`<form id="confirm-delete"><p class="deletion-warning">This permanently removes the selected application records and files. Review these counts before continuing.</p><dl class="deletion-counts">${counts.map(([label,n])=>`<div><dt>${label}${['Upload history','Review records'].includes(label)&&scope!=='reset'?' (retained)':''}</dt><dd>${n}</dd></div>`).join('')}<div><dt>Estimated storage</dt><dd>${size(plan.storage_bytes)}</dd></div></dl><p>${esc(plan.policy)}</p><p>Backup before deletion: <strong>${plan.backupEnabled?'Enabled; failure cancels deletion':'Disabled by administrator configuration'}</strong>.</p><label>Type <strong>${plan.phrase}</strong><input name="phrase" autocomplete="off" required aria-label="Confirmation phrase"></label><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="button" data-cancel>Cancel</button><button class="button danger">Continue to final confirmation</button></div></form>`);
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=e=>{
    e.preventDefault();const phrase=new FormData(e.target).get('phrase');
    if(phrase!==plan.phrase){dialog.querySelector('.form-error').textContent='Type the exact phrase shown above.';return;}
    dialog.innerHTML=`<div class="modal-head"><h2 id="modal-title">Final confirmation</h2></div><p class="deletion-warning">Delete ${plan.projects} projects, ${plan.surveys} surveys and ${plan.uploads} uploaded documents?</p><p>${esc(plan.policy)}</p><p>Records changed since preview will cancel this operation. This confirmation expires after five minutes.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button" data-cancel>Cancel</button><button class="button danger" data-final-delete>Confirm permanent ${scope==='reset'?'reset':'deletion'}</button></div>`;
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.querySelector('[data-final-delete]').onclick=async e=>{
      const button=e.currentTarget;button.disabled=true;button.textContent='Backing up and processing…';dialog.querySelector('[data-cancel]').disabled=true;
      try {
        const result=await api('/management/execute',{method:'POST',body:{token:plan.token,phrase,confirmed:true}});
        dialog.innerHTML=`<div class="modal-head"><h2 id="modal-title">Operation complete</h2></div><p>Application records were removed. User accounts and audit logs remain.</p>${result.backupPath?`<p>Backup location:</p><code class="record-id">${esc(result.backupPath)}</code>`:''}<p>${result.storage.removed} storage objects removed; ${result.storage.pending} pending.</p>${result.storage.pending?'<button class="button" data-retry-storage>Retry pending file removal</button>':''}<div class="modal-actions"><button class="button primary" data-close>Done</button></div>`;
        dialog.querySelector('[data-close]').onclick=()=>{dialog.close();location.hash='#database';refresh();};
        dialog.querySelector('[data-retry-storage]')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{const retry=await api(`/management/storage/${result.operation_id}/retry`,{method:'POST'});toast(`${retry.pending} storage objects still pending.`);}catch(error){toast(error.message,true);}finally{e.target.disabled=false;}});
      } catch(error){dialog.querySelector('.form-error').textContent=error.message;button.textContent='Preview again to retry';dialog.querySelector('[data-cancel]').disabled=false;}
    };
  };
}

export function wireManagement(page,id,state,refresh) {
  const protect=fn=>async event=>{try{await fn(event);}catch(error){toast(error.message,true);}};
  document.querySelector('#record-filters')?.addEventListener('submit',e=>{e.preventDefault();const params=new URLSearchParams();for(const [k,v] of new FormData(e.target))if(v)params.set(k,v);location.hash=hash(page,params);});
  document.querySelectorAll('[data-history-export]').forEach(b=>b.onclick=protect(async()=>{b.disabled=true;try{const params=paramsFrom(id);params.delete('offset');params.delete('limit');params.set('format',b.dataset.historyExport);const blob=await api('/uploads/history/export?'+params,{blob:true});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='upload-history.'+b.dataset.historyExport;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}finally{b.disabled=false;}}));
  document.querySelectorAll('[data-record-view]').forEach(b=>b.onclick=protect(()=>openFile(b.dataset.recordView)));
  document.querySelectorAll('[data-record-download]').forEach(b=>b.onclick=protect(()=>openFile(b.dataset.recordDownload,true)));
  document.querySelectorAll('[data-review-events]').forEach(b=>b.onclick=protect(async()=>{
    let offset=0;const show=async()=>{const data=await api(`/reviews?document_id=${b.dataset.reviewEvents}&offset=${offset}&limit=50`);const d=modal('Review history',reviewRows(data.rows)+`<div class="modal-actions"><button class="button" data-prev ${offset?'':'disabled'}>Previous</button><button class="button" data-next ${data.rows.length===50?'':'disabled'}>Next</button></div>`);d.querySelector('[data-prev]').onclick=protect(()=>{offset-=50;return show();});d.querySelector('[data-next]').onclick=protect(()=>{offset+=50;return show();});};await show();
  }));
  document.querySelectorAll('[data-delete-scope]').forEach(b=>b.onclick=protect(()=>confirmDeletion(b.dataset.deleteScope,b.dataset.targetId||document.querySelector('#delete-'+b.dataset.deleteScope)?.value,refresh)));
  document.querySelectorAll('[data-cleanup-operation]').forEach(b=>b.onclick=protect(async()=>{b.disabled=true;try{const r=await api(`/management/storage/${b.dataset.cleanupOperation}/retry`,{method:'POST'});toast(`${r.pending} file removals pending.`);await refresh();}finally{b.disabled=false;}}));
  document.querySelectorAll('[data-archive-project]').forEach(b=>b.onclick=protect(async()=>{b.disabled=true;await api(`/management/projects/${b.dataset.archiveProject}/archive`,{method:'POST',body:{archived:b.dataset.archived!=='true'}});toast(b.dataset.archived==='true'?'Project restored.':'Project archived.');await refresh();}));
}
