// npm run check-site -- <site-id | definition.json> <page.html> [--base-url <url>] [--show <n>]
//
// Tests a site definition against a saved HTML page, entirely offline: the page's own scripts are
// disabled and every network request is blocked. Prints what would be extracted.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const defaults = require('../../config/default');
const { Site } = require('../sites/Site');
const { loadSiteDefinition, loadSiteDefinitions, FIELDS } = require('../sites/definitions');
const { openSavedPage } = require('./saved-page');

const USAGE =
  'Usage: npm run check-site -- <site-id | path/to/definition.json> <page.html> ' +
  '[--base-url <url>] [--show <n>]';

function parseArgs(argv) {
  const args = { positional: [], baseUrl: null, show: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url') args.baseUrl = argv[++i];
    else if (argv[i] === '--show') args.show = Number(argv[++i]);
    else args.positional.push(argv[i]);
  }
  if (args.positional.length !== 2 || !Number.isInteger(args.show) || args.show < 0) {
    throw new Error(USAGE);
  }
  return args;
}

function findDefinition(target) {
  if (target.endsWith('.json')) return loadSiteDefinition(path.resolve(target));

  const sitesDir = path.join(defaults.paths.userDir, 'sites');
  const definition = loadSiteDefinitions(sitesDir).find(item => item.id === target);
  if (!definition) throw new Error(`No site with id "${target}" in ${sitesDir}`);
  return definition;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [target, htmlFile] = args.positional;

  const definition = findDefinition(target);
  const html = fs.readFileSync(path.resolve(htmlFile), 'utf8');
  // Relative links are resolved against this URL, as if the page had been opened there.
  const baseUrl = new URL(args.baseUrl || definition.homeUrl || 'https://www.example.com/').href;

  console.log(`Site:      ${definition.name} (${definition.file})`);
  console.log(`Page:      ${htmlFile} (served as ${baseUrl})`);

  const browser = await chromium.launch();
  try {
    const page = await openSavedPage(browser, html, baseUrl);

    const site = new Site(definition, { url: baseUrl }, { config: defaults, notifier: null });
    const { ready, cookie } = definition.selectors;

    const readyCount = await page.locator(ready).count();
    const nextFound = (await site.nextLocator(page).count()) > 0;
    const cookieCount = cookie ? await page.locator(cookie).count() : null;
    const popupFound = (await site.popupCloseLocator(page).count()) > 0;

    console.log(`Ready:     ${ready} -> ${readyCount ? `found (${readyCount})` : 'NOT FOUND'}`);
    console.log(`Next page: ${nextFound ? 'found' : 'not found (fine if the page has no pagination)'}`);
    if (popupFound) console.log('Popup:     "save search" popup close button found');
    if (cookie) console.log(`Cookie:    ${cookie} -> ${cookieCount ? 'found' : 'not found (often missing in saved pages)'}`);

    const blockReason = await site.detectBlock(page);
    if (blockReason) {
      console.log(`\nBlocked:   ${blockReason}. This is the page the site shows to refuse access,`);
      console.log('           not the search results: the selectors cannot be checked on it.');
      process.exitCode = 1;
      return;
    }

    const raw = (await site.extractRaw(page)) || [];
    const listings = site.normalizeAll(raw);

    console.log(`\nExtracted: ${raw.length} item(s), ${listings.length} valid listing(s) (with url or id)\n`);

    if (listings.length === 0) {
      console.log('Nothing extracted: check extract.item / extract.items and the url/id fields.');
      process.exitCode = 1;
      return;
    }

    console.log('Field coverage:');
    for (const field of FIELDS) {
      const filled = listings.filter(listing => listing[field] != null).length;
      const flag = filled === 0 ? '  <- always empty' : '';
      console.log(`  ${field.padEnd(8)} ${filled}/${listings.length}${flag}`);
    }

    const shown = listings.slice(0, args.show);
    if (shown.length) {
      console.log(`\nFirst ${shown.length} listing(s):`);
      for (const { source, scrapedAt, ...listing } of shown) console.log(listing);
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
