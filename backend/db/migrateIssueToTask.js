const pool = require('../config/db');

const STATUS_MAP = {
  'Open': 'Open',
  'Triaged': 'Open',
  'Assigned': 'Open',
  'In Progress': 'In Progress',
  'Code Review': 'In Progress',
  'QA Testing': 'In Progress',
  'Resolved': 'Completed',
  'Closed': 'Closed',
  'Reopened': 'Open',
  'Rejected': 'Rejected',
  'To do': 'Open',
  'In progress': 'In Progress',
  'Blocked': 'Blocked',
  'Completed': 'Completed'
};

function issueTypeToTaskType(issueType) {
  return String(issueType || '').toLowerCase() === 'bug' ? 'bug' : 'issue';
}

function issueRowToJson(row) {
  return {
    id: row.id,
    work_item_id: row.work_item_id,
    project_id: row.project_id,
    issue_number: row.issue_number,
    issue_type: row.issue_type,
    severity: row.severity,
    found_in_version: row.found_in_version,
    fixed_in_version: row.fixed_in_version,
    target_release_id: row.target_release_id,
    reopened_count: row.reopened_count,
    resolved_at: row.resolved_at,
    labels: row.labels
  };
}

async function inspect() {
  const issueTableResult = await pool.query(`
    SELECT CASE
      WHEN to_regclass('public.issues') IS NOT NULL THEN 'issues'
      ELSE 'issues_legacy_merge_archive'
    END AS table_name
  `);
  const issueTable = issueTableResult.rows[0].table_name;
  const [issueCount, taskCount] = await Promise.all([
    pool.query(`SELECT count(*)::int AS count FROM public.${issueTable}`),
    pool.query('SELECT count(*)::int AS count FROM public.tasks')
  ]);
  const statusRows = await pool.query(`
    SELECT w.status, count(*)::int AS count
    FROM public.work_items w
    JOIN public.${issueTable} i ON i.work_item_id=w.id
    GROUP BY w.status
    ORDER BY w.status
  `);
  return {
    issues: issueCount.rows[0].count,
    existingTasks: taskCount.rows[0].count,
    statusMapping: statusRows.rows.map((row) => ({
      from: row.status,
      to: STATUS_MAP[row.status] || row.status,
      count: row.count
    }))
  };
}

