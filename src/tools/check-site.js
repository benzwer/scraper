// npm run check-site -- <site-id | definition.json> <page.html> [--base-url <url>] [--show <n>] [--fix] [--open]
//
// Tests a site definition against a saved HTML page, entirely offline: the page's own scripts are
// disabled and every network request is blocked. Prints what would be extracted. With --fix it
// then helps filling the fields left empty and the page selectors not found (see fix-fields.js).
// With --open the same page is also shown in a visible browser, with its scripts and stylesheets,
// to look at it while checking; the checks still run on the offline copy.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const defaults = require('../../config/default');
const { Site } = require('../sites/Site');
const { loadSiteDefinition, loadSiteDefinitions, FIELDS } = require('../sites/definitions');
const { openSavedPage, showSavedPage } = require('./saved-page');
const { usage, handleHelp } = require('./help');
const { fixFields, describeLocated } = require('./fix-fields');
const { ask } = require('./ask');

const USAGE = `${usage('check-site')}\nMore: npm run check-site -- --help`;

function parseArgs(argv) {
  const args = { positional: [], baseUrl: null, show: 5, fix: false, open: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url') args.baseUrl = argv[++i];
    else if (argv[i] === '--show') args.show = Number(argv[++i]);
    else if (argv[i] === '--fix') args.fix = true;
    else if (argv[i] === '--open') args.open = true;
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
  // Other invalid definitions do not matter here; the target's own error is reported.
  const invalid = new Map();
  const definition = loadSiteDefinitions(sitesDir, { onInvalid: (error, id) => invalid.set(id, error) })
    .find(item => item.id === target);
  if (!definition) throw invalid.get(target) || new Error(`No site with id "${target}" in ${sitesDir}`);
  return definition;
}

async function main() {
  if (handleHelp('check-site', process.argv.slice(2))) return;
  const args = parseArgs(process.argv.slice(2));
  const [target, htmlFile] = args.positional;
  if (args.open && !process.stdin.isTTY) {
    throw new Error('--open waits for ENTER to close the browser: run it in a terminal.');
  }

  const definition = findDefinition(target);
  const html = fs.readFileSync(path.resolve(htmlFile), 'utf8');
  // Relative links are resolved against this URL, as if the page had been opened there.
  const baseUrl = new URL(args.baseUrl || definition.homeUrl || 'https://www.example.com/').href;

  console.log(`Site:      ${definition.name} (${definition.file})`);
  console.log(`Page:      ${htmlFile} (served as ${baseUrl})`);

  const browser = await chromium.launch();
  let viewer = null;
  try {
    if (args.open) viewer = await openViewer(html, baseUrl);
    const page = await openSavedPage(browser, html, baseUrl);

    const site = new Site(definition, { url: baseUrl }, { config: defaults, notifier: null });
    const { ready, cookie } = definition.selectors;

    const readyCount = await page.locator(ready).count();
    const nextFound = (await site.nextLocator(page).count()) > 0;
    const cookieCount = cookie ? await page.locator(cookie).count() : null;
    const popupFound = (await site.popupCloseLocator(page).count()) > 0;

    console.log(`Ready:     ${ready} -> ${readyCount ? `found (${readyCount})` : 'NOT FOUND'}`);
    console.log(`Next page: ${nextFound
      ? `found ${await describeLocated(site.nextLocator(page))}`
      : 'not found (fine if the page has no pagination)'}`);
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
      // Items found but without url/id: --fix can still find them.
      if (args.fix && raw.length) await fixFields(page, definition);
      return;
    }

    console.log('Field coverage:');
    for (const field of FIELDS) {
      const values = listings.map(listing => listing[field]).filter(value => value != null);
      // The same value everywhere is suspicious (a category code read as the price), except for
      // the city; the id and the url have their own check below.
      const sameEverywhere = listings.length >= 3 && values.length === listings.length &&
        new Set(values).size === 1 && !['id', 'url', 'city'].includes(field);
      const flag = values.length === 0 ? '  <- always empty'
        : sameEverywhere ? '  <- same value in every listing: check it' : '';
      console.log(`  ${field.padEnd(8)} ${values.length}/${listings.length}${flag}`);
    }

    // The scraper tells listings apart by id (or url, without an id), like listingKey.
    const keys = listings.map(listing => listing.id ?? listing.url);
    const repeated = keys.length - new Set(keys).size;
    if (repeated) {
      const keyField = listings.some(listing => listing.id != null) ? 'id' : 'url';
      console.log(`\nRepeated: ${repeated} listing(s) have the same ${keyField} as another one: the scraper`);
      console.log(`           counts them as one and would not notify them. Check extract.fields.${keyField}.`);
      process.exitCode = 1;
    }

    const shown = listings.slice(0, args.show);
    if (shown.length) {
      console.log(`\nFirst ${shown.length} listing(s):`);
      for (const { source, scrapedAt, ...listing } of shown) console.log(listing);
    }

    if (args.fix) await fixFields(page, definition);
    else {
      const missing = [
        FIELDS.some(field => listings.some(listing => listing[field] == null)) && 'some fields are empty',
        !nextFound && 'the next page is not found'
      ].filter(Boolean);
      if (missing.length) {
        console.log(`\nTo fix what is missing (${missing.join(', ')}), run:`);
        console.log(`  npm run check-site -- ${process.argv.slice(2).join(' ')} --fix`);
      }
    }
  } finally {
    await browser.close();
    if (viewer) {
      if (viewer.isConnected()) await ask('\nPress ENTER to close the browser window.');
      await viewer.close();
    }
  }
}

// The visible window is only an aid: if it cannot open, the check goes on without it.
async function openViewer(html, baseUrl) {
  try {
    const viewer = await showSavedPage(chromium, html, baseUrl);
    console.log('Browser:   page shown in a visible window, with its scripts and stylesheets');
    return viewer;
  } catch (error) {
    console.log(`Browser:   could not show the page (${error.message.split('\n')[0]})`);
    return null;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
