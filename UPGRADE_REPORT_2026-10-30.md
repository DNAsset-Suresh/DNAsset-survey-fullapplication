# DNAssets tracking and management upgrade

Completed 30 October 2026. The existing vanilla JavaScript frontend, Express backend, saved PGlite database, PostgreSQL/Supabase adapters, authentication, document analysis, reports and corporate styling were retained. No bulk deletion or reset was run on the saved application data.

## Delivered behavior

- Upload History is now a full page with project, survey, category, original filename, uploader name/ID, timestamp, reviewer name/ID, review timestamp, verification status, remarks and View/Download actions. It supports project/survey searches, uploader/reviewer filters, inclusive upload-date filters, status filters, pagination and CSV/XLSX exports. Exports contain all matching permitted records, not just the displayed page; spreadsheet formula prefixes are escaped.
- Reviews record the authenticated account ID, name, role, time, decision, remarks, rejection reason, document/category identity and the IDs of the current uploaded files. Every new review action gets a separate `document_reviews` event. Verified, Rejected, Pending and the existing Under Review workflow are supported. A category review applies to its current uploaded files. Profile renaming does not rewrite historical review identities.
- Login no longer changes a username supplied in a login form. Existing authenticated profile editing and administrator account management remain available. Review endpoints reject forged identity fields.
- Assigned reviewers can see upload/review history for accessible, unlocked projects. Ordinary users see their own upload history. Project assignments and password protection are enforced by the backend. Founder accounts continue to use the Admin role. The previous document-deletion restriction remains: Admin/Founder can delete accessible uploads; reviewers can delete their own uploads; Team User and Viewer cannot delete documents.
- Project details offer archive/restore and a scoped deletion preview. Survey checklists offer scoped survey deletion. Existing project creation/editing, multiple independent survey checklists and project progress are retained.
- Database Management shows project, survey, upload, verification and storage totals, selected-record deletion, Delete All Projects & Survey Numbers, Reset Survey Database, backup status and retry controls for failed physical file removals.
- Audit Logs provide searchable, chronological identity/action/project/survey/document/time/IP records. Database triggers reject updates and deletes to audit records. Project creation/update/archive/restore, survey operations, document uploads/replacements/reviews/deletions and database reset are recorded. Old audit records remain intact; unavailable historical IP addresses are shown as not recorded.
- Sidebar navigation includes Dashboard, Projects, Survey Numbers, Document Checklist, Upload History, Review Management, Audit Logs, User Management, Database Management and Settings. Reports remain available. Dashboard adds explicit pending/rejected/completion cards and recent uploads, reviews and activities.

## Deletion policy and safeguards

| Operation | Removed | Preserved |
|---|---|---|
| Selected survey | Selected survey, its checklist/files/analyses and memberships | Other surveys/projects, upload/review history, audit, accounts |
| Selected project | Project and its surveys/checklists/files/analyses/memberships | Other projects, upload/review history, audit, accounts |
| Delete all projects | All projects/surveys/checklists/files/analyses/memberships, including archives | Upload/review history, audit, accounts, settings and categories |
| Reset survey database | Above plus survey upload history, review events, analysis/extraction records and tracked cleanup objects | Audit/reset event, authentication users/profiles, settings, schema, categories and unrelated tables |

Every operation checks Admin permissions in Express and SQL. The server issues a five-minute confirmation token bound to the current administrator and session. The administrator must type `DELETE ALL PROJECTS` (including selected deletion) or `RESET SURVEY DATABASE`, then use a separate final confirmation screen. The server checks the exact phrase and explicit second confirmation, consumes the token, blocks competing application writes, drains upload processing and rechecks the data fingerprint. Changed data requires a fresh preview. SQL locks and a transaction protect the deletion and audit writes; database errors roll them back.

Backup is enabled by default. Failure to read any active uploaded file or to write the backup aborts deletion. Database deletion commits before physical object removal. Failed object removals remain in a durable queue tied to the confirmed operation; retry is available in Database Management. No directory-wide recursive storage deletion is used. Reset removes only known survey objects and tracked cleanup entries; unidentified files are deliberately not treated as survey-owned.

Individual document deletion/replacement retains the existing storage-cleanup queue policy. Automatic general cleanup remains opt-in with `STORAGE_CLEANUP_ENABLED=true`. Confirmed project/survey/reset operations explicitly remove only their own queued objects, independently of that background setting.

## Files created

- `backend/src/services/surveyManagement.js`: history/export/review/audit/activity APIs; protected management workflow, backups and scoped storage retry.
- `frontend/js/management.js`: full-page history, audit, users and database management; filters, exports, review history and two-stage confirmations.
- `database/migrations/011_tracking_and_management.sql`: review events, timestamp and identity snapshots, append-only audit enrichment, service-only transactional APIs.
- `database/migrations/012_legacy_survey_display.sql`: compatibility correction for older rows that already store a subdivision inside the survey number. It avoids displays such as `216/1/1` when the actual survey is `216/1`.
- `tests/management.test.js`: end-to-end isolated tracking/deletion/reset/backup/rollback/security checks.
- `scripts/verify-upgrade-state.mjs`: read-only comparison of the saved database and stored objects against the pre-upgrade backup.
- This report and verification artifacts under `artifacts/`.

## Files modified

`backend/src/app.js`, `backend/src/config.js`, `backend/src/validators.js`, `backend/src/services/localDatabase.js`, `backend/src/services/database.js`, `backend/src/services/reports.js`, `backend/.env.example`, `frontend/js/app.js`, `frontend/js/auth.js`, `frontend/js/checklist.js`, `frontend/js/dashboard.js`, `frontend/css/component-layout.css`, `tests/user_password.test.js`, and `README.md`.

