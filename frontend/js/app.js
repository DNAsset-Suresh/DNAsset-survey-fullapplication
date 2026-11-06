import './firebase.js';
import {renderManagement,wireManagement,renderRecentActivity,reviewRows} from './management.js';
import { api, hasSession } from './api.js';
import { loginScreen, logout } from './auth.js';
import { esc, icon, toast, modal, date, badge, empty, meter } from './ui.js';
import { previewProperty, previewChecklist } from './preview.js';
import { renderDashboard, surveyTable, locationText } from './dashboard.js';
import { propertyForm } from './surveys.js';
import { renderChecklist, reviewDialog } from './checklist.js';
import { uploadFiles, openFile } from './uploads.js?v=1.0.1';
import { renderReports, exportReport, emailReport } from './reports.js';
import { projectModal, surveyModal, renderProjectTable, renderProjectDetail, renderStatusMatrix, renderLockedProjectScreen, unlockProjectModal } from './projects.js';

const state = {
  preview: false,
  projects: [],
  properties: [],
  currentProject: null,
  currentMatrix: null,
  profile: { full_name: 'Preview workspace', role: 'admin' },
  config: { maxFileBytes: 20971520 }
};

const navigation = [
  ['dashboard', 'Dashboard'],
  ['projects', 'Projects'],
  ['surveys', 'Survey numbers'],
  ['documents', 'Document Checklist'],
  ['history', 'Upload History'],
  ['verification', 'Review Management'],
  ['audit', 'Audit Logs'],
  ['users', 'User Management'],
  ['database', 'Database Management'],
  ['reports', 'Reports'],
  ['settings', 'Settings']
];

const navIcon = {
  dashboard: 'dashboard',
  projects: 'folder',
  surveys: 'survey',
  documents: 'documents',
  verification: 'verification',
  reports: 'reports',
  settings: 'settings'
};

let renderVersion = 0;
const previewNotice = () => toast('This is a read-only preview. Configure Supabase to save and manage records.');
const canEdit = () => !state.preview && !state.checklist?.property?.project_archived_at && state.profile?.role === 'admin';
const canAddSurvey = () => !state.preview && !state.checklist?.property?.project_archived_at && ['admin', 'reviewer'].includes(state.profile?.role);

