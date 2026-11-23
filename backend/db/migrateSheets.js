const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../config/db');
const { TABLES, parseCell, columnLetter } = require('../services/sheetsStore');

function parseSheetRows(table, values) {
  const definition = TABLES[table];
  const headers = values[0] || [];
  if (headers.join('\u0000') !== definition.columns.join('\u0000')) {
    return {
      records: [],
      blankRows: 0,
      sourceRows: Math.max(values.length - 1, 0),
      issues: [{ row: 1, code: 'header_mismatch' }]
    };
  }

  const records = [];
  const issues = [];
  const ids = new Set();
  const emails = new Set();
  let bootstrapAdmins = 0;
  let blankRows = 0;

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (!row || row.every((cell) => cell === undefined || cell === null || cell === '')) {
      blankRows += 1;
      continue;
    }

    const rowNumber = index + 1;
    const record = {};
    let invalid = false;
    for (let columnIndex = 0; columnIndex < definition.columns.length; columnIndex += 1) {
      const field = definition.columns[columnIndex];
      const cell = row[columnIndex];
      if (['issueNumber', 'estimatedHours', 'reopenedCount'].includes(field)
        && cell !== undefined && cell !== '' && !Number.isFinite(Number(cell))) {
        issues.push({ row: rowNumber, field, code: 'invalid_number' });
        invalid = true;
        continue;
      }
      if (['active', 'bootstrapAdmin', 'read'].includes(field)
        && cell !== undefined && cell !== ''
        && ![true, false, 'true', 'false', 'TRUE', 'FALSE'].includes(cell)) {
        issues.push({ row: rowNumber, field, code: 'invalid_boolean' });
        invalid = true;
        continue;
      }
      try {
        const parsed = parseCell(field, cell);
        if (parsed !== undefined) record[field] = parsed;
      } catch {
        issues.push({ row: rowNumber, field, code: 'malformed_value' });
        invalid = true;
      }
    }

    if (!record._id) {
      issues.push({ row: rowNumber, field: '_id', code: 'missing_id' });
      invalid = true;
    } else if (ids.has(String(record._id))) {
      issues.push({ row: rowNumber, field: '_id', code: 'duplicate_id' });
      invalid = true;
    } else {
      ids.add(String(record._id));
    }

    if (table === 'users' && record.email) {
      const normalizedEmail = String(record.email).trim().toLowerCase();
      if (emails.has(normalizedEmail)) {
        issues.push({ row: rowNumber, field: 'email', code: 'duplicate_email' });
        invalid = true;
      }
      emails.add(normalizedEmail);
    }
    if (table === 'users' && record.bootstrapAdmin) {
      bootstrapAdmins += 1;
      if (bootstrapAdmins > 1) {
        issues.push({ row: rowNumber, field: 'bootstrapAdmin', code: 'multiple_bootstrap_admins' });
        invalid = true;
      }
    }

    if (!invalid) records.push(record);
  }

  return {
    records,
    blankRows,
    sourceRows: Math.max(values.length - 1, 0),
    issues
  };
}

async function extractSheets() {
  const { GOOGLE_SHEET_ID: spreadsheetId, GOOGLE_SERVICE_ACCOUNT_EMAIL: email, GOOGLE_PRIVATE_KEY: privateKey } = process.env;
  if (!spreadsheetId || !email || !privateKey) {
    throw new Error('Read-only Google Sheets credentials are required for migration');
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const metadata = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title)'
  });
  const titles = new Set((metadata.data.sheets || []).map(({ properties }) => properties.title));
  const snapshot = {};

  for (const [table, definition] of Object.entries(TABLES)) {
    if (!titles.has(definition.title)) {
      snapshot[table] = {
        records: [],
        blankRows: 0,
        sourceRows: 0,
        issues: [{ row: 0, code: 'missing_tab' }]
      };
      continue;
    }
    const result = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `${definition.title}!A1:${columnLetter(definition.columns.length)}`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    snapshot[table] = parseSheetRows(table, result.data.values || []);
  }
  return snapshot;
}

function summarize(snapshot) {
  const tables = {};
  let blockingCount = 0;
  for (const [table, result] of Object.entries(snapshot)) {
    tables[table] = {
      sourceRows: result.sourceRows,
      validRecords: result.records.length,
      blankRows: result.blankRows,
      blockingErrors: result.issues.length,
      errorCodes: [...new Set(result.issues.map(({ code }) => code))]
    };
    blockingCount += result.issues.length;
  }
  return { tables, blockingCount };
}

async function importSnapshot(snapshot) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('bugtracker:sheets-import', 0))");
    await client.query('LOCK TABLE public.app_records IN SHARE ROW EXCLUSIVE MODE');
    const existing = await client.query('SELECT count(*)::bigint AS count FROM public.app_records');
    if (Number(existing.rows[0].count) > 0) {
      throw new Error('PostgreSQL compatibility store is not empty; refusing to overwrite or mix existing records');
    }

    for (const [collection, result] of Object.entries(snapshot)) {
      for (const record of result.records) {
        await client.query(
          'INSERT INTO public.app_records (collection, id, record) VALUES ($1, $2, $3::jsonb)',
          [collection, String(record._id), JSON.stringify(record)]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--confirm-import')) {
    throw new Error('Import requires both --apply and --confirm-import; default mode is read-only dry-run');
  }

  const snapshot = await extractSheets();
  const report = summarize(snapshot);
  const target = await pool.query('SELECT count(*)::bigint AS count FROM public.app_records');
  console.log(JSON.stringify({
    mode: apply ? 'import' : 'dry-run',
    targetRecordsBeforeImport: Number(target.rows[0].count),
    ...report
  }, null, 2));

  if (report.blockingCount > 0) {
    throw new Error('Dry-run found blocking validation errors; no records were imported');
  }
  if (apply) {
    await importSnapshot(snapshot);
    console.info('Import completed. Source Google Sheets were accessed read-only and were not modified.');
  } else {
    console.info('Dry-run only. No database or source data was changed.');
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Google Sheets migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { parseSheetRows, summarize, importSnapshot };
