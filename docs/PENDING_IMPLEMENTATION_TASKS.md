# Pending Implementation Tasks

This backlog turns the remaining gaps from the implementation comparison into assignable work items. It is an execution backlog, not a claim that every item below is absent: several older checklist findings are stale. Start with **P-01** and update this file as items are verified and completed.

## How to use this backlog

- Assign one task ID at a time; follow its dependencies.
- Each task should be implemented with focused tests and documentation/API updates where applicable.
- Mark an item `In progress`, `Blocked`, or `Done` and record its owner and completion evidence.
- Before expanding scope, check the current implementation and preserve working behavior.
- Do not infer completion from a database table or an unmounted page alone; verify the full API, authorization, UI, and tests for that workflow.

## Task board

| ID | Task | Priority | Status | Depends on |
|---|---|---:|---|---|
| P-01 | Revalidate the pending backlog against current code | P0 | Done | — |
| P-02 | Define and test the resource authorization matrix | P0 | In progress | P-01 |
| P-03 | Complete authentication, account recovery, and session revocation | P1 | Not started | P-02 |
| P-04 | Deliver department administration and policy workflows | P2 | Not started | P-02 |
| P-05 | Complete append-only audit events and authorized audit access | P1 | In progress | P-02 |
| P-06 | Complete project hub, project membership, and project APIs | P1 | In progress | P-02 |
| P-07 | Implement milestone lifecycle and project completion metrics | P2 | In progress | P-06 |
| P-08 | Integrate sprint and release workflows with projects | P2 | Not started | P-06 |
| P-09 | Implement backlog workflows | P2 | In progress | P-06, P-02 |
| P-10 | Implement work-item blockers and saved filters | P3 | Not started | P-09 |
| P-11 | Standardize API list contracts and complete API documentation | P1 | In progress | P-01 |
| P-12 | Complete task comments and templates rich-text support | P3 | In progress | P-01 |
| P-13 | Harden attachment lifecycle, validation, and storage | P1 | In progress | P-01, P-02 |
| P-14 | Deliver rejection and reopen email notifications | P1 | In progress | P-01 |
| P-15 | Add organization timezone support and date-boundary handling | P2 | In progress | P-01 |
| P-16 | Complete portfolio analytics, reports, and dashboard drill-down | P2 | In progress | P-02, P-06, P-11 |
| P-17 | Complete notification preferences and event coverage | P2 | In progress | P-02, P-14 |
| P-18 | Add operational readiness: backups, observability, and performance | P1 | Not started | P-01 |
| P-19 | Complete accessibility, localization, and end-to-end quality gates | P2 | Not started | P-01 |

## Current revalidation — 24 November 2026

The status changes above reflect repository implementation evidence, not completion of the full acceptance criteria. The detailed v1.2 matrix in [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md) predates the current code and is now explicitly marked historical.

### Verified delivered behavior

- PostgreSQL is the runtime store; migrations 001–009 are applied in the configured database. The Sheets store remains for legacy/migration support.
- Task and Issue are unified in the Task UI/API with legacy issue URL redirects; configurable types, required type/custom “Other”, sanitized rich-text task descriptions, date defaults/display, attachments, task identifiers, Reject/Reopen, and server-side task/dashboard visibility are present.
- Project list/detail routes and UI are mounted. Project queries are server-filtered by owner/member/stakeholder visibility, with Manager/Admin access; project owners are made members. Project creation/edit includes status, priority, dates, owner, members, stakeholders, and ordered milestones.
- Project detail exposes visible-task progress/distribution, milestone completion, and project backlog. Backlog-mode task creation, project-scoped backlog listing, and transactional move-to-task with assignment email are present.
- Project list pagination and `X-Total-Count` are implemented while preserving its array response shape. OpenAPI includes project/backlog paths and key fields.
- Current verification: backend suite **39 passed, 0 failed**; frontend production build succeeded; OpenAPI YAML parsed. PostgreSQL integration tests exercise project persistence and backlog exclusion/listing. These do not replace route-level permission, UI, or end-to-end coverage.

### Remaining gaps and boundaries

