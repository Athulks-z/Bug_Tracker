# Google Sheets to PostgreSQL Migration Plan

**Status:** Normalized PostgreSQL runtime storage and the transactional conversion are implemented. The approved development database has been converted; the original JSONB rows are retained in `public.app_records_legacy`. Production cutover still requires its own backup, restore test, and operational approval.  
**Database decision:** PostgreSQL is the permanent runtime database. Google Sheets is the legacy source to be read during a controlled migration only; it is not a fallback or target for new writes.

Apply the versioned schema with `npm --prefix backend run db:migrate`, then convert existing compatibility rows with `npm --prefix backend run db:migrate:normalized`. The conversion validates references and values, inserts all rows and embedded issue children in one transaction, verifies table counts, records its completion, and renames `app_records` to `app_records_legacy`. Runtime storage refuses to start until this migration marker and archive are present. The pre-existing empty integer-keyed `public.users` table remains preserved as `public.users_legacy_empty`. The read-only Sheets extractor/importer is a pre-cutover tool only. The development source had four users, one project, two issues, and two activity rows; there were no tasks, sprints, releases, templates, notifications, comments, time entries, or attachments.

The implemented legacy mappings are: `admin` to `super_admin` for the bootstrap account and `admin` otherwise; `member` to `employee`; missing issue/task types to `other`; project status strings to the normalized project-status set; and `Projects.members[]` plus `Users.assignedProjects[]` to the union of memberships. In the development source, each membership list contained two entries with no overlap; the approved union created four active project-member rows. No department or mentor data is fabricated. A database validation failure rolls back the full conversion and leaves `app_records` intact.

## 1. Goals and guardrails

- Migrate all eight existing Sheets collections and embedded child data to the normalized design in [POSTGRESQL_SCHEMA_DESIGN.md](./POSTGRESQL_SCHEMA_DESIGN.md).
- Preserve existing application-visible IDs, password hashes, timestamps and relationships where valid.
- Add v1.2 fields and entities only with explicit mapping/default decisions; never fabricate departments, mentors, permissions or business data.
- Keep the source spreadsheet unchanged. Use read-only credentials for extraction and never call write/update/batchUpdate methods in the migration tool.
- Never log passwords, hashes, service-account keys, reset tokens, full descriptions, comments, attachment content or other personal data.
- Make every migration run identifiable, repeatable, verifiable and stoppable before cutover.
- Keep the old Sheets-backed application and source data available as a read-only rollback reference, but do not dual-write to Sheets and PostgreSQL.

## 2. Source inventory and mapping

Source columns below match `TABLES` in `backend/services/sheetsStore.js`. All Sheets `_id` values should be copied exactly into PostgreSQL `text` IDs. Child records in JSON cells have no stable database IDs; assign deterministic migration IDs from `(source collection, parent id, field, array index)` and record the mapping in a migration map/report, not in application response data.