No dependency, framework, connection credential, authentication password or live user account was replaced by this upgrade.

## API changes

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/uploads/history` | Upgraded filtered and paginated history |
| GET | `/api/uploads/history/export?format=csv\|xlsx` | Export all permitted matching history |
| GET | `/api/reviews` | Review event history, optionally filtered by `document_id` |
| GET | `/api/audit` | Admin-only paginated/searchable audit |
| GET | `/api/dashboard/activity` | Recent permitted uploads/reviews and admin activity |
| GET | `/api/management/summary` | Admin totals, backup setting and pending cleanup operations |
| POST | `/api/management/preview` | Preview `project`, `survey`, `all` or `reset` scope |
| POST | `/api/management/execute` | Execute a valid, explicitly confirmed preview |
| POST | `/api/management/projects/:id/archive` | Archive/restore selected project |
| POST | `/api/management/storage/:id/retry` | Retry file removal for a confirmed operation |

Existing verification endpoints now accept Pending and record review history transactionally. Existing mutation APIs use `survey_run` to attach authenticated request context to audit events. The new SQL RPCs are executable only by `service_role`; browser roles have no mutation access.

## Validation

- Full suite: **78 checks passed, 0 failed**, including existing authentication, password/assignment isolation, uploads, OCR, analysis, reporting, storage, archive and history tests. Evidence: `artifacts/upgrade-full-tests-final.txt`.
- Final management suite after legacy-format correction: **12 checks passed, 0 failed**. Evidence: `artifacts/upgrade-management-final.txt`. These overlap with the full-suite count and are not additional unique tests.
- Syntax validation: **48 JavaScript/MJS files passed**.
- Verified user upload identity, reviewer verification/rejection/pending actions, immutable identity snapshots, history searches/date/status filters, CSV/XLSX output and password-protected project isolation.
- Verified selected survey deletion preserves siblings, selected project deletion preserves other projects, missing/wrong/cross-session confirmations are rejected, stale previews are rejected, and normal users/reviewers cannot reset/delete all.
- Simulated backup failure cancelled deletion. A forced database error rolled back both deletion and audit changes. Simulated storage deletion failure retained its queue, and retry succeeded.
- Restored a generated backup snapshot into an isolated database and verified the original uploaded records existed. Reset tests preserved accounts, profiles, all prior audit IDs, categories and an unrelated company table, and allowed creation of a new project/checklist afterward.
- Compared **14 tables** against the pre-upgrade snapshot: **all original fields and row counts preserved**, including 7 users, 15 projects, 18 surveys, 126 checklists, 15 uploads, 15 upload histories, 15 analyses, 35 extracted entries and 40 audit records. All **20 stored objects** (15 active plus 5 previously queued) matched their original SHA-256 hashes. Evidence: `artifacts/upgrade-data-preservation.json`.
- Browser checks used a copied database/storage with email disabled. Verified the full history page, filters, corrected legacy survey label, 40 audit records, all 7 accounts, affected-record preview, rejection of the wrong phrase, separate final confirmation and Cancel. No browser deletion was executed. Desktop and mobile history layouts were checked; at a 390px viewport the document width was 375px, with tables scrolling inside their container.

Live cloud deployment, provider disaster recovery, real email delivery and production concurrency/load testing were not performed. Existing cloud TLS configuration was retained. This delivery is for the saved local application.

## Backup and recovery

Pre-upgrade source, database and all storage were copied to:

`backups/upgrade-20261030-160207/`

Automatic operation backups default to `backups/operations/<operation UUID>/`. Configure `SURVEY_BACKUP_DIRECTORY` to an access-restricted durable volume outside the live application data directory for external retention. Each successful backup contains `survey-data.json`, a manifest with file SHA-256 hashes and counts, and copied objects under `storage/<bucket>/`. Local deployments also include `survey_db.tar.gz`. Authentication data in a local snapshot is private; restrict backup access.

For local recovery:

1. Stop the application cleanly and take a new backup of its current database and storage. Retain the current audit records, including any deletion/reset event.
2. Copy the chosen backup into a **new recovery directory**, keeping the original backup untouched. For a pre-upgrade backup, the snapshot is under `database/survey_db.tar.gz`; for an operation backup it is at the backup root.
3. Set `USE_LOCAL_DB=true`, `LOCAL_DATABASE_FILE` to the recovered snapshot, and `LOCAL_STORAGE_DIRECTORY` to the recovered `storage` directory. Keep email and automatic background cleanup disabled during recovery validation.
4. Start the app; migrations run on the recovery copy. Verify counts, credentials, project relationships and downloads before switching the live configuration. Restoring a snapshot is point-in-time recovery; keep the newer live snapshot/audit separately to retain events occurring after the backup.

For a remote deployment, retain the provider’s native backup/PITR alongside the logical survey export and objects. A database administrator should restore into an isolated database first and reconcile existing rows, triggers and retained audit events. Automated remote restore is not part of this change.

## Deployment

The saved local application already contains migration 011 and passed the data-preservation check. Restart the existing application once to load all final server code and the legacy-label compatibility migration 012, then refresh the browser. Migration 012 was verified on the copied saved database. The server started separately during testing was left running; only the agent-owned copied-data preview was stopped.

From this workspace, run `npm.cmd start` after stopping the previous instance, and open `http://localhost:3000/`. Sign in as Admin/Founder to access Database Management. Startup never executes a deletion or reset.

For Supabase API mode, apply migrations 011 and 012 once, after the existing migrations through 010, before deploying the server. Do not rerun retired migration 008. Keep current environment values and trusted TLS certificate settings; configure durable backups and run the same checks in staging before remote deployment.