- **P-02/P-05:** Role helpers and scoped task/project query tests exist, but there is no complete resource × action authorization matrix. The audit table has limited assignment-response events; full append-only lifecycle coverage and an authorized audit API/UI are missing.
- **P-03/P-04:** Password recovery/session revocation and department administration are not delivered. Department schema exists, but no complete department API/UI/policy workflow was verified.
- **P-06:** Project hub is implemented, but broader membership APIs, full member workflow authorization coverage, and end-to-end project access tests remain.
- **P-07:** Milestone create/edit/order and progress are present through project create/update. Standalone milestone lifecycle/archive/status transitions and comprehensive metrics tests remain.
- **P-08:** Sprint and release surfaces exist, but their full project-detail integration, authorization matrix, and lifecycle/relationship tests remain.
- **P-09:** Backlog create/list/move is present. Ranking/reordering, bulk operations, trainee proposal/approval, and their concurrency/authorization tests are not implemented.
- **P-10:** Blocker and saved-filter tables exist in the schema, but full APIs, UI, validation, and visibility tests remain.
- **P-11:** OpenAPI YAML is syntactically valid and project/backlog endpoints were added. API schemas, error cases, pagination contracts, and contract tests remain incomplete.
- **P-12:** Task description rich text is present; rich-text comments and templates are not complete.
- **P-13:** Task upload, size/count and blocked-extension checks, authenticated download/delete, and assignment-email attachment/link handling exist. MIME/content verification, public upload-route/storage hardening, staging/orphan cleanup, and complete security/authorization coverage remain.
- **P-14:** Reject/Reopen in-app notifications and assignment-response email behavior exist. The Task Reject/Reopen endpoints do not yet queue lifecycle emails to creator, assignee, and CC recipients.
- **P-15:** Date-only serialization avoids timezone shifts and task start-date defaulting is implemented. Organization-timezone boundaries for due-today/overdue/dashboard behavior are not defined or verified.
- **P-16/P-17:** Task dashboard summaries are server-scoped and drill-down is supported, but portfolio reports/exports and notification preferences/read-all/event coverage remain.
- **P-18/P-19:** No verified backup/restore exercise, performance/observability acceptance, full accessibility/localization audit, or end-to-end suite.

### Product decisions still needed

- Confirm whether backlog proposals require trainee/manager approval, and whether ordering/bulk backlog operations are in scope.
- Define milestone archive/status-transition behavior and the authoritative project completion formula.
- Define organization timezone and due-date boundary rules.
- Confirm attachment content-scanning requirements and whether lifecycle emails for task Reject/Reopen should go to creator, assignee, and project stakeholders.

## Work items

### P-01 — Revalidate the pending backlog against current code

**Priority:** P0  
**Dependencies:** None  
**Suggested ownership:** Maintainer / technical lead

**Scope**

- Compare each item in this backlog and the existing implementation checklist with the current routes, database migrations, UI navigation, permissions, and tests.
- Correct stale statements, split work that is already partly delivered, and remove items proven complete.
- Confirm which APIs/pages are mounted and which database features are only schema-level.
- Record any decisions needed before implementation; do not make product-policy decisions by assumption.

**Acceptance criteria**

- Every item retained in this backlog has current-code evidence and a clear completion definition.
- The existing checklist is corrected or explicitly marked as historical where its status is stale.
- Product decisions and unresolved requirements are listed with an owner rather than silently assumed.

**Verification**

- Review route mounts, relevant frontend navigation, migrations, tests, and current API documentation.
- A reviewer can trace each backlog item to at least one concrete gap and its verification plan.

### P-02 — Define and test the resource authorization matrix

**Priority:** P0  
**Dependencies:** P-01

**Scope**

- Document role/action permissions for tasks, projects, users, departments, milestones, backlog, sprints, releases, attachments, reports, and audit records.
- Reuse existing permission helpers and the shared task visibility filter; avoid duplicating role-name checks.
- Enforce authorization in server-side queries and mutation handlers, not only in the UI.
- Return consistent forbidden/not-found responses without exposing inaccessible records.

**Acceptance criteria**

- Each resource/action has an explicit allow/deny rule for every supported role.
- List, detail, mutation, export, and nested-resource endpoints enforce the same policy.
- Unauthorized controls are hidden or disabled in the UI, while server checks remain authoritative.
- Automated tests cover allowed and denied access, including direct URL/API requests.

**Verification**

- Run targeted authorization tests and a route-by-route permission review.

### P-03 — Complete authentication, account recovery, and session revocation

**Priority:** P1  
**Dependencies:** P-02

**Scope**

- Review JWT claim, expiry, refresh, and token-version behavior against the documented policy.
- Add secure password-reset request and completion flows with expiring, single-use tokens.
- Add per-account throttling and tests for authentication and recovery abuse cases.
- Restrict profile updates to allowed fields and prevent unauthorized changes to role/project assignments.
- Preserve existing authentication and configuration behavior unless a tested security requirement requires a change.

