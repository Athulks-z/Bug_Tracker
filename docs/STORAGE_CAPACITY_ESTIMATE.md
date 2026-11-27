# Storage capacity estimate

## Scope and assumptions

This is a rough planning estimate for a local Task Tracker deployment with **30 active users**. It is not a measurement of the current database.

The estimate assumes:

- Around **150 new tasks per month** across the team.
- Normal task descriptions, comments, notifications, and activity/audit records.
- **1–2 small attachments per user per week**, averaging **500 KB per file**.
- Attachments are stored on the application server, separately from PostgreSQL.
- No significant retention cleanup; historical task and audit records continue to accumulate.
- No large video, archive, or design-file uploads.

Actual storage depends most on attachment size, upload frequency, audit retention, and whether backups or logs are stored on the same volume.

## Estimated growth

| Period | PostgreSQL data growth | Uploaded-file growth | Combined growth |
|---|---:|---:|---:|
| Daily average | 0.3–1 MB | 2–4 MB | **About 2–5 MB** |
| Weekly | 2–7 MB | 15–30 MB | **About 18–37 MB** |
| Monthly | 10–30 MB | 65–130 MB | **About 75–160 MB** |
| Yearly | 120–360 MB | 0.8–1.6 GB | **About 0.9–2.0 GB** |

Daily values are averages; actual uploads will arrive unevenly. Monthly and yearly values are rounded planning ranges.

### Approximate first-year footprint

Allow **100–300 MB** for the database's initial installation/schema/index overhead, then add estimated yearly growth:

- PostgreSQL after one year: approximately **0.2–0.7 GB**.
- Attachments after one year: approximately **0.8–1.6 GB**.
- Combined live application data after one year: approximately **1.0–2.3 GB**.

These figures exclude the operating system, application dependencies, PostgreSQL write-ahead logs, temporary files, monitoring data, and backups.

## Attachment-limit scenario

The application currently permits attachments up to **10 MB each**, with up to **10 attachments per task**. Those are upper limits, not the average assumed above.

If the team averages one 10 MB upload per user each week, uploads alone could add roughly:

- **300 MB per week**
- **1.3 GB per month**
- **15.6 GB per year**

If large uploads are common, size storage from actual usage and consider a separate upload policy/retention process. Do not treat the “small attachment” forecast as an upper bound.

## Suggested local-server starting point

For 30 users with ordinary task-tracker usage:

- **4 CPU cores and 8 GB RAM** is a reasonable starting configuration.
- Use an SSD and reserve at least **100 GB** for the server/data volumes.
- Keep PostgreSQL data and uploads on a monitored data volume, separate from the OS volume where practical.
- Keep backups on separate storage or another device/location; a second folder on the same disk does not protect against disk failure.
- Start with a visible quota such as **5–10 GB** for the application data, then adjust after measuring actual growth for a month.
- Alert IT when a data volume reaches **70–80%** capacity.

The server disk needs extra headroom for database maintenance, PostgreSQL WAL, logs, temporary exports, and backups. If backups are kept locally, size that area separately based on retention and backup method. Multiple full backups can use several times the live-data footprint.

## `STORAGE_LIMIT_MB` configuration

`STORAGE_LIMIT_MB` is an optional environment setting used by the Admin Settings screen to display used space against a quota. It is expressed in megabytes. For example:

```env
STORAGE_LIMIT_MB=10240
```

`10240` MB is approximately 10 GB. Configure it in the backend's environment (for local development, the ignored `backend/.env`; for deployment, the server's environment-variable settings), then restart the backend.

**Important:** this setting currently controls quota reporting/display; it does not block uploads when the displayed limit is reached.

## Maintenance for IT

### Daily

- Check application, PostgreSQL, and server availability.
- Check free disk space and confirm database and uploads backups completed.
- Review failed/pending email delivery errors.

### Weekly

- Record PostgreSQL size and uploads-directory size; compare with the prior week.
- Review disk, PostgreSQL, and application logs for repeated errors or unexpected growth.
- Check backup completion and available backup storage.

### Monthly

- Apply tested OS, PostgreSQL, Node.js, and dependency updates in a planned maintenance window.
- Restore a recent backup to a separate test environment and verify both records and uploaded files.
- Review user accounts and access permissions.
- Recalculate growth projections using actual measurements.

### Yearly and after major changes

- Perform a documented recovery exercise and verify the expected recovery time.
- Review backup retention, storage capacity, and server sizing.
- Confirm HTTPS/VPN or approved LAN access controls, restricted database access, and secure secret management.

## Measurement and forecasting

For the first month after deployment, record weekly:

1. PostgreSQL database size.
2. Uploads-directory size.
3. Backup-storage usage.
4. Number of active users, tasks created, and attachments added.

Use the measured average weekly increase to update the forecast. Recheck after changes to upload limits, user count, retention, or backup policy.
