# Issue to Task Migration

## Dry run

Apply the reversible schema migration first:

```bash
npm run db:migrate
npm run db:migrate:issue-task -- --dry-run
```

The dry run reports issue counts and proposed status mappings. It does not change data.

## Apply

After a database backup:

```bash
npm run db:migrate:issue-task -- --apply
```

The script creates `task_merge_issue_backup` before changing records. Issue IDs remain the same. Comments, activity, time entries, and attachments retain their IDs and work-item references.

## Status mapping

| Legacy status | Task status |
|---|---|
| Open, Triaged, Assigned | Open |
| In Progress | In Progress |
| Code Review, QA Testing | In Progress |
| Resolved | Completed |
| Closed | Closed |
| Reopened | Open |
| Rejected | Rejected |
| To do | Open |
| In progress | In Progress |
| Blocked | Blocked |
| Completed | Completed |

Legacy Issue type `bug` becomes Task type `Bug`; every other legacy Issue type becomes `Issue`. Severity and issue-only metadata remain optional Task columns.

## Reverse

```bash
npm run db:migrate:issue-task -- --down
```

The reverse step restores legacy Issue rows from `task_merge_issue_backup`, reapplies original statuses and work-item kinds, and removes the merged Task subtype rows for the migrated IDs.
