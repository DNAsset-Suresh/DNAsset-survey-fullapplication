import { api, setProjectUnlockToken } from './api.js';
import { esc, icon, meter, badge, modal, wireForm, toast, empty } from './ui.js';
import {
  renderProjectSubnav,
  renderScheduleTableSection,
  renderPRChainSection,
  renderAcquisitionDeedsSection,
  scheduleEntryModal,
  prChainModal,
  acquisitionDeedModal,
  scheduleDetailModal,
  exportScheduleToExcel
} from './project-schedule.js?v=1.1.1';

export const locationText = p => [p.village, p.taluk, p.district].filter(Boolean).join(', ') || 'Location pending';

export function projectModal(project, refresh, currentUserRole = 'admin') {
  const p = project || {};
  const isEdit = Boolean(p.id);
  const isAdmin = currentUserRole === 'admin';
  const dialog = modal(isEdit ? 'Edit Project Details' : 'Add New Project', `
    <form id="project-form">
      <p class="muted">The project is the main record. One project can contain multiple survey numbers.</p>
      <div class="form-grid">
        <label>Project Name *
          <input name="project_name" value="${esc(p.project_name)}" placeholder="e.g. Green Valley" maxlength="160" required>
        </label>
        <label>Project Code
          <input name="project_code" value="${esc(p.project_code)}" placeholder="e.g. GV001" maxlength="50">
        </label>
        <label>Promoter / Owner Name
          <input name="promoter_name" value="${esc(p.promoter_name)}" placeholder="Promoter or Company Name" maxlength="160">
        </label>
        <label>Project Status
          <select name="status">
            ${['Active', 'Completed', 'On Hold', 'Under Review', 'Draft'].map(s => `<option ${(p.status || 'Active') === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <label>Village
          <input name="village" value="${esc(p.village)}" placeholder="Village" maxlength="160">
        </label>
        <label>Taluk
          <input name="taluk" value="${esc(p.taluk)}" placeholder="Taluk" maxlength="160">
        </label>
        <label>District
          <input name="district" value="${esc(p.district)}" placeholder="District" maxlength="160">
        </label>
        <label>Total Land Extent
          <input name="total_land_extent" type="number" min="0" max="999999999999" step="0.0001" value="${p.total_land_extent ?? ''}" placeholder="0.00">
        </label>
        <label>Measurement Unit
          <select name="measurement_unit">
            ${['acres', 'cents', 'hectares', 'sq ft', 'sq m'].map(u => `<option ${(p.measurement_unit || 'acres') === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </label>
        ${isAdmin ? `
          <label>Reviewer Access Password
            <div class="password-input-group">
              <input type="password" id="project_access_pw" name="access_password" value="" placeholder="${isEdit ? 'Leave blank to keep current password' : 'Optional project password'}" maxlength="100" autocomplete="new-password">
              <button type="button" class="password-toggle-btn" data-toggle-pw="project_access_pw" title="Show or hide password">${icon('eye')}</button>
            </div>
            <span class="field-hint">When set, Reviewers must enter this password to view survey numbers & checklists.</span>
          </label>
        ` : ''}
      </div>
      <label>Project Address
        <textarea name="project_address" rows="2" maxlength="4000" placeholder="Full physical or revenue address">${esc(p.project_address)}</textarea>
      </label>
      <label>Project Description
        <textarea name="description" rows="2" maxlength="4000" placeholder="Brief description of the land parcel or layout plan">${esc(p.description)}</textarea>
      </label>
      <label>Remarks
        <textarea name="remarks" rows="2" maxlength="4000" placeholder="Administrative remarks">${esc(p.remarks)}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="button" data-cancel>Cancel</button>
        <button type="submit" class="button primary">${isEdit ? 'Save Changes' : 'Create Project'}</button>
      </div>
    </form>
  `);

  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  const toggleBtn = dialog.querySelector('[data-toggle-pw]');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const input = dialog.querySelector('#' + toggleBtn.dataset.togglePw);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    };
  }
  wireForm(dialog.querySelector('form'), async form => {
    const body = Object.fromEntries(form);
    if(isEdit && !body.access_password) delete body.access_password;
    body.total_land_extent = body.total_land_extent === '' ? null : Number(body.total_land_extent);
    const result = await api('/projects' + (isEdit ? '/' + p.id : ''), {
      method: isEdit ? 'PUT' : 'POST',
      body
    });
    dialog.close();
    toast('Project saved.');
    if (!isEdit) location.hash = '#project/' + result.id;
    else await refresh();
  });
}

export function surveyModal(projectId, survey, refresh, defaultProject = {}) {
  const s = survey || {};
  const isEdit = Boolean(s.id);
  const dialog = modal(isEdit ? 'Edit Survey Number' : 'Add Survey Number to Project', `
    <form id="survey-form">
      <p class="muted">Each survey number will automatically have its own 7-document checklist with independent file tracking.</p>
      <div class="form-grid">
        <label>Survey Number *
          <input name="survey_number" value="${esc(s.survey_number)}" placeholder="e.g. 216/1" maxlength="80" required>
        </label>
        <label>Subdivision Number
          <input name="subdivision_number" value="${esc(s.subdivision_number)}" placeholder="e.g. 1 or A" maxlength="80">
        </label>
        <label>Patta Number
          <input name="patta_number" value="${esc(s.patta_number)}" placeholder="Patta / Revenue Number" maxlength="80">
        </label>
        <label>Property / Land Owner Name
          <input name="owner_name" value="${esc(s.owner_name)}" placeholder="Registered Owner Name" maxlength="160">
        </label>
        <label>Land Extent
          <input name="land_extent" type="number" min="0" max="999999999999" step="0.0001" value="${s.land_extent ?? ''}" placeholder="0.00">
        </label>
        <label>Unit of Measurement
          <select name="land_extent_unit">
            ${['acres', 'cents', 'hectares', 'sq ft', 'sq m'].map(u => `<option ${(s.land_extent_unit || defaultProject.measurement_unit || 'acres') === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </label>
        <label>Survey Status
          <select name="status">
            ${['Active', 'Verified', 'Pending', 'Rejected', 'In Progress'].map(st => `<option ${(s.status || 'Active') === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
        </label>
        <label>Village
          <input name="village" value="${esc(s.village || defaultProject.village)}" placeholder="Village" maxlength="160">
        </label>
        <label>Taluk
          <input name="taluk" value="${esc(s.taluk || defaultProject.taluk)}" placeholder="Taluk" maxlength="160">
        </label>
        <label>District
          <input name="district" value="${esc(s.district || defaultProject.district)}" placeholder="District" maxlength="160">
        </label>
      </div>
      <label>Remarks
        <textarea name="remarks" maxlength="4000" rows="2" placeholder="Notes for legal reviewers or field surveyors">${esc(s.remarks)}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="button" data-cancel>Cancel</button>
        <button type="submit" class="button primary">${isEdit ? 'Save Changes' : 'Add Survey Number'}</button>
      </div>
    </form>
  `);

  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  wireForm(dialog.querySelector('form'), async form => {
    const body = Object.fromEntries(form);
    body.land_extent = body.land_extent === '' ? null : Number(body.land_extent);
    const endpoint = isEdit ? `/properties/${s.id}` : `/projects/${projectId}/survey-numbers`;
    const result = await api(endpoint, {
      method: isEdit ? 'PUT' : 'POST',
      body
    });
    dialog.close();
    toast('Survey number saved.');
    if (!isEdit && result.id) location.hash = '#survey/' + result.id;
    else await refresh();
  });
}

export function renderProjectTable(projects, currentUserRole = '') {
  if (!projects.length) {
    return empty('No projects found', 'Create your first project to start tracking survey documents.');
  }

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Project Name</th>
            <th>Code</th>
            <th>Survey Numbers</th>
            <th>Collected</th>
            <th>Pending</th>
            <th>Verified</th>
            <th>Collection %</th>
            <th>Verification %</th>
            <th><span class="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          ${projects.map(p => {
            const prog = p.progress || { survey_count: 0, required: 0, collected: 0, pending: 0, verified: 0, collection_percentage: 0, verification_percentage: 0 };
            const isProtected = Boolean(p.is_password_protected);
            const isUnlocked = Boolean(p.is_unlocked);
            const lockBadge = isProtected
              ? (isUnlocked
                  ? `<span class="badge green" title="Project unlocked in this session">${icon('unlock')} Unlocked</span>`
                  : `<span class="badge yellow" title="Password required for Reviewers">${icon('lock')} Protected</span>`)
              : '';
            // Show "Enter Password" for any non-admin user who hasn't unlocked yet
            const isReviewerLocked = isProtected && !isUnlocked && currentUserRole !== 'admin';

            return `
              <tr>
                <td>
                  <a class="survey-link" href="#project/${p.id}">
                    ${icon('folder')}
                    <span>
                      <span class="ui-23b34f3d">
                        ${esc(p.project_name)}
                        ${lockBadge}
                      </span>
                      <small>${esc(locationText(p))}</small>
                    </span>
                  </a>
                </td>
                <td><span class="badge gray">${esc(p.project_code || '—')}</span></td>
                <td><strong>${prog.survey_count}</strong> <span class="muted">surveys</span></td>
                <td><strong>${prog.collected}</strong><span class="muted"> / ${prog.required}</span></td>
                <td>${prog.pending}</td>
                <td>${prog.verified}<span class="muted"> / ${prog.required}</span></td>
                <td>
                  <div class="table-progress">
                    <span>${prog.collection_percentage}%</span>
                    ${meter(prog.collection_percentage, 'Collection')}
                  </div>
                </td>
                <td>
                  <div class="table-progress">
                    <span>${prog.verification_percentage}%</span>
                    ${meter(prog.verification_percentage, 'Verification')}
                  </div>
                </td>
                <td>
                  ${isReviewerLocked ? `
                    <button class="button small-button primary" data-unlock-project="${p.id}">
                      ${icon('lock')} Enter Password
                    </button>
                  ` : `
                    <div style="display:flex;gap:6px;align-items:center;">
                      <a class="button small-button" href="#project/${p.id}">Open Project ${icon('arrow')}</a>
                      ${currentUserRole === 'admin' ? `<button class="button small-button" data-delete-project="${p.id}" style="background:#c0392b;color:#fff;border-color:#c0392b;" title="Delete project">${icon('close')}</button>` : ''}
                    </div>
                  `}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderStatusMatrix(surveyChecklists, project) {
  if (!surveyChecklists.length) {
    return empty('No survey numbers under this project', 'Click "Add Survey Number" above to add the first parcel to this project.');
  }

  return `
    <div class="status-matrix-grid">
      ${surveyChecklists.map(item => {
        const p = item.property;
        const g = item.progress || { collected: 0, pending: 7, verified: 0, rejected: 0, under_review: 0, collection_percentage: 0, verification_percentage: 0 };
        const docs = item.documents || [];

        return `
          <article class="matrix-card">
            <header class="matrix-card-header">
              <div class="matrix-survey-title">
                <span class="matrix-survey-pill">Survey ${esc(p.survey_number)}</span>
                ${p.subdivision_number ? `<span class="subdiv-tag">Subdiv ${esc(p.subdivision_number)}</span>` : ''}
                <span class="badge ${p.status === 'Verified' ? 'green' : p.status === 'Active' ? 'blue' : 'gray'}">${esc(p.status || 'Active')}</span>
              </div>
              <div class="matrix-survey-meta">
                <span><strong>Owner:</strong> ${esc(p.owner_name || 'To be entered')}</span>
                <span><strong>Extent:</strong> ${p.land_extent ? `${esc(p.land_extent)} ${esc(p.land_extent_unit)}` : 'To be entered'}</span>
                ${p.patta_number ? `<span><strong>Patta:</strong> ${esc(p.patta_number)}</span>` : ''}
              </div>
              <div class="matrix-progress-dual">
                <div class="matrix-prog-col">
                  <div class="prog-caption">
                    <span>Collection</span>
                    <strong>${g.collected}/7 (${g.collection_percentage}%)</strong>
                  </div>
                  ${meter(g.collection_percentage, 'Collection')}
                </div>
                <div class="matrix-prog-col">
                  <div class="prog-caption">
                    <span>Verification</span>
                    <strong>${g.verified}/7 (${g.verification_percentage}%)</strong>
                  </div>
                  ${meter(g.verification_percentage, 'Verification')}
                </div>
              </div>
            </header>

            <div class="matrix-docs-ribbon" title="Status of 7 Required Documents">
              <span class="ribbon-label">7 Required Documents:</span>
              <div class="docs-chips-container">
                ${docs.map((d, idx) => {
                  const status = d.verification_status;
                  const isVerified = status === 'Verified';
                  const isReview = status === 'Under Review';
                  const isUploaded = status === 'Uploaded';
                  const isRejected = status === 'Rejected';
                  const isPending = status === 'Pending';
                  const fileCount = d.files ? d.files.length : 0;

                  const statusClass = isVerified ? 'verified' : isReview ? 'review' : isRejected ? 'rejected' : isUploaded ? 'uploaded' : 'pending';
                  const iconText = isVerified ? '✓' : isReview ? '👁' : isRejected ? '✕' : isUploaded ? '📄' : '⏳';

                  const shortNames = [
                    'Title Docs',
                    'FMB Sketch',
                    'Patta Record',
                    'Encumbrance (EC)',
                    'Adangal / Pahani',
                    'GP Legal Opinion',
                    'A-Register'
                  ];
                  const shortName = shortNames[idx] || d.category?.name || 'Document';

                  return `
                    <div class="doc-chip ${statusClass}" title="${esc(d.category?.name || 'Document')}: ${esc(status)} (${fileCount} file${fileCount === 1 ? '' : 's'}) · ${esc(d.survey_match_status || 'Unchecked')}">
                      <span class="doc-chip-order">${String(idx + 1).padStart(2, '0')}</span>
                      <span class="doc-chip-name">${esc(shortName)}</span>
                      <span class="doc-chip-status">${iconText} ${esc(status)}</span>
                      ${fileCount > 0 ? `<span class="doc-chip-files">${fileCount}f</span>` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            <footer class="matrix-card-footer">
              <a class="button primary small-button" href="#survey/${p.id}">
                Open Checklist & Files ${icon('arrow')}
              </a>
              <span class="matrix-location muted">${esc(locationText(p))}</span>
            </footer>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

export function renderProjectDetail(project, matrixData, state, options = {}) {
  const p = project;
  const prog = p.progress || { survey_count: 0, required: 0, collected: 0, pending: 0, verified: 0, rejected: 0, under_review: 0, collection_percentage: 0, verification_percentage: 0 };
  const checklists = matrixData?.survey_checklists || [];
  const canEdit = !p.archived_at && !state.preview && state.profile?.role === 'admin';
  const canAddSurvey = !p.archived_at && !state.preview && ['admin', 'reviewer'].includes(state.profile?.role);
  const canDelete = !state.preview && state.profile?.role === 'admin';
  const isProtected = Boolean(p.is_password_protected);
  const isUnlocked = Boolean(p.is_unlocked);
  const lockBadge = isProtected
    ? (isUnlocked
        ? `<span class="badge green" title="Project unlocked in this session">${icon('unlock')} Unlocked</span>`
        : `<span class="badge yellow" title="Password protected">${icon('lock')} Protected</span>`)
    : '';

  const activeTab = options.activeTab || 'overview';
  const scheduleData = options.scheduleData || { schedules: [], villages: [], metrics: {} };
  const prChains = options.prChains || [];
  const deeds = options.deeds || [];

  let tabContent = '';

  if (activeTab === 'overview') {
    tabContent = `
      <!-- Project Overview Details Panel -->
      <section class="panel property-info">
        <div>
          <span>Owner</span><strong>${esc(p.owner_name || 'Not entered')}</strong>
        </div>
        <div>
          <span>Promoter / Developer</span>
          <strong>${esc(p.promoter_name || 'Not entered')}</strong>
        </div>
        <div>
          <span>Total Land Extent</span>
          <strong>${p.total_land_extent ? `${esc(p.total_land_extent)} ${esc(p.measurement_unit)}` : 'To be entered'}</strong>
        </div>
        <div>
          <span>Survey Numbers</span>
          <strong>${prog.survey_count} Parcels</strong>
        </div>
        <div>
          <span>Project Status</span>
          <strong class="teal">${badge(p.status || 'Active')}</strong>
        </div>
      </section>
      ${p.project_address ? `<p class="property-remarks"><strong>Address:</strong> ${esc(p.project_address)}</p>` : ''}
      ${p.description ? `<p class="property-remarks"><strong>Description:</strong> ${esc(p.description)}</p>` : ''}

      <!-- Authoritative Project Completion Progress -->
      <div class="checklist-progress">
        <section class="panel">
          <div class="progress-label">
            <h3>Overall Project Collection Progress</h3>
            <strong>${prog.collection_percentage}%</strong>
          </div>
          ${meter(prog.collection_percentage, 'Overall Project Collection')}
          <p>${prog.collected} of ${prog.required} categories collected <span>·</span> ${prog.pending} pending</p>
        </section>
        
        <section class="panel">
          <div class="progress-label">
            <h3>Overall Project Verification Progress</h3>
            <strong>${prog.verification_percentage}%</strong>
          </div>
          ${meter(prog.verification_percentage, 'Overall Project Verification')}
          <p>${prog.verified} of ${prog.required} categories verified <span>·</span> ${prog.under_review} in review <span>·</span> ${prog.rejected} rejected</p>
        </section>
      </div>

      <!-- Quick Section Jump Cards -->
      <div class="overview-grid" style="margin-top: 24px;">
        <section class="panel" style="padding: 24px; cursor: pointer;" data-jump-tab="schedule">
          <div class="section-top" style="margin-bottom: 12px;">
            <div>
              <span class="eyebrow">LAND SCHEDULES</span>
              <h2>Survey-wise Schedule</h2>
            </div>
            ${icon('documents')}
          </div>
          <p>Inspect exact parcel extents, patta numbers, root deeds, and PR references with dynamic village filtering.</p>
          <div style="margin-top: 16px;"><span class="text-link">Open Schedule Table →</span></div>
        </section>

        <section class="panel" style="padding: 24px; cursor: pointer;" data-jump-tab="pr-chain">
          <div class="section-top" style="margin-bottom: 12px;">
            <div>
              <span class="eyebrow">TITLE TRACEABILITY</span>
              <h2>Previous Document (PR) Chain</h2>
            </div>
            ${icon('arrow')}
          </div>
          <p>Trace registered document connections per Encumbrance Certificate (EC) from root parent deeds to current acquisition.</p>
          <div style="margin-top: 16px;"><span class="text-link">View PR Relationship Chain →</span></div>
        </section>
      </div>
    `;
  } else if (activeTab === 'surveys') {
    tabContent = `
      <!-- Easy Status Checker Section -->
      <section class="panel ui-ef7a9dfb" style="margin-top: 0;">
        <div class="section-top">
          <div>
            <h2>Survey Number Status Checker <span class="count">${checklists.length}</span></h2>
            <p>Check document collection, verification, and match status across every survey number.</p>
          </div>
          <div class="ui-bc6560f4">
            <label class="search-box">
              ${icon('search')}
              <input id="matrix-search" type="search" placeholder="Filter by survey number, owner..." aria-label="Search survey numbers">
            </label>
          </div>
        </div>

        <div id="matrix-view-container" class="ui-6230a1cf">
          ${renderStatusMatrix(checklists, p)}
        </div>

        <div class="panel-footer">
          ${icon('info')} Completing documents for one survey number (e.g. 216/1) never alters statuses for other survey numbers (e.g. 216/2). Every survey number is tracked independently.
        </div>
      </section>
    `;
  } else if (activeTab === 'schedule') {
    tabContent = renderScheduleTableSection(p, scheduleData, {
      activeVillage: options.activeVillage || 'all',
      search: options.search || '',
      sortCol: options.sortCol || 'survey_number',
      sortDir: options.sortDir || 'asc',
      page: options.page || 1,
      userRole: state.profile?.role
    });
  } else if (activeTab === 'pr-chain') {
    tabContent = renderPRChainSection(p, prChains, scheduleData.schedules || [], state.profile?.role);
  } else if (activeTab === 'deeds') {
    tabContent = renderAcquisitionDeedsSection(p, deeds, state.profile?.role);
  } else if (activeTab === 'report') {
    tabContent = `
      <section class="panel report-options">
        <span class="eyebrow">CONSOLIDATED PROJECT REPORT</span>
        <h2>${esc(p.project_name)} · Documentation & Title Report</h2>
        <p>Export all project records, survey checklists, schedules, and verified document summaries.</p>
        <div class="button-group" style="margin-top: 20px;">
          <button class="button primary" data-export-project="pdf">${icon('download')} Download PDF Report</button>
          <button class="button" data-export-schedule-excel>${icon('download')} Download Schedule (Excel)</button>
          <button class="button" data-print-schedule>${icon('clock')} Print Overview</button>
        </div>
      </section>
    `;
  }

  return `
    <a class="back-link" href="#projects">← All Projects</a>
    
    <div class="page-heading">
      <div>
        <span class="eyebrow">PROJECT-WISE DOCUMENT WORKSPACE</span>
        <h1>${esc(p.project_name)}${lockBadge ? ` ${lockBadge}` : ''}<span class="heading-dot">.</span></h1>
        <p>Project Code: <strong>${esc(p.project_code || 'Not entered')}</strong> <span class="dot-divider">·</span> ${esc(locationText(p))} <span class="dot-divider">·</span> ${p.total_land_extent ? `${esc(p.total_land_extent)} ${esc(p.measurement_unit)}` : 'Extent pending'}</p>
      </div>
      <div class="button-group">
        <button class="button primary" data-add-survey ${canAddSurvey ? '' : 'disabled'}>${icon('plus')} Add Survey Number</button>
        <button class="button" data-edit-project ${canEdit ? '' : 'disabled'}>${icon('edit')} Edit Project</button>
        <button class="button" data-export-project="pdf">${icon('download')} Project Report</button>
        ${canDelete ? `<button class="button danger" data-delete-project="${esc(p.id)}" style="background:#c0392b;color:#fff;border-color:#c0392b;">${icon('close')} Delete Project</button>` : ''}
      </div>
    </div>

    ${p.archived_at ? '<p class="setup-banner">Archived project · records preserved as read-only.</p>' : ''}

    <!-- Project Overview Navigation (Phase 2 Requirement) -->
    ${renderProjectSubnav(activeTab)}

    <!-- Dynamic Tab Content -->
    <div id="project-tab-content">
      ${tabContent}
    </div>
  `;
}

export function wireProjectDetail(project, state, rerender) {
  const p = project;

  // Subnav Tab Click
  document.querySelectorAll('[data-project-tab]').forEach(btn => {
    btn.onclick = () => {
      state.projectActiveTab = btn.dataset.projectTab;
      if (rerender) rerender();
    };
  });

  // Jump Tab links on overview cards
  document.querySelectorAll('[data-jump-tab]').forEach(el => {
    el.onclick = () => {
      state.projectActiveTab = el.dataset.jumpTab;
      if (rerender) rerender();
    };
  });

  // Village filters in schedule tab
  document.querySelectorAll('[data-village-filter]').forEach(btn => {
    btn.onclick = () => {
      state.projectActiveVillage = btn.dataset.villageFilter;
      state.projectSchedulePage = 1;
      if (rerender) rerender();
    };
  });

  // Schedule live search
  const scheduleSearch = document.querySelector('#schedule-search-input');
  if (scheduleSearch) {
    scheduleSearch.oninput = e => {
      state.projectScheduleSearch = e.target.value;
      state.projectSchedulePage = 1;
      if (rerender) rerender();
    };
  }

  // Schedule table sort
  document.querySelectorAll('.schedule-table th.sortable').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.sort;
      if (state.projectScheduleSortCol === col) {
        state.projectScheduleSortDir = state.projectScheduleSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.projectScheduleSortCol = col;
        state.projectScheduleSortDir = 'asc';
      }
      if (rerender) rerender();
    };
  });

  // Pagination
  document.querySelectorAll('[data-schedule-page]').forEach(btn => {
    btn.onclick = () => {
      const pg = Number(btn.dataset.schedulePage);
      if (pg >= 1) {
        state.projectSchedulePage = pg;
        if (rerender) rerender();
      }
    };
  });

  // Add Schedule Entry
  document.querySelector('[data-add-schedule]')?.addEventListener('click', () => {
    scheduleEntryModal(p, null, async () => {
      state.projectScheduleData = await api(`/projects/${p.id}/schedules`);
      if (rerender) rerender();
    });
  });

  // Edit Schedule Entry
  document.querySelectorAll('[data-edit-schedule]').forEach(btn => {
    btn.onclick = () => {
      const entryId = btn.dataset.editSchedule;
      const entry = (state.projectScheduleData?.schedules || []).find(s => s.id === entryId);
      if (entry) {
        scheduleEntryModal(p, entry, async () => {
          state.projectScheduleData = await api(`/projects/${p.id}/schedules`);
          if (rerender) rerender();
        });
      }
    };
  });

  // Delete Schedule Entry
  document.querySelectorAll('[data-delete-schedule]').forEach(btn => {
    btn.onclick = async () => {
      const entryId = btn.dataset.deleteSchedule;
      const entry = (state.projectScheduleData?.schedules || []).find(s => s.id === entryId);
      if (!window.confirm(`⚠️ Delete Schedule Entry\n\nAre you sure you want to delete survey schedule entry "${entry?.survey_number || 'this entry'}"?`)) return;
      try {
        btn.disabled = true;
        await api(`/projects/${p.id}/schedules/${entryId}`, { method: 'DELETE' });
        toast('Schedule entry deleted.');
        state.projectScheduleData = await api(`/projects/${p.id}/schedules`);
        if (rerender) rerender();
      } catch (err) {
        toast(err.message || 'Failed to delete schedule entry.', true);
        btn.disabled = false;
      }
    };
  });

  // View Schedule Details
  document.querySelectorAll('[data-view-schedule]').forEach(btn => {
    btn.onclick = () => {
      const entryId = btn.dataset.viewSchedule;
      const entry = (state.projectScheduleData?.schedules || []).find(s => s.id === entryId);
      if (entry) {
        scheduleDetailModal(entry, state.projectPRChains || []);
      }
    };
  });

  // Sync Survey Numbers
  document.querySelector('[data-sync-schedules]')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api(`/projects/${p.id}/schedules/sync-from-surveys`, { method: 'POST' });
      toast(`${res.synced_count} survey number(s) synchronized into schedule.`);
      state.projectScheduleData = await api(`/projects/${p.id}/schedules`);
      if (rerender) rerender();
    } catch (err) {
      toast(err.message || 'Sync failed.', true);
    } finally {
      btn.disabled = false;
    }
  });

  // Export Excel
  document.querySelectorAll('[data-export-schedule-excel]').forEach(btn => {
    btn.onclick = () => {
      exportScheduleToExcel(p, state.projectScheduleData?.schedules || []);
    };
  });

  // Print Schedule
  document.querySelectorAll('[data-print-schedule]').forEach(btn => {
    btn.onclick = () => window.print();
  });

  // Export PDF
  document.querySelector('[data-export-schedule-pdf]')?.addEventListener('click', () => {
    window.print();
  });

  // Add PR Chain
  document.querySelector('[data-add-pr-chain]')?.addEventListener('click', () => {
    prChainModal(p, null, state.projectScheduleData?.schedules || [], async () => {
      state.projectPRChains = await api(`/projects/${p.id}/pr-chains`);
      if (rerender) rerender();
    });
  });

  // Edit PR Chain
  document.querySelectorAll('[data-edit-pr-chain]').forEach(btn => {
    btn.onclick = () => {
      const chainId = btn.dataset.editPrChain;
      const chain = (state.projectPRChains || []).find(c => c.id === chainId);
      if (chain) {
        prChainModal(p, chain, state.projectScheduleData?.schedules || [], async () => {
          state.projectPRChains = await api(`/projects/${p.id}/pr-chains`);
          if (rerender) rerender();
        });
      }
    };
  });

  // Delete PR Chain
  document.querySelectorAll('[data-delete-pr-chain]').forEach(btn => {
    btn.onclick = async () => {
      const chainId = btn.dataset.deletePrChain;
      if (!window.confirm('⚠️ Delete PR Document Reference\n\nAre you sure you want to remove this previous registration document reference?')) return;
      try {
        btn.disabled = true;
        await api(`/projects/${p.id}/pr-chains/${chainId}`, { method: 'DELETE' });
        toast('PR document reference deleted.');
        state.projectPRChains = await api(`/projects/${p.id}/pr-chains`);
        if (rerender) rerender();
      } catch (err) {
        toast(err.message || 'Failed to delete PR document reference.', true);
        btn.disabled = false;
      }
    };
  });

  // Add Acquisition Deed
  document.querySelector('[data-add-acquisition-deed]')?.addEventListener('click', () => {
    acquisitionDeedModal(p, null, async () => {
      state.projectDeeds = await api(`/projects/${p.id}/acquisition-deeds`);
      if (rerender) rerender();
    });
  });

  // Edit Acquisition Deed
  document.querySelectorAll('[data-edit-acquisition-deed]').forEach(btn => {
    btn.onclick = () => {
      const deedId = btn.dataset.editAcquisitionDeed;
      const deed = (state.projectDeeds || []).find(d => d.id === deedId);
      if (deed) {
        acquisitionDeedModal(p, deed, async () => {
          state.projectDeeds = await api(`/projects/${p.id}/acquisition-deeds`);
          if (rerender) rerender();
        });
      }
    };
  });

  // Delete Acquisition Deed
  document.querySelectorAll('[data-delete-acquisition-deed]').forEach(btn => {
    btn.onclick = async () => {
      const deedId = btn.dataset.deleteAcquisitionDeed;
      if (!window.confirm('⚠️ Delete Acquisition Deed\n\nAre you sure you want to delete this acquisition deed record?')) return;
      try {
        btn.disabled = true;
        await api(`/projects/${p.id}/acquisition-deeds/${deedId}`, { method: 'DELETE' });
        toast('Acquisition deed deleted.');
        state.projectDeeds = await api(`/projects/${p.id}/acquisition-deeds`);
        if (rerender) rerender();
      } catch (err) {
        toast(err.message || 'Failed to delete acquisition deed.', true);
        btn.disabled = false;
      }
    };
  });
}

export function unlockProjectModal(project, onUnlocked) {
  const p = project || {};
  const dialog = modal('Unlock Project Access', `
    <form id="unlock-project-form" class="unlock-modal-body">
      <div class="unlock-error-banner" id="unlock-error-banner"></div>
      <p class="muted">
        <strong>${esc(p.project_name || 'This project')}</strong> is protected with a Reviewer Access Password. Please enter the password to view survey numbers and document verification matrix.
      </p>
      <label>Project Access Password *
        <div class="password-input-group">
          <input type="password" id="unlock_password_input" name="password" placeholder="Enter project access password" required autofocus maxlength="100" autocomplete="current-password">
          <button type="button" class="password-toggle-btn" data-toggle-pw="unlock_password_input" title="Show or hide password">${icon('eye')}</button>
        </div>
      </label>
      <div class="modal-actions">
        <button type="button" class="button" data-cancel>Cancel</button>
        <button type="submit" class="button primary">${icon('unlock')} Unlock Project</button>
      </div>
    </form>
  `);

  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();

  const toggleBtn = dialog.querySelector('[data-toggle-pw]');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const input = dialog.querySelector('#' + toggleBtn.dataset.togglePw);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    };
  }

  const form = dialog.querySelector('form');
  const errorBanner = dialog.querySelector('#unlock-error-banner');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (errorBanner) {
        errorBanner.classList.remove('visible');
        errorBanner.textContent = '';
      }
      const submitBtn = form.querySelector('[type=submit]');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying…';
      }

      try {
        const password = form.querySelector('#unlock_password_input')?.value;
        const res = await api(`/projects/${p.id}/unlock`, {
          method: 'POST',
          body: { password }
        });
        setProjectUnlockToken(p.id, res.unlock_token);
        dialog.close();
        toast('Project unlocked successfully!');
        if (typeof onUnlocked === 'function') onUnlocked(res);
      } catch (err) {
        if (errorBanner) {
          errorBanner.textContent = err.message || 'Incorrect project password. Please verify with Administrator.';
          errorBanner.classList.add('visible');
        } else {
          toast(err.message || 'Incorrect project password. Please verify with Administrator.', true);
        }
        const input = form.querySelector('#unlock_password_input');
        if (input) {
          input.value = '';
          input.focus();
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    });
  }
}

export function renderLockedProjectScreen(project) {
  const p = project || {};
  return `
    <a class="back-link" href="#projects">← All Projects</a>
    <div class="locked-project-screen">
      <div class="locked-card">
        <div class="lock-icon-wrap">
          ${icon('lock')}
        </div>
        <span class="eyebrow">REVIEWER ACCESS RESTRICTED</span>
        <h2>${esc(p.project_name || 'Protected Project')}</h2>
        <p>This project is protected with an access password by DNAssets Admin. Please enter the password to view its survey numbers, document checklists, and verification status.</p>
        <div class="button-group">
          <a class="button" href="#projects">Back to Projects</a>
          <button class="button primary" data-unlock-project="${p.id || ''}">${icon('unlock')} Enter Password to Unlock</button>
        </div>
      </div>
    </div>
  `;
}

