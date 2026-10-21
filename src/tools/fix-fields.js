// check-site --fix: for every field that is empty in some listings, shows the text of one of those
// listings, asks the value the user sees in it and proposes ways to read it (selector, attribute,
// regex or JSON path). Each proposal is tried with the scraper's own extractor on the whole page,
// so its coverage is what the scraper will get. Then it asks the words to exclude from the
// notifications (filters.excludeWords) and, to search them in the description too, where the
// description is. Last, for the next-page button, the cookie banner and popups the scraper does
// not find, it asks the text of the button and proposes selectors. The chosen ones are saved after
// confirmation: the definition, and the words in user/config.json.
const fs = require('node:fs');

const { analyzePage, buildDraft } = require('../sites/analyze');
const defaults = require('../../config/default');
const { Site, SAVE_SEARCH_TEXT_RE, CLOSE_NAME_RE } = require('../sites/Site');
const { extractListings } = require('../sites/extract');
const { validateDefinition, FIELDS } = require('../sites/definitions');
const { normalizeListing, excludedWord } = require('../models/listing');
const { loadConfig, setExcludeWords } = require('../core/config');
const { ask } = require('./ask');
const { bold, dim, red, green, yellow, cyan, mark, heading, bar, shorten } = require('./style');

const MAX_PROPOSALS = 5;

// { selector: ".x" } -> ".x" and { path: "a.b" } -> "a.b", as written by hand.
function compactSpec(spec) {
  const entries = Object.entries(spec).filter(([, value]) => value != null);
  if (entries.length === 1 && ['selector', 'path'].includes(entries[0][0])) return entries[0][1];
  return Object.fromEntries(entries);
}

function describeSpec(spec) {
  if (typeof spec === 'string') return spec;
  const where = spec.path ?? spec.selector ?? '(the listing itself)';
  return [where, spec.attr && `[${spec.attr}]`, spec.match && `match ${spec.match}`].filter(Boolean).join('  ');
}

// Every item of the page as the scraper would store it, or null when it is not a listing (no url
// and no id: a menu or a footer selected by a too generic extract.item).
async function listingsOf(page, rawDefinition, file) {
  const definition = validateDefinition(rawDefinition, { file });
  const items = await page.evaluate(extractListings, definition.extract);
  return items.map(item => normalizeListing(item, definition.name));
}

// The field's value in every item of the page (null when empty).
async function fieldValues(page, rawDefinition, file, field) {
  return (await listingsOf(page, rawDefinition, file)).map(listing => listing?.[field] ?? null);
}

// What to look for in the listing's text, for each field.
const HINTS = {
  id: 'its code or reference (e.g. for "Ref. 1328" type 1328)',
  url: 'a part of its link (e.g. 1328 for ".../flat-1328.html")',
  title: 'its title or type of property (e.g. Two-room flat)',
  price: 'the price (e.g. 900 €)',
  surface: 'the surface (e.g. 60 m2)',
  rooms: 'the number of rooms (e.g. 3)',
  city: 'the town (e.g. Springfield)',
  description: 'a few words of its description (e.g. bright flat on the second floor)'
};

const NUMERIC = ['price', 'surface', 'rooms'];

// The typed value as the scraper would store it (price, surface and rooms become numbers).
const expectedValue = (field, typed) => normalizeListing({ url: '-', [field]: typed }, '')?.[field] ?? null;

// Whether a candidate reads, in the listing being fixed, the value the user typed: the same
// number for price, surface and rooms, a text containing it otherwise.
function readsTypedValue(field, read, typed) {
  if (read == null) return false;
  if (NUMERIC.includes(field)) return read === expectedValue(field, typed);
  const content = String(read);
  // A title or city much longer than the typed value is another text that contains it (a link…).
  if (['title', 'city'].includes(field) && content.length > Math.max(20, typed.length * 3)) return false;
  return content.toLowerCase().includes(typed.toLowerCase());
}

// Positional selectors break when a listing lacks an element: they come after the others.
const isPositional = spec => /:nth-of-type|:scope/.test(JSON.stringify(spec));

