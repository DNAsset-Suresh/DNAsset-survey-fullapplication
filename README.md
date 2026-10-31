# DNAssets | Survey Number Verification & Document Tracking

## Current saved local workspace — 30 October 2026

The selected database is `database/survey_db.tar.gz`, with private files under `storage/land-documents`. `USE_LOCAL_DB=true` explicitly overrides a configured cloud `DATABASE_URL`. Run `npm.cmd start`, then open http://localhost:3000/#surveys. Existing account credentials are preserved; there is no universal password or automatic account reset. Local sessions expire after one hour, support rotating refresh tokens, and are revoked on logout; restarting the server requires signing in again.

**pondy** (code **12**, location **pondy**, owner **guna**, promoter **siva**) contains survey **231** with seven independent, initially empty checklist categories. **Green Valley** remains in **Projects → View archive**, read-only. No old documents or history were imported into pondy.

The verified backup is `backups/local-2026-10-30T08-43-56-580Z`. The current test report is `QA_REPORT_2026-10-30.md`; evidence is in `artifacts/`. Backup snapshots contain private account data and must stay outside public hosting and source control. Migration 008 has been retired and performs no deletion. Migration 009 adds archive metadata and durable upload-history lineage.

Uploads return after storage and metadata are saved. Analysis runs one document at a time in a child process with a 45-second deadline and a 256 MiB JavaScript heap limit. The process boundary also avoids a Windows native PDF/canvas worker-thread crash. Failed processing is recorded for manual review; it does not pretend that verification succeeded. Interrupted jobs resume on startup. Email delivery can be disabled with `EMAIL_NOTIFICATIONS_ENABLED=false`.

Physical storage cleanup is **off by default**. Historical file objects are retained. Set `STORAGE_CLEANUP_ENABLED=true` only after reviewing the queued objects and your retention requirements; this permanently removes queued file bytes. Tests use separate temporary databases and storage, and never contact a real email recipient. Stop the normal app before `npm.cmd test` so its snapshot-integrity guard can verify that saved data stays unchanged.

`npm.cmd ci` installs the pinned SheetJS 0.20.3 tarball from the vendor's official CDN; the npm-registry 0.18.5 release is obsolete. Cloud mode still requires valid TLS trust through `PGSSLROOTCERT`; certificate verification is never disabled. The older sections below describe the original Supabase setup and delivery history, not the selected local workspace.

Vanilla HTML, CSS and ES modules; Node.js/Express; Supabase Auth, PostgreSQL and private Storage. There is no frontend framework or build step. The initial property is **216/1** with seven independent document categories.

## Current delivery and configuration boundary

The application source, SQL migrations, tests, Docker deployment configuration and setup instructions are included. Without Supabase credentials it opens a clearly labeled **read-only interface preview**. The preview cannot save, upload, verify or export records. It never writes property documents to browser storage or local disk. Production refuses to start without configuration.

No live Supabase database or deployment is claimed. Apply migrations to a new, dedicated Supabase project and configure credentials to use persistent records. Do not run these initial schema migrations over an existing production schema without a reviewed migration plan and verified backup.

## Phase 1 — Inspection and implementation plan

The supplied workspace was empty, without Git metadata, frontend, backend, authentication, storage, database configuration or existing company data. The inspected runtime was Node.js 24.19.0 / npm 11.17.0. The implementation plan was provided before creating files: database and access rules, authenticated API, vanilla frontend, uploads/reports, tests and deployment documentation.

## Phase 2 — Supabase schema and access policies

Create a Supabase project. In its **SQL Editor**, run these files individually in order:

1. `database/migrations/001_initial_schema.sql`: profiles, properties, memberships, categories, checklists, uploaded files, audit logs, cleanup queue and timestamp/Auth triggers.
2. `database/migrations/002_seed_document_categories.sql`: idempotent seven-category seed and initial 216/1 property; automatically creates seven checklist records for each new property. This seed migration can be rerun safely.
3. `database/migrations/003_security_policies.sql`: RLS, read grants, database progress view and private `land-documents` bucket.
4. `database/migrations/004_transactional_operations.sql`: atomic write operations with actor access checks, role checks and audit entries. Execute permission is restricted to `service_role`.

Migrations 001, 003 and 004 are **one-time migrations**, tracked by your deployment process. Do not rerun them. The seed runs during installation, not every application startup.

