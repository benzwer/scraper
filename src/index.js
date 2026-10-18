require('dotenv').config();
const path = require('node:path');

const defaults = require('../config/default');

const { loadConfig } = require('./core/config');
const { ResultStore } = require('./core/ResultStore');
const { Scraper } = require('./core/Scraper');
const { Notifier } = require('./notify/Notifier');
const { createSites, searchesForSites } = require('./sites');
const { loadSiteDefinitions } = require('./sites/definitions');
const { createLogger, setLogDir } = require('./utils/logger');
const { generalHelp } = require('./tools/help');

const log = createLogger('main');

// The values of every --site option ("--site a --site b" or "--site a,b").
function siteArgs(argv) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--site') continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error('--site: a site id or name is required');
    values.push(...value.split(',').map(item => item.trim()).filter(Boolean));
  }
  return values;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(generalHelp());
    return;
  }

  const watch = process.argv.includes('--watch');
  const retryBlocked = process.argv.includes('--retry-blocked');
  const wanted = siteArgs(process.argv.slice(2));

  const { config, searches } = loadConfig(defaults);
  setLogDir(config.paths.logDir);
  // A site whose definition is not valid yet is skipped with its search; the others still run.
  const skipped = new Set();
  const definitions = loadSiteDefinitions(path.join(config.paths.userDir, 'sites'), {
    onInvalid: (error, id) => {
      skipped.add(id);
      log.warn(`Site "${id}" skipped: its definition is not valid.\n${error.message}`);
    }
  });
  let runnable = searches.filter(search => !skipped.has(search.site));
  if (wanted.length) {
    const chosen = searchesForSites(searches, definitions, wanted, { invalid: skipped });
    for (const name of chosen.forced) log.info(`${name}: its search is disabled, run because asked with --site.`);
    runnable = chosen.searches;
  }

  const store = new ResultStore(config.paths.dataDir, config.store);
  await store.load();

  const notifier = new Notifier();
  log.info(`Notifications: ${notifier.describeChannels()}`);

  const sites = createSites(runnable, definitions, { config, notifier });
  if (sites.length === 0) {
    throw new Error(skipped.size
      ? 'No site to run: the enabled searches use only sites whose definition is not valid (see above)'
      : 'No enabled searches in user/config.json');
  }
  log.info(`Active sites: ${sites.map(site => site.name).join(', ')}`);

  const scraper = new Scraper({ config, sites, store, notifier });

  process.on('SIGINT', async () => {
    log.info('Interrupt requested: saving and exiting.');
    await store.save().catch(() => {});
    process.exit(0);
  });

  if (watch) {
    await scraper.watch();
  } else {
    await scraper.runOnce({ interactive: true, retryBlocked });
  }
}

main().catch(error => {
  log.error('Fatal error:', error);
  process.exit(1);
});
