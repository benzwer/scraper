const fs = require('node:fs/promises');
const path = require('node:path');

const { HumanBehavior } = require('../human/HumanBehavior');
const { delay } = require('../utils/random');
const { createLogger } = require('../utils/logger');
const { normalizeListing } = require('../models/listing');
const { extractListings } = require('./extract');

// Common "next page" controls, in English and Italian. A site definition can add its own
// through selectors.next.
const DEFAULT_NEXT_CSS = [
  'a[rel="next"]',
  'a[aria-label*="successiva" i]',
  'button[aria-label*="successiva" i]',
  'a[aria-label*="next" i]',
  'button[aria-label*="next" i]',
  'a[title*="successiva" i]',
  'a[title*="next" i]'
];

const NEXT_NAME_RE = /^(pagina )?(successiva|avanti|next)$|^[›»→]$/i;

// One portal + one search. Everything portal-specific comes from the site definition
// (a validated JSON file, see definitions.js); the flow itself is the same for every portal.
class Site {
  constructor(definition, search, { config, notifier }) {
    this.definition = definition;
    this.search = search;
    this.config = config;
    this.notifier = notifier;
    this.name = definition.name;
    this.log = createLogger(this.name);
    this.selectors = definition.selectors;
  }

  // Runs the extraction inside the page and returns the raw listings.
  extractRaw(page) {
    const { extract } = this.definition;
    if (extract.type === 'script') return page.evaluate(extract.fn, extract.options);
    return page.evaluate(extractListings, extract);
  }

  async waitReady(page) {
    if (!this.selectors.ready) throw new Error('selectors.ready is missing');
    await page.locator(this.selectors.ready).first().waitFor({
      state: 'attached',
      timeout: this.config.timing.readyTimeout
    });
  }

  // ------------------------------------------------------------------
  // Scraping flow
  // ------------------------------------------------------------------

  async scrape(context, maxPages) {
    const { timing } = this.config;
    const { homeUrl } = this.definition;
    const { url } = this.search;

    const results = [];
    const seen = new Set();

    // Reuse the initial blank tab if it is still there.
    const page =
      context.pages().find(p => p.url() === 'about:blank') ||
      (await context.newPage());
    const human = new HumanBehavior(page, timing);

    try {
      // If the cookie banner shows up while doing something else, close it.
      if (this.selectors.cookie) {
        await page.addLocatorHandler(page.locator(this.selectors.cookie), async button => {
          await delay(700, 1800);
          await human.click(button);
        });
      }

      // Start from the home page like a person would, then go to the search.
      if (homeUrl) {
        await page.goto(homeUrl, {
          waitUntil: 'domcontentloaded',
          timeout: timing.navigationTimeout
        });
        await delay(2500, 5000);
        await this.acceptCookies(page, human);
        await human.idleJitter();
        await delay(1500, 3500);
      }

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timing.navigationTimeout,
        referer: homeUrl || undefined
      });

