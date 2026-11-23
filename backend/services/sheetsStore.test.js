const test = require('node:test');
const assert = require('node:assert/strict');
const { SheetsStore, TABLES, cellValue, parseCell, columnLetter } = require('./sheetsStore');

test('sheet headers cover every app data collection', () => {
  assert.deepEqual(Object.keys(TABLES), [
    'users', 'projects', 'issues', 'tasks', 'sprints', 'releases', 'templates', 'notifications'
  ]);
  for (const definition of Object.values(TABLES)) {
    assert.equal(definition.columns[0], '_id');
    assert.equal(new Set(definition.columns).size, definition.columns.length);
  }
});

test('serializes nested data as raw JSON and restores typed values', () => {
  const nested = [{ author: 'user-id', text: 'Looks good' }];
  assert.equal(cellValue('comments', nested), JSON.stringify(nested));
  assert.deepEqual(parseCell('comments', JSON.stringify(nested)), nested);
  assert.equal(parseCell('active', 'true'), true);
  assert.equal(parseCell('read', 'FALSE'), false);
  assert.equal(parseCell('issueNumber', '14'), 14);
});

test('converts sheet column indexes to A1 notation', () => {
  assert.equal(columnLetter(1), 'A');
  assert.equal(columnLetter(26), 'Z');
  assert.equal(columnLetter(27), 'AA');
});

test('initializes tabs and preserves CRUD behavior through the Sheets API', async () => {
  const rowsByTitle = new Map();
  const idsByTitle = new Map();
  let nextSheetId = 1;
  const api = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [...rowsByTitle.keys()].map((title) => ({
            properties: { title, sheetId: idsByTitle.get(title) }
          }))
        }
      }),
      batchUpdate: async ({ requestBody }) => {
        const replies = [];
        for (const request of requestBody.requests) {
          if (request.addSheet) {
            const { title } = request.addSheet.properties;
            const properties = { title, sheetId: nextSheetId++ };
            idsByTitle.set(title, properties.sheetId);
            rowsByTitle.set(title, []);
            replies.push({ addSheet: { properties } });
          } else if (request.deleteDimension) {
            const { sheetId, startIndex, endIndex } = request.deleteDimension.range;
            const title = [...idsByTitle.entries()].find(([, id]) => id === sheetId)[0];
            rowsByTitle.get(title).splice(startIndex, endIndex - startIndex);
          }
        }
        return { data: { replies } };
      },
      values: {
        get: async ({ range }) => {
          const [title, a1Range] = range.split('!');
          const startRow = Number(a1Range.match(/A(\d+)/)?.[1] || 1);
          return { data: { values: (rowsByTitle.get(title) || []).slice(startRow - 1) } };
        },
        update: async ({ range, requestBody }) => {
          const [title, a1Range] = range.split('!');
          const row = Number(a1Range.match(/A(\d+)/)?.[1] || 1);
          const rows = rowsByTitle.get(title);
          while (rows.length < row) rows.push([]);
          rows[row - 1] = requestBody.values[0];
          return { data: {} };
        },
        append: async ({ range, requestBody }) => {
          const title = range.split('!')[0];
          rowsByTitle.get(title).push(...requestBody.values);
          return { data: {} };
        }
      }
    }
  };
  const store = new SheetsStore({
    spreadsheetId: 'test-sheet',
    serviceAccountEmail: 'test@example.com',
    privateKey: 'test-key'
  });
  store.sheetsApi = api;

  await store.initialize();
  assert.equal(rowsByTitle.size, Object.keys(TABLES).length);
  const user = await store.insert('users', {
    email: 'athul@example.com',
    password: 'hashed',
    bootstrapAdmin: true
  });
  assert.equal((await store.findById('users', user._id)).email, 'athul@example.com');
  await assert.rejects(
    store.insert('users', { email: 'athul@example.com' }),
    (error) => error.code === 'DUPLICATE_EMAIL'
  );
  await assert.rejects(
    store.insert('users', { email: 'other@example.com', bootstrapAdmin: true }),
    (error) => error.code === 'BOOTSTRAP_ADMIN_EXISTS'
  );

  const firstIssue = await store.insert('issues', { project: 'project-id' });
  const secondIssue = await store.insert('issues', { project: 'project-id' });
  assert.equal(firstIssue.issueNumber, 1);
  assert.equal(secondIssue.issueNumber, 2);
  assert.equal((await store.update('issues', firstIssue._id, { status: 'Closed' })).status, 'Closed');
  assert.equal(await store.remove('issues', secondIssue._id), true);
  assert.equal(await store.findById('issues', secondIssue._id), null);
});
