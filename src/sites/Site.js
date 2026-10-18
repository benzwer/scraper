const fs = require('node:fs/promises');
const path = require('node:path');

const { HumanBehavior } = require('../human/HumanBehavior');
const { delay } = require('../utils/random');
const { createLogger } = require('../utils/logger');
const { normalizeListing } = require('../models/listing');
const { extractListings } = require('./extract');
const { blockedStatus, findBlockSignal } = require('./blocking');

// Common "next page" controls, in English and Italian, used when the site definition has no
// selectors.next. A label must name the page or be just "next": a photo carousel in every card
// has buttons labelled "Immagine successiva" / "Next image".
const DEFAULT_NEXT_CSS = [
  'a[rel="next"]',
  ...['a', 'button'].flatMap(tag => [
    `${tag}[aria-label*="pagina successiva" i]`,
    `${tag}[aria-label*="next page" i]`,
    `${tag}[aria-label="successiva" i]`,
    `${tag}[aria-label="next" i]`
  ]),
  'a[title*="pagina successiva" i]',
  'a[title*="next page" i]',
  'a[title="successiva" i]',
  'a[title="next" i]'
];

const NEXT_NAME_RE = /^(pagina )?(successiva|avanti|next)$|^[›»→]$/i;

// "Save this search / get alerts" popups are closed without saving (saving usually needs an
// account). Only close buttons inside a dialog about saving the search are considered, so a
// permanent "Save search" button in the results toolbar is never touched.
const SAVE_SEARCH_TEXT_RE = /salva.{0,30}ricerc|ricerc.{0,30}salvat|save.{0,30}search|avvis|alert/i;
const CLOSE_NAME_RE =
  /^(chiudi|close)\b|^(annulla|cancel|no,? grazie|no,? thanks|non ora|not now|più tardi|later|x|×|✕|✖)$/i;
const POPUP_CLOSE_WAIT_MS = 5000;

// Playwright calls "visible" also an element parked outside the window, like the close button of
// a closed side menu (a dialog that can mention "saved searches"): it cannot be clicked.
async function isOnScreen(locator) {
  // isVisible does not wait; boundingBox would wait for a missing element.
  if (!(await locator.isVisible().catch(() => false))) return false;
  const box = await locator.boundingBox({ timeout: 1000 }).catch(() => null);
  if (!box || !box.width || !box.height) return false;
  const { width, height } = await locator.page().evaluate(() => ({ width: innerWidth, height: innerHeight }));
  return box.x < width && box.y < height && box.x + box.width > 0 && box.y + box.height > 0;
}

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

  // Returns why the page is a block page (captcha, bot check, ...) or null.
  // Only called when the listings are missing, so a captcha in an unrelated widget is ignored.
  async detectBlock(page) {
    for (const selector of this.selectors.blocked) {
      if (await page.locator(selector).count().catch(() => 0)) return `block page (${selector})`;
    }
    return page.evaluate(findBlockSignal).catch(() => null);
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
    let blocked = null;

    const stopIfBlocked = async reason => {
      if (!reason) return false;
      this.log.warn(`Access blocked (${reason}): stopping and saving debug files.`);
      await this.saveDebug(page, 'blocked');
      blocked = { reason };
      return true;
    };

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

      // Same for a "save this search" popup: the mouse moves to its close button and clicks it.
      // noWaitAfter: Playwright would otherwise wait, with no end, for a popup that does not go
      // away (or that was not on screen and was not clicked); clickPopupClose waits a bit itself.
      await page.addLocatorHandler(this.popupCloseLocator(page),
        button => this.clickPopupClose(button, human), { noWaitAfter: true });

      // Start from the home page like a person would, then go to the search.
      if (homeUrl) {
        const homeResponse = await page.goto(homeUrl, {
          waitUntil: 'domcontentloaded',
          timeout: timing.navigationTimeout
        });
        if (await stopIfBlocked(blockedStatus(homeResponse))) return { listings: results, blocked };
        await delay(2500, 5000);
        await this.acceptCookies(page, human);
        await human.idleJitter();
        await delay(1500, 3500);
      }

      const searchResponse = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timing.navigationTimeout,
        referer: homeUrl || undefined
      });
      if (await stopIfBlocked(blockedStatus(searchResponse))) return { listings: results, blocked };

      for (let p = 1; p <= maxPages; p++) {
        this.log.info(`Page ${p}: ${page.url()}`);

        if (!(await this.waitForListings(page))) {
          if (await stopIfBlocked(await this.detectBlock(page))) break;
          this.log.warn('Listings not found on the page: saving debug files.');
          await this.saveDebug(page, 'no-listings');
          break;
        }

        await delay(1200, 3000);
        await this.acceptCookies(page, human);
        await this.closeSaveSearchPopup(page, human);
        await human.readingScroll();

        let pageData = this.normalizeAll(await this.extractRaw(page));

        if (pageData.length === 0) {
          if (await stopIfBlocked(await this.detectBlock(page))) break;
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

    // The tab stays open. "blocked" is { reason } when the site refused access, otherwise null.
    return { listings: results, blocked };
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

  // The close button of a "save this search" popup, found by role and visible name, plus the
  // site's own selectors.popups for popups that are not marked as dialogs.
  popupCloseLocator(page) {
    let close = page
      .getByRole('dialog')
      .filter({ hasText: SAVE_SEARCH_TEXT_RE })
      .getByRole('button', { name: CLOSE_NAME_RE });

    if (this.selectors.popups.length) close = close.or(page.locator(this.selectors.popups.join(', ')));
    return close.first();
  }

  // The locator handler only fires before Playwright actions (e.g. clicking "next"): this closes
  // the popup as soon as the results are on screen, before scrolling through them.
  async closeSaveSearchPopup(page, human) {
    if (await this.clickPopupClose(this.popupCloseLocator(page), human)) await delay(600, 1500);
  }

  // Clicks a popup's close button if it is on screen, then waits a little for the popup to go.
  // Returns true when it clicked.
  async clickPopupClose(button, human) {
    if (!(await isOnScreen(button))) return false;

    this.log.info('Closing a "save search" popup...');
    await delay(700, 1800);
    await human.click(button).catch(() => {});
    await button.waitFor({ state: 'hidden', timeout: POPUP_CLOSE_WAIT_MS }).catch(() => {});
    return true;
  }

  // The site's own selectors.next when it has them: merged with the built-in ones, the first
  // match in page order would win, and that can be a lookalike earlier in the page.
  nextLocator(page) {
    if (this.selectors.next.length) return page.locator(this.selectors.next.join(', ')).first();

    return page
      .locator(DEFAULT_NEXT_CSS.join(', '))
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

module.exports = { Site, SAVE_SEARCH_TEXT_RE, CLOSE_NAME_RE, DEFAULT_NEXT_CSS };
