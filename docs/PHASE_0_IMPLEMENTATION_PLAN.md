# Phase 0 — PostgreSQL Foundation and Authorization Plan

**Status:** In progress; the v1.2 schema and PostgreSQL API-compatibility storage are applied to the approved disposable development database.  
**Database:** PostgreSQL is the permanent database. No Google Sheets writes or new Sheets-backed implementation are planned.  
**Scope boundary:** The existing API reads and writes PostgreSQL through a JSONB compatibility store. A read-only Sheets dry-run and import copied the six existing records without changing the source. Normalized v1.2 repositories and reconciliation remain pending.

## 1. Phase 0 outcome

Establish a safe PostgreSQL-backed foundation for the v1.2 project/work features without losing current application behavior. Phase 0 is complete only when:

1. The schema and versioned migrations are reviewed, repeatable and restorable.
2. The existing eight Sheets collections can be migrated through a read-only, dry-run-capable tool with reconciliation and exception reports.
3. Runtime persistence uses PostgreSQL as the only write/read system of record after an approved cutover; Sheets is not a fallback or dual-write target.
4. Existing supported authentication, users, projects, issues, tasks, comments, time logs, issue attachments, activity, notifications, sprints, releases and templates have documented compatibility tests.
5. Central authorization and required database constraints are implemented and covered before new v1.2 routes depend on them.
6. Operations has verified backup/restore, health/readiness and incident/rollback procedures.

Phase 0 does not deliver the complete project hub, dashboards, backlog, email system, or all v1.2 UI. It builds their database, security, and API prerequisites.

## 2. Current baseline and risks

- Runtime persistence is currently Google Sheets through `backend/services/sheetsStore.js`, instantiated in `backend/services/data.js`.
- The existing route/service surface is `backend/routes/*.js`, `backend/services/data.js`, `backend/middleware/auth.js`, and `backend/server.js`.
- Existing data has eight tabs: Users, Projects, Issues, Tasks, Sprints, Releases, Templates, Notifications.
- Project memberships and user assigned projects are embedded ID arrays; issue comments, activity, time logs and attachment metadata are embedded JSON arrays.
- Current behavior is not a relational repository contract: routes use `list/findById/findOne/insert/update/remove`, often filter full collections in Node, and hydrate references in `data.js`. A direct API-for-API wrapper around SheetsStore semantics would not meet SQL scoping, pagination, transaction or performance requirements.
- Current roles are `admin`/`member`, first registration becomes admin. SRS requires five roles and a bootstrap Super Admin.
- Current code does not consistently apply resource authorization. Uploads are locally stored and `/uploads` is public. These are Phase 0 security blockers, not deferred UI polish.
- Current backend tests pass for configuration, SheetsStore and password policy, but do not test API-level role authorization, migrations, frontend journeys or SQL.

Detailed field inventory and relationships are in [POSTGRESQL_SCHEMA_DESIGN.md](./POSTGRESQL_SCHEMA_DESIGN.md); safe migration process is in [DATABASE_MIGRATION_PLAN.md](./DATABASE_MIGRATION_PLAN.md).

## 3. Workstreams and ordered implementation

### Workstream 0 — Decisions and compatibility baseline

**Tasks**

- Confirm the v1.2 draft decisions that block safe schema/data work: department assignment for existing records, membership reconciliation, legacy role/status mappings, token storage, API versioning, notification timestamps, attachment files, retention and recovery targets.
- Inventory actual Sheets contents through a separately authorized read-only process. This planning task does not access or modify live Sheets.
- Capture current API request/response behavior and representative fixtures for every existing route. Sanitize all fixtures; never check secrets or production personal data into Git.
- Establish explicit current behavior to preserve: account/profile behavior, existing issue/task CRUD, issue comments/activity/time logs, issue attachment metadata, project owner/member listing, CSV exports, notifications, sprint/release/template APIs, and logo/login behavior.
- Decide which current endpoints retain their paths/shapes and where additions or versioned responses are introduced.

**Exit gate:** Product/data owner signs off mapping rules and API compatibility; unresolved values are not defaulted.

### Workstream 1 — PostgreSQL schema, migrations, and repository boundary

**Tasks**