async function applyMerge() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      SELECT pg_advisory_xact_lock(hashtextextended('bugtracker:issue-task-migration', 0))
    `);

    const archiveExists = await client.query(
      `SELECT to_regclass('public.issues_legacy_merge_archive') IS NOT NULL AS present`
    );
    if (archiveExists.rows[0].present) {
      throw new Error('Issue merge already applied; use --down to reverse or remove the archive first');
    }

    const { rows: issues } = await client.query(`
      SELECT i.*, w.title, w.description_text, w.description_html,
             w.project_id AS work_project_id, w.reporter_user_id, w.assignee_user_id,
             w.status AS work_status, w.priority, w.start_date, w.due_date,
             w.estimate_hours, w.sprint_id, w.rejected_by_user_id, w.rejected_at,
             w.closing_remarks, w.reject_reason, w.completed_at,
             w.created_at AS work_created_at, w.updated_at AS work_updated_at
      FROM public.issues i
      JOIN public.work_items w ON w.id=i.work_item_id
      FOR UPDATE
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS work_items_subtype_integrity ON public.work_items;
      DROP TRIGGER IF EXISTS tasks_subtype_integrity ON public.tasks;
      DROP TRIGGER IF EXISTS issues_subtype_integrity ON public.issues;
    `);

    for (const issue of issues) {
      const workItemSnapshot = {
        id: issue.work_item_id,
        project_id: issue.work_project_id,
        title: issue.title,
        description_text: issue.description_text,
        description_html: issue.description_html,
        reporter_user_id: issue.reporter_user_id,
        assignee_user_id: issue.assignee_user_id,
        status: issue.work_status,
        priority: issue.priority,
        start_date: issue.start_date,
        due_date: issue.due_date,
        estimate_hours: issue.estimate_hours,
        sprint_id: issue.sprint_id,
        rejected_by_user_id: issue.rejected_by_user_id,
        rejected_at: issue.rejected_at,
        closing_remarks: issue.closing_remarks,
        reject_reason: issue.reject_reason,
        completed_at: issue.completed_at,
        created_at: issue.work_created_at,
        updated_at: issue.work_updated_at
      };
      await client.query(`
        INSERT INTO public.task_merge_issue_backup
          (work_item_id, work_item_snapshot, issue_snapshot)
        VALUES ($1,$2::jsonb,$3::jsonb)
        ON CONFLICT (work_item_id) DO UPDATE SET
          work_item_snapshot=EXCLUDED.work_item_snapshot,
          issue_snapshot=EXCLUDED.issue_snapshot
      `, [issue.work_item_id, JSON.stringify(workItemSnapshot), JSON.stringify(issueRowToJson(issue))]);

      await client.query(
        'DELETE FROM public.issues WHERE work_item_id=$1',
        [issue.work_item_id]
      );

      await client.query(`
        UPDATE public.work_items
        SET kind='task', status=$2, updated_at=now()
        WHERE id=$1
      `, [issue.work_item_id, STATUS_MAP[issue.work_status] || issue.work_status]);

      await client.query(`
        INSERT INTO public.tasks
          (work_item_id, subtype_kind, project_id, task_type, parent_task_id,
           issue_number, severity, found_in_version, fixed_in_version,
           target_release_id, reopened_count, resolved_at)
        VALUES ($1,'task',$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (work_item_id) DO UPDATE SET
          task_type=EXCLUDED.task_type,
          issue_number=EXCLUDED.issue_number,
          severity=EXCLUDED.severity,
          found_in_version=EXCLUDED.found_in_version,
          fixed_in_version=EXCLUDED.fixed_in_version,
          target_release_id=EXCLUDED.target_release_id,
          reopened_count=EXCLUDED.reopened_count,
          resolved_at=EXCLUDED.resolved_at
      `, [
        issue.work_item_id, issue.work_project_id, issueTypeToTaskType(issue.issue_type),
        issue.issue_number, issue.severity, issue.found_in_version, issue.fixed_in_version,
        issue.target_release_id, issue.reopened_count || 0, issue.resolved_at
      ]);
    }

    await client.query('DELETE FROM public.issues');
    await client.query('ALTER TABLE public.issues RENAME TO issues_legacy_merge_archive');

    await client.query(`
      ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS work_items_kind_check
    `);
    await client.query(`
      ALTER TABLE public.work_items
      ADD CONSTRAINT work_items_kind_check CHECK (kind = 'task')
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION public.enforce_work_item_subtype() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        item_id text;
        task_count integer;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RETURN NULL;
        END IF;
        IF TG_TABLE_NAME = 'work_items' THEN
          item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
        ELSE
          item_id := NEW.work_item_id;
        END IF;
        SELECT count(*) INTO task_count FROM public.tasks WHERE work_item_id = item_id;
        IF task_count <> 1 THEN
          RAISE EXCEPTION 'Work item % must have exactly one task subtype', item_id
            USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END
      $$;
    `);

    await client.query(`
      CREATE CONSTRAINT TRIGGER work_items_subtype_integrity
      AFTER INSERT OR UPDATE OR DELETE ON public.work_items
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public.enforce_work_item_subtype()
    `);
    await client.query(`
      CREATE CONSTRAINT TRIGGER tasks_subtype_integrity
      AFTER INSERT OR UPDATE OR DELETE ON public.tasks
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public.enforce_work_item_subtype()
    `);

    await client.query('COMMIT');
    return issues.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function reverseMerge() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const archiveExists = await client.query(
      `SELECT to_regclass('public.issues_legacy_merge_archive') IS NOT NULL AS present`
    );
    if (!archiveExists.rows[0].present) throw new Error('Issue merge is not applied');

    await client.query(`
      DROP TRIGGER IF EXISTS work_items_subtype_integrity ON public.work_items;
      DROP TRIGGER IF EXISTS tasks_subtype_integrity ON public.tasks;
    `);
    await client.query(`
      ALTER TABLE public.work_items DROP CONSTRAINT IF EXISTS work_items_kind_check
    `);
    await client.query(`
      ALTER TABLE public.work_items
      ADD CONSTRAINT work_items_kind_check CHECK (kind IN ('task','issue'))
    `);
    await client.query('ALTER TABLE public.issues_legacy_merge_archive RENAME TO issues');

    const { rows: backups } = await client.query(
      'SELECT * FROM public.task_merge_issue_backup ORDER BY work_item_id'
    );
    for (const backup of backups) {
      const work = backup.work_item_snapshot;
      const issue = backup.issue_snapshot;
      await client.query(`
        UPDATE public.work_items
        SET kind='issue', status=$2,
            title=$3, description_text=$4, description_html=$5,
            reporter_user_id=$6, assignee_user_id=NULLIF($7,''),
            priority=$8, start_date=$9, due_date=$10, estimate_hours=$11,
            sprint_id=NULLIF($12,''), rejected_by_user_id=NULLIF($13,''),
            rejected_at=$14, closing_remarks=$15, reject_reason=$16,
            completed_at=$17, updated_at=$18
        WHERE id=$1
      `, [
        backup.work_item_id, work.status, work.title, work.description_text,
        work.description_html, work.reporter_user_id, work.assignee_user_id || '',
        work.priority, work.start_date, work.due_date, work.estimate_hours,
        work.sprint_id || '', work.rejected_by_user_id || '', work.rejected_at,
        work.closing_remarks, work.reject_reason, work.completed_at,
        work.updated_at
      ]);
      await client.query(`
        INSERT INTO public.issues
          (work_item_id, subtype_kind, project_id, issue_number, issue_type,
           severity, found_in_version, fixed_in_version, target_release_id,
           reopened_count, resolved_at, labels)
        VALUES ($1,'issue',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        backup.work_item_id, work.project_id, issue.issue_number, issue.issue_type,
        issue.severity, issue.found_in_version, issue.fixed_in_version,
        issue.target_release_id, issue.reopened_count || 0, issue.resolved_at,
        issue.labels || []
      ]);
      await client.query('DELETE FROM public.tasks WHERE work_item_id=$1', [backup.work_item_id]);
    }

    await client.query(`
      CREATE OR REPLACE FUNCTION public.enforce_work_item_subtype() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE item_id text; item_kind text; task_count integer; issue_count integer;
      BEGIN
        IF TG_TABLE_NAME = 'work_items' THEN
          item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
        ELSE
          item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.work_item_id ELSE NEW.work_item_id END;
        END IF;
        SELECT kind INTO item_kind FROM public.work_items WHERE id=item_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) INTO task_count FROM public.tasks WHERE work_item_id=item_id;
        SELECT count(*) INTO issue_count FROM public.issues WHERE work_item_id=item_id;
        IF (item_kind='task' AND (task_count<>1 OR issue_count<>0))
           OR (item_kind='issue' AND (issue_count<>1 OR task_count<>0)) THEN
          RAISE EXCEPTION 'Work item % must have exactly one matching subtype', item_id USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END
      $$;
    `);
    await client.query(`
      CREATE CONSTRAINT TRIGGER work_items_subtype_integrity
      AFTER INSERT OR UPDATE OR DELETE ON public.work_items
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public.enforce_work_item_subtype()
    `);
    await client.query(`
      CREATE CONSTRAINT TRIGGER tasks_subtype_integrity
      AFTER INSERT OR UPDATE OR DELETE ON public.tasks
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public.enforce_work_item_subtype()
    `);
    await client.query(`
      CREATE CONSTRAINT TRIGGER issues_subtype_integrity
      AFTER INSERT OR UPDATE OR DELETE ON public.issues
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public.enforce_work_item_subtype()
    `);
    await client.query('COMMIT');
    return backups.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  try {
    if (args.has('--down')) {
      const count = await reverseMerge();
      console.info(`Reversed Issue-to-Task merge for ${count} records.`);
      return;
    }
    const preview = await inspect();
    if (args.has('--dry-run') || !args.has('--apply')) {
      console.info(JSON.stringify({ dryRun: true, ...preview }, null, 2));
      return;
    }
    const count = await applyMerge();
    console.info(`Merged ${count} Issue records into Task records.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
