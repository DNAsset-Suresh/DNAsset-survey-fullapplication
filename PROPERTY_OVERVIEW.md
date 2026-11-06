# Property document overview

Choose **Property Overview** from the survey application's sidebar or the main dashboard button. The `/#property-overview` route opens the overview inside the existing workspace and retains its navigation and session. The standalone `/property_dashboard.html` remains available.

Run `npm run preview:overview` for a read-only workspace preview at http://127.0.0.1:4173/#property-overview. This preview uses the application's existing sample workspace mode and does not initialize databases; the property document overview itself remains empty. Saving and uploads require the full application server.

The integrated view uses a scoped Shadow DOM to reuse the standalone dashboard without changing the surrounding app's styles, permissions or frame security policy. Navigation disposes its window listeners. Search, confirmation filters and Excel generation were checked after opening the overview from the dashboard.

This first version intentionally contains no property facts. All unavailable details and unknown KPIs display **Not Available in Documents**. It does not automatically analyze or import documents from the current upload system. Documents will be consolidated into this overview after source analysis. No existing project records are changed.

## Dataset

`frontend/data/property-overview.json` contains the blank structured dataset. Rendering and calculations are separate modules under `frontend/js/property-overview*.js`. Keep missing fields `null`. Do not replace unknown quantities with zero.

The dataset is a static asset for this empty prototype. **Before adding private real records to a hosted deployment, serve the dataset through authenticated, project-authorized APIs rather than publishing it in this JSON file.** Browser export and filtering are local to the loaded dataset.

All record arrays use an explicit `status`: `Verified from supplied records`, `Mentioned in EC only`, `Not independently examined`, or `Missing / To Confirm`. Unknown statuses default to `Not independently examined`. Every sourced record should carry `source: {document, page}`. A status is entered only after examination, never inferred from a reference.

- `documents`: source inventory with `id`, `type`, and `source`. Coverage types are Sale deed, Parent deed, Encumbrance certificate, Patta, Legal opinion.
- `deeds`: one row per supplied acquisition deed, with `documentNumber`, `year`, ISO `date`, `sro`, `seller`, `purchaser`, `type`, `previousDocument`, `extent`, numeric INR `value`, `surveyNumbers`, `village`, `status`, `source`.
- `schedules`: each distinct land portion has a row with `parcelId`, `portionId`, `village`, `surveyNumber`, `subdivision`, `totalExtent`, `conveyedExtent`, `pattaNumber`, `parentDeed`, `previousDocument`, numeric INR `value`, `owner`, `year`, `type`, `status`, `source`. `value` must be the portion's allocated schedule value, not a deed-wide amount repeated on every portion.
- `ownership`: `date`, `year`, `fromOwner`, `toOwner`, `type`, `documentNumber`, `connection`, `surveyNumber`, `village`, `status`, `source`. Unknown connections remain unverified.
- `references`: `documentNumber`, `year`, `sro`, `type`, `surveyNumber`, `parentDeed`, `connection`, `village`, `status`, `source`.
- `pattas`: `pattaNumber`, `owner`, `village`, `surveyNumber`, `subdivision`, `extent`, `year`, `type`, `status`, `source`.
- `missingDocuments` and `legalNotes`: `description`, `details`, `source`. Capture discrepancies between deeds, EC, patta and opinions explicitly.

Measurements have `{value: number, unit: "acres" | "cents" | "sqft" | "hectares" | "sqm", original: string}`. Original wording remains visible beside square-foot conversions. Totals group land by `parcelId` and conveyed area/value by `portionId`. Missing identities, missing measures, unsupported units or conflicting values within a group withhold the affected total. Overlapping parcel identities must be resolved from documents before they are assigned; this interface cannot establish whether physically overlapping parcels are distinct.

Project KPIs use the complete dataset. Filters apply independently to the detailed record collections; records need the relevant village/year/type fields to match those filters. Confirmation tabs affect the schedule alone. Count KPIs count documented identities, not assumed project completeness.

## Exports

- Excel creates a genuine `.xlsx` workbook with all 12 schedule columns, visible totals and a report-notes sheet. Text stays literal, including spreadsheet formula-like strings. The existing SheetJS dependency is vendored locally and loaded only on export; its license is retained.
- Dashboard PDF and Project overview PDF open the browser print dialog; choose **Save as PDF**. Overview mode omits detailed schedules, deeds and chain tables. Print styles use landscape pages, repeating table headers and all table columns.
- Document summary downloads a text report. Detailed records reflect active filters; project KPIs remain project-wide.

Validation: `node --test tests/property_overview.test.js`, `npm run check`, `npm run build`. Fixture facts exist only in tests and are not shipped as property records.
