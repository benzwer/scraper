const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { analyzePage } = require('../src/sites/analyze');
const { rankCandidates, compactSpec } = require('../src/tools/fix-fields');

const fixture = name => path.join(__dirname, 'fixtures', name);

// A stand-in for a Playwright page: evaluate runs the function on a jsdom document.
function fakePage(name) {
  const dom = new JSDOM(fs.readFileSync(fixture(name), 'utf8'), { url: 'https://www.example.com/search' });
  return {
    evaluate: async (fn, arg) => {
      global.document = dom.window.document;
      try {
        return fn(arg);
      } finally {
        delete global.document;
      }
    }
  };
}

const tableSite = () => ({
  id: 'table-test',
  name: 'Table test',
  extract: { type: 'css', item: '.result', fields: { url: { selector: 'a', attr: 'href' } } }
});

// What check-site --fix proposes for a value typed for one listing.
async function propose(page, definition, field, index, typed) {
  const { type, item, script, items } = definition.extract;
  const { text, candidates } = await page.evaluate(analyzePage, { locate: { type, item, script, items, index, value: typed } });
  const proposals = await rankCandidates(page, definition, '(test)', { field, index, typed }, candidates);
  return { text, proposals };
}

test('fix: a number in a label/value row is read by its label, not inside another number', async () => {
  const page = fakePage('table-cards-example.html');
  const { text, proposals } = await propose(page, tableSite(), 'rooms', 0, '3');

  // textContent joins the cells without spaces when the HTML has none: the extractor reads the same.
  assert.equal(text, 'Sunny flat Town:Springfield (centre) Rent:1.250 € Surface:85 m² Rooms:3');
  assert.equal(proposals[0].spec.match, 'Rooms:\\s*(\\d[\\d.,\']*)');
  assert.deepEqual(proposals[0].values, [3, 2, 4]);
});

test('fix: with a row missing in one listing, the positional selector comes last and is wrong', async () => {
  const page = fakePage('table-cards-example.html');
  const { proposals } = await propose(page, tableSite(), 'surface', 0, '85');

  assert.deepEqual(proposals[0].values, [85, null, 110]);            // by label: right
  assert.match(proposals[0].spec.match, /^Surface:/);
  const positional = proposals.at(-1);
  assert.match(JSON.stringify(positional.spec), /nth-of-type/);
  assert.deepEqual(positional.values, [85, 2, 110]);                // reads "Rooms: 2" as surface
});

test('fix: a text value, and a value that is not in the listing', async () => {
  const page = fakePage('table-cards-example.html');

  const city = await propose(page, tableSite(), 'city', 0, 'Springfield');
  assert.deepEqual(city.proposals[0].values, ['Springfield (centre)', 'Shelbyville', 'Capital City']);

  const missing = await propose(page, tableSite(), 'city', 0, 'Ogdenville');
  assert.deepEqual(missing.proposals, []);
});

test('fix: embedded JSON gets a path', async () => {
  const page = fakePage('embedded-json-example.html');
  const definition = {
    id: 'json-test',
    name: 'JSON test',
    extract: {
      type: 'json',
      script: '#search-data',
      items: 'page.sections[*].listings',
      fields: { id: 'id' }
    }
  };
  const { proposals } = await propose(page, definition, 'city', 0, 'Shelbyville');
  assert.equal(proposals[0].spec, 'address.city');
  assert.deepEqual(proposals[0].values, ['Shelbyville', 'Shelbyville', null]);
});

test('fix: embedded JSON with keys like "/size" gets a path through them', async () => {
  const page = fakePage('embedded-json-features-example.html');
  const definition = {
    id: 'json-features-test',
    name: 'JSON features test',
    extract: { type: 'json', script: '#app-state', items: 'state.results', fields: { url: 'urls.default' } }
  };
  const { proposals } = await propose(page, definition, 'surface', 0, '70');
  assert.equal(proposals[0].spec, 'features./size.values[0].key');
  assert.deepEqual(proposals[0].values, [70, 95]);
});

test('compactSpec writes specs as a person would', () => {
  assert.equal(compactSpec({ selector: '.x', attr: null, match: null }), '.x');
  assert.equal(compactSpec({ path: 'a.b', match: null }), 'a.b');
  assert.deepEqual(compactSpec({ selector: null, match: 'Rooms:\\s*(\\d+)' }), { match: 'Rooms:\\s*(\\d+)' });
});