- Review and approve the schema design, including `work_items`/task/issue subtype invariant, role/reference tables, FK behaviors, attachment storage metadata, and audit/outbox normalization.
- Select and pin the PostgreSQL driver and migration tool; add configuration for `DATABASE_URL`, pool limits/TLS as required, and migration execution separate from application startup.
- Implement versioned, reviewable migrations for schema and seed data. Migrations should be deterministic, transaction-safe where supported, idempotent through migration history, and never run destructive DDL against production without approval.
- Implement a bounded connection pool, readiness query, graceful shutdown, transaction helper and typed repository methods using parameterized SQL.
- Introduce repositories by domain (users, projects/memberships, work items, milestones/backlog, notifications/audit, email outbox) with SQL scoping and pagination. Avoid whole-table generic `list().filter()` behavior.
- Keep HTTP routes and repositories separated through services; map database constraints/errors to stable application errors without leaking SQL or private data.
- Add database-only tests for constraints, FK deletion policies, transaction rollback, `SKIP LOCKED` outbox claims and concurrent issue-number allocation.

**Exit gate:** Fresh PostgreSQL instance migrates successfully; schema tests pass; no runtime connection secret or DDL privilege is embedded in source; repository behavior is covered before any route cutover.

### Workstream 2 — Role model, central authorization, and audit

**Tasks**

- Seed exactly the five SRS roles and enforce role validation at every write boundary.
- Implement central policy decisions for admin/manager/employee/trainee, department ownership/sharing, project owner/membership, trainee visibility, and resource/action permissions.
- Apply policy to every current read/write/export/search/summary route and every future repository query; client-side route guards remain convenience only.
- Ensure unviewable resource IDs return 404, while visible resources with forbidden actions return 403 as specified.
- Enforce `project_id` scoping for resources, list results, counts, exports and notifications; prevent callers from setting unauthorized owner, role, reporter, project, membership or department fields.
- Add audit events for login success/failure, role/department/active changes, membership changes, deletions, forced actions and sensitive authorization denials. Make records append-only.
- Add tokenVersion claims and compare against active user rows; invalidate tokens on role/department/active changes. Select cookie/CSRF or localStorage/CSP approach before implementation.
- Protect the final active Super Admin and only permit Super Admins to manage admin/Super Admin accounts.
- Use explicit transactions for sensitive multi-table state changes and write their audit records in the same transaction.

**Exit gate:** Every role/action permission-matrix test passes for API routes; cross-project and cross-department read/count/export tests demonstrate no leakage; last-Super-Admin and token-revocation cases pass.

### Workstream 3 — Data migration tool and reconciliation

**Tasks**

- Build a standalone migration command that can read source Sheets without write permissions and write to a chosen PostgreSQL target only when explicitly invoked.
- Separate extraction, transformation, validation, load and reconciliation stages. Support dry-run, stable run ID, resumable batches and deterministic child IDs.
- Preserve source IDs and password hashes; normalize/validate references and convert nested issue arrays to child rows. Generate a mapping for each embedded child record.
- Quarantine/report malformed JSON, broken references, duplicate normalized keys, unknown enum values, invalid dates/numbers, missing uploads and membership conflicts.
- Require a signed-off mapping for legacy `admin/member`, project statuses and departments. Do not invent user/project departments or convert unknown values to a permissive role.
- Produce privacy-safe reports with per-collection counts, checksums, target counts, quarantines, warnings, blocking errors, run metadata and approvals.
- Test repeated runs, partial failure/resume, target rollback, data reconciliation and input snapshot integrity against generated fixtures first, then an approved sanitized copy.

**Exit gate:** Dry run has no unresolved blockers; source-to-target mapping and child counts reconcile; restore test passes; authorized data owner accepts the report. Live Sheets must remain unchanged.

### Workstream 4 — Cutover and preservation regression

**Tasks**

- Rehearse a maintenance/write-freeze procedure. Stop new writes and wait for in-flight requests to finish.
- Take final source and PostgreSQL backups; execute final deterministic migration and reconciliation.
- Deploy the PostgreSQL repository implementation in a restricted environment; keep end-user writes disabled until readiness, authorization and smoke checks pass.
- Verify existing core flows on PostgreSQL: login/registration policy, profile, projects, issue/task CRUD, comments, time entries, activity, issue attachment records, notifications, sprint/release/template routes and CSV exports.
- Compare response contracts and keep legacy routes/fields where approved. New list routes use the SRS paginated envelope; existing array-returning v1 endpoints retain shape until versioned migration is agreed.
- Open traffic only after data owner and product owner approval. Do not dual-write or revert to Sheets after PostgreSQL accepts new writes.