The default bucket limit is 20 MiB. If you change `MAX_FILE_SIZE_MB` (1–50), also set the bucket's file size limit in Supabase Storage. If you change the bucket name, create that private bucket with the same allowed MIME types. Use a dedicated bucket without any permissive `storage.objects` client policies. Check an existing bucket before using it: the migration does not overwrite a bucket with the same ID.

Property identity is `(survey_number, property_name, village, taluk, district)`, compared without case or surrounding whitespace. The survey number is not globally unique. Use distinct property names for separate holdings at the same survey/location.

### Create the first administrator

In Supabase **Authentication → Users**, create the first account using your own email and a strong password. The Auth trigger creates a profile with the safe default `viewer` role; user-controlled metadata cannot assign roles. Then run this in SQL Editor, replacing the email:

```sql
update public.profiles
set role = 'admin', full_name = 'DNAssets Administrator'
where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
```

Create other Auth users the same way, then assign `collector`, `reviewer` or `viewer` in `profiles`. Only a trusted Supabase administrator should change global roles. Do not put role-management SQL into browser code. Disable public signups in Supabase Auth when using administrator-created accounts. Password resets and invitations are managed from Supabase Auth.

Admins see all properties, including the initially unassigned 216/1 seed. Collectors can create properties and are automatically assigned to them. Other access is granted or revoked in **Settings → Manage property access** by an admin. Reviewers and viewers do not gain access merely because of their global role.

## Phase 3 — Express API and authentication

Files: `backend/src/app.js`, `server.js`, `config.js`, `validators.js`, and `services/`.

From Windows PowerShell:

```powershell
Set-Location 'C:\Users\Admin\OneDrive\Desktop\Survey application'
npm.cmd ci
Copy-Item -LiteralPath '.\backend\.env.example' -Destination '.\backend\.env'
notepad.exe '.\backend\.env'
```

