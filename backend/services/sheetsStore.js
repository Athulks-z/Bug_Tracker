const { google } = require('googleapis');
const { randomUUID } = require('crypto');

const TABLES = {
  users: {
    title: 'Users',
    columns: ['_id', 'name', 'email', 'password', 'role', 'jobTitle', 'domain', 'phone', 'skills', 'reportingManager', 'assignedProjects', 'avatar', 'active', 'bootstrapAdmin', 'createdAt', 'updatedAt']
  },
  projects: {
    title: 'Projects',
    columns: ['_id', 'name', 'description', 'key', 'owner', 'members', 'status', 'createdAt', 'updatedAt']
  },
  issues: {
    title: 'Issues',
    columns: ['_id', 'title', 'description', 'project', 'reporter', 'assignee', 'status', 'severity', 'dueDate', 'issueNumber', 'foundInVersion', 'fixedInVersion', 'targetRelease', 'sprint', 'estimatedHours', 'timeLogs', 'attachments', 'comments', 'activity', 'reopenedCount', 'resolvedAt', 'createdAt', 'updatedAt']
  },
  tasks: {
    title: 'Tasks',
    columns: ['_id', 'title', 'description', 'project', 'reporter', 'assignee', 'status', 'priority', 'startDate', 'endDate', 'createdAt', 'updatedAt']
  },
  sprints: {
    title: 'Sprints',
    columns: ['_id', 'name', 'project', 'startDate', 'endDate', 'goal', 'status', 'createdAt', 'updatedAt']
  },
  releases: {
    title: 'Releases',
    columns: ['_id', 'name', 'project', 'version', 'description', 'releaseDate', 'status', 'createdAt', 'updatedAt']
  },
  templates: {
    title: 'Templates',
    columns: ['_id', 'name', 'type', 'body', 'fields', 'createdBy', 'createdAt', 'updatedAt']
  },
  notifications: {
    title: 'Notifications',
    columns: ['_id', 'type', 'issue', 'user', 'details', 'read', 'createdAt', 'updatedAt']
  }
};

const BOOLEAN_FIELDS = new Set(['active', 'bootstrapAdmin', 'read']);
const NUMBER_FIELDS = new Set(['issueNumber', 'estimatedHours', 'reopenedCount']);
const OBJECT_FIELDS = new Set(['assignedProjects', 'members', 'timeLogs', 'attachments', 'comments', 'activity', 'fields']);

function cellValue(field, value) {
  if (value === undefined || value === null) return '';
  if (OBJECT_FIELDS.has(field)) return JSON.stringify(value);
  if (BOOLEAN_FIELDS.has(field)) return value ? 'true' : 'false';
  return String(value);
}

