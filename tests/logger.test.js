const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLogger, setLogDir, removeOldLogs } = require('../src/utils/logger');

test('the log goes to the terminal and, once set, to one file per day', t => {
  const printed = [];
  t.mock.method(console, 'log', line => printed.push(line));
  t.mock.method(console, 'warn', line => printed.push(line));

  const log = createLogger('Site A');
  log.info('before the file is set');

  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'logs-')), 'logs');
  setLogDir(dir);
  log.info('read %d listings', 21, { page: 1 });
  log.warn('blocked');

  assert.match(printed[1], /^\d\d:\d\d:\d\d INFO  \[Site A\] read 21 listings \{ page: 1 \}$/);

  const [file] = fs.readdirSync(dir);
  assert.match(file, /^\d{4}-\d\d-\d\d\.log$/);
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);   // what came before setLogDir stays in the terminal only
  assert.match(lines[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d INFO  \[Site A\] read 21 listings/);
  assert.match(lines[1], /WARN  \[Site A\] blocked$/);
});

test('old daily logs are deleted, today and the last retentionDays days are kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-'));
  for (const name of ['2026-10-18.log', '2026-09-18.log', '2026-09-17.log', '2025-01-01.log', 'notes.txt', '2026-01-01.log.bak']) {
    fs.writeFileSync(path.join(dir, name), 'x');
  }

  const removed = removeOldLogs(dir, 30, new Date(2026, 9, 18, 9, 0));
  assert.deepEqual(removed.sort(), ['2025-01-01.log', '2026-09-17.log']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-01-01.log.bak', '2026-09-18.log', '2026-10-18.log', 'notes.txt']);

  assert.deepEqual(removeOldLogs(dir, null), []);   // null keeps everything
  assert.throws(() => setLogDir(dir, { retentionDays: '30' }), /whole number of days, or null/);
});

test('the first line logged by the scraper deletes the old daily logs', t => {
  t.mock.method(console, 'log', () => {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-'));
  fs.writeFileSync(path.join(dir, '2000-01-01.log'), 'old');

  setLogDir(dir, { retentionDays: 30 });
  createLogger('main').info('started');

  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.notEqual(files[0], '2000-01-01.log');
});