      for (let p = 1; p <= maxPages; p++) {
        this.log.info(`Page ${p}: ${page.url()}`);

        if (!(await this.waitForListings(page))) {
          this.log.warn('Listings not found on the page: saving debug files.');
          await this.saveDebug(page, 'no-listings');
          break;
        }

        await delay(1200, 3000);
        await this.acceptCookies(page, human);
        await human.readingScroll();

        let pageData = this.normalizeAll(await this.extractRaw(page));

        if (pageData.length === 0) {
          this.log.warn('No listings extracted: saving debug files.');
          await this.saveDebug(page, 'no-extract');
          break;
        }

        let added = this.addUnique(results, seen, pageData);

        // With client-side navigation the embedded data can go stale: a reload (F5) refreshes it.
        if (p > 1 && added === 0 && this.definition.reloadIfStale) {
          this.log.info('Data unchanged after the page change: reloading.');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: timing.navigationTimeout });
          await delay(1500, 3000);
          pageData = this.normalizeAll(await this.extractRaw(page));
          added = this.addUnique(results, seen, pageData);
        }

        if (p > 1 && added === 0) {
          this.log.info('No new listings on this page. Stopping.');
          break;
        }

        this.log.info(`Listings on page: ${pageData.length} (new in this run: ${added})`);

        if (p >= maxPages) break;

        if (Math.random() < 0.5 && this.selectors.items) {
          await human.hoverRandom(this.selectors.items);
        }

        await human.pause(timing.pauseBeforeNextPageMs);

        if (!(await this.goToNextPage(page, human))) break;
      }
    } catch (error) {
      this.log.error(error.message);
    }

    // The tab stays open.
    return { listings: results };
  }

  // Waits for the listings to appear on the page. Returns true/false.
  async waitForListings(page) {
    const deadline = Date.now() + this.config.timing.listingsWaitMs;

    do {
      try {
        await this.waitReady(page);
        return true;
      } catch (error) {
        // Only timeouts are worth retrying; anything else (e.g. a config error) would spin.
        if (error.name !== 'TimeoutError') throw error;
      }
    } while (Date.now() < deadline);

    return false;
  }

  async acceptCookies(page, human) {
    if (!this.selectors.cookie) return;
    const button = page.locator(this.selectors.cookie);

    if (await button.isVisible().catch(() => false)) {
      await delay(800, 2000);
      await human.click(button).catch(() => {});
      await delay(600, 1500);
    }
  }

  nextLocator(page) {
    const css = [...DEFAULT_NEXT_CSS, ...this.selectors.next].join(', ');

    return page
      .locator(css)
      .or(page.getByRole('link', { name: NEXT_NAME_RE }))
      .first();
  }

  async goToNextPage(page, human) {
    const next = this.nextLocator(page);

    const usable =
      (await next.isVisible().catch(() => false)) &&
      (await next.isEnabled().catch(() => false)) &&
      (await next.getAttribute('aria-disabled').catch(() => null)) !== 'true';

    if (!usable) {
      this.log.info('No next page available.');
      return false;
    }

    const previousUrl = page.url();
    const href = await next.getAttribute('href').catch(() => null);

    if (href && new URL(href, previousUrl).href === previousUrl) {
      this.log.info('The button points to the current page.');
      return false;
    }

    this.log.info('Clicking the next page button...');

    try {
      // The wait must be registered before the click so the navigation is not missed.
      const navigation = page
        .waitForURL(url => url.href !== previousUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timing.navigationTimeout
        })
        .catch(() => null);

      await human.click(next);
      await navigation;

      if (page.url() === previousUrl) {
        this.log.info('The page did not change after the click. Stopping.');
        return false;
      }

      await delay(1200, 2800);
      return true;
    } catch (error) {
      this.log.error(`Error while changing page: ${error.message}`);
      return false;
    }
  }

  normalizeAll(rawItems) {
    return (rawItems || [])
      .map(raw => normalizeListing(raw, this.name))
      .filter(Boolean);
  }

  addUnique(results, seen, pageData) {
    let added = 0;

    for (const item of pageData) {
      const key = item.id ?? item.url;
      if (key == null || seen.has(String(key))) continue;

      seen.add(String(key));
      results.push(item);
      added++;
    }

    return added;
  }

  async saveDebug(page, tag) {
    try {
      const dir = path.join(this.config.paths.dataDir, 'debug');
      await fs.mkdir(dir, { recursive: true });

      const base = path.join(dir, `${this.name}_${tag}`.replace(/[^a-z0-9_.-]/gi, '_'));
      this.log.info(`Page title: "${await page.title()}" | URL: ${page.url()}`);

      await page.screenshot({ path: `${base}.png` });
      await fs.writeFile(`${base}.html`, await page.content(), 'utf8');
      this.log.info(`Debug saved to ${base}.png / .html`);
    } catch (error) {
      this.log.warn(`Debug failed: ${error.message}`);
    }
  }
}

module.exports = { Site };
