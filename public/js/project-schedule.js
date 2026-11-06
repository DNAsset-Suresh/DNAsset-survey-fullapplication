import { esc, icon, badge, empty, modal, wireForm, toast } from './ui.js?v=1.1.1';
import { api } from './api.js?v=1.1.1';

export function renderProjectSubnav(activeTab = 'overview') {
  const tabs = [
    { id: 'overview', label: 'Overview', iconName: 'folder' },
    { id: 'surveys', label: 'Survey Number Management', iconName: 'survey' },
    { id: 'schedule', label: 'Survey-wise Schedule', iconName: 'documents' },
    { id: 'pr-chain', label: 'Previous Document (PR) Chain', iconName: 'arrow' },
    { id: 'deeds', label: 'Acquisition Deeds', iconName: 'verification' },
    { id: 'report', label: 'Project Report', iconName: 'download' }
  ];

  return `
    <nav class="project-subnav" aria-label="Project sections">
      ${tabs.map(t => `
        <button type="button" class="project-subnav-btn ${activeTab === t.id ? 'active' : ''}" data-project-tab="${t.id}" aria-selected="${activeTab === t.id}">
          ${icon(t.iconName)}
          <span>${esc(t.label)}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

export function renderScheduleKPIs(metrics = {}) {
  const conveyed = metrics.total_extent_conveyed_display || '0 cents';
  const valFormatted = metrics.total_schedule_value_formatted || '₹0';
  const subdivisions = metrics.total_subdivisions ?? 0;
  const entries = metrics.total_entries ?? 0;
  const villages = metrics.total_villages ?? 0;
  const deeds = metrics.total_acquisition_deeds ?? 0;

  return `
    <div class="schedule-kpi-grid">
      <article class="schedule-kpi-card">
        <div class="kpi-label">Total Extent Conveyed ${icon('survey')}</div>
        <div class="kpi-val">${esc(conveyed)}</div>
        <div class="kpi-sub">Documented land portions</div>
      </article>

      <article class="schedule-kpi-card">
        <div class="kpi-label">Total Schedule Value ${icon('documents')}</div>
        <div class="kpi-val">${esc(valFormatted)}</div>
        <div class="kpi-sub">Documented value · INR</div>
      </article>

      <article class="schedule-kpi-card">
        <div class="kpi-label">Survey Subdivisions ${icon('verification')}</div>
        <div class="kpi-val">${String(subdivisions).padStart(2, '0')}</div>
        <div class="kpi-sub">Distinct recorded subdivisions</div>
      </article>

      <article class="schedule-kpi-card">
        <div class="kpi-label">Schedule Entries ${icon('folder')}</div>
        <div class="kpi-val">${String(entries).padStart(2, '0')}</div>
        <div class="kpi-sub">Total parcel schedule entries</div>
      </article>

      <article class="schedule-kpi-card">
        <div class="kpi-label">Villages Involved ${icon('search')}</div>
        <div class="kpi-val">${String(villages).padStart(2, '0')}</div>
        <div class="kpi-sub">Locations in project schedules</div>
      </article>

      <article class="schedule-kpi-card">
        <div class="kpi-label">Acquisition Deeds ${icon('check')}</div>
        <div class="kpi-val">${String(deeds).padStart(2, '0')}</div>
        <div class="kpi-sub">Supplied acquisition records</div>
      </article>
    </div>

    ${metrics.methodology ? `
      <div class="methodology-banner">
        ${icon('info')} <span><strong>Calculation Methodology:</strong> ${esc(metrics.methodology)}</span>
      </div>
    ` : ''}
  `;
}

export function renderScheduleTableSection(project, scheduleData, options = {}) {
  const {
    activeVillage = 'all',
    search = '',
    sortCol = 'survey_number',
    sortDir = 'asc',
    page = 1,
    pageSize = 15,
    userRole = 'reviewer'
  } = options;

  const rawSchedules = scheduleData.schedules || [];
  const villages = scheduleData.villages || [];
  const metrics = scheduleData.metrics || {};
  const canEdit = ['admin', 'reviewer'].includes(userRole);
  const canDelete = userRole === 'admin';

  // Filter
  let filtered = rawSchedules.filter(row => {
    if (activeVillage !== 'all' && (row.village || '').trim().toLowerCase() !== activeVillage.toLowerCase()) {
      return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const text = [
        row.survey_number,
        row.subdivision_number,
        row.village,
        row.patta_number,
        row.root_parent_deed,
        row.previous_doc_pr,
        row.total_extent,
        row.extent_conveyed,
        row.schedule_value ? String(row.schedule_value) : ''
      ].join(' ').toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (sortCol === 'schedule_value') {
      va = Number(va) || 0;
      vb = Number(vb) || 0;
    } else if (sortCol === 'survey_number') {
      // Natural sort for survey numbers like 282/1, 282/2
      const [aMain, aSub] = String(va || '').split('/');
      const [bMain, bSub] = String(vb || '').split('/');
      const diff = (parseInt(aMain, 10) || 0) - (parseInt(bMain, 10) || 0);
      if (diff !== 0) return sortDir === 'asc' ? diff : -diff;
      va = aSub || '';
      vb = bSub || '';
    } else {
      va = String(va || '').toLowerCase();
      vb = String(vb || '').toLowerCase();
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Pagination
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const paginatedRows = filtered.slice(startIdx, startIdx + pageSize);

  return `
    <div class="schedule-container">
      ${renderScheduleKPIs(metrics)}

      <section class="panel schedule-panel">
        <div class="schedule-header-controls">
          <div>
            <h2>Survey-wise Schedule <span class="count">${filtered.length}</span></h2>
            <p>Parcel schedules organized by village with parent deeds and previous EC document references.</p>
          </div>
          <div class="button-group">
            ${canEdit ? `
              <button class="button primary" data-add-schedule>${icon('plus')} Add Schedule Entry</button>
              <button class="button" data-sync-schedules title="Import existing survey numbers into schedule">${icon('check')} Sync Survey Numbers</button>
            ` : ''}
            <button class="button" data-export-schedule-excel title="Download Excel Spreadsheet">${icon('download')} Excel (.xlsx)</button>
            <button class="button" data-export-schedule-pdf title="Export PDF">${icon('download')} PDF</button>
            <button class="button" data-print-schedule title="Print Schedule">${icon('clock')} Print</button>
          </div>
        </div>

        <!-- Village Filters & Search -->
        <div class="schedule-filter-bar">
          <div class="village-pill-group" role="group" aria-label="Village filters">
            <button type="button" class="village-pill ${activeVillage === 'all' ? 'active' : ''}" data-village-filter="all">All Villages (${rawSchedules.length})</button>
            ${villages.map(v => {
              const count = rawSchedules.filter(s => (s.village || '').trim().toLowerCase() === v.toLowerCase()).length;
              return `<button type="button" class="village-pill ${activeVillage.toLowerCase() === v.toLowerCase() ? 'active' : ''}" data-village-filter="${esc(v)}">${esc(v)} (${count})</button>`;
            }).join('')}
          </div>

          <label class="schedule-search-box">
            ${icon('search')}
            <input id="schedule-search-input" type="search" value="${esc(search)}" placeholder="Search survey no., patta, deed, PR no...." aria-label="Search schedule">
          </label>
        </div>

        <!-- Schedule Data Table (Dark Navy Style as specified in Phase 8) -->
        <div class="schedule-table-wrap">
          <table class="schedule-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th data-sort="village" class="sortable ${sortCol === 'village' ? 'sorted-' + sortDir : ''}">Village</th>
                <th data-sort="survey_number" class="sortable ${sortCol === 'survey_number' ? 'sorted-' + sortDir : ''}">Survey No.</th>
                <th>Total Extent</th>
                <th>Extent Conveyed</th>
                <th data-sort="patta_number" class="sortable ${sortCol === 'patta_number' ? 'sorted-' + sortDir : ''}">Patta No.</th>
                <th>Root / Parent Deed</th>
                <th>Previous Doc (PR) – per EC</th>
                <th data-sort="schedule_value" class="sortable ${sortCol === 'schedule_value' ? 'sorted-' + sortDir : ''}">Value (₹)</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${paginatedRows.length ? paginatedRows.map((row, idx) => {
                const sNo = startIdx + idx + 1;
                const surveyFull = row.subdivision_number ? `${row.survey_number}/${row.subdivision_number}` : row.survey_number;
                const valDisp = row.schedule_value ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(row.schedule_value) : '—';
                return `
                  <tr data-schedule-id="${esc(row.id)}">
                    <td class="text-muted">${sNo}</td>
                    <td><strong>${esc(row.village || '—')}</strong></td>
                    <td>
                      <span class="survey-badge">${esc(surveyFull)}</span>
                    </td>
                    <td>${esc(row.total_extent || '—')}</td>
                    <td><strong class="teal-text">${esc(row.extent_conveyed || '—')}</strong></td>
                    <td>${esc(row.patta_number || '—')}</td>
                    <td>
                      <span class="deed-flow">${esc(row.root_parent_deed || '—')}</span>
                    </td>
                    <td>
                      <span class="pr-doc-tag">${esc(row.previous_doc_pr || '—')}</span>
                    </td>
                    <td class="schedule-value-cell">${esc(valDisp)}</td>
                    <td style="text-align: right;">
                      <div class="action-btn-group">
                        <button class="icon-btn" data-view-schedule="${esc(row.id)}" title="View complete details">${icon('eye')}</button>
                        ${canEdit ? `<button class="icon-btn" data-edit-schedule="${esc(row.id)}" title="Edit entry">${icon('edit')}</button>` : ''}
                        ${canDelete ? `<button class="icon-btn danger-btn" data-delete-schedule="${esc(row.id)}" title="Delete entry">${icon('close')}</button>` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr>
                  <td colspan="10" class="empty-table-cell">
                    ${empty('No schedule entries found', search || activeVillage !== 'all' ? 'No entries match your search or village filter. Try clearing filters.' : 'Click "Add Schedule Entry" or "Sync Survey Numbers" to populate.')}
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>

        <!-- Table Footer / Pagination -->
        <div class="schedule-table-footer">
          <div class="table-info">
            Showing <strong>${filtered.length ? startIdx + 1 : 0}</strong> to <strong>${Math.min(startIdx + pageSize, filtered.length)}</strong> of <strong>${filtered.length}</strong> entries
          </div>
          <div class="pagination-controls">
            <button class="button small-button" data-schedule-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button>
            <span class="page-indicator">Page ${currentPage} of ${totalPages}</span>
            <button class="button small-button" data-schedule-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderPRChainSection(project, prChains = [], schedules = [], userRole = 'reviewer') {
  const canEdit = ['admin', 'reviewer'].includes(userRole);
  const canDelete = userRole === 'admin';

  return `
    <div class="pr-chain-container">
      <div class="page-heading">
        <div>
          <span class="eyebrow">TITLE TRACEABILITY & REVENUE CHRONOLOGY</span>
          <h2>Previous Document (PR) Chain<span class="heading-dot">.</span></h2>
          <p>Trace registered document lineage per Encumbrance Certificate (EC) for each survey parcel from root deed to present acquisition.</p>
        </div>
        <div class="button-group">
          ${canEdit ? `<button class="button primary" data-add-pr-chain>${icon('plus')} Add PR Document Reference</button>` : ''}
        </div>
      </div>

      <!-- Chain Relationship Concept Banner -->
      <div class="pr-chain-visual-flow">
        <div class="flow-step">
          <div class="flow-step-icon">${icon('folder')}</div>
          <strong>Original Parent Deed</strong>
          <small>Root title conveyance</small>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step">
          <div class="flow-step-icon">${icon('documents')}</div>
          <strong>Previous Doc (PR)</strong>
          <small>EC referenced registrations</small>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step">
          <div class="flow-step-icon">${icon('arrow')}</div>
          <strong>Subsequent Registration</strong>
          <small>Intermediate partitions / transfers</small>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-step active-step">
          <div class="flow-step-icon">${icon('verification')}</div>
          <strong>Current Acquisition Deed</strong>
          <small>Present registered owner</small>
        </div>
      </div>

      <!-- PR Chain Records Grid -->
      <div class="pr-chain-grid">
        ${prChains.length ? prChains.map(chain => {
          const isVerified = chain.verification_status === 'Verified';
          return `
            <article class="pr-card ${isVerified ? 'verified-card' : 'unverified-card'}">
              <div class="pr-card-header">
                <div>
                  <div class="eyebrow">${esc(chain.document_type || 'Registration Document')}</div>
                  <h3>Doc No: ${esc(chain.previous_doc_number)} ${chain.registration_year ? `(${esc(chain.registration_year)})` : ''}</h3>
                </div>
                <span class="badge ${isVerified ? 'green' : 'amber'}">${esc(chain.verification_status || 'Unverified')}</span>
              </div>

              <div class="pr-card-body">
                <dl class="pr-details-grid">
                  <div>
                    <dt>Survey Number</dt>
                    <dd><strong>${esc(chain.survey_number || 'All Project Parcels')}</strong>${chain.subdivisions ? ` (Sub: ${esc(chain.subdivisions)})` : ''}</dd>
                  </div>
                  <div>
                    <dt>Village</dt>
                    <dd>${esc(chain.village || project.village || '—')}</dd>
                  </div>
                  <div>
                    <dt>Root / Parent Document</dt>
                    <dd>${esc(chain.parent_root_doc || '—')}</dd>
                  </div>
                  <div>
                    <dt>EC Reference</dt>
                    <dd>${esc(chain.ec_reference || 'Mentioned in EC')}</dd>
                  </div>
                  ${chain.from_party || chain.to_party ? `
                    <div style="grid-column: 1 / -1;">
                      <dt>Parties</dt>
                      <dd><strong>${esc(chain.from_party || 'Seller')}</strong> → <strong>${esc(chain.to_party || 'Purchaser')}</strong></dd>
                    </div>
                  ` : ''}
                  ${chain.extent ? `
                    <div>
                      <dt>Extent Documented</dt>
                      <dd>${esc(chain.extent)}</dd>
                    </div>
                  ` : ''}
                  ${chain.value ? `
                    <div>
                      <dt>Transaction Value</dt>
                      <dd>${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(chain.value)}</dd>
                    </div>
                  ` : ''}
                </dl>

                ${chain.notes ? `<p class="pr-notes"><strong>Notes:</strong> ${esc(chain.notes)}</p>` : ''}
                ${chain.attachment_url ? `
                  <div class="pr-attachment">
                    <a href="${esc(chain.attachment_url)}" target="_blank" rel="noopener">${icon('documents')} View Supporting Document: ${esc(chain.attachment_name || 'Attached Deed')}</a>
                  </div>
                ` : ''}
              </div>

              <div class="pr-card-footer">
                <div class="chain-status-note">
                  ${isVerified ? `${icon('check')} Verified against source EC records` : `${icon('info')} Unverified relationship — advocate review required`}
                </div>
                <div class="button-group">
                  ${canEdit ? `<button class="button small-button" data-edit-pr-chain="${esc(chain.id)}">${icon('edit')} Edit</button>` : ''}
                  ${canDelete ? `<button class="button small-button danger" data-delete-pr-chain="${esc(chain.id)}">${icon('close')} Delete</button>` : ''}
                </div>
              </div>
            </article>
          `;
        }).join('') : `
          <div class="panel empty-pr-panel">
            ${empty('No previous document records', 'Add PR document references found in Encumbrance Certificates (EC) to establish complete title chain traceability.')}
          </div>
        `}
      </div>
    </div>
  `;
}

export function renderAcquisitionDeedsSection(project, deeds = [], userRole = 'reviewer') {
  const canEdit = ['admin', 'reviewer'].includes(userRole);
  const canDelete = userRole === 'admin';

  return `
    <div class="deeds-container">
      <div class="page-heading">
        <div>
          <span class="eyebrow">TITLE ACQUISITIONS</span>
          <h2>Acquisition Deeds Register <span class="count">${deeds.length}</span></h2>
          <p>Chronological acquisition records detailing deeds, parties, values, and covered survey numbers.</p>
        </div>
        <div class="button-group">
          ${canEdit ? `<button class="button primary" data-add-acquisition-deed>${icon('plus')} Add Acquisition Deed</button>` : ''}
        </div>
      </div>

      <div class="deeds-card-grid">
        ${deeds.length ? deeds.map(deed => {
          const valFormatted = deed.value ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(deed.value) : '—';
          return `
            <article class="deed-record-card">
              <div class="deed-record-header">
                <span class="deed-badge-icon">▣</span>
                <div>
                  <div class="eyebrow">${esc(deed.document_type || 'ACQUISITION DEED')}</div>
                  <h3>Doc No: ${esc(deed.document_number)}</h3>
                </div>
                <span class="badge green">${esc(deed.status || 'Verified')}</span>
              </div>

              <dl class="deed-grid">
                <div>
                  <dt>Registration Year</dt>
                  <dd>${esc(deed.registration_year || deed.registration_date || '—')}</dd>
                </div>
                <div>
                  <dt>Sub-Registrar Office (SRO)</dt>
                  <dd>${esc(deed.sro || '—')}</dd>
                </div>
                <div>
                  <dt>Seller / Executant</dt>
                  <dd>${esc(deed.seller || '—')}</dd>
                </div>
                <div>
                  <dt>Purchaser / Claimant</dt>
                  <dd>${esc(deed.purchaser || '—')}</dd>
                </div>
                <div>
                  <dt>Previous Document (PR)</dt>
                  <dd>${esc(deed.previous_document || '—')}</dd>
                </div>
                <div>
                  <dt>Property Extent</dt>
                  <dd><strong>${esc(deed.extent || '—')}</strong></dd>
                </div>
                <div>
                  <dt>Registration Value</dt>
                  <dd>${esc(valFormatted)}</dd>
                </div>
                <div>
                  <dt>Related Survey Numbers</dt>
                  <dd><span class="survey-badge">${esc(deed.survey_numbers || 'All Parcels')}</span></dd>
                </div>
              </dl>

              <div class="deed-card-footer">
                <span>Source: ${esc(deed.source || 'Supplied Document')}</span>
                <div class="button-group">
                  ${canEdit ? `<button class="button small-button" data-edit-acquisition-deed="${esc(deed.id)}">${icon('edit')} Edit</button>` : ''}
                  ${canDelete ? `<button class="button small-button danger" data-delete-acquisition-deed="${esc(deed.id)}">${icon('close')} Delete</button>` : ''}
                </div>
              </div>
            </article>
          `;
        }).join('') : `
          <div class="panel empty-deed-panel">
            ${empty('No acquisition deeds recorded', 'Add registered acquisition deeds to trace current ownership against survey schedules.')}
          </div>
        `}
      </div>
    </div>
  `;
}

// --- Modals ---
export function scheduleEntryModal(project, entry = null, onSaved) {
  const isEdit = Boolean(entry && entry.id);
  const data = entry || {};

  const dialog = modal(isEdit ? 'Edit Schedule Entry' : 'Add Schedule Entry', `
    <form id="schedule-entry-form">
      <div class="form-grid">
        <label>Village
          <input name="village" type="text" value="${esc(data.village || project.village || '')}" required placeholder="e.g. Mathur">
        </label>
        <label>Survey Number
          <input name="survey_number" type="text" value="${esc(data.survey_number || '')}" required placeholder="e.g. 282">
        </label>
        <label>Subdivision Number
          <input name="subdivision_number" type="text" value="${esc(data.subdivision_number || '')}" placeholder="e.g. 1 or 2A">
        </label>
        <label>Total Extent
          <input name="total_extent" type="text" value="${esc(data.total_extent || '')}" placeholder="e.g. 66½ cent or 2.5 acres">
        </label>
        <label>Extent Conveyed
          <input name="extent_conveyed" type="text" value="${esc(data.extent_conveyed || '')}" placeholder="e.g. 0.26½ cent">
        </label>
        <label>Patta Number
          <input name="patta_number" type="text" value="${esc(data.patta_number || '')}" placeholder="e.g. 1506">
        </label>
        <label>Root / Parent Deed
          <input name="root_parent_deed" type="text" value="${esc(data.root_parent_deed || '')}" placeholder="e.g. 2223/2000 → 3618/2020">
        </label>
        <label>Previous Doc (PR) – per EC
          <input name="previous_doc_pr" type="text" value="${esc(data.previous_doc_pr || '')}" placeholder="e.g. 1480/93, 1482/93">
        </label>
        <label>Schedule Value (₹)
          <input name="schedule_value" type="number" step="0.01" min="0" value="${data.schedule_value ?? ''}" placeholder="e.g. 79500">
        </label>
        <label>Verification Status
          <select name="verification_status">
            <option value="Verified" ${data.verification_status === 'Verified' ? 'selected' : ''}>Verified</option>
            <option value="Mentioned in EC only" ${data.verification_status === 'Mentioned in EC only' ? 'selected' : ''}>Mentioned in EC only</option>
            <option value="Not independently examined" ${data.verification_status === 'Not independently examined' ? 'selected' : ''}>Not independently examined</option>
            <option value="Missing / To Confirm" ${data.verification_status === 'Missing / To Confirm' ? 'selected' : ''}>Missing / To Confirm</option>
            <option value="Under Review" ${data.verification_status === 'Under Review' ? 'selected' : ''}>Under Review</option>
          </select>
        </label>
      </div>
      <label>Remarks / Notes
        <textarea name="remarks" rows="2" placeholder="Any specific boundary or title clearance notes">${esc(data.remarks || '')}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="button" data-close>Cancel</button>
        <button type="submit" class="button primary">${isEdit ? 'Save Changes' : 'Create Entry'}</button>
      </div>
    </form>
  `);

  wireForm(dialog.querySelector('form'), async formVals => {
    const payload = Object.fromEntries(formVals);
    if (payload.schedule_value) payload.schedule_value = Number(payload.schedule_value);
    else delete payload.schedule_value;

    const url = isEdit ? `/projects/${project.id}/schedules/${data.id}` : `/projects/${project.id}/schedules`;
    const method = isEdit ? 'PUT' : 'POST';
    await api(url, { method, body: payload });
    dialog.close();
    toast(isEdit ? 'Schedule entry updated.' : 'Schedule entry created.');
    if (typeof onSaved === 'function') await onSaved();
  });
}

export function prChainModal(project, entry = null, schedules = [], onSaved) {
  const isEdit = Boolean(entry && entry.id);
  const data = entry || {};

  const dialog = modal(isEdit ? 'Edit PR Document Reference' : 'Add PR Document Reference', `
    <form id="pr-chain-form">
      <div class="form-grid">
        <label>Previous Document Number (PR) *
          <input name="previous_doc_number" type="text" value="${esc(data.previous_doc_number || '')}" required placeholder="e.g. 1480/1993">
        </label>
        <label>Document Type
          <input name="document_type" type="text" value="${esc(data.document_type || 'Sale Deed')}" placeholder="e.g. Sale Deed, Partition, Settlement">
        </label>
        <label>Registration Year
          <input name="registration_year" type="text" value="${esc(data.registration_year || '')}" placeholder="e.g. 1993">
        </label>
        <label>Related Survey Number
          <input name="survey_number" type="text" value="${esc(data.survey_number || '')}" placeholder="e.g. 282/1">
        </label>
        <label>Village
          <input name="village" type="text" value="${esc(data.village || project.village || '')}" placeholder="e.g. Mathur">
        </label>
        <label>Parent / Root Document
          <input name="parent_root_doc" type="text" value="${esc(data.parent_root_doc || '')}" placeholder="e.g. 2223/2000">
        </label>
        <label>Related EC Reference
          <input name="ec_reference" type="text" value="${esc(data.ec_reference || '')}" placeholder="e.g. EC Entry #412">
        </label>
        <label>Related Acquisition Deed
          <input name="acquisition_deed" type="text" value="${esc(data.acquisition_deed || '')}" placeholder="e.g. 3618/2020">
        </label>
        <label>Seller / Executant
          <input name="from_party" type="text" value="${esc(data.from_party || '')}" placeholder="e.g. Original Owner">
        </label>
        <label>Purchaser / Claimant
          <input name="to_party" type="text" value="${esc(data.to_party || '')}" placeholder="e.g. Intermediate Purchaser">
        </label>
        <label>Extent
          <input name="extent" type="text" value="${esc(data.extent || '')}" placeholder="e.g. 66½ cent">
        </label>
        <label>Transaction Value (₹)
          <input name="value" type="number" step="0.01" min="0" value="${data.value ?? ''}" placeholder="e.g. 50000">
        </label>
        <label>Verification Status
          <select name="verification_status">
            <option value="Verified" ${data.verification_status === 'Verified' ? 'selected' : ''}>Verified</option>
            <option value="Unverified" ${data.verification_status === 'Unverified' ? 'selected' : ''}>Unverified</option>
            <option value="Mentioned in EC only" ${data.verification_status === 'Mentioned in EC only' ? 'selected' : ''}>Mentioned in EC only</option>
            <option value="Pending" ${data.verification_status === 'Pending' ? 'selected' : ''}>Pending</option>
          </select>
        </label>
        <label>Supporting Document URL / Link
          <input name="attachment_url" type="text" value="${esc(data.attachment_url || '')}" placeholder="https://... or signed storage link">
        </label>
      </div>
      <label>Notes & Observations
        <textarea name="notes" rows="2" placeholder="Record chain details, title notes, advocate clearance comments...">${esc(data.notes || '')}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="button" data-close>Cancel</button>
        <button type="submit" class="button primary">${isEdit ? 'Save Changes' : 'Record PR Document'}</button>
      </div>
    </form>
  `);

  wireForm(dialog.querySelector('form'), async formVals => {
    const payload = Object.fromEntries(formVals);
    if (payload.value) payload.value = Number(payload.value);
    else delete payload.value;

    const url = isEdit ? `/projects/${project.id}/pr-chains/${data.id}` : `/projects/${project.id}/pr-chains`;
    const method = isEdit ? 'PUT' : 'POST';
    await api(url, { method, body: payload });
    dialog.close();
    toast(isEdit ? 'PR document reference updated.' : 'PR document reference recorded.');
    if (typeof onSaved === 'function') await onSaved();
  });
}

export function acquisitionDeedModal(project, entry = null, onSaved) {
  const isEdit = Boolean(entry && entry.id);
  const data = entry || {};

  const dialog = modal(isEdit ? 'Edit Acquisition Deed' : 'Add Acquisition Deed', `
    <form id="acquisition-deed-form">
      <div class="form-grid">
        <label>Document Number *
          <input name="document_number" type="text" value="${esc(data.document_number || '')}" required placeholder="e.g. 3618/2020">
        </label>
        <label>Document Type
          <input name="document_type" type="text" value="${esc(data.document_type || 'Sale Deed')}" placeholder="e.g. Sale Deed">
        </label>
        <label>Registration Year
          <input name="registration_year" type="text" value="${esc(data.registration_year || '')}" placeholder="e.g. 2020">
        </label>
        <label>Sub-Registrar Office (SRO)
          <input name="sro" type="text" value="${esc(data.sro || '')}" placeholder="e.g. Thirukanur">
        </label>
        <label>Seller / Executant
          <input name="seller" type="text" value="${esc(data.seller || '')}" placeholder="e.g. Seller Name">
        </label>
        <label>Purchaser / Claimant
          <input name="purchaser" type="text" value="${esc(data.purchaser || '')}" placeholder="e.g. Developer / Current Owner">
        </label>
        <label>Previous Document (PR)
          <input name="previous_document" type="text" value="${esc(data.previous_document || '')}" placeholder="e.g. 2223/2000">
        </label>
        <label>Related Survey Numbers
          <input name="survey_numbers" type="text" value="${esc(data.survey_numbers || '')}" placeholder="e.g. 282/1, 282/2">
        </label>
        <label>Property Extent
          <input name="extent" type="text" value="${esc(data.extent || '')}" placeholder="e.g. 1.25 acres">
        </label>
        <label>Registration Value (₹)
          <input name="value" type="number" step="0.01" min="0" value="${data.value ?? ''}" placeholder="e.g. 1500000">
        </label>
      </div>
      <label>Source Reference / Remarks
        <textarea name="remarks" rows="2" placeholder="Deed source, volume number, page, notes...">${esc(data.remarks || '')}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="button" data-close>Cancel</button>
        <button type="submit" class="button primary">${isEdit ? 'Save Deed' : 'Add Deed'}</button>
      </div>
    </form>
  `);

  wireForm(dialog.querySelector('form'), async formVals => {
    const payload = Object.fromEntries(formVals);
    if (payload.value) payload.value = Number(payload.value);
    else delete payload.value;

    const url = isEdit ? `/projects/${project.id}/acquisition-deeds/${data.id}` : `/projects/${project.id}/acquisition-deeds`;
    const method = isEdit ? 'PUT' : 'POST';
    await api(url, { method, body: payload });
    dialog.close();
    toast(isEdit ? 'Acquisition deed updated.' : 'Acquisition deed added.');
    if (typeof onSaved === 'function') await onSaved();
  });
}

export function scheduleDetailModal(entry, prChains = []) {
  const d = entry || {};
  const surveyFull = d.subdivision_number ? `${d.survey_number}/${d.subdivision_number}` : d.survey_number;
  const matchingPRs = prChains.filter(pr => pr.survey_number && (pr.survey_number === d.survey_number || pr.survey_number === surveyFull));

  modal(`Survey Schedule Details · ${esc(surveyFull)}`, `
    <div class="schedule-detail-view">
      <dl class="schedule-detail-grid">
        <div><dt>Village</dt><dd><strong>${esc(d.village || '—')}</strong></dd></div>
        <div><dt>Survey Number</dt><dd><strong>${esc(surveyFull)}</strong></dd></div>
        <div><dt>Total Extent</dt><dd>${esc(d.total_extent || '—')}</dd></div>
        <div><dt>Extent Conveyed</dt><dd><strong class="teal-text">${esc(d.extent_conveyed || '—')}</strong></dd></div>
        <div><dt>Patta Number</dt><dd>${esc(d.patta_number || '—')}</dd></div>
        <div><dt>Root / Parent Deed</dt><dd>${esc(d.root_parent_deed || '—')}</dd></div>
        <div><dt>Previous Doc (PR)</dt><dd>${esc(d.previous_doc_pr || '—')}</dd></div>
        <div><dt>Schedule Value</dt><dd>${d.schedule_value ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(d.schedule_value) : '—'}</dd></div>
        <div><dt>Verification Status</dt><dd>${badge(d.verification_status || 'Verified')}</dd></div>
        <div><dt>Source / Page</dt><dd>${esc(d.source_page || 'Supplied Document')}</dd></div>
      </dl>

      ${d.remarks ? `<p class="schedule-remarks"><strong>Remarks:</strong> ${esc(d.remarks)}</p>` : ''}

      <div class="schedule-pr-section">
        <h3>Associated Previous Registration (PR) Chain</h3>
        ${matchingPRs.length ? `
          <ul class="schedule-pr-list">
            ${matchingPRs.map(pr => `
              <li>
                <div>
                  <strong>Doc #${esc(pr.previous_doc_number)}</strong> (${esc(pr.registration_year || 'Year —')}) · ${esc(pr.document_type || 'Deed')}
                  <small>${esc(pr.from_party || 'Seller')} → ${esc(pr.to_party || 'Purchaser')}</small>
                </div>
                <span class="badge ${pr.verification_status === 'Verified' ? 'green' : 'amber'}">${esc(pr.verification_status || 'Unverified')}</span>
              </li>
            `).join('')}
          </ul>
        ` : '<p class="muted">No direct PR document records linked yet for this parcel.</p>'}
      </div>
    </div>
  `);
}

// --- Excel Export (Phase 3) ---
export async function exportScheduleToExcel(project, schedules = []) {
  try {
    toast('Preparing Excel export…');
    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/vendor/xlsx.mini.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load Excel library.'));
        document.head.append(s);
      });
    }

    const headers = [
      '#',
      'Village',
      'Survey No.',
      'Total Extent',
      'Extent Conveyed',
      'Patta No.',
      'Root / Parent Deed',
      'Previous Doc (PR) – per EC',
      'Value (INR)',
      'Verification Status',
      'Remarks'
    ];

    const rows = schedules.map((row, idx) => {
      const surveyFull = row.subdivision_number ? `${row.survey_number}/${row.subdivision_number}` : row.survey_number;
      return [
        idx + 1,
        row.village || '',
        surveyFull,
        row.total_extent || '',
        row.extent_conveyed || '',
        row.patta_number || '',
        row.root_parent_deed || '',
        row.previous_doc_pr || '',
        row.schedule_value ?? '',
        row.verification_status || 'Verified',
        row.remarks || ''
      ];
    });

    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 30 },
      { wch: 30 },
      { wch: 16 },
      { wch: 20 },
      { wch: 35 }
    ];

    window.XLSX.utils.book_append_sheet(wb, ws, 'Survey Schedule');
    const filename = `${(project.project_name || 'project').toLowerCase().replace(/\s+/g, '-')}-survey-schedule.xlsx`;
    window.XLSX.writeFile(wb, filename);
    toast('Excel spreadsheet downloaded.');
  } catch (err) {
    toast('Excel export failed: ' + err.message, true);
  }
}