function shell() {
  document.querySelector('#app').innerHTML = `
    <div class="workspace">
      <aside class="sidebar">
        <a href="#dashboard" class="brand">
          <img src="/favicon.svg" alt="">
          <span>DNAssets<small>PROPERTY INTELLIGENCE</small></span>
        </a>
        <div class="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          ${navigation.filter(([key])=>!['audit','users','database'].includes(key)||state.profile.role==='admin').map(([key, label]) => `
            <a href="#${key}" data-nav="${key}">
              ${icon(navIcon[key] || key)}
              <span>${label}</span>
              ${key === 'projects' ? `<span class="nav-count">${state.projects.length}</span>` : ''}
              ${key === 'surveys' ? `<span class="nav-count">${state.properties.length}</span>` : ''}
            </a>
          `).join('')}
        </nav>
        <div class="sidebar-bottom">
          <div class="secure-note">
            ${icon('verification')}
            <div>
              <strong>Built on trust.</strong>
              <small>Every record. Every review.</small>
            </div>
          </div>
          <div class="user-profile">
            <div class="avatar">${esc((state.profile.full_name || 'D').slice(0, 2).toUpperCase())}</div>
            <div>
              <strong>${esc(state.profile.full_name || 'DNAssets member')}</strong>
              <small>${state.preview ? 'Read-only preview' : esc(state.profile.role)}</small>
            </div>
            ${!state.preview ? `
              <button class="icon-button" id="edit-profile-btn" title="Change Name & Password" aria-label="Change Name and Password">${icon('edit')}</button>
              <button class="icon-button" id="logout" aria-label="Sign out">${icon('logout')}</button>
            ` : ''}
          </div>
        </div>
      </aside>

      <div class="workspace-main">
        <header class="topbar">
          <button class="icon-button mobile-menu" aria-label="Toggle navigation">${icon('menu')}</button>
          <div class="breadcrumb">Workspace <span>/</span> <strong id="breadcrumb-current">Dashboard</strong></div>
          <div class="topbar-right">
            ${!state.preview ? `<button class="button small-button ui-a36b1709" id="topbar-upload-history" title="View Document Upload History & Analysis">${icon('documents')} Upload History</button>` : ''}
            <span class="current-date">${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span>
            <span class="environment-pill"><i></i>${state.preview ? 'Preview workspace' : 'Secure workspace'}</span>
          </div>
        </header>
        ${state.preview ? '<div class="setup-banner"><span>Read-only preview · Connect Supabase to start saving property records.</span><a href="#settings">Setup details →</a></div>' : ''}
        <main id="main" tabindex="-1"></main>
        <footer class="app-footer">
          <span>DNAssets <span class="dot-divider">·</span> Project-wise survey number checklists.</span>
          <span>Survey verification & document tracking system</span>
        </footer>
      </div>
    </div>
  `;

  document.querySelector('.mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('mobile-open');
  document.querySelector('#logout')?.addEventListener('click', logout);
  document.querySelector('#edit-profile-btn')?.addEventListener('click', () => profileModal(state.profile, () => route()));
  document.querySelector('#topbar-upload-history')?.addEventListener('click', () => {location.hash='#history';});
}

async function loadData() {
  if (state.preview) {
    state.projects = [{
      id: 'preview-project-1',
      project_name: 'Green Valley',
      project_code: 'GV001',
      progress: { survey_count: 1, required: 7, collected: 0, pending: 7, verified: 0, collection_percentage: 0, verification_percentage: 0 }
    }];
    state.properties = [previewProperty];
    return;
  }
  const [projects, properties] = await Promise.all([
    api('/projects'),
    api('/properties')
  ]);
  state.projects = projects;
  state.properties = properties;
}

async function boot() {
  try {
    state.config = await api('/config', { publicRequest: true });
    state.preview = !state.config.configured;
    if (!state.preview && !hasSession()) {
      loginScreen(boot);
      return;
    }
    if (!state.preview) state.profile = await api('/me');
    await loadData();
    shell();
    await route(true);
  } catch (error) {
    if(error.status===401){loginScreen(boot);return;}
    document.querySelector('#app').innerHTML = `
      <div class="connection-error">
        <h1>We couldn’t open your workspace.</h1>
        <p>${esc(error.message)}</p>
        <button class="button primary" id="retry">Try again</button>
      </div>
    `;
    document.querySelector('#retry').onclick = boot;
  }
}

async function route(reuseData = false) {
  if (!document.querySelector('#main')) return;
  const version = ++renderVersion;
  const [page = 'dashboard', id] = (location.hash.slice(1) || 'dashboard').split('/');
  const active = page === 'survey' ? 'surveys' : page === 'project' ? 'projects' : page;

  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === active);
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  document.querySelector('.sidebar').classList.remove('mobile-open');

  const breadcrumbEl = document.querySelector('#breadcrumb-current');
  if (page === 'project') breadcrumbEl.textContent = 'Project Overview';
  else if (page === 'survey') breadcrumbEl.textContent = 'Survey Checklist';
  else breadcrumbEl.textContent = navigation.find(n => n[0] === page)?.[1] || 'Workspace';

  const main = document.querySelector('#main');
  main.setAttribute('aria-busy', 'true');
  main.innerHTML = '<div class="loading-state">Loading your records…</div>';

  try {
    if(reuseData!==true) await loadData();
    if (version !== renderVersion) return;
    let html = '';
    state.checklist = null;
    state.currentProject = null;
    state.currentMatrix = null;

    if (['history','audit','users','database'].includes(page)) {
      html=await renderManagement(page,id,state);
    } else if (page === 'dashboard') {
      const summary = state.preview ? { properties: 1, ...previewProperty.progress } : await api('/reports/summary');
      let matrix = null;
      if (!state.preview && state.projects.length) {
        try {
          matrix = await api(`/projects/${state.projects[0].id}/matrix`);
        } catch {
          matrix = null;
        }
      }
      html = renderDashboard(state.projects, state.properties, summary, matrix, state.profile?.role);
      if(!state.preview)html+=await renderRecentActivity();
    } else if (page === 'projects' || page === 'archives') {
      if(page==='archives')state.projects=await api('/projects?archived=1');
      html = `
        <div class="page-heading">
          <div>
            <span class="eyebrow">PROJECT MANAGEMENT</span>
            <h1>${page==='archives'?'Archived projects':'Projects'}<span class="heading-dot">.</span></h1>
            <p>Every project organizes multiple survey numbers with independent document checklists.</p>
          </div>
          <div class="button-group"><a class="button" href="${page==='archives'?'#projects':'#archives'}">${page==='archives'?'Active projects':'View archive'}</a>${page==='archives'?'':`<button class="button primary" data-add-project>${icon('plus')} Add New Project</button>`}</div>
        </div>

        <section class="panel">
          <div class="section-top">
            <div>
              <h2>All Projects <span class="count">${state.projects.length}</span></h2>
              <p>Top-level property ventures and consolidated progress.</p>
            </div>
            <label class="search-box">
              ${icon('search')}
              <input id="project-search" type="search" placeholder="Search projects by name, code, village…">
            </label>
          </div>
          <div id="project-results">
            ${renderProjectTable(state.projects, state.profile?.role)}
          </div>
        </section>
      `;
    } else if (page === 'project') {
      if (state.preview) throw new Error('Preview mode supports dashboard view.');
      try {
        const matrix=await api(`/projects/${encodeURIComponent(id)}/matrix`);
        const project={...matrix.project,progress:matrix.progress};
        state.currentProject = project;
        state.currentMatrix = matrix;
        breadcrumbEl.textContent = project.project_name || 'Project Details';
        html = renderProjectDetail(project, matrix, state);
        if(state.profile.role==='admin')html+=`<section class="panel management-panel"><h2>Project management</h2><div class="button-group"><button class="button" data-archive-project="${project.id}" data-archived="${Boolean(project.archived_at)}">${project.archived_at?'Restore project':'Archive project'}</button><button class="button danger" data-delete-scope="project" data-target-id="${project.id}">Review project deletion</button></div></section>`;
      } catch (err) {
        if (err.code === 'PROJECT_PASSWORD_REQUIRED' || err.status === 403) {
          const targetProj = state.projects.find(p => p.id === id) || { id, project_name: 'Protected Project' };
          breadcrumbEl.textContent = targetProj.project_name || 'Protected Project';
          html = renderLockedProjectScreen(targetProj);
          setTimeout(() => {
            unlockProjectModal(targetProj, () => route());
          }, 60);
        } else {
          throw err;
        }
      }
    } else if (page === 'surveys') {
      html = `
        <div class="page-heading">
          <div>
            <span class="eyebrow">YOUR SURVEY REGISTER</span>
            <h1>Survey numbers<span class="heading-dot">.</span></h1>
            <p>One place for every survey parcel and its document journey.</p>
          </div>
          <div class="button-group">
            <button class="button primary" data-add-survey>${icon('plus')} Add survey number</button>
          </div>
        </div>
        <section class="panel">
          <div class="section-top">
            <h2>All surveys <span class="count">${state.properties.length}</span></h2>
            <label class="search-box">
              ${icon('search')}
              <input id="survey-search" type="search" aria-label="Search survey numbers or locations" placeholder="Search survey or location…">
            </label>
          </div>
          <div id="survey-results">${surveyTable(state.properties)}</div>
        </section>
      `;
    } else if (page === 'survey') {
      if (state.preview && id !== previewProperty.id) throw new Error('Property not found.');
      try {
        state.checklist = state.preview ? previewChecklist : await api(`/properties/${encodeURIComponent(id)}/checklist`);
        breadcrumbEl.textContent = `Survey ${state.checklist.property.survey_number}`;
        html = renderChecklist(state.checklist, state);
        if(state.profile.role==='admin'&&!state.preview)html+=`<section class="panel management-panel"><button class="button danger" data-delete-scope="survey" data-target-id="${id}">Review survey deletion</button></section>`;
      } catch (err) {
        if (err.code === 'PROJECT_PASSWORD_REQUIRED' || err.status === 403) {
          const parentProjId = err.projectId || state.properties.find(p => p.id === id)?.project_id;
          const targetProj = state.projects.find(p => p.id === parentProjId) || { id: parentProjId, project_name: 'Protected Project' };
          breadcrumbEl.textContent = targetProj.project_name || 'Protected Project';
          html = renderLockedProjectScreen(targetProj);
          setTimeout(() => {
            unlockProjectModal(targetProj, () => route());
          }, 60);
        } else {
          throw err;
        }
      }
    } else if (page === 'documents' || page === 'verification') {
      const offset=Math.max(0,Number(id)||0);
      const documentPage=state.preview?{checklists:[previewChecklist],hasMore:false,locked:0}:await api(`/checklists?offset=${offset}&limit=25`);
      const sets=documentPage.checklists;
      const rows = sets.flatMap(s => s.documents.map(d => ({ ...d, property: s.property })));
      const review = page === 'verification';
      const filtered = review ? rows.filter(d => d.files.length) : rows;
      html = `
        <div class="page-heading">
          <div>
            <span class="eyebrow">${review ? 'HUMAN REVIEW, RECORDED' : 'YOUR DOCUMENT LIBRARY'}</span>
            <h1>${review ? 'Verification' : 'Documents'}<span class="heading-dot">.</span></h1>
            <p>${review ? 'Review uploaded records and capture a clear decision.' : 'Every required category, organized by property.'} Showing up to 25 surveys per page.</p>
            ${documentPage.locked?'<p>Some projects need an access password. <a href="#projects">Open Projects to unlock them.</a></p>':''}
          </div>
        </div>
        <section class="panel">
          <div class="section-top">
            <h2>${review ? 'Review queue' : 'Document register'} <span class="count">${filtered.length}</span></h2>
            <div class="button-group">${offset?`<a class="button" href="#${page}/${Math.max(0,offset-25)}">Previous</a>`:''}${documentPage.hasMore?`<a class="button" href="#${page}/${offset+25}">Next</a>`:''}</div>
          </div>
          ${filtered.length ? `
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Document category</th>
                    <th>Survey</th>
                    <th>Files</th>
                    <th>Collection</th>
                    <th>Status</th>
                    <th>Survey match</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map(d => `
                    <tr>
                      <td><strong>${esc(d.category?.name || 'Document')}</strong></td>
                      <td>
                        ${esc(d.property.survey_number)}
                        <small class="table-small">${esc(locationText(d.property))}</small>
                      </td>
                      <td>${d.files.length}</td>
                      <td>${d.is_collected && d.files.length ? 'Collected' : 'Pending'}</td>
                      <td>${badge(d.verification_status)}</td>
                      <td>${esc(d.survey_match_status)}</td>
                      <td><a class="text-link" href="#survey/${d.property.id}">Open checklist ${icon('arrow')}</a></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : empty('No documents awaiting review', 'Upload a document from a property checklist to begin.')}
          <div class="panel-footer">
            ${icon('info')} ${review ? 'Only admins and assigned reviewers can record verification decisions.' : 'Files are stored privately and opened through short-lived signed links.'}
          </div>
        </section>
      `;
      if(review&&!state.preview){const events=await api('/reviews?limit=50');html+='<section class="panel"><div class="section-top"><h2>Latest review decisions</h2></div>'+reviewRows(events.rows)+'</section>';}
    } else if (page === 'reports') {
      html = renderReports(state.properties);
    } else if (page === 'settings') {
      if(state.profile.role==='admin'&&!state.preview)state.users=await api('/users');
      html = renderSettings();
    } else {
      html = empty('Page not found', 'Choose a section from the sidebar.');
    }

    if (version !== renderVersion) return;
    main.innerHTML = html;
    main.removeAttribute('aria-busy');
    wire(page, id);
    wireManagement(page,id,state,route);
    window.scrollTo(0, 0);
  } catch (error) {
    if (version !== renderVersion) return;
    main.removeAttribute('aria-busy');
    main.innerHTML = empty('Unable to load this view', error.message);
    toast(error.message, true);
  }
}

export function profileModal(profile, onUpdated) {
  const p = profile || {};
  const dialog = modal('Change Name & Password', `
    <form id="profile-form">
      <p class="muted">Update your display name or set a new sign-in password.</p>
      <div class="form-grid">
        <label>Email Address
          <input type="email" value="${esc(p.email || 'reviewer@dnassets.com')}" disabled class="ui-8247523b">
        </label>
        <label>Account Role
          <input type="text" value="${esc(p.role || 'reviewer')}" disabled class="ui-989fc886">
        </label>
      </div>
      <label>Full Name *
        <input name="full_name" value="${esc(p.full_name || '')}" placeholder="Your Full Name" maxlength="160" required autocomplete="name">
      </label>
      <div class="form-grid">
        <label>New Password (Optional)
          <div class="password-input-group">
            <input type="password" id="profile_new_pw" name="password" placeholder="Leave blank to keep current" maxlength="100" autocomplete="new-password">
            <button type="button" class="password-toggle-btn" data-toggle-pw="profile_new_pw" title="Show or hide password">${icon('eye')}</button>
          </div>
          <span class="field-hint">Minimum 4 characters. Leave blank if not changing.</span>
        </label>
        <label>Confirm New Password
          <div class="password-input-group">
            <input type="password" id="profile_confirm_pw" name="confirm_password" placeholder="Repeat new password" maxlength="100" autocomplete="new-password">
            <button type="button" class="password-toggle-btn" data-toggle-pw="profile_confirm_pw" title="Show or hide password">${icon('eye')}</button>
          </div>
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="button" data-cancel>Cancel</button>
        <button type="submit" class="button primary">Save Changes</button>
      </div>
    </form>
  `);

  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.querySelectorAll('[data-toggle-pw]').forEach(btn => {
    btn.onclick = () => {
      const input = dialog.querySelector('#' + btn.dataset.togglePw);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    };
  });

  const form = dialog.querySelector('form');
  wireForm(form, async formData => {
    const data = Object.fromEntries(formData);
    const fullName = (data.full_name || '').trim();
    const password = (data.password || '').trim();
    const confirmPassword = (data.confirm_password || '').trim();

    if (password) {
      if (password.length < 4) throw new Error('New password must be at least 4 characters long.');
      if (password !== confirmPassword) throw new Error('New password and confirm password do not match.');
    }

    const payload = {};
    if (fullName) payload.full_name = fullName;
    if (password) payload.password = password;

    const updated = await api('/me', {
      method: 'PUT',
      body: payload
    });

    state.profile = { ...state.profile, ...updated };
    const nameEl = document.querySelector('.user-profile strong');
    if (nameEl) nameEl.textContent = updated.full_name;
    const avatarEl = document.querySelector('.user-profile .avatar');
    if (avatarEl) avatarEl.textContent = (updated.full_name || 'D').slice(0, 2).toUpperCase();

    dialog.close();
    toast('Profile and password updated successfully.');
    if (typeof onUpdated === 'function') await onUpdated();
  });
}

export function adminUserModal(targetUser, onUpdated) {
  const u = targetUser || {};
  const dialog = modal('Edit User Name & Password', `
    <form id="admin-user-form">
      <p class="muted">Administrator management for user <strong>${esc(u.email || '')}</strong>.</p>
      <label>Email Address
        <input type="email" value="${esc(u.email || '')}" disabled class="ui-8247523b">
      </label>
      <div class="form-grid">
        <label>Full Name *
          <input name="full_name" value="${esc(u.full_name || '')}" placeholder="User full name" maxlength="160" required>
        </label>
        <label>User Role
          <select name="role">
            ${['admin', 'reviewer'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r === 'admin' ? 'Admin' : 'Reviewer'}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>Set New Password
        <div class="password-input-group">
          <input type="password" id="admin_reset_pw" name="password" placeholder="Enter new password (leave blank to keep current)" maxlength="100" autocomplete="new-password">
          <button type="button" class="password-toggle-btn" data-toggle-pw="admin_reset_pw" title="Show or hide password">${icon('eye')}</button>
        </div>
        <span class="field-hint">Minimum 4 characters. Overwrites user's sign-in password.</span>
      </label>
      <div class="modal-actions">
        <button type="button" class="button" data-cancel>Cancel</button>
        <button type="submit" class="button primary">Save Changes</button>
      </div>
    </form>
  `);

  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.querySelectorAll('[data-toggle-pw]').forEach(btn => {
    btn.onclick = () => {
      const input = dialog.querySelector('#' + btn.dataset.togglePw);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    };
  });

  const form = dialog.querySelector('form');
  wireForm(form, async formData => {
    const data = Object.fromEntries(formData);
    const fullName = (data.full_name || '').trim();
    const password = (data.password || '').trim();
    const role = data.role;

    if (password && password.length < 4) {
      throw new Error('Password must be at least 4 characters long.');
    }

    const payload = {};
    if (fullName) payload.full_name = fullName;
    if (password) payload.password = password;
    if (role) payload.role = role;

    await api(`/users/${u.id}`, {
      method: 'PUT',
      body: payload
    });

    dialog.close();
    toast('User account and password updated.');
    if (typeof onUpdated === 'function') await onUpdated();
  });
}

export async function analysisModal(uploadId) {
  toast('Loading document analysis…');
  let data;
  try {
    data = await api(`/analyses/${encodeURIComponent(uploadId)}`);
  } catch (err) {
    toast('Could not load analysis: ' + err.message, true);
    return;
  }

  const analysis = data.analysis;
  const records = data.extracted_surveys || [];
  const summary = analysis?.summary || {};

  const totalEntries = summary.total_entries || records.length;
  const uniqueMain = summary.unique_main_survey_numbers || 0;
  const uniqueCombos = summary.unique_survey_subdivision_combinations || 0;
  const extractedCount = summary.successfully_extracted || records.length;
  const reviewCount = summary.requires_manual_verification || 0;

  const renderTableRows = (list) => {
    if (!list || list.length === 0) {
      return `<tr><td colspan="10" class="ui-afe7421b">No matching survey records found.</td></tr>`;
    }
    return list.map(r => `
      <tr>
        <td><strong>${esc(r.s_no)}</strong></td>
        <td><strong class="ui-13daa001">${esc(r.survey_number)}</strong></td>
        <td><span class="badge ${r.subdivision && r.subdivision !== 'Not Found' ? 'blue' : 'gray'}">${esc(r.subdivision)}</span></td>
        <td>${esc(r.village)}</td>
        <td>${esc(r.taluk)}</td>
        <td>${esc(r.district)}</td>
        <td>${esc(r.extent)}</td>
        <td>${esc(r.patta_number)}</td>
        <td>${esc(r.plot_number)}</td>
        <td><small class="ui-93e6231c">${esc(r.source_reference || '')}</small></td>
      </tr>
    `).join('');
  };

  const dialog = modal(`Analysis & Survey Summary · ${esc(analysis?.original_file_name || 'Document')}`, `
    <div class="analysis-container ui-7afa0e1f">
      <!-- Analysis Summary Cards -->
      <div class="analysis-summary-grid ui-fd95725c">
        <div class="stat-card ui-468f9ee5">
          <small class="ui-229b4642">Status</small>
          <div class="ui-a3a55686">${badge(analysis?.status || 'Uploaded')}</div>
        </div>
        <div class="stat-card ui-468f9ee5">
          <small class="ui-229b4642">Total Entries</small>
          <strong class="ui-235184ae">${totalEntries}</strong>
        </div>
        <div class="stat-card ui-468f9ee5">
          <small class="ui-229b4642">Unique Main Surveys</small>
          <strong class="ui-47da5e81">${uniqueMain}</strong>
        </div>
        <div class="stat-card ui-468f9ee5">
          <small class="ui-229b4642">Survey/Subdiv Combos</small>
          <strong class="ui-c9bb80de">${uniqueCombos}</strong>
        </div>
        <div class="stat-card ui-468f9ee5">
          <small class="ui-229b4642">Requires Manual Review</small>
          <strong class="analysis-review-count ${reviewCount > 0 ? 'review-needed' : ''}">${reviewCount}</strong>
        </div>
      </div>

      <!-- File Meta -->
      <div class="ui-9d41c503">
        <span><strong>File:</strong> ${esc(analysis?.original_file_name || 'Document')}</span>
        <span><strong>Uploaded By:</strong> ${esc(summary.uploaded_by || 'Authorized User')}</span>
        <span><strong>Upload Date:</strong> ${date(analysis?.created_at)}</span>
      </div>

      ${analysis?.error_message ? `
        <div class="ui-2a236c5d">
          <strong>Notice:</strong> ${esc(analysis.error_message)}
        </div>
      ` : ''}

      <!-- Search, Filter & Export Toolbar -->
      <div class="ui-58e280fd">
        <div class="ui-2e683146">
          <label class="search-box ui-b76633f1">
            ${icon('search')}
            <input id="analysis-search" type="search" placeholder="Search survey number, subdivision, village, taluk, district…" class="ui-7875a2b7">
          </label>
          <select id="analysis-filter" class="ui-a48cc473">
            <option value="all">All Records (${records.length})</option>
            <option value="verified">Identified Records</option>
            <option value="review">Needs Review (${reviewCount})</option>
          </select>
        </div>
        <div class="button-group">
          <a class="button small-button" href="/api/analyses/${encodeURIComponent(uploadId)}/export?format=xlsx" download title="Export table to Excel spreadsheet">${icon('download')} Export Excel</a>
          <button class="button small-button" data-analysis-export title="Export table to CSV">${icon('download')} Export CSV</button>
        </div>
      </div>

      <!-- Extracted Survey Numbers Table -->
      <div class="table-scroll ui-8149d75f">
        <table class="ui-979f14d2">
          <thead class="ui-95efa713">
            <tr>
              <th class="ui-d0097a5b">S.No.</th>
              <th class="ui-d0097a5b">Survey Number</th>
              <th class="ui-d0097a5b">Subdivision</th>
              <th class="ui-d0097a5b">Village</th>
              <th class="ui-d0097a5b">Taluk</th>
              <th class="ui-d0097a5b">District</th>
              <th class="ui-d0097a5b">Extent</th>
              <th class="ui-d0097a5b">Patta No.</th>
              <th class="ui-d0097a5b">Plot No.</th>
              <th class="ui-d0097a5b">Source</th>
            </tr>
          </thead>
          <tbody id="analysis-table-body">
            ${renderTableRows(records)}
          </tbody>
        </table>
      </div>

      <div class="modal-actions ui-5fa693f3">
        <button type="button" class="button" data-close-modal>Close</button>
      </div>
    </div>
  `);

  dialog.querySelector('[data-analysis-export]')?.addEventListener('click',protect(async()=>{const blob=await api('/analyses/'+encodeURIComponent(uploadId)+'/export?format=csv',{blob:true});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='survey-analysis.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
  dialog.querySelector('[data-close-modal]').onclick = () => dialog.close();

  const searchInput = dialog.querySelector('#analysis-search');
  const filterSelect = dialog.querySelector('#analysis-filter');
  const tbody = dialog.querySelector('#analysis-table-body');

  const updateTable = () => {
    const q = (searchInput?.value || '').toLowerCase().trim();
    const filter = filterSelect?.value || 'all';

    let filtered = records;
    if (filter === 'review') {
      filtered = filtered.filter(r => r.requires_manual_review);
    } else if (filter === 'verified') {
      filtered = filtered.filter(r => !r.requires_manual_review && r.survey_number !== 'Not Found');
    }

    if (q) {
      filtered = filtered.filter(r => [
        r.survey_number,
        r.subdivision,
        r.village,
        r.taluk,
        r.district,
        r.plot_number,
        r.patta_number,
        r.extent,
        r.source_reference
      ].join(' ').toLowerCase().includes(q));
    }

    tbody.innerHTML = renderTableRows(filtered);
  };

  searchInput?.addEventListener('input', updateTable);
  filterSelect?.addEventListener('change', updateTable);
}

export function uploadHistoryModal(offset=0,projectId=state.currentProject?.id||state.checklist?.property?.project_id||null){const q=new URLSearchParams({offset:String(offset)});if(projectId)q.set('project_id',projectId);location.hash='#history/'+encodeURIComponent(q.toString());}

function renderSettings() {
  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow">WORKSPACE CONFIGURATION</span>
        <h1>Settings<span class="heading-dot">.</span></h1>
        <p>Manage your account name, password, connection details, and team access.</p>
      </div>
    </div>
    <div class="settings-grid">
      <!-- Your Profile & Password Panel -->
      <section class="panel settings-panel">
        <h2>Your Profile & Password</h2>
        <p class="muted">Manage your personal account details and sign-in credentials.</p>
        <dl>
          <div><dt>Full Name</dt><dd><strong>${esc(state.profile.full_name || 'DNAssets Member')}</strong></dd></div>
          <div><dt>Email Address</dt><dd>${esc(state.profile.email || 'reviewer@dnassets.com')}</dd></div>
          <div><dt>Account Role</dt><dd><span class="badge ${state.profile.role === 'admin' ? 'green' : 'blue'}">${esc(state.profile.role)}</span></dd></div>
        </dl>
        <div class="ui-5fa693f3">
          <button class="button primary" data-edit-my-profile>${icon('edit')} Change Name & Password</button>
        </div>
      </section>

      <!-- Workspace connection -->
      <section class="panel settings-panel">
        <h2>Workspace connection</h2>
        <dl>
          <div><dt>Database</dt><dd>Local PostgreSQL (PGlite) / Supabase</dd></div>
          <div><dt>Storage</dt><dd>Private document bucket (land-documents)</dd></div>
          <div><dt>Maximum file size</dt><dd>${state.config.maxFileBytes / 1048576} MB per file</dd></div>
          <div><dt>Your role</dt><dd>${esc(state.preview ? 'Preview only' : state.profile.role)}</dd></div>
        </dl>
        <p class="small">Session credentials are scoped to this browser tab. Uploaded documents are persisted securely.</p>
      </section>

      <!-- Team Access Panel (Admin only) -->
      ${state.profile.role === 'admin' ? `
      <section class="panel settings-panel ui-d5b43342">
        <div class="ui-7e1343d0">
          <div>
            <h2 class="ui-ff227d06">Team Accounts & Role Management</h2>
            <p class="muted ui-6c63b477">Reviewers and administrators configured in the system.</p>
          </div>
          ${!state.preview ? '<button class="button" data-manage-members>Manage Property Access</button>' : ''}
        </div>
        <div class="role-list">
          ${(state.users||[]).map(u=>`<div><strong>${esc(u.full_name||u.email)}</strong><span>${esc(u.email)} · ${esc(u.role)}</span><button class="button small-button" data-admin-edit-user="${u.id}" data-user-email="${esc(u.email)}" data-user-name="${esc(u.full_name)}" data-user-role="${esc(u.role)}">Edit account</button></div>`).join('')}
        </div>
      </section>
      ` : ''}
    </div>
  `;
}

function protect(action) {
  return async event => {
    if (state.preview) {
      previewNotice();
      return;
    }
    try {
      await action(event);
    } catch (error) {
      toast(error.message, true);
    }
  };
}

function wire(page, id) {
  // Change My Profile & Password
  document.querySelectorAll('[data-edit-my-profile]').forEach(b => {
    b.onclick = () => profileModal(state.profile, () => route());
  });

  // Admin edit user credentials
  document.querySelectorAll('[data-admin-edit-user]').forEach(b => {
    b.onclick = () => {
      const targetUser = {
        id: b.dataset.adminEditUser,
        email: b.dataset.userEmail,
        full_name: b.dataset.userName,
        role: b.dataset.userRole
      };
      adminUserModal(targetUser, () => route());
    };
  });

  // Add Project
  document.querySelectorAll('[data-add-project]').forEach(b => {
    b.disabled = !canEdit();
    b.onclick = () => projectModal(null, route, state.profile?.role);
  });

  // Edit Project
  const editProjectBtn = document.querySelector('[data-edit-project]');
  if (editProjectBtn) {
    editProjectBtn.disabled = !canEdit();
    editProjectBtn.onclick = () => projectModal(state.currentProject, route, state.profile?.role);
  }

  // Delete Project — admin only, with confirmation
  document.querySelectorAll('[data-delete-project]').forEach(btn => {
    btn.onclick = async () => {
      const targetId = btn.dataset.deleteProject;
      const proj = state.projects.find(p => p.id === targetId) || state.currentProject || { project_name: 'this project' };
      const confirmed = window.confirm(`⚠️ DELETE PROJECT\n\nAre you sure you want to permanently delete "${proj.project_name}"?\n\nThis will also delete all survey numbers, documents, uploads, and checklists inside it.\n\nThis action CANNOT be undone.`);
      if (!confirmed) return;
      try {
        btn.disabled = true;
        await api(`/projects/${targetId}`, { method: 'DELETE' });
        state.projects = state.projects.filter(p => p.id !== targetId);
        toast(`Project "${proj.project_name}" deleted.`);
        location.hash = '#projects';
      } catch (err) {
        toast(err.message || 'Failed to delete project.', true);
        btn.disabled = false;
      }
    };
  });

  // Unlock Project Buttons
  document.querySelectorAll('[data-unlock-project]').forEach(b => {
    b.onclick = () => {
      const targetId = b.dataset.unlockProject || (page === 'project' ? id : null);
      const proj = state.projects.find(p => p.id === targetId) || { id: targetId, project_name: 'Project' };
      unlockProjectModal(proj, () => {
        // Mark the project as unlocked in local state so the list reflects it immediately
        const idx = state.projects.findIndex(p => p.id === targetId);
        if (idx !== -1) state.projects[idx] = { ...state.projects[idx], is_unlocked: true };
        route();
      });
    };
  });

  // Add Survey Number
  document.querySelectorAll('[data-add-survey]').forEach(b => {
    b.disabled = !canAddSurvey();
    b.onclick = () => {
      if(page==='project')return surveyModal(id,null,route,state.currentProject);
      if(!state.projects.length)return toast('Create a project before adding its survey number.',true);
      const dialog=modal('Choose project',`<form><label>Project<select name="project" required><option value="">Select a project</option>${state.projects.map(p=>`<option value="${p.id}">${esc(p.project_name)}</option>`).join('')}</select></label><button class="button primary" type="submit">Continue</button></form>`);
      dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const p=state.projects.find(p=>p.id===dialog.querySelector('select').value);if(p){dialog.close();surveyModal(p.id,null,route,p);}};
    };
  });

  // Edit Survey Number
  const editSurvey = document.querySelector('[data-edit]');
  if (editSurvey) {
    editSurvey.disabled = !canAddSurvey();
    editSurvey.onclick = () => {
      if (state.checklist?.property) {
        surveyModal(state.checklist.property.project_id, state.checklist.property, route, {});
      }
    };
  }

  // Project search filter
  document.querySelector('#project-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = state.projects.filter(p => [p.project_name, p.project_code, locationText(p)].join(' ').toLowerCase().includes(q));
    const container = document.querySelector('#project-results');
    if (container) {
      container.innerHTML = renderProjectTable(filtered, state.profile?.role);
      container.querySelectorAll('[data-unlock-project]').forEach(b => {
        b.onclick = () => {
          const targetId = b.dataset.unlockProject;
          const proj = state.projects.find(p => p.id === targetId) || { id: targetId, project_name: 'Project' };
          unlockProjectModal(proj, () => {
            const idx = state.projects.findIndex(p => p.id === targetId);
            if (idx !== -1) state.projects[idx] = { ...state.projects[idx], is_unlocked: true };
            route();
          });
        };
      });
      container.querySelectorAll('[data-delete-project]').forEach(btn => {
        btn.onclick = async () => {
          const targetId = btn.dataset.deleteProject;
          const proj = state.projects.find(p => p.id === targetId) || { project_name: 'this project' };
          if (!window.confirm(`⚠️ DELETE PROJECT\n\nPermanently delete "${proj.project_name}" and all its survey numbers, documents and uploads?\n\nThis CANNOT be undone.`)) return;
          try {
            btn.disabled = true;
            await api(`/projects/${targetId}`, { method: 'DELETE' });
            state.projects = state.projects.filter(p => p.id !== targetId);
            toast(`Project "${proj.project_name}" deleted.`);
            route();
          } catch (err) {
            toast(err.message || 'Failed to delete project.', true);
            btn.disabled = false;
          }
        };
      });
    }
  });

  // Survey search filter
  document.querySelector('#survey-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = state.properties.filter(p => [p.survey_number, p.property_name, locationText(p)].join(' ').toLowerCase().includes(q));
    document.querySelector('#survey-results').innerHTML = surveyTable(filtered);
  });

  // Matrix search filter (Easy Status Checker inside project)
  document.querySelector('#matrix-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    if (!state.currentMatrix) return;
    const filteredChecklists = state.currentMatrix.survey_checklists.filter(c => {
      const p = c.property;
      return [p.survey_number, p.subdivision_number, p.owner_name, locationText(p)].join(' ').toLowerCase().includes(q);
    });
    document.querySelector('#matrix-view-container').innerHTML = renderStatusMatrix(filteredChecklists, state.currentProject);
  });

  // Export Project Report
  document.querySelector('[data-export-project]')?.addEventListener('click', protect(async () => {
    if (page === 'project' && id) {
      await exportReport('pdf', null, 'all', id);
    }
  }));

  if (page === 'reports') document.querySelector('#report-table').innerHTML = surveyTable(state.properties);

  document.querySelectorAll('[data-export]').forEach(b => b.onclick = protect(async () => {
    b.disabled = true;
    try {
      await exportReport(b.dataset.export, page === 'survey' ? id : document.querySelector('#report-property')?.value, document.querySelector('#report-filter')?.value || 'all');
    } finally {
      b.disabled = false;
    }
  }));

  document.querySelectorAll('[data-email-report]').forEach(b => b.onclick = protect(async () => {
    b.disabled = true;
    try {
      await emailReport(page === 'survey' ? id : document.querySelector('#report-property')?.value, document.querySelector('#report-filter')?.value || 'all', state.config.adminEmail || 'dna.space.sm@gmail.com');
    } finally {
      b.disabled = false;
    }
  }));

  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());

  document.querySelector('[data-expand]')?.addEventListener('click', e => {
    const open = e.target.textContent === 'Expand all';
    document.querySelectorAll('.document-card').forEach(d => d.open = open);
    e.target.textContent = open ? 'Collapse all' : 'Expand all';
  });

  document.querySelectorAll('[data-collected]').forEach(input => input.onchange = protect(async () => {
    input.disabled = true;
    try {
      await api('/documents/' + input.dataset.collected, { method: 'PUT', body: { is_collected: input.checked } });
      await route();
    } catch (error) {
      input.checked = !input.checked;
      throw error;
    } finally {
      input.disabled = false;
    }
  }));

  document.querySelectorAll('[data-review]').forEach(b => b.onclick = () => reviewDialog(state.checklist.documents.find(d => d.id === b.dataset.review), route));

  const handleUpload = async (files, doc, replace = null) => {
    const inputs = [...document.querySelectorAll('[data-upload]')];
    inputs.forEach(i => i.disabled = true);
    try {
      await uploadFiles([...files], doc, id, state.config.maxFileBytes, route, replace);
    } finally {
      inputs.forEach(i => i.disabled = false);
    }
  };

  document.querySelectorAll('[data-upload]').forEach(input => input.onchange = protect(() => handleUpload(input.files, input.dataset.upload)));

  document.querySelectorAll('[data-drop]').forEach(zone => {
    zone.ondragover = e => {
      e.preventDefault();
      zone.classList.add('dragging');
    };
    zone.ondragleave = () => zone.classList.remove('dragging');
    zone.ondrop = protect(async e => {
      e.preventDefault();
      zone.classList.remove('dragging');
      await handleUpload(e.dataTransfer.files, zone.dataset.drop);
    });
    if (state.preview) zone.ondrop = e => {
      e.preventDefault();
      previewNotice();
    };
  });

  document.querySelectorAll('[data-analysis]').forEach(b => b.onclick = protect(() => analysisModal(b.dataset.analysis)));
  document.querySelectorAll('[data-preview]').forEach(b => b.onclick = protect(() => openFile(b.dataset.preview)));
  document.querySelectorAll('[data-download]').forEach(b => b.onclick = protect(() => openFile(b.dataset.download, true)));

  document.querySelectorAll('[data-replace]').forEach(b => b.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv';
    input.onchange = protect(() => handleUpload(input.files, b.dataset.doc, b.dataset.replace));
    input.click();
  });

  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => {
    const dialog = modal('Delete this file?', `
      <p>This removes the file from the checklist and resets this category’s verification. The deletion remains in the audit trail.</p>
      <div class="modal-actions">
        <button class="button" data-cancel>Keep file</button>
        <button class="button danger-button" data-confirm>Delete file</button>
      </div>
    `);
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('[data-confirm]').onclick = protect(async e => {
      e.target.disabled = true;
      try {
        await api('/files/' + b.dataset.delete, { method: 'DELETE' });
        dialog.close();
        toast('File deleted.');
        await route();
      } finally {
        e.target.disabled = false;
      }
    });
  });

  document.querySelector('[data-audit]')?.addEventListener('click', protect(async () => {
    const logs = await api('/properties/' + id + '/audit');
    document.querySelector('#audit-content').innerHTML = logs.length ? `
      <ul class="activity-list">
        ${logs.map(l => `
          <li>
            <span>${esc(l.action.replaceAll('.', ' · ').replaceAll('_', ' '))}</span>
            <small>${esc(l.actor?.full_name || 'Team member')} · ${date(l.created_at)}</small>
          </li>
        `).join('')}
      </ul>
    ` : '<p class="muted">No recorded activity yet.</p>';
  }));

  document.querySelector('[data-manage-members]')?.addEventListener('click', protect(manageMembers));
}

async function manageMembers() {
  const users = await api('/users');
  const dialog = modal('Manage property access', `
    <label>Property
      <select id="access-property">
        ${state.properties.map(p => `<option value="${p.id}">${esc(p.survey_number + ' · ' + (p.property_name || p.village || 'Details pending'))}</option>`).join('')}
      </select>
    </label>
    <div id="members-list"></div>
    <label>Add team member
      <select id="access-user">
        ${users.map(u => `<option value="${u.id}">${esc(u.full_name || u.id)} (${esc(u.role)})</option>`).join('')}
      </select>
    </label>
    <button class="button primary" id="grant-access">Grant access</button>
  `);
  const property = dialog.querySelector('#access-property');
  const reload = async () => {
    if (!property.value) return;
    const members = await api('/properties/' + property.value + '/members');
    dialog.querySelector('#members-list').innerHTML = `
      <ul class="activity-list">
        ${members.map(m => `
          <li>
            <span>${esc(m.profile.full_name || m.user_id)} · ${esc(m.profile.role)}</span>
            <button class="text-button danger" data-revoke="${m.user_id}">Remove access</button>
          </li>
        `).join('')}
      </ul>
    `;
    dialog.querySelectorAll('[data-revoke]').forEach(b => b.onclick = protect(async () => {
      await api('/properties/' + property.value + '/members', { method: 'POST', body: { user_id: b.dataset.revoke, remove: true } });
      await reload();
    }));
  };
  property.onchange = protect(reload);
  dialog.querySelector('#grant-access').onclick = protect(async () => {
    if (!property.value) return;
    await api('/properties/' + property.value + '/members', { method: 'POST', body: { user_id: dialog.querySelector('#access-user').value } });
    await reload();
    toast('Access granted.');
  });
  await reload();
}

window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => loginScreen(boot));
boot();
