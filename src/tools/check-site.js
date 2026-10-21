// npm run check-site -- <site-id | definition.json> <page.html> [--base-url <url>] [--show <n>] [--fix] [--open]
//
// Tests a site definition against a saved HTML page, entirely offline: the page's own scripts are
// disabled and every network request is blocked. Prints what would be extracted and which listings
// filters.excludeWords would keep out of the notifications. With --fix it then helps filling the
// fields left empty, the word filter and the page selectors not found (see fix-fields.js).
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
const { fixFields, describeLocated, printExcluded } = require('./fix-fields');
const { ask } = require('./ask');
const { loadConfig } = require('../core/config');
const { bold, dim, red, yellow, cyan, mark, heading, bar, row, shorten } = require('./style');

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

  heading('check-site', definition.name);
  console.log(row('Definition', dim(definition.file)));
  console.log(row('Page', `${htmlFile} ${dim(`(served as ${baseUrl})`)}`));

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

    heading('Page');
    console.log(`${readyCount ? mark.ok : mark.fail}${row('Listings', `${ready} ${readyCount
      ? dim(`found (${readyCount})`) : red('NOT FOUND')}`)}`);
    console.log(nextFound
      ? `${mark.ok}${row('Next page', shorten(await describeLocated(site.nextLocator(page)), 90))}`
      : `${mark.info}${row('Next page', dim('not found (fine if the page has no pagination)'))}`);
    if (cookie) {
      console.log(cookieCount
        ? `${mark.ok}${row('Cookie', cookie)}`
        : `${mark.warn}${row('Cookie', `${cookie} ${dim('not found (often missing in saved pages)')}`)}`);
    }
    if (popupFound) console.log(`${mark.ok}${row('Popup', '"save search" popup close button found')}`);

    const blockReason = await site.detectBlock(page);
    if (blockReason) {
      console.log(`\n${mark.fail} ${red(bold('Blocked:'))} ${blockReason}. This is the page the site shows to refuse`);
      console.log('  access, not the search results: the selectors cannot be checked on it.');
      process.exitCode = 1;
      return;
    }

    const raw = (await site.extractRaw(page)) || [];
    const listings = site.normalizeAll(raw);

    heading('Listings', `${raw.length} item(s), ${listings.length} valid (with url or id)`);

    if (listings.length === 0) {
      console.log(`${mark.fail} Nothing extracted: check extract.item / extract.items and the url/id fields.`);
      process.exitCode = 1;
      // Items found but without url/id: --fix can still find them.
      if (args.fix && raw.length) await fixFields(page, definition);
      return;
    }

    for (const field of FIELDS) {
      const values = listings.map(listing => listing[field]).filter(value => value != null);
      // The same value everywhere is suspicious (a category code read as the price), except for
      // the city; the id and the url have their own check below.
      const sameEverywhere = listings.length >= 3 && values.length === listings.length &&
        new Set(values).size === 1 && !['id', 'url', 'city'].includes(field);
      const optional = field === 'description' && !values.length;
      const flag = optional ? dim('optional: lets filters.excludeWords read the description')
        : !values.length ? red('always empty')
          : sameEverywhere ? yellow('same value in every listing: check it') : '';
      console.log(`  ${field.padEnd(12)} ${bar(values.length, listings.length)}  ${flag}`);
    }

    // The scraper tells listings apart by id (or url, without an id), like listingKey.
    const keys = listings.map(listing => listing.id ?? listing.url);
    const repeated = keys.length - new Set(keys).size;
    if (repeated) {
      const keyField = listings.some(listing => listing.id != null) ? 'id' : 'url';
      console.log(`\n${mark.fail} ${red(bold('Repeated:'))} ${repeated} listing(s) have the same ${keyField} as another one:`);
      console.log(`  the scraper counts them as one and would not notify them. Check extract.fields.${keyField}.`);
      process.exitCode = 1;
    }

    printWordFilter(listings, loadFilters());

    const shown = listings.slice(0, args.show);
    if (shown.length) {
      heading(`First ${shown.length} listing(s)`);
      shown.forEach(printListing);
    }

    if (args.fix) await fixFields(page, definition);
    else {
      const missing = [
        FIELDS.some(field => field !== 'description' && listings.some(listing => listing[field] == null)) &&
          'some fields are empty',
        !nextFound && 'the next page is not found'
      ].filter(Boolean);
      if (missing.length) {
        console.log(`\n${mark.info} To fix what is missing (${missing.join(', ')}), run:`);
        console.log(`  ${bold(`npm run check-site -- ${process.argv.slice(2).join(' ')} --fix`)}`);
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

// The filters of user/config.json; the defaults when it is missing or invalid (check-site also
// works on a definition before any search is configured).
function loadFilters() {
  try {
    return loadConfig(defaults).config.filters;
  } catch {
    return defaults.filters;
  }
}

// Which listings of the page filters.excludeWords would keep out of the notifications.
function printWordFilter(listings, filters) {
  const words = filters.excludeWords ?? [];
  if (!words.length) return;

  heading('Word filter', words.join(', '));
  if (!listings.some(listing => listing.description)) {
    console.log(`${mark.warn} No description read: only the titles are searched. Run --fix to add the field.`);
  }
  printExcluded(listings, words);
}

// One listing in three lines: title, the figures, the link (and the start of the description).
function printListing(listing, i) {
  const figures = [
    listing.price != null && `${listing.price} €`,
    listing.surface != null && `${listing.surface} m²`,
    listing.rooms != null && `${listing.rooms} rooms`,
    listing.city,
    listing.id != null && dim(`id ${listing.id}`)
  ].filter(Boolean);
  console.log(`  ${cyan(`${i + 1}.`)} ${bold(shorten(listing.title ?? '(no title)', 80))}`);
  console.log(`     ${figures.length ? figures.join(dim(' · ')) : dim('no price, surface, rooms or city')}`);
  if (listing.url) console.log(`     ${dim(shorten(listing.url, 90))}`);
  if (listing.description) console.log(`     ${dim(`“${shorten(listing.description, 86)}”`)}`);
}

// The visible window is only an aid: if it cannot open, the check goes on without it.
async function openViewer(html, baseUrl) {
  try {
    const viewer = await showSavedPage(chromium, html, baseUrl);
    console.log(`${mark.ok}${row('Browser', 'page shown in a visible window, with its scripts and stylesheets')}`);
    return viewer;
  } catch (error) {
    console.log(`${mark.warn}${row('Browser', `could not show the page (${error.message.split('\n')[0]})`)}`);
    return null;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
