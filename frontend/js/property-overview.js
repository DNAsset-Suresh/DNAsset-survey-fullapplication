import { NA, STATUSES, columns, text, number, money, extent, landTotal, source, status, confirmed, metrics, matches, scheduleRows, totalsRow, chronological } from './property-overview-data.js';

function createOverview(root = document, host = document.body) {
const lifecycle = new AbortController();
const $ = selector => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const value = v => esc(text(v));
const pill = record => `<span class="pill ${confirmed(record) ? 'green' : status(record) === STATUSES[3] ? 'amber' : 'blue'}">${esc(status(record))}</span>`;
const field = (label, content) => `<div class="info-field"><dt>${esc(label)}</dt><dd>${value(content)}</dd></div>`;
const empty = (hint, symbol = '◇') => `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">${symbol}</span><strong>${NA}</strong><p>${esc(hint)}</p></div>`;
const emptyRow = (count, hint) => `<tr><td colspan="${count}" class="empty-cell"><strong>${NA}</strong><p>${esc(hint)}</p></td></tr>`;
let data, confirmation = 'all', visibleSchedules = [], workbookLibrary;
let feedbackTimer;
function feedback(message) { $('#feedback').textContent = message; clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { $('#feedback').textContent = ''; }, 7000); }
function filters() { return Object.fromEntries(new FormData($('#filter-form'))); }
function activeFilters() { return Object.values(filters()).some(v => v.trim()) || confirmation !== 'all'; }
function blankHint(defaultHint) { return activeFilters() ? 'No records match these filters. Clear filters to see all available records.' : defaultHint; }
function renderOverview() {
  const p = data.project, m = metrics(data);
  $('#project-title').textContent = text(p.name);
  $('#project-description').textContent = `Property type: ${text(p.propertyType)} · Location: ${[p.village, p.taluk, p.district, p.state].filter(Boolean).join(', ') || NA}`;
  $('#hero-meta').innerHTML = [['Current owner', p.currentOwner], ['Land classification', p.landClassification], ['Registration office', p.sro]].map(([label, v]) => `<dl><dt>${label}</dt><dd>${value(v)}</dd></dl>`).join('');
  const kpis = [
    ['Total land extent', m.land == null ? NA : `${number(m.land / 43560)} acres`, m.land == null ? 'Acres · Cents · Sq.ft' : `${number(m.land / 435.6)} cents · ${number(m.land)} sq.ft`, '⌗'],
    ['Total extent conveyed', m.conveyed == null ? NA : `${number(m.conveyed / 43560)} acres`, m.conveyed == null ? 'Documented land portions' : `${number(m.conveyed / 435.6)} cents · ${number(m.conveyed)} sq.ft`, '▱'],
    ['Total schedule value', money(m.value), 'Documented value · INR', '₹'],
    ['Survey numbers', number(m.surveys), 'Unique numbers by village', '⊞'],
    ['Survey subdivisions', number(m.subdivisions), 'Distinct recorded subdivisions', '⊟'],
    ['Schedule entries', number(m.entries), 'Each distinct portion retained', '▤'],
    ['Villages', number(m.villages), 'Locations in the schedules', '⌖'],
    ['Acquisition deeds', number(m.deeds), 'Supplied acquisition records', '▣'],
    ['Previous documents', number(m.references), 'Distinct referenced documents', '↗'],
    ['Patta numbers', number(m.pattas), 'Unique numbers by village', '▥']
  ];
  $('#kpis').innerHTML = kpis.map(([label, v, note, symbol]) => `<article class="kpi"><div class="kpi-top"><span>${label}</span><span class="kpi-icon" aria-hidden="true">${symbol}</span></div><div class="kpi-value ${v === NA ? 'unavailable' : ''}">${esc(v)}</div><div class="kpi-note">${esc(note)}</div></article>`).join('');
  const location = [p.village, p.taluk, p.district, p.state].filter(Boolean).join(', ') || null;
  const summary = [['Property', p.propertyType], ['Location', location], ['Current owner', p.currentOwner], ['Villages involved', number(m.villages)], ['Survey numbers involved', number(m.surveys)], ['Total land extent', landTotal(m.land)], ['Acquisition deeds available', number(m.deeds)], ['Documented property value', money(m.value)], ['Missing documents', data.missingDocuments.map(r => r.description).filter(Boolean).join('; ') || null], ['Items requiring legal verification', data.legalNotes.map(r => r.description).filter(Boolean).join('; ') || null]];
  $('#management-grid').innerHTML = summary.map(([label, v]) => `<dl><dt>${label}</dt><dd>${value(v)}</dd></dl>`).join('');
  const dates = data.deeds.map(r => r.date).filter(Boolean).sort();
  $('#information-grid').innerHTML = [['Project name', p.name], ['Village name', p.village], ['Village code', p.villageCode], ['Taluk', p.taluk], ['District', p.district], ['State', p.state], ['Property type', p.propertyType], ['Land classification', p.landClassification], ['Current owner', p.currentOwner], ['Previous owners', p.previousOwners], ['Total land extent', landTotal(m.land)], ['Total survey numbers', number(m.surveys)], ['Total patta numbers', number(m.pattas)], ['Sub-Registrar Office (SRO)', p.sro], ['Latest registration date', dates.at(-1)]].map(([label, v]) => field(label, v)).join('');
  if (data.documents.length) {
    $('#document-notice strong').textContent = 'Property document overview';
    $('#document-notice p').textContent = `${data.documents.length} source record(s) listed. Missing details remain “${NA}”. Review statuses appear on individual records.`;
    $('#overall-status').textContent = 'Review individual records';
  }
  const coverageTypes = ['Sale deed', 'Parent deed', 'Encumbrance certificate', 'Patta', 'Legal opinion'];
  $('#coverage').innerHTML = coverageTypes.map(type => {
    const count = data.documents.filter(d => d.type === type).length;
    return `<div class="coverage-row"><span>${type}</span><span>${count ? `${count} supplied` : NA}</span></div>`;
  }).join('');
  const reviewNotes = records => records.map(r => `<div class="review-note"><strong>${value(r.description)}</strong><p>${value(r.details)}</p><p>${esc(source(r))}</p></div>`).join('');
  $('#missing-documents').innerHTML = data.missingDocuments.length ? reviewNotes(data.missingDocuments) : empty('Document gaps can be identified once the supplied records have been examined.', '▤');
  $('#legal-notes').innerHTML = data.legalNotes.length ? reviewNotes(data.legalNotes) : empty('Record conflicts and ownership links will be listed here for advocate verification.');
}
function renderDeeds(deeds) {
  $('#deed-count').textContent = data.deeds.length ? `${deeds.length} of ${data.deeds.length} records` : 'Awaiting records';
  const card = (d, placeholder = false) => `<article class="deed-card ${placeholder ? 'empty-deed' : ''}"><div class="deed-header"><span class="deed-icon" aria-hidden="true">▣</span><div><div class="eyebrow">${placeholder ? 'ACQUISITION RECORD' : value(d.type)}</div><h3>${value(d.documentNumber)}</h3></div></div><dl class="deed-grid">${[['Registration year', d.year], ['Registration date', d.date], ['Sub-Registrar Office', d.sro], ['Document type', d.type], ['Seller', d.seller], ['Purchaser', d.purchaser], ['Previous document', d.previousDocument], ['Property extent', extent(d.extent)], ['Registration / schedule value', money(d.value)], ['Related survey numbers', d.surveyNumbers]].map(([label, v]) => `<div><dt>${label}</dt><dd>${value(v)}</dd></div>`).join('')}</dl><div class="deed-footer">${placeholder ? '<span>Awaiting a supplied acquisition deed</span>' : pill(d)}<span>${esc(source(d))}</span></div></article>`;
  $('#deed-cards').innerHTML = deeds.length ? chronological(deeds).map(d => card(d)).join('') : data.deeds.length || activeFilters() ? `<div class="panel">${empty(blankHint('No acquisition records are available.'))}</div>` : `${card({}, true)}<div class="deed-explanation">${empty('Acquisition deeds will appear in chronological order with parties, extents, values and source references.', '↗')}</div>`;
}
function renderRecords() {
  const f = filters(), filtered = name => data[name].filter(r => matches(r, f));
  const deeds = filtered('deeds'), rows = filtered('schedules').filter(r => confirmation === 'all' || (confirmation === 'confirmed' ? confirmed(r) : !confirmed(r)));
  visibleSchedules = rows;
  renderDeeds(deeds);
  $('#schedule-body').innerHTML = rows.length ? scheduleRows(rows).map((row, i) => `<tr>${row.map((cell, col) => `<td>${col === 10 ? pill(rows[i]) : col === 3 && rows[i].subdivision ? `<span class="subdivision">${esc(cell)}</span>` : (col === 6 || col === 8) && cell === NA ? `<span class="missing">${NA}<br>Missing / To Confirm</span>` : esc(cell)}</td>`).join('')}</tr>`).join('') : emptyRow(columns.length, blankHint('Survey entries will appear here after document analysis. No survey numbers or land portions have been assumed.'));
  $('#schedule-totals').innerHTML = `<tr>${totalsRow(rows).map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`;
  const owners = chronological(filtered('ownership'));
  $('#ownership-timeline').innerHTML = owners.length ? `<ol class="timeline">${owners.map(r => `<li><time>${value(r.date || r.year)}</time><h3>${value(r.fromOwner)} → ${value(r.toOwner)}</h3><p>${value(r.type)} · ${value(r.documentNumber)}</p><p>${value(r.connection)} · ${esc(source(r))}</p>${pill(r)}${confirmed(r) ? '' : '<p>Unverified ownership connection — advocate review required.</p>'}</li>`).join('')}</ol>` : empty(blankHint('Original owner → previous owner → intermediate purchaser → current owner. The chain will be populated only from supplied records.'), '⌁');
  const refs = filtered('references');
  $('#references-body').innerHTML = refs.length ? refs.map(r => `<tr>${[r.documentNumber, r.year, r.type, r.surveyNumber, r.parentDeed, r.connection].map(v => `<td>${value(v)}</td>`).join('')}<td>${pill(r)}</td><td>${esc(source(r))}</td></tr>`).join('') : emptyRow(8, blankHint('Parent deeds and previous-document references will be listed with their verification status.'));
  const pattas = filtered('pattas');
  $('#patta-body').innerHTML = pattas.length ? pattas.map(r => `<tr>${[r.pattaNumber, r.owner, r.village, [r.surveyNumber, r.subdivision].filter(Boolean).join('/'), extent(r.extent)].map(v => `<td>${value(v)}</td>`).join('')}<td>${pill(r)}</td><td>${esc(source(r))}</td></tr>`).join('') : emptyRow(7, blankHint('No patta records have been supplied for this overview.'));
  $('#filter-status').textContent = activeFilters() ? `${rows.length} matching schedule entries · ${deeds.length} deeds · ${owners.length} ownership entries · ${refs.length} PR references · ${pattas.length} patta records. Project KPIs remain unchanged.` : 'Filters apply to deeds, schedules, ownership, PR and patta records. Project KPIs show the full project.';
  root.querySelectorAll('[data-confirmation]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.confirmation === confirmation)));
}
function populateFilters() {
  const all = ['schedules', 'deeds', 'ownership', 'references', 'pattas'].flatMap(key => data[key]);
  const options = { village: [...new Set(all.map(r => r.village).filter(Boolean))].sort(), year: [...new Set(all.map(r => r.year ?? r.date?.slice(0, 4)).filter(Boolean).map(String))].sort().reverse(), type: [...new Set(all.map(r => r.type).filter(Boolean))].sort(), status: STATUSES };
  for (const [key, items] of Object.entries(options)) for (const option of items) $(`[name="${key}"]`).add(new Option(option, option));
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function excelLibrary() {
  if (window.XLSX) return window.XLSX;
  if (!workbookLibrary) workbookLibrary = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/vendor/xlsx.mini.min.js';
    script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel library unavailable.'));
    script.onerror = () => { script.remove(); workbookLibrary = null; reject(new Error('Could not load Excel export. Please try again.')); };
    document.head.append(script);
  });
  return workbookLibrary;
}
async function exportExcel() {
  const buttons = [$('#export-excel'), $('#schedule-excel')]; buttons.forEach(b => b.disabled = true);
  try {
    const XLSX = await excelLibrary(), workbook = XLSX.utils.book_new();
    const rows = visibleSchedules.length ? scheduleRows(visibleSchedules) : [[NA, ...Array(columns.length - 1).fill(NA)]];
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows, totalsRow(visibleSchedules)]);
    sheet['!cols'] = columns.map((_, i) => ({ wch: i === 4 || i === 5 ? 50 : 30 }));
    sheet['!autofilter'] = { ref: `A1:L${rows.length + 1}` };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Survey schedule');
    const info = [['Project', text(data.project.name)], ['Exported at', new Date().toISOString()], ['Scope', 'Visible schedule entries; full project KPIs remain unchanged'], ['Filters', JSON.stringify({ ...filters(), confirmation })], ['Missing values', NA], ['Measurement totals', 'Missing identity, missing measurement, or conflicting parcel/portion totals are not treated as zero.'], ['Title review', 'Documentation overview only; not a legal title-clearance certificate.']];
    const notes = XLSX.utils.aoa_to_sheet(info); notes['!cols'] = [{ wch: 25 }, { wch: 95 }];
    XLSX.utils.book_append_sheet(workbook, notes, 'Report notes');
    XLSX.writeFile(workbook, 'DNAssets-survey-schedule.xlsx', { compression: true });
    feedback('Excel export prepared with all schedule columns and visible totals.');
  } catch (error) { feedback(error.message); }
  finally { buttons.forEach(b => b.disabled = false); }
}
function printReport(mode) {
  host.dataset.printMode = mode;
  root.querySelectorAll('details[open]').forEach(d => d.open = false);
  window.print();
}
function wire() {
  $('#filter-form').addEventListener('submit', event => event.preventDefault());
  $('#filter-form').addEventListener('input', renderRecords);
  $('#clear-filters').onclick = () => { $('#filter-form').reset(); confirmation = 'all'; renderRecords(); };
  root.querySelectorAll('[data-confirmation]').forEach(button => button.onclick = () => { confirmation = button.dataset.confirmation; renderRecords(); });
  [$('#export-excel'), $('#schedule-excel')].forEach(button => button.onclick = exportExcel);
  $('#export-summary').onclick = () => {
    const sections = ['.project-hero', '#kpis', '#management-summary', '#information', '#acquisitions', '#schedule', '#ownership', '#references', '#patta', '#verification', '.disclaimer'];
    const report = ['DNAssets — Property Document Summary', `Generated: ${new Date().toISOString()}`, `Record filters: ${JSON.stringify({ ...filters(), confirmation })}`, 'KPIs represent the full project. Detailed records reflect active filters.', ...sections.map(selector => $(selector).innerText)];
    download(report.join('\n\n'), 'DNAssets-document-summary.txt', 'text/plain;charset=utf-8'); feedback('Document summary downloaded.');
  };
  $('#print-report').onclick = () => printReport('dashboard');
  root.querySelectorAll('[data-pdf]').forEach(button => button.onclick = () => printReport(button.dataset.pdf));
  window.addEventListener('afterprint', () => delete host.dataset.printMode, { signal: lifecycle.signal });
  root.addEventListener('click', event => { if (!event.target.closest('.export-menu')) $('.export-menu').open = false; }, { signal: lifecycle.signal });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') $('.export-menu').open = false; }, { signal: lifecycle.signal });
  const navLinks = [...root.querySelectorAll('.sidebar nav a')];
  function highlight() {
    let active = '#overview';
    for (const link of navLinks) if ($(link.hash).getBoundingClientRect().top <= 110) active = link.hash;
    for (const link of navLinks) if (link.hash === active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  }
  let scheduled = false;
  window.addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { if (!lifecycle.signal.aborted) highlight(); scheduled = false; }); } }, { passive: true, signal: lifecycle.signal });
}
async function start() {
  try {
    const response = await fetch('/data/property-overview.json', { cache: 'no-store', signal: lifecycle.signal });
    if (!response.ok) throw new Error('The overview dataset could not be loaded. Please reload the page.');
    data = await response.json();
    if (data.schemaVersion !== 1 || !data.project || !['documents', 'deeds', 'schedules', 'ownership', 'references', 'pattas', 'missingDocuments', 'legalNotes'].every(key => Array.isArray(data[key]) && data[key].every(r => r && typeof r === 'object'))) throw new Error('The overview dataset has an unsupported format.');
    renderOverview(); populateFilters(); renderRecords(); wire();
  } catch (error) {
    $('#document-notice strong').textContent = 'Overview unavailable';
    $('#document-notice p').textContent = error.message;
    root.querySelectorAll('button, input, select').forEach(element => element.disabled = true);
  }
}
return { start, dispose() { lifecycle.abort(); clearTimeout(feedbackTimer); delete host.dataset.printMode; } };
}

// Mount the same dashboard inside the survey workspace without duplicate navigation
// or global CSS changes. It shares the current app session; no iframe is required.
export async function mountPropertyOverview(host) {
  const response = await fetch('/property_dashboard.html');
  if (!response.ok) throw new Error('The property overview could not be opened. Please try again.');
  const template = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (!host.isConnected) return () => {};
  template.querySelectorAll('.sidebar, .topbar, footer, .skip-link, script').forEach(element => element.remove());
  const root = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = '/css/property-overview.css';
  root.append(stylesheet, ...template.body.childNodes);
  const overview = createOverview(root, host);
  await overview.start();
  return overview.dispose;
}

if (document.querySelector('#project-title')) createOverview().start();
