const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { blockedStatus, findBlockSignal } = require('../src/sites/blocking');
const { ResultStore } = require('../src/core/ResultStore');
const { Scraper } = require('../src/core/Scraper');

const HOUR = 3600000;
const blocking = { pauseHours: 6, maxPauseHours: 48 };

function signalIn(html) {
  global.document = new JSDOM(html).window.document;
  try {
    return findBlockSignal();
  } finally {
    delete global.document;
  }
}

test('findBlockSignal recognises common bot checks', () => {
  assert.equal(
    signalIn('<iframe src="https://geo.captcha-delivery.com/captcha/?x=1" title="DataDome CAPTCHA"></iframe>'),
    'DataDome captcha'
  );
  assert.equal(signalIn('<form id="challenge-form"></form>'), 'Cloudflare challenge');
  assert.equal(signalIn('<div id="px-captcha"></div>'), 'PerimeterX captcha');
  assert.equal(signalIn('<iframe src="https://newassets.hcaptcha.com/captcha/v1"></iframe>'), 'hCaptcha');
  assert.equal(signalIn('<ul class="results"><li>Flat</li></ul>'), null);
});

test('blockedStatus flags 403 and 429 only', () => {
  const response = status => ({ status: () => status });
  assert.equal(blockedStatus(response(403)), 'HTTP 403');
  assert.equal(blockedStatus(response(429)), 'HTTP 429');
  assert.equal(blockedStatus(response(200)), null);
  assert.equal(blockedStatus(response(500)), null);
  assert.equal(blockedStatus(null), null);   // goto can return null
});

test('consecutive blocks double the pause up to the maximum', () => {
  const store = new ResultStore(os.tmpdir());
  const now = Date.parse('2026-10-15T10:00:00Z');

  const hours = [1, 2, 3, 4, 5].map(i => {
    const block = store.recordBlock('A', 'DataDome captcha', blocking, now);
    assert.equal(block.count, i);
    return (Date.parse(block.until) - now) / HOUR;
  });
  assert.deepEqual(hours, [6, 12, 24, 48, 48]);
});

test('a block is active until it expires, and clearing it resets the backoff', () => {
  const store = new ResultStore(os.tmpdir());
  const now = Date.parse('2026-10-15T10:00:00Z');

  store.recordBlock('A', 'HTTP 403', blocking, now);
  assert.equal(store.activeBlock('A', now + 5 * HOUR).reason, 'HTTP 403');
  assert.equal(store.activeBlock('A', now + 7 * HOUR), null);
  assert.equal(store.activeBlock('B', now), null);

  store.clearBlock('A');
  assert.equal(store.recordBlock('A', 'HTTP 403', blocking, now).count, 1);
});

test('blocks are saved and loaded with the listings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const store = new ResultStore(dir);
  await store.load();
  store.recordBlock('A', 'HTTP 429', blocking);
  await store.save();

  const reloaded = new ResultStore(dir);
  await reloaded.load();
  assert.equal(reloaded.activeBlock('A').reason, 'HTTP 429');
});

test('the scraper skips paused sites, notifies blocks and can retry on request', async () => {
  const store = new ResultStore(os.tmpdir());
  const sent = [];
  const scraper = new Scraper({
    config: { blocking },
    sites: [{ name: 'A' }, { name: 'B' }],
    store,
    notifier: { send: async message => sent.push(message) }
  });

  await scraper.handleBlock('A', 'DataDome captcha');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'A: access blocked');
  assert.match(sent[0].message, /DataDome captcha\. The site will not be visited for 6 h/);

  assert.deepEqual(scraper.sitesToVisit().map(site => site.name), ['B']);
  assert.deepEqual(scraper.sitesToVisit({ retryBlocked: true }).map(site => site.name), ['A', 'B']);
});

test('each site has its own profile, deleted only after a block', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-'));
  const scraper = new Scraper({ config: { paths: { profileDir } }, sites: [], store: null, notifier: null });
  const site = id => ({ name: id.toUpperCase(), definition: { id } });
  const sessionOf = (id, blocked) => {
    const dir = scraper.profileDirOf(site(id));
    fs.mkdirSync(dir, { recursive: true });
    return { context: { close: async () => {} }, siteName: id, profileDir: dir, blocked };
  };

  assert.equal(scraper.profileDirOf(site('a')), path.join(profileDir, 'a'));

  await scraper.closeBrowser(sessionOf('a', false));
  await scraper.closeBrowser(sessionOf('b', true));

  assert.ok(fs.existsSync(path.join(profileDir, 'a')));
  assert.ok(!fs.existsSync(path.join(profileDir, 'b')));

  fs.rmSync(profileDir, { recursive: true, force: true });
});
