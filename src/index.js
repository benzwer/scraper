require('dotenv').config();
const path = require('node:path');

const defaults = require('../config/default');

const { loadConfig } = require('./core/config');
const { ResultStore } = require('./core/ResultStore');
const { Scraper } = require('./core/Scraper');
const { Notifier } = require('./notify/Notifier');
const { createSites } = require('./sites');
const { loadSiteDefinitions } = require('./sites/definitions');
const { createLogger } = require('./utils/logger');

async function main() {
  const log = createLogger('main');
  const watch = process.argv.includes('--watch');
  const retryBlocked = process.argv.includes('--retry-blocked');

  const { config, searches } = loadConfig(defaults);
  // A site whose definition is not valid yet is skipped with its search; the others still run.
  const skipped = new Set();
  const definitions = loadSiteDefinitions(path.join(config.paths.userDir, 'sites'), {
    onInvalid: (error, id) => {
      skipped.add(id);
      log.warn(`Site "${id}" skipped: its definition is not valid.\n${error.message}`);
    }
  });
  const runnable = searches.filter(search => !skipped.has(search.site));

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
  console.error('Fatal error:', error);
  process.exit(1);
});
