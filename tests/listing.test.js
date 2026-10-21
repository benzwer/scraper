const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePrice, parseSurface, parseRooms, passesFilters, excludedWord, crossKey, normalizeListing, formatListing
} = require('../src/models/listing');

test('parsePrice handles Italian formats', () => {
  assert.equal(parsePrice('€ 1.200/mese'), 1200);
  assert.equal(parsePrice('900 €'), 900);
  assert.equal(parsePrice('€ 1.250,50'), 1250);
  assert.equal(parsePrice('1200'), 1200);
  assert.equal(parsePrice('$1,200 / month'), 1200);
  assert.equal(parsePrice('1,250.50'), 1250);
  assert.equal(parsePrice('1200.50'), 1200);
  assert.equal(parsePrice('€ 1.200.000'), 1200000);
  assert.equal(parsePrice(950), 950);
  assert.equal(parsePrice('su richiesta'), null);
  assert.equal(parsePrice(null), null);
});

test('parseSurface and parseRooms', () => {
  assert.equal(parseSurface('85 m²'), 85);
  assert.equal(parseSurface('72,5 m²'), 72.5);
  assert.equal(parseSurface(null), null);
  assert.equal(parseRooms('3 locali'), 3);
  assert.equal(parseRooms('5+'), 5);
  assert.equal(parseRooms(4), 4);
});

test('passesFilters: missing data passes, out-of-range data does not', () => {
  const filters = { maxPrice: 1300, minRooms: 3, maxRooms: 5, minSurface: null };
  assert.equal(passesFilters({ price: 1200, rooms: 3 }, filters), true);
  assert.equal(passesFilters({ price: 1400, rooms: 3 }, filters), false);
  assert.equal(passesFilters({ price: 1200, rooms: 2 }, filters), false);
  assert.equal(passesFilters({ price: null, rooms: null }, filters), true);
});

test('crossKey requires price, surface and rooms', () => {
  assert.equal(crossKey({ price: 1000, surface: 80, rooms: 3 }), '1000|80|3');
  assert.equal(crossKey({ price: 1000, surface: null, rooms: 3 }), null);
});

test('formatListing labels possible cross-portal duplicates', () => {
  const base = { source: 'B', title: 't', price: 1000, rooms: 3 };
  assert.doesNotMatch(formatListing(base).message, /duplicate/);
  assert.match(
    formatListing({ ...base, duplicateSource: 'A' }).message,
    /possible duplicate of A/
  );
});

test('normalizeListing discards data with neither id nor url', () => {
  assert.equal(normalizeListing({ title: 'x' }, 'Site'), null);
});

test('excludedWord: title or description, no matter capitals and accents, words starting with it', () => {
  const listing = { title: 'Bilocale in Città', description: 'Contratto TRANSITORIO, solo studentesse.' };
  assert.equal(excludedWord(listing, ['transitorio']), 'transitorio');
  assert.equal(excludedWord(listing, ['citta']), 'citta');                // accents do not matter
  assert.equal(excludedWord(listing, ['student']), 'student');            // "studentesse" starts with it
  assert.equal(excludedWord(listing, ['solo studentesse']), 'solo studentesse');
  assert.equal(excludedWord(listing, ['tessa']), null);                   // not inside another word
  assert.equal(excludedWord(listing, ['ufficio', ' ']), null);
  assert.equal(excludedWord({ title: null, description: null }, ['x']), null);
});

test('passesFilters: a listing with an excluded word is not notified', () => {
  const filters = { maxPrice: null, excludeWords: ['transitorio'] };
  assert.equal(passesFilters({ title: 'Affitto transitorio', price: 800 }, filters), false);
  assert.equal(passesFilters({ title: 'Bilocale', description: 'Contratto 4+4', price: 800 }, filters), true);
  assert.equal(passesFilters({ title: 'Affitto transitorio' }, { maxPrice: null }), true);
});

test('normalizeListing keeps the description on one line and cuts it', () => {
  const listing = normalizeListing({ url: '/a', description: `  Bright\n flat ${'x'.repeat(2000)}` }, 'Site');
  assert.match(listing.description, /^Bright flat x/);
  assert.equal(listing.description.length, 1000);
  assert.equal(normalizeListing({ url: '/a', description: '   ' }, 'Site').description, null);
  assert.equal(normalizeListing({ url: '/a' }, 'Site').description, null);
});
