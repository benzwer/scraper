const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLogger, setLogDir } = require('../src/utils/logger');

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
