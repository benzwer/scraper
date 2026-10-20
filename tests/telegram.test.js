const test = require('node:test');
const assert = require('node:assert/strict');

const { listingMessage, digestMessage, plainMessage } = require('../src/notify/telegramFormat');
const { Notifier } = require('../src/notify/Notifier');

const listing = {
  source: 'SiteA',
  title: 'Flat <near> the park & river',
  url: 'https://example.com/a?x=1&y=2',
  price: 1200,
  priceText: null,
  surface: 65,
  rooms: 2,
  city: 'Springfield'
};

test('listingMessage escapes HTML and lists the details', () => {
  const text = listingMessage(listing);
  assert.match(text, /^🏠 <b>Flat &lt;near&gt; the park &amp; river<\/b>\n<i>SiteA<\/i>\n\n/);
  assert.match(text, /💶 1200 €  ·  📐 65 m²  ·  🚪 2 rooms\n📍 Springfield$/);
  assert.doesNotMatch(text, /duplicate/);
  assert.match(listingMessage({ ...listing, duplicateSource: 'SiteB' }), /⚠️ possible duplicate of SiteB$/);
});

test('listingMessage copes with missing details', () => {
  const text = listingMessage({ source: 'SiteA', url: 'https://example.com/a' });
  assert.equal(text, '🏠 <b>New listing</b>\n<i>SiteA</i>\n\nDetails not available');
});

test('digestMessage links each title and counts the listings left out', () => {
  const text = digestMessage('SiteA', [listing, { ...listing, url: 'javascript:alert(1)' }], 5);
  assert.match(text, /^🔔 <b>SiteA<\/b>: 5 new listings\n\n/);
  assert.match(text, /1\. <b><a href="https:\/\/example\.com\/a\?x=1&amp;y=2">Flat &lt;near&gt;/);
  assert.match(text, /2\. <b>Flat &lt;near&gt; the park &amp; river<\/b>/);
  assert.match(text, /<i>…and 3 more<\/i>$/);
  assert.doesNotMatch(digestMessage('SiteA', [listing], 1), /more/);
});

test('plainMessage puts the title in bold', () => {
  assert.equal(plainMessage('A <b>', 'x & y'), '<b>A &lt;b&gt;</b>\nx &amp; y');
});

test('Notifier sends HTML, a button for web links and no link preview', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true };
  });
  const notifier = new Notifier({ TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_CHAT_ID: '42' });

  await notifier.send({ title: 't', message: 'm', url: listing.url, html: '<b>hi</b>' });
  await notifier.send({ title: 'Blocked', message: 'captcha', url: 'not a url' });

  assert.equal(requests[0].text, '<b>hi</b>');
  assert.equal(requests[0].parse_mode, 'HTML');
  assert.deepEqual(requests[0].link_preview_options, { is_disabled: true });
  assert.deepEqual(requests[0].reply_markup.inline_keyboard[0][0], { text: 'Open listing ↗', url: listing.url });
  assert.equal(requests[1].text, '<b>Blocked</b>\ncaptcha');
  assert.equal(requests[1].reply_markup, undefined);
});