**Acceptance criteria**

- Tokens enforce maximum lifetime and are invalidated after the defined revocation event.
- Reset tokens expire, cannot be reused, and do not disclose whether an account exists.
- Authentication and reset endpoints are rate-limited with observable, tested responses.
- Profile endpoints reject unauthorized fields and changes.

**Verification**

- Add API tests for token claims, expiry, revocation, reset expiry/reuse, rate limits, and profile allowlists.

### P-04 — Deliver department administration and policy workflows

**Priority:** P2  
**Dependencies:** P-02

**Scope**

- Confirm department schema and existing behavior, then implement the missing authorized APIs and admin UI.
- Define department membership and how department scope interacts with projects, task visibility, and user administration.
- Add safe handling for department changes and removal where records depend on the department.

**Acceptance criteria**

- Authorized administrators can create, view, update, and deactivate departments through supported UI/API flows.
- Department access rules are enforced server-side and covered by tests.
- Existing users and work records remain consistent when department membership changes.

**Verification**

- Test CRUD permissions, membership changes, invalid references, and cross-department access.

### P-05 — Complete append-only audit events and authorized audit access

**Priority:** P1  
**Dependencies:** P-02

**Scope**

- Identify security- and business-critical events that must be audited, including permission changes and task/project lifecycle actions.
- Record actor, action, target, timestamp, and appropriate before/after or contextual data without storing secrets.
- Prevent normal application paths from modifying or deleting audit history.
- Add an authorized audit query/API and UI if required by the product.

**Acceptance criteria**

- Critical successful mutations produce attributable audit events; failed/no-op requests do not create misleading success events.
- Audit data cannot be altered through ordinary application endpoints.
- Access is restricted and sensitive values are redacted.
- Tests cover event recording, access control, and redaction.

**Verification**

- Exercise representative mutations and verify persisted events and denied unauthorized reads.

### P-06 — Complete project hub, project membership, and project APIs

**Priority:** P1  
**Dependencies:** P-02

**Scope**

- Implement or complete project detail, member management, and project-scoped API flows.
- Define how project membership relates to the current policy that permitted task creators can assign to any active user.
- Add project-aware navigation and ensure project data is filtered by server-side permissions.

**Acceptance criteria**

- Users can view and manage projects according to the authorization matrix.
- Project detail and member APIs expose only permitted data.
- Task assignment to any active user remains supported and is not accidentally restricted by membership checks.
- Project pages provide useful empty, loading, and error states.

**Verification**

- Test project access by role, membership changes, and task assignment to a non-member.

### P-07 — Implement milestone lifecycle and project completion metrics

**Priority:** P2  
**Dependencies:** P-06

**Scope**

- Implement authorized milestone create/read/update/archive workflows.
- Define milestone dates, status transitions, and relationship to project work items.
- Calculate project completion metrics consistently from the agreed task/status rules.

**Acceptance criteria**

- Milestones are manageable through the authorized API/UI and are linked to the correct project.
- Invalid date ranges and cross-project references are rejected.
- Completion metrics use documented rules and match underlying task data.
- Tests cover lifecycle, permissions, and metric calculations.

**Verification**

- Verify milestone API/UI flows and compare calculated results with fixture data.

### P-08 — Integrate sprint and release workflows with projects

**Priority:** P2  
**Dependencies:** P-06

**Scope**

- Verify the currently mounted sprint/release UI and API behavior; do not rely on older checklist claims about whether pages are mounted.
- Complete project scoping, authorization, lifecycle validation, and links between planning records and work items.
- Implement optional completion/release notifications only if confirmed as a product requirement.

**Acceptance criteria**

- Sprint and release records are scoped to a project and enforce the authorization matrix.
- Lifecycle transitions and date/status constraints are validated server-side.
- Project navigation links to the relevant planning views.
- Tests cover project isolation and lifecycle rules.

**Verification**

- Run API and UI tests for create/update, invalid transitions, permissions, and linked work.

### P-09 — Implement backlog workflows

**Priority:** P2  
**Dependencies:** P-06, P-02

**Scope**

- Implement authorized backlog item create, view, update, rank/reorder, bulk operations, and conversion to a Task where required.
- Define approval and conversion rules before implementation.
- Preserve identifiers/history when converting items if the product requires it.

**Acceptance criteria**

