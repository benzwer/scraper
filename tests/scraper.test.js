const test = require('node:test');
const assert = require('node:assert/strict');

const { Scraper } = require('../src/core/Scraper');

test('closeOpenBrowser closes the browser still open, once', async () => {
  const scraper = new Scraper({ config: {}, sites: [], store: {}, notifier: {} });
  let closed = 0;
  const session = { context: { close: async () => { closed++; } }, siteName: 'x', blocked: false };

  await scraper.closeOpenBrowser(); // nothing open: nothing to do
  scraper.openSession = session;
  await scraper.closeOpenBrowser();
  await scraper.closeOpenBrowser();

  assert.equal(closed, 1);
  assert.equal(scraper.openSession, null);
});

test('closeBrowser forgets the session, so an interrupt does not close it again', async () => {
  const scraper = new Scraper({ config: {}, sites: [], store: {}, notifier: {} });
  const session = { context: { close: async () => {} }, siteName: 'x', blocked: false };

  scraper.openSession = session;
  await scraper.closeBrowser(session);

  assert.equal(scraper.openSession, null);
});