// Tries every candidate on the whole page; keeps the ones that read the typed value in the listing
// being fixed, best coverage first, one per distinct result.
async function rankCandidates(page, rawDefinition, file, { field, index, typed }, candidates) {
  const results = new Map();   // values -> best proposal giving them
  for (const candidate of candidates) {
    const spec = compactSpec(candidate);
    const trial = structuredClone(rawDefinition);
    trial.extract.fields[field] = spec;

    let values;
    try {
      values = await fieldValues(page, trial, file, field);
    } catch {
      continue;   // e.g. a regex the definition rejects
    }
    if (!readsTypedValue(field, values[index], typed)) continue;

    const proposal = { spec, values, coverage: values.filter(value => value != null).length };
    const key = JSON.stringify(values);
    const other = results.get(key);
    if (!other || isPositional(other.spec) > isPositional(spec) ||
      (isPositional(other.spec) === isPositional(spec) && JSON.stringify(spec).length < JSON.stringify(other.spec).length)) {
      results.set(key, proposal);
    }
  }
  // A positional selector may read another row where one is missing, which still counts as
  // "filled": the coverage cannot tell, so they are listed last.
  return [...results.values()]
    .sort((a, b) => isPositional(a.spec) - isPositional(b.spec) || b.coverage - a.coverage)
    .slice(0, MAX_PROPOSALS);
}

const samples = values => [...new Set(values.filter(value => value != null).map(String))]
  .slice(0, 3)
  .map(value => (value.length > 30 ? `${value.slice(0, 29)}…` : value))
  .join(', ');

function printWrapped(content, indent = '    ', width = 96) {
  let line = '';
  for (const word of content.split(' ')) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      console.log(dim(`${indent}│ `) + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) console.log(dim(`${indent}│ `) + line);
}

// The numbered proposals to choose from, with their coverage.
function printProposal(index, spec, detail) {
  console.log(`  ${cyan(bold(`${index + 1}.`))} ${spec}`);
  console.log(`     ${detail}`);
}

const askChoice = count => ask(`${cyan('?')} Choose ${bold(`[1-${count}]`)}, or ENTER to skip: `);

function writeDefinition(file, original, rawDefinition) {
  const json = `${JSON.stringify(rawDefinition, null, 2)}\n`;
  fs.writeFileSync(file, original.includes('\r\n') ? json.replace(/\n/g, '\r\n') : json, 'utf8');
}

// Asks the value of one field in a listing where it is empty. Returns the chosen proposal, null to
// skip the field, or "stop".
async function fixField(page, rawDefinition, file, field, locate) {
  const listings = await listingsOf(page, rawDefinition, file);
  const values = listings.map(listing => listing?.[field] ?? null);
  // A real listing (with url or id) where the field is empty; else any item where it is empty.
  let index = listings.findIndex(listing => listing && listing[field] == null);
  if (index < 0) index = values.findIndex(value => value == null);
  const filled = values.filter(value => value != null).length;
  heading(field, `empty in ${values.length - filled} of ${values.length} listings`);

  const { text } = await locate(index, null);
  if (!text) return null;
  console.log(dim(`  Text of listing ${index + 1}, one where ${field} is empty:`));
  printWrapped(text);
  console.log(`${mark.info} Find ${bold(HINTS[field])} in the text above and type it as written there.`);

  for (;;) {
    const value = await ask(`${cyan('?')} ${bold(field)} ${dim('(ENTER to skip this field, "q" to stop)')}: `);
    if (!value) return null;
    if (value.toLowerCase() === 'q') return 'stop';
    if (NUMERIC.includes(field) && expectedValue(field, value) == null) {
      console.log(`  ${mark.warn} ${field} is a number: type it as in the text above (e.g. "${field === 'price' ? '1.200 €' : '4'}").`);
      continue;
    }

    let { candidates } = await locate(index, value);
    // The whole description is wanted, not only the words typed to find it.
    if (field === 'description') candidates = candidates.map(({ match, ...candidate }) => candidate);
    const proposals = await rankCandidates(page, rawDefinition, file, { field, index, typed: value }, candidates);
    if (!proposals.length) {
      console.log(`  ${mark.fail} "${value}" was not found in this listing. Type it exactly as in the text above;`);
      console.log(dim('    if it is not there, the page does not have it (e.g. it is only on the detail page).'));
      continue;
    }

    proposals.forEach((proposal, i) => {
      const detail = `${bar(proposal.coverage, values.length, 10)} ${dim('→')} ${samples(proposal.values)}`;
      printProposal(i, describeSpec(proposal.spec), detail);
      if (isPositional(proposal.spec)) {
        console.log(`     ${yellow('by position: where a listing lacks an element, it may read the wrong one')}`);
      }
    });
    const choice = await askChoice(proposals.length);
    const chosen = proposals[Number(choice) - 1];
    if (chosen) return chosen;
    if (!choice) return null;
    console.log(`  ${mark.warn} not a valid choice`);
  }
}