| Source tab | Source fields / embedded data | PostgreSQL targets | Migration treatment |
|---|---|---|---|
| `Users` | `_id`, name, email, password, role, jobTitle, domain, phone, skills, reportingManager, assignedProjects[], avatar, active, bootstrapAdmin, timestamps | `users`, `roles`, `manager_departments` (not inferable from source), `project_members` | Preserve ID and bcrypt hash. Normalize email for uniqueness only after a collision report. Map legacy `admin → admin`, bootstrap admin → `super_admin`, `member → employee` per SRS. Preserve unmapped profile values. Do not invent departments, mentors or manager department scope. `assignedProjects[]` is reconciled with `Projects.members[]`. |
| `Projects` | `_id`, name, description, key, owner, members[], status, timestamps | `projects`, `project_members`, optionally `project_departments` after approved department assignment | Preserve ID/key after duplicate/format checks. Convert `members[]` to memberships. Reconcile project owners and memberships against users. Existing status mapping must be reviewed; reject/report unknown values, do not silently coerce. Owning department, dates and status choices are not available in the source. |
| `Issues` | `_id`, title, description, project, reporter, assignee, status, severity, dueDate, issueNumber, foundInVersion, fixedInVersion, targetRelease, sprint, estimatedHours, timeLogs[], attachments[], comments[], activity[], reopenedCount, resolvedAt, timestamps | `work_items`, `issues`, `comments`, `time_entries`, `attachments`, `activity_log`, `block_links` only if explicit valid blocker data exists | Preserve issue ID as `work_items.id`; subtype ID matches. Map issue-specific fields. Convert nested arrays to individual records and retain ordering/timestamps. Resolve sprint/release/user/project references. Existing attachments provide metadata/path references, not necessarily file bytes. Never create blocker links from guesses or issue wording. |
| `Tasks` | `_id`, title, description, project, reporter, assignee, status, priority, startDate, endDate, timestamps | `work_items`, `tasks` | Preserve task ID. Map `endDate → due_date` after verifying actual date values; `taskType → other` per FR-TYPE-07; completedAt should be derived only if an approved historical status/timestamp mapping exists, otherwise report as unavailable. |
| `Sprints` | `_id`, name, project, startDate, endDate, goal, status, timestamps | `sprints` | Preserve IDs; validate project/date/status references. No sprint membership can be derived unless separately present in actual source data. |
| `Releases` | `_id`, name, project, version, description, releaseDate, status, timestamps | `releases` | Preserve IDs; validate project and release values. Resolve issue `targetRelease` only when it matches a release ID; report free-text/unmatched references for review. |
| `Templates` | `_id`, name, type, body, fields JSON, createdBy, timestamps | `templates` | Preserve IDs and fields JSON after schema/size checks. Add optional `project_id` as NULL because the source has no project-scope field. Keep body text until the SRS rich-text migration/sanitizer is approved and applied. |
| `Notifications` | `_id`, type, issue, user, details, read, timestamps | `notifications` | Preserve ID. Map user to recipient and issue to resource. Actor is unknown in the source and remains NULL. Translate boolean `read` to `read_at`: use a recorded timestamp only if a trustworthy source exists; otherwise migration time for read rows and NULL for unread, with this synthetic timestamp clearly identified in report. |

### Relationship inventory

- Users have a self-reference via `reportingManager`; projects have an owner reference.
- Project membership is redundantly represented by `Projects.members[]` and `Users.assignedProjects[]`. The converter applies the documented union policy so a relationship present on either side is retained.
- Tasks and issues reference a project, reporter, and optional assignee; issues additionally reference a sprint and a possible release field.
- Sprints, releases and templates have project/user references as listed above.
- Issue comments/activity/time logs/attachments are embedded arrays; notification rows link to an issue and recipient user.
- No source collection represents departments, milestones, backlog, block links, task comments, audit records, email outbox, attachment object metadata, saved filters, task types, or project stakeholder configuration. These will be created as empty v1.2 tables or seeded fixed reference values, not populated with invented records.

## 3. Migration phases and execution protocol

### Phase A — Authorize and inventory

1. Approve a migration window, application write freeze, data owner for ambiguous values, destination PostgreSQL instance, retention period and production rollback policy.
2. Obtain secure read-only Sheets access for the migration operator and a separate least-privilege PostgreSQL migration role. Do not place credentials in the repository or reports.
3. Inventory all tabs, exact header rows, row counts, nonempty rows, trailing/blank rows and maximum cell sizes. Record only counts and safe identifiers in summary output.
4. Take a source-preserving snapshot/export using authorized read access; keep it encrypted and access-controlled. Do not modify the source spreadsheet.
5. Inventory referenced local upload files separately and reconcile against issue attachment metadata. Do not assume a path reference means the file exists or is safe.

### Phase B — Dry-run extraction and validation

1. Read each tab once into a versioned, immutable migration input artifact. Record extraction time, spreadsheet/tab identifiers, header fingerprints, counts and per-row checksums without recording secrets.
2. Parse using the same source column definitions. For every malformed JSON cell or invalid typed value, report tab, source row/ID, field, and error category; omit the actual private cell content.
3. Validate source references, duplicate IDs, case-insensitive email/project-key collisions, missing required values, role values, date formats, negative/non-numeric estimates, issue-number duplicates, and nested-array shapes.
4. Produce a dry-run report with source/target counts, field transformations, unresolved references, skipped/quarantined records, warnings and blocking errors.
5. Require explicit review of membership array conflicts, unrecognized roles/statuses, department assignment strategy, and notification read-time reconstruction before continuing.

### Phase C — Build and verify target schema

