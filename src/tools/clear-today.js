// npm run clear-today -- [--site <id or name>] [--yes]
//
// Forgets the listings first seen today (local date), from every portal or from one: they are
// removed from data/seen.json, so the next run finds them again and notifies them as new.
// Run it while the scraper is stopped: a running "npm run watch" would overwrite the file.
const path = require('node:path');
const readline = require('node:readline/promises');

const defaults = require('../../config/default');
const { loadConfig } = require('../core/config');
const { ResultStore } = require('../core/ResultStore');
const { loadSiteDefinitions } = require('../sites/definitions');

const USAGE = 'Usage: npm run clear-today -- [--site <id or name>] [--yes]';

function parseArgs(argv) {
  const args = { site: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--site' && argv[i + 1]) args.site = argv[++i];
    else if (argv[i] === '--yes') args.yes = true;
    else throw new Error(USAGE);
  }
  return args;
}

const localDay = date => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Listings store the portal's name; --site also accepts the id of its definition.
function sourceNameOf(site, config) {
  const definitions = loadSiteDefinitions(path.join(config.paths.userDir, 'sites'), { onInvalid: () => {} });
  const wanted = site.toLowerCase();
  const definition = definitions.find(item => item.id === wanted || item.name.toLowerCase() === wanted);
  return definition ? definition.name : site;
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(y|yes|s|si|sì)$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { config } = loadConfig(defaults);

  const store = new ResultStore(config.paths.dataDir, config.store);
  await store.load();

  const today = localDay(Date.now());
  const fromToday = item => localDay(item.firstSeen) === today;
  const todays = Object.values(store.data.listings).filter(fromToday);

  const source = args.site ? sourceNameOf(args.site, config) : null;
  const selected = source
    ? todays.filter(item => item.source.toLowerCase() === source.toLowerCase())
    : todays;

  const counts = new Map();
  for (const item of todays) counts.set(item.source, (counts.get(item.source) || 0) + 1);

  if (!selected.length) {
    const found = [...counts].map(([name, count]) => `${name} (${count})`).join(', ') || 'none';
    console.log(`No listings first seen today (${today})${source ? ` for "${args.site}"` : ''}.`);
    console.log(`Portals with listings first seen today: ${found}`);
    return;
  }

  const sources = [...new Set(selected.map(item => item.source))];
  console.log(`Listings first seen today (${today}) that will be forgotten:`);
  for (const name of sources) console.log(`  ${name}: ${counts.get(name)}`);
  console.log('The next run finds them again and notifies them as new.');

  if (!args.yes && !(await confirm('Proceed? [y/N] '))) {
    console.log(process.stdin.isTTY ? 'Nothing changed.' : 'Nothing changed: add --yes to confirm without a terminal.');
    return;
  }

  const selectedSet = new Set(selected);
  const removed = store.removeWhere(item => selectedSet.has(item));
  await store.save();
  console.log(`Removed ${removed.length} listing(s) from ${path.relative(process.cwd(), store.file)}.`);

  // With no listings left, the next run of a portal counts as its first: it only records them.
  for (const name of sources) {
    if (!store.hasSource(name)) {
      console.log(`Note: ${name} has no listings left, so its next run only records them, without notifications.`);
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