Fill in the project URL, publishable key and server secret key. Use `SUPABASE_SECRET_KEY=sb_secret_...` for current projects, or `SUPABASE_SERVICE_ROLE_KEY` for a legacy service-role key. Never place server secrets in `frontend/`, a Git commit, a URL or a screenshot. The server accepts either convention through the Supabase JS client. See [Supabase API key documentation](https://supabase.com/docs/guides/getting-started/api-keys).

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
SUPABASE_STORAGE_BUCKET=land-documents
PORT=3000
MAX_FILE_SIZE_MB=20
NODE_ENV=development
FRONTEND_ORIGINS=http://localhost:3000
TRUST_PROXY_HOPS=0
```

```powershell
npm.cmd start
# Open http://localhost:3000
```

For watch mode use `npm.cmd run dev`. Express serves `frontend/` only; environment files, backend source, tests and migrations are not static assets.

The login form uses the backend's Supabase JS client for password sign-in. The frontend keeps access/refresh tokens in sessionStorage for the current tab, renews short-lived sessions, and sends Bearer tokens to the API. No property document content is placed there. Logout revokes the refresh session and clears tab credentials; already issued access tokens remain valid until their configured JWT expiry, as with Supabase's normal session model. Set an appropriate Auth JWT expiry for the organization.

Every data endpoint verifies the token with `auth.getUser`, reads the profile, and uses a user-scoped Supabase client for RLS-filtered reads. The service client performs only guarded mutations and storage operations. Auth/config endpoints are necessarily public; they expose no secret keys or property data. `/api/health` requires authentication and queries the database.

### API surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Public configuration readiness and file limit |
| POST | `/api/auth/login`, `/api/auth/refresh` | Sign-in/session renewal; rate limited |
| POST | `/api/auth/logout` | Revoke current refresh session |
| GET | `/api/me`, `/api/health` | Profile and authenticated database health |
| GET, POST | `/api/properties` | List or create properties |
| GET, PUT | `/api/properties/:id` | View or edit a property |
| GET | `/api/properties/:id/checklist`, `/progress`, `/audit` | Checklist, authoritative counts, latest 100 audit events |
| PUT | `/api/documents/:id` | Explicit `is_collected` boolean |
| POST | `/api/documents/:id/verification` | Review decision and findings |
| GET | `/api/documents/:id/files` | File metadata |
| POST | `/api/properties/:propertyId/documents/:documentId/files` | Multipart `file`, optional `replace_id` |
| GET | `/api/files/:id/url?download=1` | Authorized 60-second signed download URL; omit download for preview |
| DELETE | `/api/files/:id` | Remove metadata and queue storage deletion |
| GET | `/api/users` | Admin-only profile directory |
| GET, POST | `/api/properties/:id/members` | Admin-only assignment; POST `user_id`, optional `remove` |
| GET | `/api/reports/summary` | Counts and percentages for accessible properties |
| GET | `/api/reports/export?format=pdf&filter=all` | PDF or CSV; optional `property_id`; filters all/pending/verified/rejected |

Each upload request accepts one file. The multi-file UI queues one request per selected file so successes persist individually and failures show the number saved. It refreshes state even after a partially failed batch. Limits: 20 MiB default per file, 30 uploads/minute per IP, 180 API requests/minute per IP, 20 auth attempts/15 minutes per IP. Tune for your deployment rather than disabling protection.

## Phase 4 — HTML, CSS and vanilla JavaScript frontend

Files: `frontend/index.html`, `css/styles.css`, `config.js`, and `js/{app,api,auth,dashboard,surveys,checklist,uploads,reports,ui,preview}.js`.

The application uses hash navigation for Dashboard, Survey numbers, Documents, Verification, Reports and Settings. It includes a searchable survey register, property editing, responsive checklist cards, drag-and-drop upload, file preview/download/replace/delete, review dialogs, recent audit history and admin membership management. On mobile, use the menu button for navigation. Dialogs have accessible labels and native keyboard focus handling. All user-provided data is escaped before HTML rendering.

To host the frontend separately, edit `frontend/config.js`:

```javascript
window.DNASSETS_CONFIG = { apiBaseUrl: 'https://YOUR_BACKEND_HOST' };
```

Publish the **contents of `frontend/` at the host root**. Add the frontend's exact HTTPS origin to the backend `FRONTEND_ORIGINS` allowlist. Static-host security headers should include a CSP allowing that backend under `connect-src` and self-hosted scripts/styles only; deny framing. The same-origin Express deployment already supplies security headers. There are no CDN scripts or fonts.

## Phase 5 — Upload, verification, progress and reporting

Collection = categories explicitly marked collected **with at least one stored file**, divided by seven. Verification = categories explicitly verified by an authorized reviewer, divided by seven. One category produces 14.29%. Counts come from PostgreSQL's RLS-aware `property_progress` view; frontend percentages are never accepted as writes. Reports and summary counts use the same persisted state.

Server validation checks extension, MIME, file signature and size. Buffers exist only in request memory during upload; persistent content is stored in Supabase Storage under unique UUID paths. Uploaded filenames do not control storage paths. Signature checks are not malware scanning: integrate a scanning service before production if required by your organization's document handling policy.

Storage upload precedes the atomic metadata/audit transaction. A failed metadata commit removes the new object where the result can be determined. An ambiguous network response checks for committed metadata before deleting anything. If both commit and reconciliation checks lose database connectivity, the object is preserved for investigation; it never counts without metadata. Such rare unreferenced objects require operator reconciliation against `uploaded_files.storage_path`. Do not blindly delete bucket objects during reconciliation.

Replacement commits the new file record before deleting the prior record, in a single database transaction. Old storage paths are placed in `storage_cleanup` within that transaction. The server retries queued deletions every minute. Failed deletions stay queued. This covers deletion requests too, and keeps an audit trail even if the object store is temporarily unavailable. Do not remove cleanup queue rows until object deletion succeeds.

All content changes reset verification to Uploaded (or Pending if the last file is deleted). Deleting the last file also clears collection. Changes to survey number, location or owner reset prior reviews. Rejection requires a reason. Verified requires an explicit confirmed survey match. Matching a survey number does not establish legal ownership or title validity; qualified professional review is still required.

Exports are produced by the backend from authorized records. CSV uses UTF-8 BOM, quoted fields, and spreadsheet formula neutralization. PDF is generated with PDFKit, with multi-page wrapping for remarks. The bundled PDF font supports Latin text; for Tamil or other non-Latin scripts, set `PDF_FONT_PATH` to an absolute server path to an appropriate licensed Unicode `.ttf` or `.otf` font. Mount or bundle that font on the backend host. CSV and browser printing preserve Unicode. Print styling hides navigation and controls.

## Phase 6 — Tests and deployment

```powershell
Set-Location 'C:\Users\Admin\OneDrive\Desktop\Survey application'
npm.cmd run check
npm.cmd test
npm.cmd audit --omit=dev
```

Database tests run the actual four migrations against embedded PostgreSQL (PGlite), with local stubs for Supabase's `auth` and `storage` schemas. They exercise seeding, seven categories, 14.29% progress, review permissions, rejection, atomic replacement, final deletion, independent properties, RLS isolation, denied role/audit mutation, denied client storage access and identity-change review invalidation. API tests cover setup mode, authentication, CORS, file signatures, oversize files, upload/metadata failure recovery, ambiguous commits, and CSV/PDF generation. These tests do not substitute for connecting to a real Supabase Auth and Storage service.

### Live acceptance checks after configuration

Use a new staging project and separate admin, collector, reviewer and viewer accounts:

1. Sign in as admin: confirm 216/1 and seven categories; refresh and confirm no duplicate seed.
2. Upload a real Title Documents PDF; confirm Uploaded, 0% verified, and persistence after refresh.
3. Mark collected: confirm 1/7 and 14.29%; review and mark Verified with a confirmed match: confirm 14.29% verification.
4. Reject with an empty reason (must fail), then with a reason (must succeed).
5. Replace the PDF: confirm new file opens, old metadata is gone, review resets, and audit records both versions. Simulate failed upload: the original must remain available.
6. Add a second property, including the same survey in a different location: progress must be independent.
7. Assign only one property to the collector/reviewer. Attempt the other property's API URLs, file IDs and exports: expect 404/403 with no leaked data.
8. Using the publishable key alone, attempt direct database writes and bucket object access: they must be denied. An unassigned signed-in user must see no property rows.
9. Test PDF/JPG/PNG upload, invalid type, altered extension/MIME, oversized file, multiple files and interrupted upload.
10. Confirm preview/download links expire after 60 seconds and direct public bucket URLs fail. Existing signed links can remain usable for their short lifetime after access revocation.
11. Download PDF and CSV for all/pending/verified/rejected scopes; confirm names, locations, remarks, filenames, progress and update dates. Inspect printed output.
12. Delete the last file: confirm Pending, collection cleared, review reset, audit retained, and eventual storage cleanup. Reopen the browser and sign in to confirm database persistence.

### Deployment

Choose an HTTPS Node.js host for Express and Supabase for Auth/database/storage. Serve the frontend on the same Node host (simplest) or a separate static host. A static-only host cannot run this API. No Vercel serverless behavior is assumed.

The included Dockerfile runs Node as a non-root user and excludes environment files. Example local build, after dependencies and lockfile exist:

```powershell
docker build -t dnassets-survey .
docker run --rm -p 3000:3000 --env-file .\backend\.env dnassets-survey
```

For a production host, set `NODE_ENV=production`, Supabase keys, `FRONTEND_ORIGINS=https://YOUR_FRONTEND_HOST`, and a platform-provided `PORT`. Terminate HTTPS at a trusted reverse proxy; set `TRUST_PROXY_HOPS` to its verified hop count (zero by default). Use a TCP readiness probe or the public frontend `/`; `/api/health` is intentionally authenticated. Configure the Supabase Auth Site URL and allowed redirect URLs to the deployed frontend for admin invitation/reset flows. Never put a wildcard CORS allowlist in production.

Use the host's secret store, configure database backups and retention, and verify Supabase Security Advisor findings. In-memory rate limiting is scoped to one Node process; use a shared rate-limit store when scaling to multiple instances. Large portfolio-wide PDF exports currently run synchronously; introduce paginated/background exports if report size or host timeouts require it.

Reference: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [private storage access](https://supabase.com/docs/guides/storage/security/access-control), [signed downloads](https://supabase.com/docs/guides/storage/serving/downloads).

## Tracking and database management upgrade (30 October 2026)

See `UPGRADE_REPORT_2026-10-30.md` for the migration, API, validation, and recovery details. The existing application now includes Upload History, Review Management, Audit Logs, User Management and Database Management. Admin-only deletions require a scoped preview, exact typed phrase and a separate final confirmation. Automatic backups are enabled by default; configure `SURVEY_BACKUP_DIRECTORY` on a durable, access-restricted volume. Deletion/reset never runs during startup.

Saved local databases apply migrations `011_tracking_and_management.sql` and `012_legacy_survey_display.sql` automatically when needed. Supabase API deployments must apply both migrations once, after 001–010, before starting the upgraded server. Never rerun the retired seeding/account-reset migration 008. Keep the existing trusted TLS CA configuration for direct cloud database connections.

# DNAsset-survey-fullapplication
