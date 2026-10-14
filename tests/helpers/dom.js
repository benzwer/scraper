const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const { extractListings } = require('../../src/sites/extract');
const { normalizeListing } = require('../../src/models/listing');

// Runs a site definition's extraction against an HTML file, as the browser would,
// and returns the normalised listings.
function extractFromFile(definition, htmlFile, url = 'https://www.example.com/search') {
  const dom = new JSDOM(fs.readFileSync(htmlFile, 'utf8'), { url });
  global.document = dom.window.document;
  try {
    const { extract } = definition;
    const raw = extract.type === 'script' ? extract.fn(extract.options) : extractListings(extract);
    return raw.map(item => normalizeListing(item, definition.name)).filter(Boolean);
  } finally {
    delete global.document;
  }
}

module.exports = { extractFromFile };
