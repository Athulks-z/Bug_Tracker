# PostgreSQL Schema Review Notes — Task Tracker v1.2

## 1. Review scope

Reviewed `docs/POSTGRESQL_SCHEMA_DESIGN.md` against the v1.2 PRD/SRS and the repository's documented SheetsStore structure. The schema has since been implemented through versioned PostgreSQL migrations, and the existing API now uses a transitional JSONB compatibility store. Six legacy records were imported through read-only Sheets access; normalized v1.2 data conversion remains pending, and the source spreadsheet was not modified.

## 2. Changes made to the schema proposal

| Review area | Outcome |
|---|---|
| Exactly one task/issue subtype per work item | Added `kind`-matching composite subtype foreign keys, fixed subtype discriminator checks, unique parent keys, and deferred constraint-trigger requirements. A committed work item must have exactly its one matching subtype; parent and subtype are written atomically. |
| Same-project integrity | Specified composite FKs for work-item milestone/sprint assignments, issue release targets, backlog milestone assignment and conversion, task parent/dependency relationships, blocker links, and milestone/work-item links. |
| Backlog conversion | Added `backlog_conversions` as the canonical unique one-to-one relationship; API `fromBacklog`/`convertedTo` values are derived rather than duplicated. |
| Blockers | Added `blocker_requests` for the trainee request flow. `block_links` uses typed target columns, same-project FKs, and explicit checks/validation for blocker-type and active-link rules. |
| Notifications | Replaced the unconstrained `resource_kind/resource_id` proposal with optional typed `notification_resources` links and real FKs. Notification rows and resource snapshots survive deletion of the linked resource. |
| Email resource linkage | Added typed `email_resources` links and persistent payload/resource snapshots; resource deletion removes only the link. Recipient snapshots preserve delivery history. |
| External attachment cleanup | Added a durable `storage_cleanup_jobs` proposal so object deletion is retried after the PostgreSQL transaction commits. |
| Ownership, user deactivation, and deletion | Documented transactional project-owner reassignment, session revocation through `token_version`, department/project deletion restrictions, and preservation of historical user-owned records. |
| Indexing | Split unique/integrity and SRS-required indexes from query indexes that require measured query-plan evidence. Included FR-WORK-15 task/issue project/type indexes. |
| Audit controls | Added append-only permissions, restricted reads, sensitive-field redaction, retained actor/resource snapshots, and an explicit unresolved retention policy. |
| SRS data coverage | Added a coverage matrix mapping SRS entity/data areas to proposed tables and identified flexible JSON values that must be validated. |
| ER diagram | Updated it to include conversions, blocker requests, typed notification/email resources, templates, and same-project resource relationships. |

## 3. Unresolved product and policy decisions

These are not safe to decide from the repository alone and are implementation gates:

1. **User deactivation/open work:** PRD asks for reassignment of open work; SRS §6.4 says open work is flagged unassigned. Product must select the behavior and define what happens to completed/history assignments.
2. **Project deletion confirmation:** clarify the exact meaning, authorization, and client/server semantics of `?confirm=<key>`. The proposed design requires an explicit confirmation and blocks deletion when open tasks/issues remain unless the SRS-defined confirmation condition is satisfied.
3. **Project status set:** `cancelled` is referenced by PRD/SRS closure-email behavior but omitted from the SRS project status list. Confirm whether it is a supported project status before finalizing the CHECK constraint.
4. **Audit retention:** choose retention duration, archival destination, legal-hold behavior, and whether anonymization is required. No deletion duration is assumed.
5. **Release version uniqueness:** confirm whether versions must be unique within a project before adding that unique constraint.
6. **Backlog rank semantics:** confirm whether rank is unique per project and define ordering/reordering semantics before imposing a uniqueness constraint.
7. **Blocker lifecycle:** confirm whether blocker links are retained after resolution/rejection and precisely when linked blockers cease to affect blocked state/counts. The proposal keeps historical links and treats only active blockers as effective.
8. **Department hierarchy:** confirm whether nested departments may be arbitrarily deep and whether cycles are forbidden; the proposed self-FK alone is insufficient to prevent hierarchy cycles, so service/trigger validation is required.
9. **Email provider and payload retention:** provider and sensitive-field retention policy remain deployment/product decisions; outbox payloads must be minimized and redacted.
10. **Global template permissions and field schema:** SRS permits optional project scope, but does not by itself settle who may create/edit global templates or the complete `fields` JSON schema.
11. **Project-membership reconciliation:** legacy `Projects.members` and `Users.assignedProjects` may disagree. Establish an approved precedence/reconciliation rule before migration.
12. **Legacy project/status and release values:** define reviewed mappings for free-form statuses, `targetRelease` values, and any unknown enum values; never silently coerce them.
13. **Milestone cardinality:** the proposal uses the SRS/API's optional `work_items.milestone_id` as the single source of truth (zero or one milestone per item). If the requirement is instead many-to-many, replace this column with a relation table; do not retain both as independently writable representations.

## 4. Technical cautions / implementation gates

- Implement subtype enforcement with deferred constraint triggers or an equivalent database-enforced mechanism. A normal FK alone cannot require every parent to have a child row.
- Same-project composite FKs require all referenced composite unique keys to be present in migrations. Include project IDs on relation rows where needed and avoid denormalized IDs without consistency constraints.
- A `CHECK` cannot query the `work_types` registry. The fixed subtype kind can be checked locally; allowed type/kind membership must use the composite FK to `work_type_kinds`.
- Blocker issue-type validation and blocker-cycle detection require a trigger/service transaction in addition to the FKs and XOR check.
- External attachment-object deletion is not transactional with PostgreSQL. Commit a durable cleanup job/queue record, then delete asynchronously and retry; do not delete the object before the database transaction commits.
- Audit immutability is not achieved by application convention alone. Use a least-privilege runtime role and, where required, database-side defense in depth. Separate retention administration from the runtime role.
- Resource snapshots in notifications, email, and audit must be allowlisted and redacted. Avoid copying entire user/project/work-item JSON objects.
- Decide the user deletion policy separately from deactivation. Historical audit and delivery history must not be lost by ordinary user deactivation.

## 5. SRS coverage findings

The revised design has proposed representations for the v1.2 user/role/department/project domains, work-item task and issue subtypes, status/priority/estimate/date fields, milestones, backlog and conversion, sprints, releases, blocker requests/links, dependencies, memberships, comments, time entries, attachments, activity, notifications, templates, saved filters, audit, password resets, and email delivery/outbox data.

The SRS's flexible settings, template field definitions, email payloads, and immutable snapshots remain JSON only where their schema is validated at the application boundary. They must not be used to replace relational identifiers or query-critical fields.

This confirms proposed entity representation, not field-by-field implementation readiness. Before migrations are authored, compare every field and enum in SRS §7.2 and every integrity rule in §7.3 to the actual SQL migration draft, then validate every API/acceptance criterion against it.

## 6. Approval and implementation boundary

This review updates only `POSTGRESQL_SCHEMA_DESIGN.md` and adds this note. No source code or database changes were made. Implementation remains paused pending user approval and resolution of decisions that affect schema constraints or migration behavior.
