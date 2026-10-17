// npm run analyze-page -- <page.html> [--base-url <url>] [--write <definition.json>]
// npm run analyze-page -- --url <url> [--write <definition.json>]
//
// Helps writing a site definition: finds the listings (HTML cards or embedded JSON) and suggests
// selectors and paths for every field, plus the next-page button, the cookie banner and the
// popups (telling whether the scraper closes them by itself or a selectors.popups entry is
// needed). Ends with a validated draft definition.
//
// With a file the page is opened offline, like check-site. With --url a visible browser opens:
// you reach the results page and any popup, then press ENTER to analyse the live page; a snapshot
// is saved to data/debug/ to use with check-site.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const defaults = require('../../config/default');
const { Site, SAVE_SEARCH_TEXT_RE, CLOSE_NAME_RE } = require('../sites/Site');
const { analyzePage, buildDraft } = require('../sites/analyze');
const { validateDefinition, FIELDS } = require('../sites/definitions');
const { findBlockSignal } = require('../sites/blocking');
const { openSavedPage } = require('./saved-page');

chromium.use(StealthPlugin());

const USAGE =
  'Usage: npm run analyze-page -- <page.html> [--base-url <url>] [--write <definition.json>]\n' +
  '       npm run analyze-page -- --url <url> [--write <definition.json>]';

