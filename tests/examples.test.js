const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadSiteDefinition } = require('../src/sites/definitions');
const { extractFromFile } = require('./helpers/dom');

// The example site definitions double as documentation: these tests keep them working.
const example = name => loadSiteDefinition(path.join(__dirname, '..', 'examples', 'sites', name));
const fixture = name => path.join(__dirname, 'fixtures', name);

test('css example: cards, attributes, relative links and regex matches', () => {
  const [a, b] = extractFromFile(example('cards-example.json'), fixture('cards-example.html'));

  assert.equal(a.id, 'A1');
  assert.equal(a.url, 'https://www.example.com/listing/A1');   // relative href made absolute
  assert.equal(a.title, 'Bright three-room flat');             // whitespace trimmed
  assert.equal(a.price, 1200);
  assert.equal(a.priceText, '€ 1.200 / month');
  assert.equal(a.surface, 85);
  assert.equal(a.rooms, 3);
  assert.equal(a.city, 'Springfield');

  assert.equal(b.price, null);      // "Price on request"
  assert.equal(b.surface, 72.5);
  assert.equal(b.rooms, 5);         // "5+ rooms"
  assert.equal(b.city, null);       // missing element
});

test('json example: wildcard path, fallback paths and url template', () => {
  const listings = extractFromFile(
    example('embedded-json-example.json'),
    fixture('embedded-json-example.html')
  );

  assert.equal(listings.length, 2);   // the promo entry has neither id nor url
  const [a, b] = listings;

  assert.equal(a.id, '501');
  assert.equal(a.url, 'https://www.example.org/listing/flat-501');
  assert.equal(a.price, 950);         // numeric amount
  assert.equal(a.surface, 70);
  assert.equal(a.rooms, 2);
  assert.equal(a.city, 'Shelbyville');

  assert.equal(b.price, 1050);        // no amount: falls back to the label
  assert.equal(b.surface, 110);       // bare "110"
  assert.equal(b.rooms, 4);
});

test('script example: custom extractor receives the options', () => {
  const [a, b] = extractFromFile(example('script-example.json'), fixture('cards-example.html'));

  assert.equal(a.id, 'A1');
  assert.equal(a.url, 'https://www.example.com/listing/A1');
  assert.equal(a.price, 1200);
  assert.equal(a.rooms, 3);
  assert.equal(b.surface, 72.5);
});

test('json extraction returns nothing when the script is missing or invalid', () => {
  const definition = example('embedded-json-example.json');
  const { JSDOM } = require('jsdom');

  for (const html of ['<p>no data</p>', '<script id="search-data">{not json</script>']) {
    global.document = new JSDOM(html).window.document;
    try {
      assert.deepEqual(require('../src/sites/extract').extractListings(definition.extract), []);
    } finally {
      delete global.document;
    }
  }
});
