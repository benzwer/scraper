// check-site --fix: for every field that is empty in some listings, shows the text of one of those
// listings, asks the value the user sees in it and proposes ways to read it (selector, attribute,
// regex or JSON path). Each proposal is tried with the scraper's own extractor on the whole page,
// so its coverage is what the scraper will get. The chosen ones are saved after confirmation.
const fs = require('node:fs');

const { analyzePage, buildDraft } = require('../sites/analyze');
const { SAVE_SEARCH_TEXT_RE, CLOSE_NAME_RE } = require('../sites/Site');
const { extractListings } = require('../sites/extract');
const { validateDefinition, FIELDS } = require('../sites/definitions');
const { normalizeListing } = require('../models/listing');
const { ask } = require('./ask');

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
  city: 'the town (e.g. Springfield)'
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
      console.log(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) console.log(indent + line);
}

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
  console.log(`\n== ${field}: empty in ${values.length - filled} of ${values.length} listings ==`);

  const { text } = await locate(index, null);
  if (!text) return null;
  console.log(`Text of listing ${index + 1}, one where ${field} is empty:`);
  printWrapped(`"${text}"`);
  console.log(`Find ${HINTS[field]} in the text above and type it as written there.`);

  for (;;) {
    const value = await ask(`${field} (ENTER to skip this field, "q" to stop): `);
    if (!value) return null;
    if (value.toLowerCase() === 'q') return 'stop';
    if (NUMERIC.includes(field) && expectedValue(field, value) == null) {
      console.log(`  ${field} is a number: type it as in the text above (e.g. "${field === 'price' ? '1.200 €' : '4'}").`);
      continue;
    }

    const { candidates } = await locate(index, value);
    const proposals = await rankCandidates(page, rawDefinition, file, { field, index, typed: value }, candidates);
    if (!proposals.length) {
      console.log(`  "${value}" was not found in this listing. Type it exactly as in the text above;`);
      console.log('  if it is not there, the page does not have it (e.g. it is only on the detail page).');
      continue;
    }

    proposals.forEach((proposal, i) => {
      console.log(`  ${i + 1}. ${describeSpec(proposal.spec)}`);
      console.log(`     ${proposal.coverage}/${values.length} listings  -> ${samples(proposal.values)}`);
      if (isPositional(proposal.spec)) {
        console.log('     by position: where a listing lacks an element, it may read the wrong one');
      }
    });
    const choice = await ask(`Choose [1-${proposals.length}], or ENTER to skip: `);
    const chosen = proposals[Number(choice) - 1];
    if (chosen) return chosen;
    if (!choice) return null;
    console.log('  not a valid choice');
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
  console.log(`\n${others} of the ${listings.length} blocks found by ${describe(rawDefinition.extract)} have no link and no id:`);
  console.log('they are not listings (often the menu or the footer, when the selector is a generic class).');

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
    console.log('Fix "extract" by hand (see README, "Writing a definition"), then run check-site again.');
    return null;
  }

  console.log(`\nanalyze-page now finds ${found} listings with ${describe(extract)} and these fields:`);
  for (const [name, spec] of Object.entries(extract.fields)) console.log(`  ${name.padEnd(8)} ${JSON.stringify(spec)}`);
  if (/^no?$/i.test(await ask('Use them in place of the current "extract"? [Y/n] '))) return null;

  rawDefinition.extract = extract;
  return { name: 'extract', summary: `replaced: ${found} listings instead of ${listings.length - others}` };
}

async function fixFields(page, definition) {
  if (definition.extract.type === 'script') {
    console.log('\n--fix works with css and json definitions: with "script" the fields are read by your script.');
    return;
  }
  if (!process.stdin.isTTY) throw new Error('--fix asks questions: run it in a terminal.');

  const { file } = definition;
  const original = fs.readFileSync(file, 'utf8');
  const rawDefinition = JSON.parse(original);
  // Reads the current extract block, which checkListings may replace.
  const locate = (index, value) => {
    const { type, item, script, items } = rawDefinition.extract;
    return page.evaluate(analyzePage, { locate: { type, item, script, items, index, value } });
  };

  const changes = [];
  const replaced = await checkListings(page, rawDefinition, file);
  if (replaced) changes.push(replaced);

  // Always-empty fields first, then the ones empty only in some listings.
  const coverage = {};
  for (const field of FIELDS) coverage[field] = await fieldValues(page, rawDefinition, file, field);
  const todo = FIELDS
    .filter(field => coverage[field].some(value => value == null))
    .sort((a, b) => coverage[a].filter(v => v != null).length - coverage[b].filter(v => v != null).length);
  if (!todo.length) console.log('\nEvery field is filled in every listing.');

  for (const field of todo) {
    const before = await fieldValues(page, rawDefinition, file, field);
    const result = await fixField(page, rawDefinition, file, field, locate);
    if (result === 'stop') break;
    if (!result) continue;

    const count = list => list.filter(value => value != null).length;
    changes.push({
      name: field,
      summary: `${count(before)} -> ${result.coverage}/${result.values.length}  ${JSON.stringify(result.spec)}`,
      was: rawDefinition.extract.fields[field]
    });
    rawDefinition.extract.fields[field] = result.spec;
  }

  if (!changes.length) {
    console.log('\nNo changes.');
    return;
  }

  console.log('\n== Changes ==');
  for (const { name, summary, was } of changes) {
    console.log(`  ${name.padEnd(8)} ${summary}`);
    if (was !== undefined) console.log(`  ${''.padEnd(8)} was: ${JSON.stringify(was)}`);
  }
  if (/^no?$/i.test(await ask(`Save to ${file}? [Y/n] `))) {
    console.log('Nothing saved.');
    return;
  }
  writeDefinition(file, original, rawDefinition);
  console.log('Saved. Run check-site again to see the result.');
}

module.exports = { fixFields, compactSpec, rankCandidates };
