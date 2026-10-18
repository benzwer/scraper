const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { analyzePage, buildDraft, pickDataRequests } = require('../src/sites/analyze');
const { validateDefinition } = require('../src/sites/definitions');
const { SAVE_SEARCH_TEXT_RE, CLOSE_NAME_RE } = require('../src/sites/Site');
const { extractFromFile } = require('./helpers/dom');

const fixture = name => path.join(__dirname, 'fixtures', name);

function analyzeFile(name) {
  const dom = new JSDOM(fs.readFileSync(fixture(name), 'utf8'), { url: 'https://www.example.com/search' });
  global.document = dom.window.document;
  try {
    return analyzePage({ saveSearchText: SAVE_SEARCH_TEXT_RE.source, closeName: CLOSE_NAME_RE.source });
  } finally {
    delete global.document;
  }
}

const withoutDates = listings => listings.map(({ scrapedAt, ...listing }) => listing);

test('cards: the draft definition extracts the same listings as the hand-written example', () => {
  const report = analyzeFile('cards-example.html');

  assert.equal(report.cards[0].selector, '.listing-card');
  assert.equal(report.cards[0].count, 2);
  assert.deepEqual(report.cookie.map(item => item.selector), ['#accept-cookies']);
  assert.equal(report.next[0].selector, '.pagination__next');

  const { definition } = buildDraft(report, { nextHandled: true });
  assert.equal(definition.selectors.next, undefined);   // the built-in detection finds it
  assert.equal(definition.extract.fields.surface.selector, '.listing-card__features');

  const draft = validateDefinition(definition);
  const example = validateDefinition(
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'sites', 'cards-example.json'), 'utf8'))
  );
  const fromDraft = withoutDates(extractFromFile(draft, fixture('cards-example.html')));
  const fromExample = withoutDates(extractFromFile(example, fixture('cards-example.html')))
    .map(listing => ({ ...listing, source: draft.name, city: null }));   // city is not detected

  assert.deepEqual(fromDraft, fromExample);
});

test('embedded JSON: script, generic items path and field paths', () => {
  const report = analyzeFile('embedded-json-example.html');
  const [json] = report.json;

  assert.equal(json.script, 'script#search-data');
  assert.equal(json.items, 'page.sections[*].listings');
  assert.deepEqual(
    Object.fromEntries(Object.entries(json.fields).map(([name, field]) => [name, field.path])),
    {
      id: 'id', url: 'slug', title: 'name', price: 'price.label',
      surface: 'details.area', rooms: 'details.rooms', city: 'address.city'
    }
  );

  // A slug is not a link: it is left out of the draft with a note.
  const { definition, notes } = buildDraft(report);
  assert.equal(definition.extract.fields.url, undefined);
  assert.match(notes.join('\n'), /"slug" holds "flat-501"/);

  const listings = extractFromFile(validateDefinition(definition), fixture('embedded-json-example.html'));
  assert.deepEqual(listings.map(listing => [listing.id, listing.price, listing.rooms]), [['501', 950, 2], ['502', 1050, 4]]);
});

test('popups: a dialog is closed by the scraper, a plain fixed div needs selectors.popups', () => {
  const report = analyzeFile('popups-example.html');
  const [dialog, overlay] = report.popups;

  assert.equal(dialog.kind, 'dialog');
  assert.equal(dialog.aboutSaveSearch, true);
  assert.equal(dialog.automatic, true);
  assert.deepEqual(dialog.closeButtons.map(button => button.selector), ['.save-dialog__close']);

  assert.equal(overlay.kind, 'overlay');
  assert.equal(overlay.selector, '.alert-modal');
  assert.equal(overlay.automatic, false);
  assert.deepEqual(overlay.closeButtons.map(button => button.selector), ['.alert-modal__x']);

  // The toolbar's permanent "Save search" button is never a popup.
  assert.ok(report.popups.every(popup => !popup.selector.includes('toolbar')));

  const { definition } = buildDraft(report);
  assert.deepEqual(definition.selectors.popups, ['.alert-modal__x']);
  assert.equal(definition.extract, undefined);
});

test('the draft id and name come from the page host', () => {
  const report = { url: 'https://www.my-portal.example/rent?city=x', cards: [], json: [], next: [], cookie: [], popups: [] };
  const { definition } = buildDraft(report);
  assert.equal(definition.id, 'my-portal-example');
  assert.equal(definition.name, 'my-portal.example');
  assert.equal(definition.homeUrl, 'https://www.my-portal.example/');
});

test('data requests: only HTML or JSON from the portal itself, largest first', () => {
  const requests = [
    { url: 'https://www.my-portal.example/api/search?city=x', contentType: 'application/json', size: 300 },
    { url: 'https://www.my-portal.example/list.php?offset=0', contentType: 'text/html; charset=utf-8', size: 0 },
    { url: 'https://api.my-portal.example/results', contentType: 'application/json', size: 900 },
    { url: 'https://www.my-portal.example/api/search?city=x', contentType: 'application/json', size: 500 },
    { url: 'https://www.my-portal.example/logo.svg', contentType: 'image/svg+xml', size: 2000 },
    { url: 'https://tracker.example.net/collect', contentType: 'application/json', size: 4000 }
  ];
  const picked = pickDataRequests(requests, 'https://www.my-portal.example/rent?city=x');
  assert.deepEqual(picked.map(request => [request.url, request.size]), [
    ['https://api.my-portal.example/results', 900],
    ['https://www.my-portal.example/api/search?city=x', 500],   // the latest response of a repeated URL
    ['https://www.my-portal.example/list.php?offset=0', 0]
  ]);
});

test('cards: the tightest selector, not a layout class shared with the header; links by tag', () => {
  const report = analyzeFile('generic-class-example.html');

  assert.equal(report.cards[0].selector, '.listing');      // ".col-12" also matches the header
  assert.equal(report.cards[0].count, 3);
  assert.equal(report.cards[0].fields.url.selector, 'a');   // a[title="…"] fits only one card
  assert.equal(report.cards[0].fields.url.coverage, 3);
});