// When some items are not listings (extract.item also selects the menu, the footer…), says so and
// offers the extract block analyze-page finds now, if it gets more listings. Returns the change
// to report, or null.
async function checkListings(page, rawDefinition, file) {
  const listings = await listingsOf(page, rawDefinition, file);
  const others = listings.filter(listing => !listing).length;
  if (!others) return null;

  const describe = extract => (extract.type === 'css' ? `"item": "${extract.item}"` : `"items": "${extract.items}"`);
  heading('Listings', `${others} of ${listings.length} blocks are not listings`);
  console.log(`${mark.warn} ${others} of the ${listings.length} blocks found by ${describe(rawDefinition.extract)} have no link and no id:`);
  console.log(dim('  they are not listings (often the menu or the footer, when the selector is a generic class).'));

  const report = await page.evaluate(analyzePage, {
    saveSearchText: SAVE_SEARCH_TEXT_RE.source,
    closeName: CLOSE_NAME_RE.source
  });
  const { extract } = buildDraft(report).definition;
  let found = 0;
  if (extract) {
    try {
      found = (await listingsOf(page, { ...rawDefinition, extract }, file)).filter(Boolean).length;
    } catch {
      found = 0;
    }
  }
  if (found <= listings.length - others) {
    console.log(`${mark.info} Fix "extract" by hand (see README, "Writing a definition"), then run check-site again.`);
    return null;
  }

  console.log(`\n${mark.ok} analyze-page now finds ${bold(found)} listings with ${describe(extract)} and these fields:`);
  for (const [name, spec] of Object.entries(extract.fields)) console.log(`    ${name.padEnd(12)} ${dim(JSON.stringify(spec))}`);
  if (/^no?$/i.test(await ask(`${cyan('?')} Use them in place of the current "extract"? ${dim('[Y/n]')} `))) return null;

  rawDefinition.extract = extract;
  return { name: 'extract', summary: `replaced: ${found} listings instead of ${listings.length - others}` };
}

// The text of a listing and, for a typed value, the candidate specs reading it. Reads the current
// extract block, which checkListings may replace.
const locatorFor = (page, rawDefinition) => (index, value) => {
  const { type, item, script, items } = rawDefinition.extract;
  return page.evaluate(analyzePage, { locate: { type, item, script, items, index, value } });
};

// The words around the excluded word, so that a listing is recognisable even when its title is
// only the town: "…affittasi ufficio al 1° piano…".
function wordContext(listing, word, around = 4) {
  const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const tokens = [listing.title, listing.description].filter(Boolean).join(' ').split(/\s+/);
  const first = fold(word.trim().split(/\s+/)[0]);
  const at = tokens.findIndex(token => fold(token).replace(/^[^\p{L}\p{N}]+/u, '').startsWith(first));
  if (at < 0) return '';
  const from = Math.max(0, at - around);
  const to = Math.min(tokens.length, at + around + 1);
  return `${from ? '…' : ''}${tokens.slice(from, to).join(' ')}${to < tokens.length ? '…' : ''}`;
}

// How many listings filters.excludeWords keeps out of the notifications, and which.
function printExcluded(listings, words) {
  const excluded = listings
    .map(listing => ({ listing, word: excludedWord(listing, words) }))
    .filter(({ word }) => word);
  if (!excluded.length) {
    console.log(`${mark.ok} No listing on this page has one of these words.`);
    return;
  }
  console.log(`${mark.info} On this page ${bold(excluded.length)} of ${listings.length} listing(s) would not be notified:`);
  for (const { listing, word } of excluded) {
    console.log(`    ${red('✗')} ${bold(`"${word}"`)}  ${dim(shorten(wordContext(listing, word) || listing.url, 80))}`);
  }
}

