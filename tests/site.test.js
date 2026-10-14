const test = require('node:test');
const assert = require('node:assert/strict');

const { Site } = require('../src/sites/Site');
const { createSites } = require('../src/sites');
const { validateDefinition } = require('../src/sites/definitions');

const config = { timing: { readyTimeout: 10, listingsWaitMs: 50 } };

const definition = (id = 'cards') => validateDefinition({
  id,
  name: id.toUpperCase(),
  extract: { type: 'css', item: '.card', fields: { url: { selector: 'a', attr: 'href' } } }
});

function makeSite(waitReady) {
  const site = new Site(definition(), { url: 'https://www.example.com/' }, { config });
  site.waitReady = waitReady;
  return site;
}

test('waitForListings retries on timeouts and gives up at the deadline', async () => {
  let calls = 0;
  const site = makeSite(async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    const error = new Error('timeout');
    error.name = 'TimeoutError';
    throw error;
  });

  assert.equal(await site.waitForListings({}), false);
  assert.ok(calls > 1);
});

test('waitForListings rethrows non-timeout errors instead of spinning', async () => {
  let calls = 0;
  const site = makeSite(async () => {
    calls++;
    throw new Error('selectors.ready is missing');
  });

  await assert.rejects(site.waitForListings({}), /selectors.ready is missing/);
  assert.equal(calls, 1);
});

test('createSites pairs enabled searches with their definitions', () => {
  const sites = createSites(
    [
      { site: 'cards', url: 'https://a.example/' },
      { site: 'other', url: 'https://b.example/', enabled: false }
    ],
    [definition('cards'), definition('other')],
    { config }
  );
  assert.deepEqual(sites.map(site => site.name), ['CARDS']);
  assert.equal(sites[0].search.url, 'https://a.example/');
});

test('createSites rejects unknown sites and duplicate searches', () => {
  assert.throws(
    () => createSites([{ site: 'nope', url: 'https://a.example/' }], [definition('cards')], { config }),
    /unknown site "nope" \(site definitions found: cards\)/
  );
  assert.throws(
    () => createSites(
      [{ site: 'cards', url: 'https://a.example/' }, { site: 'cards', url: 'https://b.example/' }],
      [definition('cards')],
      { config }
    ),
    /more than one enabled search/
  );
});