1. Create a clean PostgreSQL database using reviewed, versioned migrations from the schema design. Use no runtime application credentials for DDL.
2. Install constraints and indexes; seed role/type lookup rows deterministically. Keep PostgreSQL as the only target.
3. Run schema smoke tests, FK/unique/check constraint tests, and an empty database start/readiness test.
4. Keep migration run/checkpoint and source-to-target child-ID mapping metadata in a restricted migration ledger or secured external report. Do not mix temporary migration bookkeeping with user-facing application tables unless its retention/access needs are explicitly approved.

### Phase D — Load in dependency order

Load using idempotent upserts keyed by preserved source IDs, inside bounded transactions:

1. Roles and departments (department rows only after real source data or an approved explicit mapping exists).
2. Users (preserve hashes; map roles; defer/reconcile self-references as needed).
3. Projects and releases/sprints/templates after users/projects are available.
4. Project memberships from reconciled arrays.
5. Work item base rows, then task/issue subtypes; enforce unique project issue numbers.
6. Nested issue comments, time entries, activity and attachment metadata.
7. Notifications after recipients and resources exist.
8. Approved v1.2-only empty structures and reference data.

If work items use subtype rows, load the base row and its exactly-one subtype in one transaction. Batch sizes should be tuned to the source volume and PostgreSQL limits; record progress after each batch without exposing row contents. A failed batch must be retryable without duplicate child records.

### Phase E — Reconciliation and acceptance

Compare source versus target counts and checksums for every source collection. Validate:

- Every preserved source ID appears once in its target entity; every FK resolves.
- Password hashes are byte-for-byte unchanged and never appear in application responses or logs.
- Project memberships reconcile to the approved merge policy, with conflicts documented.
- Issue numbers are unique within each project; legacy duplicates are blockers pending resolution.
- Embedded child counts (comments, activity, time entries, attachments) match source arrays except explicitly quarantined entries.
- Date-only and timestamp conversions are stable, and timezone interpretation is explicit.
- Legacy status/role/email transformations match an approved mapping report.
- Representative API reads produce compatible identifiers and preserve existing issue/task/project/profile data.
- No unauthorized cross-project reads/writes; aggregate and export results respect caller scope.

Do not treat matching total row counts alone as successful validation.

### Phase F — Cutover

1. Announce and enable a write freeze; stop the old application from accepting writes. Confirm no writes are in flight.
2. Take a final source snapshot and repeat the deterministic load/reconciliation delta against the already validated target.
3. Deploy the PostgreSQL-backed application with database credentials and health/readiness checks. Keep external user writes disabled until smoke, permission, and record spot checks pass.
4. Run controlled acceptance checks for login, profile, projects, issues, tasks, comments/activity, notifications, and all required v1.2 security boundaries.
5. Open traffic only after product/data owner sign-off. PostgreSQL becomes the sole system of record; never dual-write.
6. Keep the original sheet unchanged and access-restricted as a read-only archive for the approved retention window. Do not place sensitive exports in the repository.

## 4. Data validation and exception policy

| Validation | Required handling |
|---|---|
| Missing or duplicate source `_id` | Blocking error; do not generate a replacement silently. |
| Unresolved user/project references | Quarantine affected row or block cutover; do not invent a reference or silently set it to NULL where it changes ownership/authorization. |
| Duplicate normalized email or project key | Blocking report; owner must choose a correction/merge. Do not modify source rows. |
| Unknown role/status/severity/priority | Report exact source ID and value; require an approved mapping. No fallback-to-member/default status behavior. |
| Malformed embedded JSON | Quarantine that child field/row and report count/category; never silently drop it. |
| Invalid date/number/boolean | Report and block affected records unless a reviewed, documented transformation is approved. |
| Conflicting project membership arrays | Migration policy is the union of both legacy relationship arrays, preserving memberships recorded on either side. |
| Issue release field unmatched | Preserve as a legacy value in a staging/migration exception record; do not attach to an arbitrary release. |
| Missing upload file or unsafe content | Migrate metadata as quarantined/unavailable only if product approves; never copy/open/serve it automatically. Scan and verify before use. |
| Unsupported v1.2-only fields | Keep NULL/default only where the SRS defines a default; document remaining user/admin setup tasks. |

Every exception should have a stable code, source entity/ID, field, severity, action (block/quarantine/approved transform), and resolution owner. Reports should not include full free text, credentials, personal contact data, or password material.

