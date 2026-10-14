# Rental Listings Scraper

Watches the rental portals you choose, remembers every listing it has already seen and
sends a notification to your phone (ntfy or Telegram) **only for the new ones**.

- **Any portal, no code:** you describe a portal in a small JSON file (which elements are the
  listings, where the price is, …). A JavaScript escape hatch covers the odd cases.
- **Gentle browsing:** a real Chromium window, human-like mouse movements and scrolling,
  random pauses, low frequency, active hours only.
- **Useful notifications:** filters on price, surface and rooms; a digest instead of a flood;
  listings that look like the same flat on another portal are labelled as possible duplicates.
- **Your data stays yours:** your searches and site definitions live in `user/`, which is
  never committed.

> **Use it responsibly.** Many portals forbid automated access in their terms of use. This
> project ships **no** definitions for real portals: you write your own, for your own personal
> use, and you are responsible for respecting the terms of the sites you visit. Keep the
> frequency and volume low (the defaults read 1 page per site every 30-60 minutes).

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Configuration: `user/config.json`](#configuration-userconfigjson)
- [Notifications: `.env`](#notifications-env)
- [Site definitions: `user/sites/*.json`](#site-definitions-usersitesjson)
- [Writing a definition, step by step](#writing-a-definition-step-by-step)
- [When a site stops working](#when-a-site-stops-working)
- [Commands](#commands)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Requirements

- Node.js 18 or later
- A desktop session: the browser runs in a visible window (portals block headless browsers
  much more often)

## Quick start

```bash
git clone <this repository>
cd <repository folder>
npm install
npx playwright install chromium
npm run setup
```

`npm run setup` copies the examples into a `user/` folder and creates `.env`. It never
overwrites a file that already exists. Then:

1. **Describe your portals** in `user/sites/`: one JSON file per portal. Start from the
   `*-example.json` files and read [Site definitions](#site-definitions-usersitesjson).
2. **Add your searches** to `user/config.json`: open the portal in your browser, run the search
   with your filters (city, rooms, price, *newest first*), and copy the URL of the results page.
3. **Check each definition** on a page saved from the portal (no requests are sent):
   ```bash
   npm run check-site -- my-portal saved-page.html
   ```
4. **Choose a notification channel** in `.env` (see [Notifications](#notifications-env)).
5. **Run it:**
   ```bash
   npm start          # one run; the browser stays open until you press ENTER
   npm run watch      # keeps running: one run every 30-60 minutes, 07:00-22:00
   ```

The first run of each portal **only records** the listings that are already online, without
notifying you (otherwise you would get dozens of messages). From the second run on, every new
listing that passes your filters is sent to your phone.

## How it works

For every enabled search, in random order and with a pause between portals:

1. opens the portal's home page (if `homeUrl` is set), accepts the cookie banner, then goes to
   your search URL, as a person would;
2. waits for the listings, scrolls through the page "reading" it, and extracts the listings
   with the site definition;
3. moves to the next page by clicking the "next" button (2 pages on a portal's first run, then
   1: new listings appear at the top when the search is sorted by newest);
4. compares the listings with `data/seen.json`: only never-seen ones are notified;
5. saves everything (`data/seen.json`, plus `data/latest.json` with the listings of the run).

**Possible duplicates:** a listing with the same price, surface and rooms as one already seen on
*another* portal is still notified, marked `possible duplicate of <portal>`.

**Cleanup:** listings not seen for 90 days are removed from `data/seen.json`
(`store.retentionDays`).

## Configuration: `user/config.json`

```json
{
  "searches": [
    { "site": "my-portal", "url": "https://www.my-portal.example/rent/springfield?sort=newest" },
    { "site": "other-portal", "url": "https://www.other-portal.example/search?city=springfield", "enabled": false }
  ],
  "filters": { "maxPrice": 1300, "minRooms": 2 }
}
```

**`searches`** (required): one entry per portal.

| Key       | Required | Meaning |
|-----------|----------|---------|
| `site`    | yes      | `id` of a site definition in `user/sites/` |
| `url`     | yes      | URL of the search results page |
| `enabled` | no       | `false` skips the search without deleting it |

Only **one search per portal** is allowed (the portal's name identifies its listings in
`data/seen.json`): put all your criteria in that one URL.

**Every other key** overrides the defaults in [`config/default.js`](config/default.js). Objects
are merged, so you only write what you change. Unknown keys are reported as errors, to catch
typos.

| Setting | Default | Meaning |
|---------|---------|---------|
| `filters.maxPrice` | `null` | Notify only listings up to this price. `null` = no limit |
| `filters.minSurface` | `null` | Minimum surface in m² |
| `filters.minRooms` / `filters.maxRooms` | `null` | Room range |
| `pages.firstRun` / `pages.incremental` | `2` / `1` | Pages read on a portal's first run / afterwards |
| `notify.onFirstRun` | `false` | `true` notifies every listing found on the first run too |
| `notify.maxIndividual` | `5` | Above this many new listings, send one digest instead |
| `notify.digestSize` | `10` | Listings shown in a digest |
| `watch.intervalMinutes` | `[30, 60]` | Random interval between runs in `npm run watch` |
| `watch.activeHours` | `[7, 22]` | Runs only between these hours |
| `store.retentionDays` | `90` | Forget listings not seen for this many days. `null` = never |
| `browser.locale` / `browser.timezoneId` | `"it-IT"` / `"Europe/Rome"` | Set them to the country of your portals |
| `timing.*` | see file | Pauses and timeouts, in milliseconds |

Filters only affect **notifications**: every listing is still saved. A listing with a missing
value (e.g. no surface) passes the corresponding filter.

## Notifications: `.env`

Fill in at least one channel. With none, notifications are only printed in the terminal.

- **ntfy** (simplest): install the [ntfy](https://ntfy.sh) app, subscribe to a topic with a
  long, hard-to-guess name, and set `NTFY_TOPIC=that-name`. For a self-hosted server, also set
  `NTFY_SERVER`.
- **Telegram**: create a bot with [@BotFather](https://t.me/BotFather), send it a message, then
  set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (your chat id is in
  `https://api.telegram.org/bot<token>/getUpdates`).

## Site definitions: `user/sites/*.json`

A site definition tells the scraper how to read one portal. Every `*.json` file in
`user/sites/` is loaded and validated at startup; any mistake is reported with the file name
and the exact key.

Three examples, each matching a test page in `tests/fixtures/`:

| Example | Extraction | When to use it |
|---------|------------|----------------|
| [`cards-example.json`](examples/sites/cards-example.json) | `css` | Each listing is an HTML element (a "card") |
| [`embedded-json-example.json`](examples/sites/embedded-json-example.json) | `json` | The page embeds its results as JSON in a `<script>` (common with Next.js and similar) |
| [`script-example.json`](examples/sites/script-example.json) | `script` | Neither of the above is enough |

Tip: open the portal, *View page source*, and search for a price you can see on screen. If it
appears inside a `<script>` tag, the `json` type is usually more robust than CSS selectors.

### Top level

| Key | Required | Meaning |
|-----|----------|---------|
| `id` | yes | Lowercase letters, digits and dashes (`"my-portal"`), used in `searches` |
| `name` | yes | Shown in logs and notifications |
| `description` | no | Free text for your own notes |
| `homeUrl` | no | Visited before the search, like a person would. Also the base URL for `check-site` |
| `reloadIfStale` | no | `true` reloads the page when page 2 shows the same data as page 1 (for sites that change page without reloading) |
| `selectors` | no | See below |
| `extract` | yes | How to read the listings, see below |

### `selectors`

All values are [Playwright selectors](https://playwright.dev/docs/other-locators): standard
CSS plus extras such as `:has-text("Next")` and `:text-is("Next")`.

| Key | Default | Meaning |
|-----|---------|---------|
| `ready` | `extract.item` (css) or `extract.script` (json); **required** for `script` | Element meaning "the listings are on the page" |
| `items` | `extract.item` (css) | A listing, hovered now and then to look human |
| `cookie` | none | The cookie banner's *accept* button |
| `next` | `[]` | Extra selectors for the *next page* button. Common ones (`rel="next"`, "Next", "Successiva", `›`, …) are already tried |

### Fields

Each extraction produces these fields. Only `url` **or** `id` is required; the others make
filters, duplicate detection and notifications work better.

| Field | Content | Parsing |
|-------|---------|---------|
| `id` | The portal's listing id | Used to recognise a listing between runs (falls back to `url`) |
| `url` | Link to the listing | |
| `title` | Title | |
| `price` | Monthly price | Text like `€ 1.200/mese`, `$1,200` or `1.250,50` becomes a whole number (`1200`, `1250`); a number is kept |
| `surface` | Surface | `85 m²`, `72,5 mq` or a bare `85` |
| `rooms` | Rooms | First number found: `3 rooms`, `4+`, `3 locali` |
| `city` | City or area | |

Every field can also have:

- **`match`**: a regular expression (case-insensitive) applied to the value. The first
  capturing group is kept, or the whole match if there is no group. No match gives `null`.
  Remember to double the backslashes in JSON: `"(\\d+)\\s*m²"`.
- **`template`**: a string where `{}` is replaced by the value, e.g. to build a URL from an id:
  `"https://www.my-portal.example/listing/{}"`.

### `extract.type: "css"`

```json
"extract": {
  "type": "css",
  "item": ".listing-card",
  "fields": {
    "id": { "attr": "data-id" },
    "url": { "selector": "a.listing-card__link", "attr": "href" },
    "title": ".listing-card__title",
    "price": ".listing-card__price",
    "rooms": { "selector": ".listing-card__features", "match": "(\\d+)\\s*rooms?" }
  }
}
```

- `item`: CSS selector matching **each** listing.
- A field is either a CSS selector string (its text is used) or an object:

| Key | Meaning |
|-----|---------|
| `selector` | CSS selector *inside the item*. Omit it to use the item itself |
| `attr` | Read this attribute instead of the text. Relative `href`/`src` become absolute URLs |
| `match`, `template` | See [Fields](#fields) |

To pick a value out of a block of text (e.g. a features list with surface and rooms), point
`selector` at the block and use `match`.

### `extract.type: "json"`

```json
"extract": {
  "type": "json",
  "script": "script#search-data",
  "items": "page.sections[*].listings",
  "fields": {
    "id": "id",
    "url": { "path": "slug", "template": "https://www.my-portal.example/listing/{}" },
    "price": ["price.amount", "price.label"],
    "rooms": "details.rooms"
  }
}
```

- `script`: CSS selector of the `<script>` tag that contains the JSON.
- `items`: path to the **array** of listings. `[*]` goes through every element of an array: the
  first match that is an array is used.
- A field is a path (relative to one listing), an array of paths (the first one with a value
  wins: handy when a number is sometimes missing), or an object with `path`, `match`, `template`.

Path syntax: `a.b.c`, `list[0].name` (by position), `list[*].name` (every element).

### `extract.type: "script"`

```json
"selectors": { "ready": ".listing-card" },
"extract": {
  "type": "script",
  "file": "./my-portal.extract.js",
  "options": { "card": ".listing-card" }
}
```

`file` (relative to the JSON file) exports **one function that runs inside the page**. It
receives `options` and returns an array of objects with the [fields](#fields) above. It cannot
use `require` or variables defined outside the function. See
[`script-example.extract.js`](examples/sites/script-example.extract.js).

## Writing a definition, step by step

1. **Save a results page.** In the browser: *Save page as… → Web page, HTML only*. Or run the
   scraper once: when extraction fails, it saves the page to `data/debug/`.
2. **Find the listings.** Use the browser's developer tools (right click → *Inspect* on a
   listing) to find a selector that matches every card, or look for the JSON in the page source.
   Prefer stable names (`data-*` attributes, meaningful classes) over generated ones like
   `css-1x2y3z`.
3. **Write `user/sites/my-portal.json`**, starting from the closest example.
4. **Check it**, as many times as needed:
   ```bash
   npm run check-site -- my-portal path/to/saved-page.html
   ```
   It opens the page offline (scripts disabled, no network) and shows whether the `ready`
   element, the next-page button and the cookie button are found, how many listings were
   extracted, which fields are always empty, and the first listings. Options: `--show <n>`
   listings to print, `--base-url <url>` to resolve relative links (default: `homeUrl`).
   You can also pass a file path instead of the id: `npm run check-site -- ./draft.json page.html`.
5. **Add the search** to `user/config.json` and run `npm start` once, watching the browser.
6. **Optional: a regression test.** Put the saved page and a test in `tests/private/` (ignored by
   git, run by `npm test`). Copy the pattern in [`tests/examples.test.js`](tests/examples.test.js)
   and use `extractFromFile` from `tests/helpers/dom.js`.

## When a site stops working

Portals change their pages. When the listings do not appear or nothing is extracted, the
scraper logs a warning and saves a screenshot and the HTML in `data/debug/`
(`<Portal name>_no-listings.*` or `<Portal name>_no-extract.*`).

- **Screenshot shows a captcha or "access denied"**: the portal is blocking you. Wait, and
  reduce the frequency (`watch.intervalMinutes`).
- **Screenshot shows the listings**: the page structure changed. Run `check-site` on the saved
  HTML, fix the selectors, and check again.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run setup` | Creates `user/` and `.env` from the examples (never overwrites) |
| `npm start` | One run; the browser stays open until you press ENTER |
| `npm run watch` | Periodic runs within the active hours. Stop with Ctrl+C |
| `npm run check-site -- <id or file> <page.html>` | Tests a site definition offline |
| `npm test` | Unit tests, no network |

## Project structure

```
config/default.js           default settings (override them in user/config.json)
examples/                   example config and site definitions (copied by npm run setup)
src/index.js                entry point
src/core/config.js          loads user/config.json and merges it with the defaults
src/core/Scraper.js         orchestrator: portal order, pauses, saving, notifications, watch
src/core/ResultStore.js     listings already seen, cross-portal duplicates, cleanup
src/sites/definitions.js    loads and validates the site definitions
src/sites/extract.js        generic css/json extractor (runs in the page)
src/sites/Site.js           flow for one portal: home -> search -> cookies -> pages
src/sites/index.js          pairs the searches with their definitions
src/human/HumanBehavior.js  mouse, wheel, clicks and pauses
src/models/listing.js       common listing schema, parsing, filters
src/notify/Notifier.js      ntfy and Telegram
src/tools/                  setup and check-site commands
tests/                      unit tests and synthetic pages for the examples
user/                       YOUR config and site definitions (not versioned)
tests/private/              YOUR tests and saved pages (not versioned)
data/                       seen listings, last run, debug files (not versioned)
```

## Contributing

Bug reports and pull requests are welcome. Please:

- run `npm test` before opening a pull request, and add tests for new behaviour;
- keep the engine generic: **do not** submit definitions or saved pages of real portals;
- for a new extraction feature, extend an example in `examples/sites/` and its page in
  `tests/fixtures/`, so it is documented and tested at the same time.

## License

Released into the public domain under [The Unlicense](LICENSE).
