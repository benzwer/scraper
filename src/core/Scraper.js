const readline = require('node:readline/promises');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const { delay, sleep, rand, shuffle } = require('../utils/random');
const { createLogger } = require('../utils/logger');
const { passesFilters, formatListing } = require('../models/listing');

chromium.use(StealthPlugin());

// Orchestrator: opens the browser, goes through the sites one at a time, saves and notifies.
class Scraper {
  constructor({ config, sites, store, notifier }) {
    this.config = config;
    this.sites = sites;
    this.store = store;
    this.notifier = notifier;
    this.log = createLogger('Scraper');
  }

  async runOnce({ interactive = false } = {}) {
    const { config, store } = this;

    const context = await chromium.launchPersistentContext(config.paths.profileDir, {
      headless: config.browser.headless,
      viewport: null,
      locale: config.browser.locale,
      timezoneId: config.browser.timezoneId,
      args: config.browser.args
    });

    const allListings = [];

    try {
      const order = shuffle(this.sites);

      for (let i = 0; i < order.length; i++) {
        const site = order[i];
        const firstRun = !store.hasSource(site.name);
        const maxPages = firstRun ? config.pages.firstRun : config.pages.incremental;

        this.log.info(`${site.name}: ${maxPages} page(s)${firstRun ? ' (first run)' : ''}`);

        const { listings } = await site.scrape(context, maxPages);
        allListings.push(...listings);

        const { added, duplicates } = store.registerMany(listings);
        this.log.info(
          `${site.name}: ${listings.length} read, ${added.length} new, ` +
          `${duplicates.length} already seen on other portals`
        );

        // The cross-portal match is only a heuristic, so duplicates are still notified (labelled)
        // rather than risk silently dropping a different flat with the same numbers.
        await this.notifyNew(site.name, [...added, ...duplicates], firstRun);
        await store.save();

        if (i < order.length - 1) {
          this.log.info('Pausing before the next portal...');
          await delay(...config.timing.pauseBetweenSitesMs);
        }
      }

      await store.exportRun(allListings);

      this.log.info(`Run finished: ${allListings.length} listings read in total.`);

      if (interactive) {
        console.log('\nThe browser stays open. Press ENTER in the terminal to close it.');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await rl.question('');
        rl.close();
      }
    } finally {
      await context.close().catch(() => {});
      this.log.info('Browser closed.');
    }

    return { listings: allListings };
  }

  async notifyNew(siteName, added, firstRun) {
    const { notify, filters } = this.config;

    if (firstRun && !notify.onFirstRun) {
      if (added.length) {
        this.log.info(`${siteName}: first run, ${added.length} listings recorded without notification.`);
      }
      return;
    }

    const relevant = added.filter(listing => passesFilters(listing, filters));
    if (relevant.length === 0) return;

    if (relevant.length <= notify.maxIndividual) {
      for (const listing of relevant) await this.notifier.send(formatListing(listing));
      return;
    }

    const lines = relevant
      .slice(0, notify.digestSize)
      .map(listing => {
        const { message, url } = formatListing(listing);
        return `• ${message}\n${url || ''}`;
      })
      .join('\n');

    await this.notifier.send({
      title: `${siteName}: ${relevant.length} new listings`,
      message: lines
    });
  }

  // Periodic low-frequency runs, daytime only.
  async watch() {
    const { watch } = this.config;

    for (;;) {
      const hour = new Date().getHours();
      const [from, to] = watch.activeHours;

      if (hour < from || hour >= to) {
        this.log.info(`Outside active hours (${from}:00-${to}:00). Checking again in 15 minutes.`);
        await sleep(15 * 60 * 1000);
        continue;
      }

      try {
        await this.runOnce({ interactive: false });
      } catch (error) {
        this.log.error(`Run failed: ${error.message}`);
      }

      const minutes = rand(...watch.intervalMinutes);
      this.log.info(`Next run in ${Math.round(minutes)} minutes.`);
      await sleep(minutes * 60 * 1000);
    }
  }
}

module.exports = { Scraper };
