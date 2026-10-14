const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig, deepMerge } = require('../src/core/config');

const defaults = {
  paths: { userDir: null },
  filters: { maxPrice: null, minRooms: null },
  watch: { activeHours: [7, 22] }
};

function userDirWith(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-'));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    typeof content === 'string' ? content : JSON.stringify(content)
  );
  return dir;
}

const search = { site: 'cards', url: 'https://www.example.com/rent' };

test('deepMerge merges objects and replaces arrays', () => {
  const merged = deepMerge(defaults, { filters: { maxPrice: 900 }, watch: { activeHours: [8, 20] } });
  assert.deepEqual(merged.filters, { maxPrice: 900, minRooms: null });
  assert.deepEqual(merged.watch.activeHours, [8, 20]);
  assert.equal(defaults.filters.maxPrice, null);   // defaults untouched
});

test('loadConfig returns the merged config and the searches', () => {
  const dir = userDirWith({ searches: [search], filters: { minRooms: 2 } });
  const { config, searches } = loadConfig(defaults, dir);
  assert.equal(config.filters.minRooms, 2);
  assert.equal(config.filters.maxPrice, null);
  assert.deepEqual(searches, [search]);
});

test('loadConfig explains how to create a missing config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-'));
  assert.throws(() => loadConfig(defaults, dir), /npm run setup/);
});

test('loadConfig rejects typos, missing searches and bad urls', () => {
  assert.throws(() => loadConfig(defaults, userDirWith({ searches: [search], filter: {} })), /unknown key "filter"/);
  assert.throws(() => loadConfig(defaults, userDirWith({})), /"searches" must be a non-empty array/);
  assert.throws(
    () => loadConfig(defaults, userDirWith({ searches: [{ site: 'cards', url: 'example.com' }] })),
    /searches\[0\]\.url/
  );
  assert.throws(() => loadConfig(defaults, userDirWith('{ broken')), /invalid JSON/);
});