## 5. Migration reports and audit artifacts

Generate a restricted report outside the Git repository containing:

- Run ID, code/migration version, source snapshot fingerprint and extraction time.
- Per-tab source row counts, accepted target counts, quarantined counts, skipped blank rows and checksum totals.
- Per-table insert/update counts and FK/unique/check validation totals.
- Reconciliation outcomes for each source-to-target mapping.
- Issue records requiring human decisions, grouped by error code and safe source ID.
- Start/end times, batch-level progress, retries, failures and operator approvals.
- A manifest of encrypted backups and the restore test result; never include connection strings, keys, password hashes or private cell values.

Store deterministic mapping entries for embedded child IDs so reruns do not duplicate them. Protect and retain reports under the organization’s approved data-retention policy.

## 6. Backup and rollback strategy

### Before migration

- Export/snapshot the source through read-only access and retain it encrypted and immutable.
- Take a PostgreSQL pre-migration backup even for a newly provisioned instance.
- Use `pg_dump` custom format with encryption at rest and controlled key handling; for larger production environments, use an approved managed backup/PITR service.
- Verify backup checksums and perform a restore into an isolated environment before cutover. A backup that has not been restored is not considered verified.

### During migration

- Apply each versioned SQL migration transactionally when supported; maintain a separate migration history table.
- Use staging tables or a separate staging schema for raw transformed rows and validation; restrict access and drop/retain only under approved policy.
- Make data-load operations idempotent and persist a per-run checkpoint. Never overwrite target rows changed after cutover as part of a migration rerun.
- Keep source sheets unmodified. No reverse sync or dual-write.

### Rollback / recovery

- **Before traffic opens:** keep maintenance mode/write freeze in place. If schema/data validation or smoke checks fail, keep PostgreSQL unavailable to users, restore the pre-migration target if needed, fix the migration, and rerun from the immutable snapshot.
- **After PostgreSQL accepts writes:** PostgreSQL is authoritative. Roll back application binaries only to a version that supports the PostgreSQL schema/API contract; do not switch to a Sheets writer or discard PostgreSQL writes. Use PostgreSQL PITR/restore only through an approved recovery procedure, accounting for writes after the restore point.
- A return to Sheets would require a separately designed, tested reverse migration and explicit business approval; this plan does not assume or implement it.
- Test restore and application recovery before launch; define RPO/RTO with operations because the SRS does not specify those values.

## 7. Cutover checklist

- [ ] PostgreSQL schema and migrations reviewed and deployed to the target.
- [ ] Least-privilege application, migration, and backup credentials provisioned outside source control.
- [ ] Dry-run report has no unresolved blocking errors.
- [ ] Business owners sign off role/status/membership/dept/email/timezone mappings.
- [ ] Source snapshot and PostgreSQL backup are verified and restore-tested.
- [ ] Final write freeze and snapshot procedure rehearsed.
- [ ] Migration is repeatable and has tested failure recovery.
- [ ] Source-to-target counts, checksums, FKs, and nested children reconcile.
- [ ] Existing feature compatibility and role-based authorization tests pass.
- [ ] Readiness, connection pool, migrations, monitoring and operational runbook are ready.
- [ ] No user traffic is admitted until post-load smoke checks pass.
- [ ] Product/data owner approves cutover and source archive retention.
- [ ] Sheets write access is disabled for the new runtime; PostgreSQL is sole write target.

## 8. Decisions required before execution

1. Which explicit department assignment/mapping should apply to existing users and projects, given that the source has no department values?
2. How to reconcile membership arrays when `Users.assignedProjects` and `Projects.members` disagree?
3. Which existing role/status/severity/priority values are present in actual rows and how should unsupported values be resolved?
4. Are legacy notification read timestamps recoverable? If not, is migration time acceptable for already-read rows?
5. Are `targetRelease` values release IDs, versions, or arbitrary text in existing data?
6. What is the approved policy for existing local attachment files that are missing, unsafe, or inaccessible?
7. What are the approved backup retention, RPO/RTO, archive retention, migration window, and post-cutover rollback owner?
8. How should v1 API response shapes remain compatible while new list APIs use SRS pagination envelopes?

No values should be guessed to resolve these questions. Decisions must be recorded before production migration.
