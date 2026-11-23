const pool = require('../config/db');

async function validateProjectStakeholders(userIds) {
  if (!Array.isArray(userIds)) return false;
  const ids = [...new Set(userIds.map(String))];
  if (!ids.length) return true;
  const { rows } = await pool.query(
    'SELECT id FROM public.users WHERE id = ANY($1::text[]) AND active',
    [ids]
  );
  return rows.length === ids.length;
}

async function getProjectStakeholders(projectId) {
  const { rows } = await pool.query(
    `SELECT u.id AS "_id", u.name, u.email
     FROM public.project_stakeholders ps
     JOIN public.users u ON u.id = ps.user_id
     WHERE ps.project_id = $1 AND u.active
     ORDER BY u.name, u.id`,
    [String(projectId)]
  );
  return rows;
}

async function replaceProjectStakeholders(projectId, userIds, addedByUserId) {
  if (!Array.isArray(userIds)) throw new TypeError('Project stakeholders must be an array');
  const ids = [...new Set(userIds.map(String))];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id FROM public.users WHERE id = ANY($1::text[]) AND active',
      [ids]
    );
    if (rows.length !== ids.length) {
      throw new Error('One or more project stakeholders are missing or inactive');
    }
    await client.query('DELETE FROM public.project_stakeholders WHERE project_id = $1', [String(projectId)]);
    for (const userId of ids) {
      await client.query(
        `INSERT INTO public.project_stakeholders (project_id, user_id, added_by_user_id)
         VALUES ($1, $2, $3)`,
        [String(projectId), userId, addedByUserId || null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getProjectStakeholders,
  replaceProjectStakeholders,
  validateProjectStakeholders
};