- Backlog operations are project-scoped and permission-checked on the server.
- Ranking remains stable under concurrent or repeated updates according to the chosen ordering scheme.
- Conversion produces a valid Task and handles invalid or duplicate conversions predictably.
- Tests cover permissions, ordering, bulk behavior, and conversion.

**Verification**

- Test representative single-item, bulk, ordering, and conversion flows.

### P-10 — Implement work-item blockers and saved filters

**Priority:** P3  
**Dependencies:** P-09

**Scope**

- Add blocker/dependency relationships between work items, with validation for invalid and self-referential links.
- Add saved filters if confirmed in the product requirements, respecting the existing task visibility rule.
- Surface blockers and saved filters in the relevant work-item/list UI.

**Acceptance criteria**

- Blocker relationships cannot cross unauthorized project boundaries or create invalid cycles if cycles are disallowed.
- Saved filters cannot reveal records outside the viewer's task visibility.
- UI and API support create, view, update, and removal according to permissions.
- Tests cover relationship validation and visibility-safe filtering.

**Verification**

- Test blocked/unblocked views, invalid relationships, and employee versus manager filter results.

### P-11 — Standardize API list contracts and complete API documentation

**Priority:** P1  
**Dependencies:** P-01

**Scope**

- Inventory existing list endpoints and identify compatibility-sensitive consumers before changing response shapes.
- Define a consistent pagination envelope for new APIs and a migration/versioning approach for existing endpoints.
- Update OpenAPI schemas, query parameters, authorization behavior, error responses, and examples.
- Add missing contract coverage for list, count, detail, mutation, and report endpoints.

**Acceptance criteria**

- Pagination, sorting, filtering, and error shapes are documented and consistent for the agreed API version.
- Existing clients are migrated or protected by an explicit compatibility plan.
- OpenAPI validates and matches runtime behavior for the covered endpoints.
- Contract tests detect response-shape regressions.

**Verification**

- Run OpenAPI validation and API contract tests for representative endpoints.

### P-12 — Complete task comments and templates rich-text support

**Priority:** P3  
**Dependencies:** P-01

**Scope**

- Verify comment and template description formats and current rendering paths.
- Add rich-text editing where required, reusing the existing editor and server-side sanitizer.
- Preserve plain-text rendering and sanitize on save and render.

**Acceptance criteria**

- Required comment/template fields support the agreed formatting controls.
- Unsafe markup and link attributes are removed or normalized by the shared sanitizer.
- Existing plain-text content remains readable.
- Tests cover sanitization, rendering, and legacy content.

**Verification**

- Run sanitizer and UI tests against safe formatting, malicious markup, and plain-text fixtures.

### P-13 — Harden attachment lifecycle, validation, and storage

**Priority:** P1  
**Dependencies:** P-01, P-02

**Scope**

- Audit current task attachment limits, extension/MIME checks, random stored names, authenticated download/delete, and email delivery.
- Add content-based validation or malware scanning according to deployment capability and product policy.
- Add staged upload/cleanup and storage abstraction only where required for reliable operation; do not assume public upload paths are still active.
- Ensure attachment links and email behavior cannot bypass task visibility or authorization.

**Acceptance criteria**

- Limits and blocked-file rules are enforced server-side and configurable as intended.
- Downloads/deletes require authorization and do not reveal storage paths.
- Temporary or orphaned files are safely cleaned up.
- Email attachment size behavior (attach versus secure link) is documented, authorized, and tested.
- Tests cover size, dangerous/double extensions, MIME mismatch, access control, and cleanup.

**Verification**

- Run targeted upload/download/delete/email tests and inspect configured storage behavior.

### P-14 — Deliver rejection and reopen email notifications

**Priority:** P1  
**Dependencies:** P-01

**Scope**

- Review existing in-app notification and email/outbox paths for Reject and Reopen.
- Send emails to the agreed creator, assignee, and CC recipients, including closing remarks on rejection.
- Reuse the existing email/outbox implementation and templates; avoid duplicate delivery.

**Acceptance criteria**

- Each successful reject/reopen operation creates the intended in-app and email notifications.
- Recipient lists are deduplicated and unauthorized or inactive recipients are handled by documented rules.
- Rejection remarks appear correctly in email and are safely rendered.
- Tests cover recipient selection, email content, and outbox failure/retry behavior.

**Verification**

- Use the existing mail test transport/outbox tests; do not send real external email in tests.

### P-15 — Add organization timezone support and date-boundary handling

