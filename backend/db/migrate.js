const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATIONS_DIRECTORY = path.join(__dirname, 'migrations');
const MIGRATION_NAME_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_ID = 773145021;

async function runMigrations() {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = fs.readdirSync(MIGRATIONS_DIRECTORY)
      .filter((name) => MIGRATION_NAME_PATTERN.test(name))
      .sort();

    for (const name of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const { rows } = await client.query(
        'SELECT checksum FROM public.schema_migrations WHERE name = $1',
        [name]
      );

      if (rows.length) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Applied migration checksum mismatch: ${name}`);
        }
        console.info(`Already applied: ${name}`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum]
        );
        await client.query('COMMIT');
        console.info(`Applied: ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed (${name}): ${error.message}`, { cause: error });
      }
    }

    console.info('Database migrations are up to date.');
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
