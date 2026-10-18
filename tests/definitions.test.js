const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateDefinition, loadSiteDefinitions } = require('../src/sites/definitions');

const cssSite = (overrides = {}) => ({
  id: 'my-site',
  name: 'My Site',
  extract: { type: 'css', item: '.card', fields: { url: { selector: 'a', attr: 'href' } } },
  ...overrides
});

test('a minimal css definition gets sensible defaults', () => {
  const definition = validateDefinition(cssSite());
  assert.equal(definition.selectors.ready, '.card');
  assert.equal(definition.selectors.items, '.card');
  assert.equal(definition.selectors.cookie, null);
  assert.deepEqual(definition.selectors.next, []);
  assert.deepEqual(definition.selectors.popups, []);
  assert.equal(definition.reloadIfStale, false);
  assert.deepEqual(definition.extract.fields.url, { selector: 'a', attr: 'href' });
});

test('json fields accept a path, an array of paths or an object', () => {
  const definition = validateDefinition({
    id: 'j',
    name: 'J',
    extract: {
      type: 'json',
      script: '#data',
      items: 'results',
      fields: { id: 'id', price: ['price.value', 'price.text'], url: { path: 'slug', template: 'https://x/{}' } }
    }
  });
  assert.equal(definition.selectors.ready, '#data');
  assert.deepEqual(definition.extract.fields.id, { path: ['id'] });
  assert.deepEqual(definition.extract.fields.price, { path: ['price.value', 'price.text'] });
  assert.deepEqual(definition.extract.fields.url, { path: ['slug'], template: 'https://x/{}' });
});

test('every problem is reported, with the file name', () => {
  const bad = cssSite({
    id: 'Bad Id',
    colour: 'red',
    extract: {
      type: 'css',
      item: '.card',
      fields: {
        title: { selector: 'h2', match: '(' },
        price: { selector: '.p', template: 'no placeholder' },
        bedrooms: '.b'
      }
    }
  });

  assert.throws(() => validateDefinition(bad, { file: 'bad.json' }), error => {
    for (const expected of [
      /^bad\.json:/,
      /id: required/,
      /unknown key "colour"/,
      /title\.match: invalid regular expression/,
      /price\.template: must be a string containing "\{\}"/,
      /unknown field "bedrooms"/,
      /at least "url" or "id" is required/
    ]) {
      assert.match(error.message, expected);
    }
    return true;
  });
});

test('unknown extract type and missing script file are rejected', () => {
  assert.throws(() => validateDefinition(cssSite({ extract: { type: 'xpath' } })), /must be "css", "json" or "script"/);
  assert.throws(
    () => validateDefinition(cssSite({
      selectors: { ready: '.x' },
      extract: { type: 'script', file: './does-not-exist.js' }
    })),
    /not found/
  );
});

test('loadSiteDefinitions rejects duplicate ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(cssSite()));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(cssSite()));
  assert.throws(() => loadSiteDefinitions(dir), /Duplicate site id "my-site"/);
});

test('loadSiteDefinitions reports invalid JSON with the file name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-'));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ "id": ');
  assert.throws(() => loadSiteDefinitions(dir), /broken\.json: cannot read the definition/);
});

test('loadSiteDefinitions with onInvalid skips invalid definitions and keeps the others', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-'));
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(cssSite()));
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify({ id: 'draft-site', name: 'Draft' }));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ "id": ');

  const skipped = [];
  const definitions = loadSiteDefinitions(dir, { onInvalid: (error, id) => skipped.push([id, error.message]) });

  assert.deepEqual(definitions.map(definition => definition.id), ['my-site']);
  assert.deepEqual(skipped.map(([id]) => id), ['broken', 'draft-site']);   // file name when unreadable
  assert.match(skipped[1][1], /draft\.json:\n {2}- extract/);
});