**Priority:** P2  
**Dependencies:** P-01

**Scope**

- Define the organization timezone source and behavior for users, if per-user timezones are required.
- Apply timezone-aware day boundaries to due-today, overdue, start-date defaults, dashboard, and reports.
- Preserve date-only values without introducing UTC conversion shifts.

**Acceptance criteria**

- Date-only fields remain stable across browser/server timezones.
- “Today” and due-date boundaries follow the configured timezone, including daylight-saving transitions where applicable.
- API and UI display the same calendar date.
- Tests cover midnight boundaries, timezone offsets, and date-only serialization.

**Verification**

- Run date and dashboard tests with controlled timezone settings and boundary fixtures.

### P-16 — Complete portfolio analytics, reports, and dashboard drill-down

**Priority:** P2  
**Dependencies:** P-02, P-06, P-11

**Scope**

- Inventory current task dashboard aggregates and compare them to the product's portfolio/report requirements.
- Implement only confirmed missing project, milestone, sprint/release, and cross-project analytics.
- Apply shared visibility and authorization filters inside server-side queries for every chart, list, export, and report.
- Ensure clickable dashboard aggregates link to equivalent list filters.

**Acceptance criteria**

- Each report/chart has documented definitions and server-enforced visibility.
- Counts reconcile with the corresponding filtered list totals.
- Employee/trainee responses omit team-only data rather than hiding it only in the browser.
- Type/custom type and Rejected categories are represented where relevant.
- Tests cover visibility, aggregate/list parity, and export access.

**Verification**

- Compare dashboard/report aggregates against filtered API results using test fixtures.

### P-17 — Complete notification preferences and event coverage

**Priority:** P2  
**Dependencies:** P-02, P-14

**Scope**

- Inventory notification-producing events, existing in-app notifications, and email outbox behavior.
- Define user preferences and delivery rules for supported event types.
- Enforce authorization and task visibility on notification lists and linked records.
- Add read/unread and bulk/read-all behavior if required by the product contract.

**Acceptance criteria**

- Supported events produce consistent notifications without duplicate delivery.
- Users cannot read notifications or linked task data they are not authorized to access.
- Preferences are honored server-side and have an accessible UI.
- Tests cover event coverage, read state, preferences, and visibility.

**Verification**

- Run notification API/UI tests and inspect email outbox results with a test transport.

### P-18 — Add operational readiness: backups, observability, and performance

**Priority:** P1  
**Dependencies:** P-01

**Scope**

- Document and automate database/file backup and restore procedures appropriate to configured storage.
- Add structured logs, request correlation, health/readiness checks, and operational metrics without logging secrets.
- Measure critical list/dashboard/upload paths and add indexes or query changes only from evidence.
- Define and test performance targets and graceful failure behavior.

**Acceptance criteria**

- A documented restore exercise succeeds in a non-production environment.
- Logs and health endpoints help diagnose failures without exposing credentials or sensitive content.
- Performance targets and test data are stated; critical query paths meet agreed limits.
- Backup, restore, readiness, and performance procedures are reproducible.

**Verification**

- Run a restore drill and the agreed load/performance checks; attach results to the task.

### P-19 — Complete accessibility, localization, and end-to-end quality gates

**Priority:** P2  
**Dependencies:** P-01

**Scope**

- Audit primary task, project, planning, and administration flows for keyboard access, labels, focus management, contrast, and responsive behavior.
- Identify user-facing strings not routed through the existing localization approach and complete the agreed language coverage.
- Add end-to-end coverage for high-value flows and consolidate CI checks/coverage thresholds where required.

**Acceptance criteria**

- Critical flows pass the agreed accessibility checks and keyboard-only interaction.
- User-facing strings use the established localization mechanism.
- End-to-end tests cover authentication, task assignment, visibility, attachments, reject/reopen, and key project workflows.
- CI runs targeted tests and reports failures/coverage consistently.

**Verification**

- Run accessibility and end-to-end suites in CI and document any accepted exceptions.

## Completed work to preserve

The following should be treated as existing behavior to verify and preserve, not re-created as new work: Issue-to-Task merge and legacy redirects; configurable task types including custom “Other”; sanitized Task descriptions; Task attachments and authenticated downloads; Reject/Reopen actions; task assignment to any active user; task/date display fixes; and server-side role-based task visibility and dashboard filtering.

If revalidation finds any of these incomplete or regressed, add a narrowly scoped follow-up item rather than reopening the whole feature area.
