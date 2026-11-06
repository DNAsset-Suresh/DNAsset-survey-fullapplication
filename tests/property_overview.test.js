import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { NA, STATUSES, toSqft, totals, metrics, matches, extent, chronological, scheduleRows, totalsRow, columns } from '../frontend/js/property-overview-data.js';

const empty = JSON.parse(await readFile(new URL('../frontend/data/property-overview.json', import.meta.url), 'utf8'));
const row = { parcelId: 'test-parcel', portionId: 'test-portion', village: 'Test village', surveyNumber: '100', subdivision: '1A', totalExtent: { value: 1, unit: 'acres', original: '1 acre' }, conveyedExtent: { value: 25, unit: 'cents', original: '25 cents' }, value: 150000, pattaNumber: 'P-1', parentDeed: 'ROOT-1', previousDocument: 'PR-1', owner: 'Test Owner', type: 'Sale deed', year: 2020, status: STATUSES[0], source: { document: 'test.pdf', page: 2 } };

test('the shipped dashboard contains no fabricated project facts or zero KPI totals', () => {
  assert.ok(Object.values(empty.project).every(v => v === null));
  assert.ok(Object.entries(empty).filter(([, v]) => Array.isArray(v)).every(([, v]) => v.length === 0));
  assert.ok(Object.values(metrics(empty)).every(v => v === null));
  assert.equal(totalsRow([])[4], NA);
});
test('unit conversions retain original measurements and reject missing, negative or unsupported units', () => {
  assert.equal(toSqft({ value: 1, unit: 'acres' }), 43560);
  assert.equal(toSqft({ value: 100, unit: 'cents' }), 43560);
  assert.equal(toSqft({ value: 0, unit: 'sqft' }), 0);
  assert.equal(toSqft({ value: -1, unit: 'acres' }), null);
  assert.equal(toSqft({ value: 1, unit: 'unknown' }), null);
  assert.equal(toSqft({ value: '1', unit: 'acres' }), null);
  assert.equal(toSqft(null), null);
  assert.match(extent(row.totalExtent), /^1 acre · 43,560 sq.ft$/);
});
test('distinct portions remain separate but shared land parcels and repeated portions are not double counted', () => {
  const second = { ...row, portionId: 'test-portion-2' };
  assert.deepEqual(totals([row, second]), { land: 43560, conveyed: 21780, value: 300000 });
  assert.deepEqual(totals([row, { ...row }]), totals([row]));
  assert.equal(scheduleRows([row, second]).length, 2);
});
test('missing identities, incomplete values and conflicting totals are withheld', () => {
  assert.equal(totals([{ ...row, parcelId: null }]).land, null);
  assert.equal(totals([row, { ...row, totalExtent: { value: 2, unit: 'acres' } }]).land, null);
  assert.equal(totals([row, { ...row, portionId: 'new', conveyedExtent: null }]).conveyed, null);
  assert.equal(totals([{ ...row, value: null }]).value, null);
  assert.equal(totals([{ ...row, value: 0 }]).value, 0);
});
test('survey and patta identities distinguish villages; empty numbers do not inflate counts', () => {
  const m = metrics({ ...empty, schedules: [row, { ...row, village: 'Other test village' }, { ...row, portionId: 'portion2' }] });
  assert.equal(m.surveys, 2); assert.equal(m.subdivisions, 2); assert.equal(m.pattas, 2); assert.equal(m.entries, 3);
});
test('searches find survey, patta, document reference and owner; filters combine', () => {
  for (const search of ['100', '100/1A', 'P-1', 'ROOT-1', 'pr-1', 'test owner']) assert.ok(matches(row, { search }));
  assert.ok(matches(row, { village: 'Test village', year: '2020', type: 'Sale deed', status: STATUSES[0] }));
  assert.equal(matches(row, { village: 'Other village' }), false);
  assert.equal(matches(row, { year: '2021' }), false);
  assert.equal(matches(row, { status: STATUSES[1] }), false);
});
test('chronology keeps unknown dates last without changing original order', () => {
  const records = [{ documentNumber: 'unknown' }, { year: 2022 }, { date: '2020-02-01' }];
  assert.equal(chronological(records)[0].date, '2020-02-01');
  assert.equal(chronological(records).at(-1).documentNumber, 'unknown');
  assert.equal(records[0].documentNumber, 'unknown');
});
test('Excel round trip preserves all 12 columns, source, totals and formula-like text as literal strings', () => {
  const rows = scheduleRows([{ ...row, owner: '=1+1', village: '=1+1' }]);
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows, totalsRow([row])]);
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Schedule');
  const parsed = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }).Sheets.Schedule;
  const result = XLSX.utils.sheet_to_json(parsed, { header: 1 });
  assert.equal(result[0].length, 12); assert.equal(result[1][1], '=1+1'); assert.equal(parsed.B2.f, undefined);
  assert.equal(result[1][11], 'test.pdf · p. 2'); assert.equal(result[2][9], '₹1,50,000.00');
});