function parseArgs(argv) {
  const args = { file: null, url: null, baseUrl: null, write: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--base-url') args.baseUrl = argv[++i];
    else if (argv[i] === '--write') args.write = argv[++i];
    else if (!args.file) args.file = argv[i];
    else throw new Error(USAGE);
  }
  if (Boolean(args.file) === Boolean(args.url)) throw new Error(USAGE);
  if (args.url && !/^https?:\/\//.test(args.url)) throw new Error('--url: must be an http(s) URL');
  if (args.write && fs.existsSync(args.write)) throw new Error(`--write: ${args.write} already exists`);
  return args;
}

const heading = title => console.log(`\n== ${title} ==`);
const coverage = (field, total) => `${field.coverage}/${total}`.padEnd(6);

function printCards(cards) {
  heading('Listings as HTML cards');
  if (!cards.length) return console.log('  none found');

  cards.forEach((card, i) => {
    console.log(`  ${i + 1}. ${card.selector}  (${card.count} on the page)${i === 0 ? '  <- best match' : ''}`);
    console.log(`     "${card.sample}"`);
    const total = Math.min(card.count, 20);
    for (const name of FIELDS) {
      const field = card.fields[name];
      if (!field) {
        console.log(`     ${name.padEnd(8)} not found`);
        continue;
      }
      const where = [field.selector || '(the card itself)', field.attr && `[${field.attr}]`, field.match && `match ${field.match}`]
        .filter(Boolean).join(' ');
      console.log(`     ${name.padEnd(8)} ${coverage(field, total)} ${where}  -> "${field.sample}"`);
    }
  });
}

function printJson(results) {
  heading('Listings as embedded JSON');
  if (!results.length) return console.log('  none found');

  results.forEach((result, i) => {
    console.log(`  ${i + 1}. script ${result.script}, items "${result.items}"  (${result.count} items)`);
    const total = Math.min(result.count, 20);
    for (const name of FIELDS) {
      const field = result.fields[name];
      console.log(field
        ? `     ${name.padEnd(8)} ${coverage(field, total)} ${field.path}  -> "${field.sample}"`
        : `     ${name.padEnd(8)} not found`);
    }
  });
}

function printNext(next, nextHandled) {
  heading('Next page');
  if (nextHandled) console.log('  found by the scraper\'s built-in detection: no selectors.next needed');
  else if (!next.length) console.log('  not found (fine if the results fit in one page)');
  else console.log('  not found by the built-in detection. Candidates for selectors.next:');
  if (!nextHandled) for (const item of next) console.log(`    ${item.selector}  ("${item.name}")`);
}

function printCookie(cookie, live) {
  heading('Cookie banner');
  if (!cookie.length) {
    console.log(live ? '  no accept button found' : '  no accept button found (often missing in saved pages)');
    return;
  }
  console.log('  candidates for selectors.cookie:');
  for (const item of cookie) console.log(`    ${item.selector}  ("${item.name}")`);
}

function printPopups(popups, live) {
  heading('Popups and overlays');
  if (!live) {
    console.log('  (saved page: stylesheets are not loaded, so only popups marked as dialogs are reliable;');
    console.log('   use --url to analyse a popup on the live page)');
  }
  if (!popups.length) return console.log('  none found');

  popups.forEach((popup, i) => {
    const kind = popup.kind === 'overlay'
      ? `<${popup.tag}> with position: fixed, NOT marked as a dialog`
      : `<${popup.tag}> marked as ${popup.kind === 'dialog' ? 'role="dialog"' : popup.kind}`;
    console.log(`  ${i + 1}. ${kind}`);
    console.log(`     ${popup.selector}`);
    console.log(`     "${popup.text}"`);

    if (popup.isCookieBanner) console.log('     -> looks like the cookie banner: see selectors.cookie above');
    else if (popup.automatic) console.log('     -> closed automatically by the scraper (a dialog about saving the search with a close button)');
    else if (!popup.closeButtons.length) console.log('     -> no close button recognised: find it with the browser\'s developer tools');
    else {
      const why = popup.kind !== 'dialog' ? 'it is not marked as a dialog'
        : !popup.aboutSaveSearch ? 'its text does not mention saving the search'
          : 'its close button has no recognisable name';
      console.log(`     -> NOT closed automatically (${why}). For selectors.popups:`);
    }
    if (!popup.automatic && !popup.isCookieBanner) {
      for (const button of popup.closeButtons) console.log(`          ${button.selector}  ("${button.name}")`);
    }
  });
}

async function analyze(page, { live }) {
  const report = await page.evaluate(analyzePage, {
    saveSearchText: SAVE_SEARCH_TEXT_RE.source,
    closeName: CLOSE_NAME_RE.source
  });

  // The verdicts come from the same Playwright locators the scraper uses.
  const builtIn = new Site({ name: 'analyze-page', selectors: { next: [], popups: [], blocked: [] } },
    { url: report.url }, { config: defaults });
  const nextHandled = (await builtIn.nextLocator(page).count()) > 0;
  for (const popup of report.popups) {
    popup.automatic = popup.kind === 'dialog' && popup.aboutSaveSearch &&
      (await page.locator(popup.selector).getByRole('button', { name: CLOSE_NAME_RE }).count()) > 0;
  }

  console.log(`Page:  ${report.url}${report.title ? `  ("${report.title}")` : ''}`);
  const blocked = await page.evaluate(findBlockSignal);
  if (blocked) {
    console.log(`\nBlocked: ${blocked}. This is the page the site shows to refuse access, not the results.`);
    process.exitCode = 1;
    return null;
  }

  printCards(report.cards);
  printJson(report.json);
  printNext(report.next, nextHandled);
  printCookie(report.cookie, live);
  printPopups(report.popups, live);

  return buildDraft(report, { nextHandled });
}

function printDraft({ definition, notes }, args, pageFile) {
  heading('Draft definition');
  try {
    validateDefinition(definition, { file: '(draft)' });
  } catch (error) {
    console.log(`  not valid yet:\n${error.message.split('\n').slice(1).join('\n')}`);
  }
  for (const note of notes) console.log(`  note: ${note}`);
  console.log('  Fields "not found" above (often city) must be added by hand.\n');

  const json = `${JSON.stringify(definition, null, 2)}\n`;
  console.log(json);

  const target = args.write || `user/sites/${definition.id}.json`;
  if (args.write) {
    fs.mkdirSync(path.dirname(path.resolve(args.write)), { recursive: true });
    fs.writeFileSync(args.write, json, 'utf8');
    console.log(`Saved to ${args.write}.`);
  } else {
    console.log(`Save it with --write ${target} (or copy it), then`);
  }
  console.log(`check it: npm run check-site -- ${target} ${pageFile}`);
}

async function analyzeFile(args) {
  const html = fs.readFileSync(path.resolve(args.file), 'utf8');
  const baseUrl = new URL(args.baseUrl || 'https://www.example.com/').href;

  const browser = await chromium.launch();
  try {
    const page = await openSavedPage(browser, html, baseUrl);
    console.log(`File:  ${args.file} (offline, scripts disabled${args.baseUrl ? '' : '; use --base-url <portal url> for real links'})`);
    const draft = await analyze(page, { live: false });
    if (draft) printDraft(draft, args, args.file);
  } finally {
    await browser.close();
  }
}

async function analyzeLive(args) {
  const { browser: options } = defaults;
  const browser = await chromium.launch({ headless: false, args: options.args });
  try {
    const context = await browser.newContext({
      viewport: null,
      locale: options.locale,
      timezoneId: options.timezoneId
    });
    const page = await context.newPage();
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: defaults.timing.navigationTimeout });

    console.log('A browser window is open (temporary profile, nothing is saved).');
    console.log('Reach the search results and wait for any popup you want to analyse:');
    console.log('leave it open, then press ENTER here.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('');
    rl.close();

    const current = context.pages().filter(p => !p.isClosed()).at(-1);
    if (!current) throw new Error('The browser tab was closed: nothing to analyse.');

    const debugDir = path.join(defaults.paths.dataDir, 'debug');
    fs.mkdirSync(debugDir, { recursive: true });
    const host = new URL(current.url()).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
    const snapshot = path.join(debugDir, `analyze_${host}.html`);
    fs.writeFileSync(snapshot, await current.content(), 'utf8');
    console.log(`Snapshot saved to ${path.relative(process.cwd(), snapshot)}\n`);

    const draft = await analyze(current, { live: true });
    if (draft) printDraft(draft, args, path.relative(process.cwd(), snapshot));
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await (args.url ? analyzeLive(args) : analyzeFile(args));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