**Exit gate:** Reconciliation and regression evidence accepted; operators can recover from a tested PostgreSQL backup; PostgreSQL is the sole system of record.

## 4. Proposed backend architecture

```text
Express route/controller
  -> request schema validation
  -> authentication and central authorization policy
  -> domain service (transaction boundary, workflow, audit/events)
  -> domain repository (parameterized SQL, explicit query scope)
  -> pg Pool / PostgreSQL
```

Additional components:

- **Migration command:** isolated CLI using a read-only Sheets source client and a restricted Postgres migration/load connection; never imported into runtime route code.
- **Attachment storage adapter:** keeps bytes outside PostgreSQL and outside public static serving. PostgreSQL stores metadata, ownership, scan state and opaque storage key.
- **Notification/email outbox:** application transaction records event/outbox rows; a worker claims and delivers outside the transaction with retries and idempotency.
- **Authorization query scope:** repository methods accept a trusted policy-derived scope, not raw client role/department filters.
- **Observability:** structured request logs, request IDs, redaction, `/health/ready`, DB pool metrics, query timing and migration run identifiers.

### Suggested directory layout

```text
backend/
  db/
    pool.js
    transaction.js
    migrations/
  repositories/
    usersRepository.js
    projectsRepository.js
    workItemsRepository.js
    planningRepository.js
    notificationsRepository.js
    auditRepository.js
    emailOutboxRepository.js
  services/
    authorizationPolicy.js
    authService.js
    projectService.js
    workItemService.js
    migration/
  validation/
  routes/
```

This is a proposal, not a requirement to create every file at once. Preserve current CommonJS conventions unless the team explicitly approves a module-system change.

## 5. Packages and configuration dependencies

No packages have been installed. Confirm versions/maintenance policy before adding dependencies:

| Package | Intended use | Required decision |
|---|---|---|
| `pg` | PostgreSQL pool and parameterized queries. | Required for PostgreSQL runtime. |
| `node-pg-migrate` | Versioned database migrations. | Not selected; reviewable SQL migrations use `backend/db/migrate.js`. |
| `zod` | Strict validation for request parameters, bodies and query filters. | Confirm as schema-validation library or select an equivalent. |
| `pino`, `pino-http` | Structured JSON request/application logs with redaction. | Align with deployment log collection. |
| `@azure/msal-node` | Microsoft Entra client-credentials tokens for Microsoft Graph email. | Selected outgoing email provider; grant Graph `Mail.Send` application permission with admin consent. |
| `node-cron` | Scheduled jobs only if one worker instance can be guaranteed. | Decide worker topology; avoid duplicate schedules in multi-instance API deployment. |
| Provider-specific object-storage SDK | Attachment byte storage if required by chosen provider. | Provider is unspecified; choose before adding SDK. |

Configuration to plan: `DATABASE_URL` (required), pool/TLS settings, separate migration credentials, existing JWT/port/CORS/auth settings, `DEFAULT_TIMEZONE`, `STORAGE_DRIVER`/`STORAGE_BUCKET`, Microsoft Graph (`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER`) and outbox/scheduler variables specified in the SRS. Secrets must be injected through the hosting secret manager, excluded from examples except placeholders, and redacted from logs.

## 6. Security controls and dependencies

- Complete the central permission layer before exposing new data surfaces. Test all role/action pairs and scope aggregate queries.
- Apply strict runtime schemas to every route and reject unknown fields, especially role, department, owner, reporter, status, project and attachment reference fields.
- Use parameterized SQL, allowlisted sort/filter columns, database constraints, minimum-privilege DB accounts and TLS.
- Preserve bcrypt-compatible hashes; reset secrets are single-use, short-lived, and hashed in PostgreSQL.
- Revocable JWTs require `tokenVersion`; active/role/department changes must invalidate issued sessions.
- Treat HTML as untrusted: sanitize server-side using the SRS allowlist and derive plain text on the server.
- Remove public static upload serving at cutover. Authorize every file read/delete; check size/count/extension, store generated keys, track scan state, and serve as attachment with `nosniff`.
- Keep audit data append-only and exclude secrets, passwords, reset tokens and unnecessary personal data.
- Rate limit API/auth traffic and add account-level failed-login throttling without enabling account enumeration.
- Retain CORS allowlist and Helmet. Enforce HTTPS in production and decide browser token storage with CSRF/CSP requirements before implementation.

