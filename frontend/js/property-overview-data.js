// Document-backed data only. Unknown values remain null, never inferred as zero.
export const NA = 'Not Available in Documents';
export const STATUSES = ['Verified from supplied records', 'Mentioned in EC only', 'Not independently examined', 'Missing / To Confirm'];
export const columns = ['S.No', 'Village', 'Survey number', 'Subdivision', 'Total extent', 'Conveyed extent', 'Patta number', 'Root / parent deed', 'Previous document (PR)', 'Document value', 'Verification', 'Source / page'];
export const text = value => value == null || value === '' || (Array.isArray(value) && !value.length) ? NA : Array.isArray(value) ? value.join(', ') : String(value);
export const number = value => value == null ? NA : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(value);
export const money = value => value == null ? NA : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
export const status = record => STATUSES.includes(record.status) ? record.status : STATUSES[2];
export const confirmed = record => status(record) === STATUSES[0];
export function toSqft(measurement) {
  const factors = { acres: 43560, cents: 435.6, sqft: 1, hectares: 107639.1041671, sqm: 10.76391041671 };
  if (!measurement || typeof measurement.value !== 'number' || !Number.isFinite(measurement.value) || measurement.value < 0 || !factors[measurement.unit]) return null;
  return measurement.value * factors[measurement.unit];
}
export function extent(measurement) {
  const sqft = toSqft(measurement);
  if (sqft == null) return text(measurement?.original);
  return `${measurement.original || `${number(measurement.value)} ${measurement.unit}`} · ${number(sqft)} sq.ft`;
}
export function landTotal(sqft) {
  return sqft == null ? NA : `${number(sqft / 43560)} acres / ${number(sqft / 435.6)} cents / ${number(sqft)} sq.ft`;
}
export function source(record) {
  return record.source?.document ? `${record.source.document}${record.source.page ? ` · p. ${record.source.page}` : ''}` : NA;
}
// Totals are withheld for missing identity, unknown measures, or conflicts within an identity.
function uniqueSum(rows, identity, read) {
  if (!rows.length) return null;
  const seen = new Map();
  for (const row of rows) {
    const key = row[identity], value = read(row);
    if (!key || value == null || !Number.isFinite(value) || value < 0) return null;
    if (seen.has(key) && Math.abs(seen.get(key) - value) > 0.00001) return null;
    seen.set(key, value);
  }
  return [...seen.values()].reduce((a, b) => a + b, 0);
}
export function totals(rows) {
  return {
    land: uniqueSum(rows, 'parcelId', r => toSqft(r.totalExtent)),
    conveyed: uniqueSum(rows, 'portionId', r => toSqft(r.conveyedExtent)),
    value: uniqueSum(rows, 'portionId', r => typeof r.value === 'number' ? r.value : null)
  };
}
const distinct = items => new Set(items.filter(v => v != null && v !== '')).size || null;
export function metrics(data) {
  const rows = data.schedules;
  return { ...totals(rows), surveys: distinct(rows.map(r => r.surveyNumber ? `${r.village || ''}|${r.surveyNumber}` : null)),
    subdivisions: distinct(rows.map(r => r.surveyNumber && r.subdivision ? `${r.village || ''}|${r.surveyNumber}|${r.subdivision}` : null)),
    entries: rows.length || null, villages: distinct(rows.map(r => r.village)), deeds: data.deeds.length || null,
    references: distinct(data.references.map(r => r.documentNumber ? `${r.sro || ''}|${r.year || ''}|${r.documentNumber}` : null)),
    pattas: distinct([...rows, ...data.pattas].map(r => r.pattaNumber ? `${r.village || ''}|${r.pattaNumber}` : null)) };
}
export function matches(record, filters) {
  const searchable = [record.surveyNumber, record.surveyNumber && record.subdivision ? `${record.surveyNumber}/${record.subdivision}` : null, record.surveyNumbers, record.subdivision, record.pattaNumber, record.documentNumber, record.previousDocument, record.parentDeed, record.owner, record.seller, record.purchaser, record.fromOwner, record.toOwner, record.village].flat().filter(Boolean).join(' ').toLowerCase();
  return (!filters.search || searchable.includes(filters.search.toLowerCase().trim())) &&
    (!filters.village || record.village === filters.village) &&
    (!filters.year || String(record.year ?? record.date?.slice(0, 4) ?? '') === filters.year) &&
    (!filters.type || record.type === filters.type) && (!filters.status || status(record) === filters.status);
}
export function scheduleRows(rows) {
  return rows.map((r, i) => [i + 1, text(r.village), text(r.surveyNumber), text(r.subdivision), extent(r.totalExtent), extent(r.conveyedExtent), text(r.pattaNumber), text(r.parentDeed), text(r.previousDocument), money(r.value), status(r), source(r)]);
}
export function totalsRow(rows) {
  const total = totals(rows);
  return ['TOTAL (visible entries)', '', '', '', landTotal(total.land), landTotal(total.conveyed), '', '', '', money(total.value), '', ''];
}
export function chronological(rows) {
  return [...rows].sort((a, b) => (a.date || (a.year ? `${a.year}-12-31` : '9999')).localeCompare(b.date || (b.year ? `${b.year}-12-31` : '9999')));
}