// "transitorio, Studenti ,, transitorio" -> ["transitorio", "Studenti"]
const parseWords = answer => [...new Set(answer.split(',').map(word => word.trim()).filter(Boolean))];

// filters.excludeWords: asks the words, and where the description is when the definition does not
// read it yet, then shows which listings of the page the words would keep out of the
// notifications. Returns the change for user/config.json (with stopped: true when the user stopped
// at the description: the words typed are kept), null, or "stop".
async function fixWordFilter(page, rawDefinition, file, changes) {
  heading('Word filter', 'filters.excludeWords in user/config.json');
  let current;
  try {
    current = loadConfig(defaults).config.filters.excludeWords ?? [];
  } catch (error) {
    console.log(`${mark.warn} Skipped: user/config.json cannot be read (${error.message.split('\n')[0]}).`);
    return null;
  }
  console.log(`${mark.info} Listings with one of these words in the title or the description are saved but not notified:`);
  console.log(dim('  useful when the portal has no filter for it (e.g. transitorio, studenti, uso ufficio).'));
  console.log(dim('  A word also finds the ones starting with it ("student" finds "studenti"); capitals and'));
  console.log(dim('  accents do not matter.'));
  console.log(`  Now: ${current.length ? bold(current.join(', ')) : dim('no words')}`);

  const answer = await ask(`${cyan('?')} ${bold('Words to exclude')}, separated by commas ` +
    `${dim(`(ENTER ${current.length ? 'keeps them' : 'skips'}, "-" removes all, "q" to stop)`)}: `);
  if (answer.toLowerCase() === 'q') return 'stop';
  const words = answer === '-' ? [] : answer ? parseWords(answer) : current;
  if (!words.length) {
    return current.length ? { name: 'excludeWords', summary: 'removed', was: current, words } : null;
  }

  let stopped = false;
  if (rawDefinition.extract.type === 'script') {
    console.log(dim('  With "extract.type": "script" your script decides the fields: add "description" there to'));
    console.log(dim('  search the descriptions too.'));
  } else {
    const descriptions = await fieldValues(page, rawDefinition, file, 'description');
    if (descriptions.every(value => value == null)) {
      console.log(`${mark.info} The definition does not read the description: the words are searched in the titles only.`);
      console.log(dim('  To search the descriptions too, show where the description is (ENTER to skip).'));
      const result = await fixField(page, rawDefinition, file, 'description', locatorFor(page, rawDefinition));
      stopped = result === 'stop';
      if (result && !stopped) {
        changes.push({ name: 'description', summary: `0 -> ${result.coverage}/${result.values.length}  ${JSON.stringify(result.spec)}` });
        rawDefinition.extract.fields.description = result.spec;
      }
    }

    if (!stopped) {
      console.log('');
      printExcluded((await listingsOf(page, rawDefinition, file)).filter(Boolean), words);
    }
  }

  const same = words.length === current.length && words.every((word, i) => word === current[i]);
  if (same) return stopped ? 'stop' : null;
  return { name: 'excludeWords', summary: JSON.stringify(words), was: current, words, stopped };
}

// The fields part of --fix. Returns "stop" when the user stopped the questions.
async function fixAllFields(page, rawDefinition, file, changes) {
  const locate = locatorFor(page, rawDefinition);

  const replaced = await checkListings(page, rawDefinition, file);
  if (replaced) changes.push(replaced);

  // Always-empty fields first, then the ones empty only in some listings. The description is
  // optional: it is asked by the word filter, which is the only one using it.
  const coverage = {};
  for (const field of FIELDS) coverage[field] = await fieldValues(page, rawDefinition, file, field);
  const todo = FIELDS
    .filter(field => field !== 'description' && coverage[field].some(value => value == null))
    .sort((a, b) => coverage[a].filter(v => v != null).length - coverage[b].filter(v => v != null).length);
  if (!todo.length) console.log(`\n${mark.ok} Every field is filled in every listing.`);

  for (const field of todo) {
    const before = await fieldValues(page, rawDefinition, file, field);
    const result = await fixField(page, rawDefinition, file, field, locate);
    if (result === 'stop') return 'stop';
    if (!result) continue;

    const count = list => list.filter(value => value != null).length;
    changes.push({
      name: field,
      summary: `${count(before)} -> ${result.coverage}/${result.values.length}  ${JSON.stringify(result.spec)}`,
      was: rawDefinition.extract.fields[field]
    });
    rawDefinition.extract.fields[field] = result.spec;
  }
  return null;
}

