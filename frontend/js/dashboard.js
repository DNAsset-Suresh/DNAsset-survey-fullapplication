import { esc, icon, meter, empty, badge } from './ui.js';
import { renderProjectTable, renderStatusMatrix } from './projects.js';

export const locationText = p => [p.village, p.taluk, p.district].filter(Boolean).join(', ') || 'To be entered';

export function surveyTable(properties) {
  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Survey / Property</th>
            <th>Location</th>
            <th>Collected</th>
            <th>Pending</th>
            <th>Verified</th>
            <th>Collection</th>
            <th>Verification</th>
            <th><span class="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          ${properties.map(p => `
            <tr>
              <td>
                <a class="survey-link" href="#survey/${p.id}">
                  ${icon('survey')}
                  <span>
                    ${esc(p.survey_number)}
                    <small>${esc(p.property_name || 'Property details pending')}</small>
                  </span>
                </a>
              </td>
              <td class="muted">${esc(locationText(p))}</td>
              <td><strong>${p.progress?.collected ?? 0}</strong><span class="muted"> / 7</span></td>
              <td>${p.progress?.pending ?? 7}</td>
              <td>${p.progress?.verified ?? 0}<span class="muted"> / 7</span></td>
              <td>
                <div class="table-progress">
                  <span>${p.progress?.collection_percentage ?? 0}%</span>
                  ${meter(p.progress?.collection_percentage ?? 0, 'Collection')}
                </div>
              </td>
              <td>
                <div class="table-progress">
                  <span>${p.progress?.verification_percentage ?? 0}%</span>
                  ${meter(p.progress?.verification_percentage ?? 0, 'Verification')}
                </div>
              </td>
              <td>
                <a class="text-link nowrap" href="#survey/${p.id}">View checklist ${icon('arrow')}</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${properties.length ? '' : empty('No surveys found', 'Add a survey or ask your administrator for property access.')}
  `;
}

export function renderDashboard(projects, properties, summary, activeMatrix, currentUserRole = '') {
  const totalProjects = summary.total_projects ?? projects.length;
  const totalSurveys = summary.total_surveys ?? properties.length;
  const totalRequired = summary.total_required ?? (totalSurveys * 7);
  const collected = summary.total_collected ?? summary.collected ?? 0;
  const pending = summary.total_pending ?? summary.pending ?? totalRequired;
  const verified = summary.total_verified ?? summary.verified ?? 0;
  const rejected = summary.total_rejected ?? summary.rejected ?? 0;
  const collectionPercentage = summary.overall_collection_percentage ?? summary.collection_percentage ?? 0;
  const verificationPercentage = summary.overall_verification_percentage ?? summary.verification_percentage ?? 0;

  const currentProject = projects[0] || { project_name: 'No active project', project_code: '' };

  return `
    <div class="page-heading">
      <div>
        <span class="eyebrow">DNAssets PROJECT-WISE PORTAL</span>
        <h1>Project & Survey Dashboard<span class="heading-dot">.</span></h1>
        <p>A unified hierarchy: Project Name is the main record holding multiple survey numbers.</p>
      </div>
      <div class="button-group">
        <a class="button" href="#property-overview">${icon('reports')} Property Overview</a>
        <button class="button primary" data-add-project>${icon('plus')} Add New Project</button>
        <button class="button" data-add-survey>${icon('plus')} Add Survey Number</button>
      </div>
    </div>

    <!-- Master Executive KPI Cards -->
    <div class="stat-grid">
      <article class="stat">
        <div class="stat-label">Total Projects ${icon('folder')}</div>
        <div class="stat-value">${totalProjects.toString().padStart(2, '0')}<span>projects</span></div>
        <div class="stat-foot">${totalSurveys} total survey numbers</div>
      </article>

      <article class="stat">
        <div class="stat-label">Total Survey Numbers ${icon('survey')}</div>
        <div class="stat-value">${totalSurveys.toString().padStart(2, '0')}<span>parcels</span></div>
        <div class="stat-foot">${totalRequired} total document categories</div>
      </article>

      <article class="stat">
        <div class="stat-label">Documents Collected ${icon('documents')}</div>
        <div class="stat-value">${collected.toString().padStart(2, '0')}<span>of ${totalRequired}</span></div>
        <div class="stat-foot teal">${collectionPercentage}% collection complete</div>
      </article>

      <article class="stat">
        <div class="stat-label">Documents Verified ${icon('verification')}</div>
        <div class="stat-value">${verified.toString().padStart(2, '0')}<span>approved</span></div>
        <div class="stat-foot">${verificationPercentage}% verified · ${rejected} rejected</div>
      </article>
    </div>

    <div class="stat-grid"><article class="stat"><div class="stat-label">Total Documents</div><div class="stat-value">${totalRequired}</div><div class="stat-foot">Required checklist categories</div></article><article class="stat"><div class="stat-label">Pending verification</div><div class="stat-value">${Math.max(0,totalRequired-verified-rejected)}</div></article><article class="stat"><div class="stat-label">Rejected documents</div><div class="stat-value">${rejected}</div></article><article class="stat"><div class="stat-label">Overall completion</div><div class="stat-value">${verificationPercentage}%</div></article></div>
    <!-- Readiness Orbit and Next Move -->
    <div class="overview-grid">
      <section class="panel progress-panel">
        <div class="section-top">
          <div>
            <span class="eyebrow">PORTFOLIO READINESS</span>
            <h2>Overall Document Progress</h2>
          </div>
          <span class="badge gray">Across All Projects</span>
        </div>
        <div class="readiness-content">
          <div class="progress-orbit">
            <svg viewBox="0 0 140 140" aria-hidden="true">
              <circle cx="70" cy="70" r="60" class="orbit-track"/>
              <circle cx="70" cy="70" r="60" class="orbit-value" stroke-dasharray="${collectionPercentage * 3.77} 377"/>
            </svg>
            <div>
              <strong>${collectionPercentage}%</strong>
              <span>collected</span>
            </div>
          </div>
          <div class="readiness-bars">
            <div class="progress-label">
              <span><i class="legend-dot teal-bg"></i>Collection progress</span>
              <strong>${collected} / ${totalRequired}</strong>
            </div>
            ${meter(collectionPercentage, 'Overall collection')}
            <div class="progress-label second">
              <span><i class="legend-dot sage-bg"></i>Verification progress</span>
              <strong>${verified} / ${totalRequired}</strong>
            </div>
            ${meter(verificationPercentage, 'Overall verification')}
            <p class="small">Each survey number maintains an independent 7-document checklist.</p>
          </div>
        </div>
      </section>

      <aside class="next-step">
        <div class="next-icon">${icon('folder')}</div>
        <span class="eyebrow">EASY STATUS ACCESS</span>
        <h2>Explore Project Status</h2>
        <p>Select any project to inspect all survey numbers and their 7 required document verification states at a glance.</p>
        <a class="text-link" href="${projects.length ? `#project/${projects[0].id}` : '#projects'}">
          Open ${esc(currentProject.project_name)} ${icon('arrow')}
        </a>
        <div class="decor-lines" aria-hidden="true"></div>
      </aside>
    </div>

    <!-- EASY STATUS CHECKER / MATRIX VIEW -->
    <section class="panel ui-3e43f6f8">
      <div class="section-top">
        <div>
          <span class="eyebrow">EASY STATUS CHECKER</span>
          <h2>Project: ${esc(currentProject.project_name)} · Survey Status Matrix</h2>
          <p>Instantly check the status of all survey numbers and their 7 documents without navigating through multiple pages.</p>
        </div>
        <div class="ui-85aafcf8">
          <a class="button small-button primary" href="#project/${currentProject.id}">Open Full Project View ${icon('arrow')}</a>
        </div>
      </div>

      <div class="ui-6230a1cf">
        ${activeMatrix && activeMatrix.survey_checklists
          ? renderStatusMatrix(activeMatrix.survey_checklists, currentProject)
          : (currentProject.is_password_protected && !currentProject.is_unlocked
              ? `<div class="locked-card ui-81b032c2">
                   <div class="lock-icon-wrap ui-f4c14f3c">${icon('lock')}</div>
                   <h3 class="ui-7f3cbaf6">${esc(currentProject.project_name)} is Password Protected</h3>
                   <p class="ui-97c8a088">Enter the reviewer access password to unlock and view its survey numbers and document verification status.</p>
                   <button class="button small-button primary" data-unlock-project="${currentProject.id}">${icon('unlock')} Enter Password to Unlock</button>
                 </div>`
              : '<p class="loading-state">Loading status matrix…</p>')}
      </div>
    </section>

    <!-- Project Register Table as required by Prompt Section 5 -->
    <section class="panel ui-3e43f6f8">
      <div class="section-top">
        <div>
          <h2>Project Register <span class="count">${projects.length}</span></h2>
          <p>All property development projects with aggregate survey numbers and collection progress.</p>
        </div>
        <button class="button small-button primary" data-add-project>${icon('plus')} Add New Project</button>
      </div>
      ${renderProjectTable(projects, currentUserRole)}
      <div class="panel-footer">
        ${icon('info')} Click "Open Project" on any record to manage its survey numbers and view the project-level document report.
      </div>
    </section>

    <!-- Survey Register Panel -->
    <section class="panel">
      <div class="section-top">
        <div>
          <h2>Survey Register <span class="count">${properties.length}</span></h2>
          <p>Individual property parcels and independent verification status.</p>
        </div>
        <a class="text-link" href="#surveys">View all surveys ${icon('arrow')}</a>
      </div>
      ${surveyTable(properties.slice(0, 5))}
    </section>
  `;
}