## 7. Verification plan

### Automated tests

- Unit: policy matrix, role validation, status transition functions, issue-number allocator, completion/health calculators as implemented, data transforms and migration validation.
- PostgreSQL integration: unique/FK/check constraints, transaction rollback, advisory/row locking, repeatable migration batches, repository filters, pagination, and resource deletion policies.
- API integration: every existing endpoint and new Phase 0 endpoints with each relevant role; 401/403/404/409/422 behavior; data scope for lists/counts/search/export.
- Migration: fixtures for all eight tabs, embedded JSON arrays, malformed cell, duplicate email/key/issue number, orphan references, invalid timestamps, conflicting membership arrays, idempotent rerun, failure/resume and privacy-safe logs.
- Security: unauthorized cross-project requests, parameter injection, mass assignment, upload validation, token revocation, rate limits, audit completeness and secret redaction.
- Regression: preserve existing frontend API calls and core flows. The login logo at `frontend/src/pages/Login.js` remains intact.

### Operational verification

- Clean PostgreSQL install from migrations; database readiness and graceful shutdown.
- Backup/restore rehearsal; validate data and indexes after restore.
- Migration load and reconciliation run on a sanitized copy at representative scale.
- Verify pool capacity, connection leak behavior, SQL timeout strategy and p95 on scoped queries.
- Verify deployment rollback without routing PostgreSQL writes back to Sheets.

## 8. Risks and mitigations

| Risk | Mitigation / gate |
|---|---|
| Unapproved departments or membership merge can grant excessive access. | Block cutover until data owner approves exact mapping; report both source sides and test resulting visibility. |
| Duplicate emails/project keys or invalid issue numbers prevent relational constraints. | Preflight reports and explicit resolution; do not silently rewrite values. |
| Legacy embedded arrays contain malformed/missing data. | Quarantine individual records/fields with deterministic IDs and documented resolution. |
| Current routes expect synchronous full-list filtering and hydration. | Replace with explicit repository queries while contract tests protect existing route behavior; avoid a generic store compatibility shim as the final architecture. |
| Authorization is tightened and existing screens may depend on broader visibility. | Test current flows under intended least privilege; document intentional behavior change and update role-aware UI together. |
| Attachment metadata references missing or unsafe local files. | Inventory separately, scan and reconcile; keep inaccessible files quarantined; no public serving. |
| Existing first-admin registration conflicts with bootstrap Super Admin requirement. | Approve account mapping and registration behavior before enabling writes; protect final active Super Admin. |
| Partial cutover creates divergence between PostgreSQL and Sheets. | Freeze writes, no dual write, gated traffic opening; PostgreSQL-only compatible rollback after first write. |
| Email/scheduler workers duplicate work in multiple instances. | Durable idempotency keys and row claiming; deployment topology and scheduler ownership decided before enabling jobs. |
| Database credentials or personal data leak through reports/logging. | Secret manager, redaction, restricted encrypted reports, no production data fixtures in Git. |

## 9. Approval gates before coding

Implementation should not begin until the owner approves:

1. The PostgreSQL schema design and repository/API boundary.
2. The v1.2 draft decisions that affect schema and migration, especially existing department assignment and membership reconciliation.
3. The exact role/status mapping for real current data and bootstrap Super Admin identity.
4. The v1 API compatibility and response-shape strategy.
5. Attachment object-storage provider and handling of existing local files.
6. Database deployment target, TLS, credentials/roles, backup/retention, RPO/RTO, and migration window.
7. Selected package/tool versions and worker/scheduler topology.
8. The cutover, rollback and source-sheet archive plan.

After approval, implement in Workstream 1 and security foundations first; do not start project dashboards/backlog/email features against an unprotected or non-relational persistence layer.

## 10. Current non-actions

- The source Google Sheet was read only and was not changed.
- Six records were imported into the compatibility store; the normalized v1.2 entities are not yet populated.
- The current API reads and writes PostgreSQL. A normalized repository cutover remains pending.