// ------------------------------------------------------------------
// Page selectors: next page, cookie banner, popups
// ------------------------------------------------------------------

const PAGE_SELECTORS = {
  next: {
    title: 'Next page',
    look: 'the button or link that opens the next page of results',
    example: 'Next, Successiva, ›'
  },
  cookie: {
    title: 'Cookie banner',
    look: 'the button that accepts the cookies',
    example: 'Accetta tutto, Accept all'
  },
  popups: {
    title: 'Popup',
    look: 'the button that closes it',
    example: '×, Chiudi, No grazie'
  }
};

// '<a> "Next" -> /rent?page=2': the element a locator finds, to tell a lookalike (a photo
// carousel's "next image" button) from the right one.
const describeLocated = locator => locator.evaluate(el => {
  const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const href = el.getAttribute('href');
  return `<${el.tagName.toLowerCase()}> "${name}"${href ? ` -> ${href}` : ''}`;
}).catch(() => '(not readable)');

// Paths with :nth-of-type break when the page layout changes a little.
const isPositionalSelector = selector => /:nth-of-type/.test(selector);

// The selectors finding the buttons or links that match `value`, checked with the same Playwright
// locators the scraper uses: the ones matching a single element first, positional ones last.
async function pageSelectorProposals(page, value) {
  const elements = await page.evaluate(analyzePage, { locate: { type: 'clickable', value } });
  const proposals = [];
  for (const element of elements) {
    for (const selector of element.selectors) {
      if (proposals.some(proposal => proposal.selector === selector)) continue;
      const count = await page.locator(selector).count().catch(() => 0);
      if (count) proposals.push({ selector, count, element });
    }
  }
  return proposals
    .sort((a, b) => (a.count !== 1) - (b.count !== 1) ||
      isPositionalSelector(a.selector) - isPositionalSelector(b.selector))
    .slice(0, MAX_PROPOSALS);
}

// Asks the text of a button or link and the selector to use. Returns it, null to skip, or "stop".
async function askPageSelector(page, kind) {
  const { look, example } = PAGE_SELECTORS[kind];
  console.log(`${mark.info} Find ${bold(look)} on the page. Type its text, its tooltip or a part of its link ${dim(`(e.g. ${example})`)}.`);

  for (;;) {
    const value = await ask(`${cyan('?')} ${bold(kind)} ${dim('(ENTER to skip, "q" to stop)')}: `);
    if (!value) return null;
    if (value.toLowerCase() === 'q') return 'stop';

    const proposals = await pageSelectorProposals(page, value);
    if (!proposals.length) {
      console.log(`  ${mark.fail} No button or link with "${value}" in its text, tooltip or link on this page.`);
      continue;
    }

    proposals.forEach(({ selector, count, element }, i) => {
      const target = `<${element.tag}> "${element.name}"${element.href ? ` -> ${shorten(element.href, 60)}` : ''}`;
      printProposal(i, selector, dim(`${count === 1 ? 'finds' : `finds ${count} elements, the first is`} ${target}`));
      if (isPositionalSelector(selector)) console.log(`     ${yellow('by position: it may break when the page changes a little')}`);
    });
    const choice = await askChoice(proposals.length);
    const chosen = proposals[Number(choice) - 1];
    if (chosen) return chosen.selector;
    if (!choice) return null;
    console.log(`  ${mark.warn} not a valid choice`);
  }
}

// A page has one next-page button and one cookie button, so they are replaced; selectors.popups
// is a list of close buttons, so the new one is added.
function setPageSelector(rawDefinition, kind, selector) {
  const selectors = rawDefinition.selectors ?? (rawDefinition.selectors = {});
  const was = selectors[kind];
  selectors[kind] = { next: [selector], cookie: selector, popups: [...new Set([].concat(was ?? [], selector))] }[kind];
  return { name: kind, summary: JSON.stringify(selectors[kind]), was };
}