function parseCell(field, value) {
  if (value === undefined || value === '') return undefined;
  if (BOOLEAN_FIELDS.has(field)) return value === true || String(value).toLowerCase() === 'true';
  if (NUMBER_FIELDS.has(field)) return Number(value) || 0;
  if (OBJECT_FIELDS.has(field)) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON data in Google Sheets column "${field}"`);
    }
  }
  return value;
}

function columnLetter(number) {
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

class SheetsStore {
  constructor({ spreadsheetId, serviceAccountEmail, privateKey }) {
    this.spreadsheetId = spreadsheetId;
    this.sheetsApi = google.sheets({
      version: 'v4',
      auth: new google.auth.JWT({
        email: serviceAccountEmail,
        key: privateKey.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      })
    });
    this.sheetIds = {};
    this.initialized = false;
    this.writeQueue = Promise.resolve();
    this.listCache = new Map();
  }

  async initialize() {
    if (this.initialized) return;
    const metadata = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties(sheetId,title)'
    });
    const sheets = metadata.data.sheets || [];
    const addRequests = [];
    for (const [table, definition] of Object.entries(TABLES)) {
      let sheet = sheets.find(({ properties }) => properties.title === definition.title);
      if (!sheet) {
        addRequests.push({ addSheet: { properties: { title: definition.title } } });
      } else {
        this.sheetIds[table] = sheet.properties.sheetId;
      }
    }
    if (addRequests.length) {
      const result = await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: addRequests }
      });
      const addedSheets = (result.data.replies || []).map((reply) => reply.addSheet.properties);
      for (const [table, definition] of Object.entries(TABLES)) {
        const sheet = addedSheets.find(({ title }) => title === definition.title);
        if (sheet) this.sheetIds[table] = sheet.sheetId;
      }
    }

    for (const [table, definition] of Object.entries(TABLES)) {
      const range = `${definition.title}!A1:${columnLetter(definition.columns.length)}1`;
      const result = await this.sheetsApi.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range
      });
      const headers = result.data.values?.[0] || [];
      if (headers.length === 0) {
        await this.sheetsApi.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range,
          valueInputOption: 'RAW',
          requestBody: { values: [definition.columns] }
        });
      } else if (headers.join('\u0000') !== definition.columns.join('\u0000')) {
        throw new Error(`Google Sheet tab "${definition.title}" has incompatible headers. Restore the expected header row or use a blank tab.`);
      }
      if (this.sheetIds[table] === undefined) {
        const sheet = sheets.find(({ properties }) => properties.title === definition.title);
        if (sheet) this.sheetIds[table] = sheet.properties.sheetId;
      }
    }
    this.initialized = true;
  }

  async list(table, { fresh = false } = {}) {
    const definition = this.definition(table);
    const cached = this.listCache.get(table);
    if (!fresh && cached && Date.now() - cached.loadedAt < 1000) {
      return cached.records.map((record) => ({ ...record }));
    }
    const result = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${definition.title}!A2:${columnLetter(definition.columns.length)}`
    });
    const records = (result.data.values || []).map((row, index) => {
      const record = { __rowNumber: index + 2 };
      definition.columns.forEach((field, columnIndex) => {
        const value = parseCell(field, row[columnIndex]);
        if (value !== undefined) record[field] = value;
      });
      return record;
    }).filter((record) => record._id);
    if (!fresh) this.listCache.set(table, { records, loadedAt: Date.now() });
    return records.map((record) => ({ ...record }));
  }

  async findById(table, id, options) {
    return (await this.list(table, options)).find((record) => String(record._id) === String(id)) || null;
  }

  async findOne(table, predicate, options) {
    return (await this.list(table, options)).find(predicate) || null;
  }

  async insert(table, input) {
    return this.serializeWrite(async () => {
      const definition = this.definition(table);
      if (table === 'users') {
        const users = await this.list('users', { fresh: true });
        if (input.email && users.some((user) => user.email === input.email)) {
          const error = new Error('Email already exists');
          error.code = 'DUPLICATE_EMAIL';
          throw error;
        }
        if (input.bootstrapAdmin && users.length > 0) {
          const error = new Error('A bootstrap admin already exists');
          error.code = 'BOOTSTRAP_ADMIN_EXISTS';
          throw error;
        }
      }
      const now = new Date().toISOString();
      const issueNumber = table === 'issues' && input.issueNumber === undefined
        ? (await this.list('issues', { fresh: true })).filter((issue) => issue.project === input.project).length + 1
        : input.issueNumber;
      const record = {
        ...input,
        ...(issueNumber === undefined ? {} : { issueNumber }),
        _id: input._id || randomUUID().replace(/-/g, ''),
        createdAt: input.createdAt || now,
        updatedAt: now
      };
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${definition.title}!A:${columnLetter(definition.columns.length)}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [this.rowValues(definition, record)] }
      });
      this.listCache.delete(table);
      return record;
    });
  }

  async update(table, id, updates) {
    return this.serializeWrite(async () => {
      const definition = this.definition(table);
      const existing = await this.findById(table, id, { fresh: true });
      if (!existing) return null;
      if (table === 'users' && updates.email && updates.email !== existing.email) {
        const duplicate = await this.findOne('users', (user) => user.email === updates.email && user._id !== existing._id, { fresh: true });
        if (duplicate) {
          const error = new Error('Email already exists');
          error.code = 'DUPLICATE_EMAIL';
          throw error;
        }
      }
      const record = { ...existing, ...updates, _id: existing._id, updatedAt: new Date().toISOString() };
      delete record.__rowNumber;
      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${definition.title}!A${existing.__rowNumber}:${columnLetter(definition.columns.length)}${existing.__rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: { values: [this.rowValues(definition, record)] }
      });
      this.listCache.delete(table);
      return record;
    });
  }

  async remove(table, id) {
    return this.serializeWrite(async () => {
      const record = await this.findById(table, id, { fresh: true });
      if (!record) return false;
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: this.sheetIds[table],
                dimension: 'ROWS',
                startIndex: record.__rowNumber - 1,
                endIndex: record.__rowNumber
              }
            }
          }]
        }
      });
      this.listCache.delete(table);
      return true;
    });
  }

  definition(table) {
    const definition = TABLES[table];
    if (!definition) throw new Error(`Unknown Google Sheets table "${table}"`);
    return definition;
  }

  rowValues(definition, record) {
    return definition.columns.map((field) => cellValue(field, record[field]));
  }

  serializeWrite(operation) {
    const pending = this.writeQueue.then(operation);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }
}

module.exports = { SheetsStore, TABLES, cellValue, parseCell, columnLetter };