async function fixPageSelectors(page, rawDefinition, file, changes) {
  const definition = validateDefinition(rawDefinition, { file });
  const site = new Site(definition, { url: page.url() }, { config: defaults, notifier: null });
  const todo = [];

  // The next-page button: when one is found, the user confirms it is the right one.
  const next = site.nextLocator(page);
  if ((await next.count()) === 0) {
    todo.push(['next', 'not found (fine if the results fit in one page)']);
  } else {
    heading('Next page', 'found');
    console.log(`  ${shorten(await describeLocated(next), 90)}`);
    const answer = await ask(`${cyan('?')} Is it the button or link to the next page of results? ${dim('[Y/n/q]')} `);
    if (answer.toLowerCase() === 'q') return;
    if (/^no?$/i.test(answer)) todo.push(['next', 'the one found is not right']);
  }

  const { cookie } = definition.selectors;
  if (!cookie || (await page.locator(cookie).count().catch(() => 0)) === 0) {
    todo.push(['cookie', `${cookie ? `"${cookie}" not found` : 'no selector'} (saved pages often miss the banner)`]);
  }

  // Popups the scraper would not close: neither a "save search" dialog nor in selectors.popups.
  if ((await site.popupCloseLocator(page).count()) === 0) {
    const report = await page.evaluate(analyzePage, {
      saveSearchText: SAVE_SEARCH_TEXT_RE.source,
      closeName: CLOSE_NAME_RE.source
    });
    // A layer without text is a backdrop, not something to close.
    const popup = report.popups.find(item => !item.isCookieBanner && item.text);
    if (popup) todo.push(['popups', `"${popup.text}" is not closed by the scraper`]);
  }

  for (const [kind, status] of todo) {
    heading(PAGE_SELECTORS[kind].title, status);
    const selector = await askPageSelector(page, kind);
    if (selector === 'stop') return;
    if (selector) changes.push(setPageSelector(rawDefinition, kind, selector));
  }
}

async function fixFields(page, definition) {
  if (!process.stdin.isTTY) throw new Error('--fix asks questions: run it in a terminal.');

  const { file } = definition;
  const original = fs.readFileSync(file, 'utf8');
  const rawDefinition = JSON.parse(original);
  const changes = [];
  let words = null;   // the change to filters.excludeWords, saved in user/config.json

  let stopped = null;
  if (definition.extract.type === 'script') {
    console.log(`\n${mark.info} With "extract.type": "script" the fields are read by your script: only the word filter and`);
    console.log('  the page selectors are checked.');
  } else {
    stopped = await fixAllFields(page, rawDefinition, file, changes);
  }
  if (!stopped) {
    const result = await fixWordFilter(page, rawDefinition, file, changes);
    if (result === 'stop' || result?.stopped) stopped = 'stop';
    if (result?.words) words = result;
  }
  if (!stopped) await fixPageSelectors(page, rawDefinition, file, changes);

  if (!changes.length && !words) {
    console.log(`\n${mark.ok} No changes.`);
    return;
  }

  heading('Changes');
  for (const { name, summary, was } of [...changes, ...(words ? [words] : [])]) {
    console.log(`  ${green('+')} ${bold(name.padEnd(12))} ${summary}`);
    if (was !== undefined) console.log(`    ${''.padEnd(12)} ${dim(`was: ${JSON.stringify(was)}`)}`);
  }
  const targets = [changes.length && file, words && 'user/config.json'].filter(Boolean).join(' and ');
  if (/^no?$/i.test(await ask(`${cyan('?')} Save to ${targets}? ${dim('[Y/n]')} `))) {
    console.log(`${mark.info} Nothing saved.`);
    return;
  }
  if (changes.length) writeDefinition(file, original, rawDefinition);
  if (words) setExcludeWords(defaults.paths.userDir, words.words);
  console.log(`${mark.ok} ${green('Saved.')} Run check-site again to see the result.`);
}

module.exports = { fixFields, compactSpec, rankCandidates, pageSelectorProposals, describeLocated, printExcluded, wordContext };
