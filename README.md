# Rental Listings Scraper

Watches the rental portals you choose, remembers every listing it has already seen and
sends a notification to your phone (ntfy or Telegram) **only for the new ones**.

- **Any portal, no code:** you describe a portal in a small JSON file (which elements are the
  listings, where the price is, …). A JavaScript escape hatch covers the odd cases.
- **Gentle browsing:** a real Chromium window, human-like mouse movements and scrolling,
  random pauses, low frequency, active hours only.
- **Takes no for an answer:** when a portal shows a captcha or denies access, the scraper does
  not insist. It pauses that portal for hours and tells you.
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
- [When a portal blocks you](#when-a-portal-blocks-you)
- [Running on a server or VM](#running-on-a-server-or-vm)
- [Commands](#commands)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Requirements

- Node.js 18 or later
- A desktop session: the browser runs in a visible window (portals block headless browsers
  much more often). On a server without a desktop, see
  [Running on a server or VM](#running-on-a-server-or-vm)

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
   `*-example.json` files and read [Site definitions](#site-definitions-usersitesjson), or let
   `npm run analyze-page` draft one for you (see
   [Writing a definition](#writing-a-definition-step-by-step)).
2. **Add your searches** to `user/config.json`: open the portal in your browser, run the search
   with your filters (city, rooms, price, *newest first*), and copy the URL of the results page.
3. **Check each definition** on a page saved from the portal (no requests are sent):
   ```bash
   npm run check-site -- my-portal saved-page.html
   ```
4. **Choose a notification channel** in `.env` (see [Notifications](#notifications-env)).
5. **Run it:**
   ```bash
   npm start          # one run; the last browser stays open until you press ENTER
   npm run watch      # keeps running: one run every 30-60 minutes, 07:00-22:00
   ```

The first run of each portal **only records** the listings that are already online, without
notifying you (otherwise you would get dozens of messages). From the second run on, every new
listing that passes your filters is sent to your phone.

## How it works

For every enabled search, in random order and with a pause between portals:

1. launches a browser with the portal's own profile (`browser-profile/<site id>/`: cookies and
   history are kept between runs but never shared with other portals), closed once the portal
   is done;
2. opens the portal's home page (if `homeUrl` is set), accepts the cookie banner, then goes to
   your search URL, as a person would;
3. waits for the listings, scrolls through the page "reading" it, and extracts the listings
   with the site definition;
4. moves to the next page by clicking the "next" button (2 pages on a portal's first run, then
   1: new listings appear at the top when the search is sorted by newest);
5. compares the listings with `data/seen.json`: only never-seen ones are notified;
6. saves everything (`data/seen.json`, plus `data/latest.json` with the listings of the run).

**Possible duplicates:** a listing with the same price, surface and rooms as one already seen on
*another* portal is still notified, marked `possible duplicate of <portal>`.

**Cleanup:** listings not seen for 90 days are removed from `data/seen.json`
(`store.retentionDays`).

**Blocks:** if a portal refuses access, the scraper stops visiting it for a while and notifies
you. See [When a portal blocks you](#when-a-portal-blocks-you).

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
| `blocking.pauseHours` / `blocking.maxPauseHours` | `6` / `48` | Pause after a portal blocks access; it doubles at each consecutive block, up to the maximum |
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
and the exact key. A site whose definition is not valid (for example a draft not finished yet)
is skipped together with its search, and the other sites run as usual.

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
| `blocked` | `[]` | Extra selectors of the portal's own "access denied" page. Common captchas are already recognised |
| `popups` | `[]` | Extra selectors for the *close* button of a "save this search" popup. Popups marked as dialogs that mention saving the search or alerts are already closed (never saved) by their "Close", "×", "No thanks", "Non ora", … button |

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

Prefer a selector that points at exactly one value. Attributes that describe the content are
often the most stable choice, e.g. `"[aria-label^=\"Surface\"]"`. Use `match` on a larger block
only when there is no better element. Watch out: the text of adjacent elements is joined
**without spaces**, so `<span>€ 1.700</span><span>118 m²</span>` reads as `€ 1.700118 m²`.
`check-site` shows these mistakes immediately as absurd prices or surfaces.

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
2. **Analyse the page** to find the listings and the selectors:
   ```bash
   npm run analyze-page -- path/to/saved-page.html --base-url https://www.my-portal.example/
   npm run analyze-page -- --url "https://www.my-portal.example/rent?city=my-city&sort=newest"
   ```
   Always put the URL in quotes: characters like `&` and `;` would otherwise cut it.
   It looks for the listings both as repeated HTML cards and as JSON embedded in a `<script>`,
   and for each field shows the suggested selector or path, how many listings it covers and a
   sample value. It also reports:
   - **next page**: whether the built-in detection already finds the button, or which
     selector to put in `selectors.next`;
   - **cookie banner**: candidates for `selectors.cookie`;
   - **popups**: for each popup or overlay, whether it is marked as a dialog (closed
     automatically when it is about saving the search) or is a plain `<div>`, and in that case
     the selector of its close button for `selectors.popups`.

   It ends with a **validated draft definition** and asks whether to save it: press ENTER to save
   it as `user/sites/<id>.json`, type another path, or `n` to skip (`--write <file>` saves it
   without asking; an existing file is never overwritten). Then it lists the **next steps** with
   the exact commands: complete the draft, check it with `check-site`, and the entry to add to
   `"searches"` in `user/config.json`. Only stable names are suggested (`data-*` attributes,
   meaningful classes), never generated
   ones like `css-1x2y3z`. Fields it cannot recognise (often `city`) must be added by hand with
   the browser's developer tools (right click → *Inspect*).

   With a file the page is opened offline, like `check-site`; stylesheets are not loaded, so
   popups that are not marked as dialogs can be missed. With `--url` a visible browser opens with
   a temporary profile: reach the results page, wait for the popup to appear and press ENTER in
   the terminal. The live page is analysed and a snapshot is saved to
   `data/debug/analyze_<host>.html`, ready for `check-site`.

   **The page ignores the filters in its URL, or shows no listings?** Some portals load the
   results with a separate request (fetch/XHR) and build its filters from the search form or
   from the browser's storage, not from the page URL. With `--url` the tool lists these requests
   (size, type, URL and decoded URL; `(empty)` when nothing came back). Copy the one that loads
   the listings, put your filters in it, and analyse it directly:
   `npm run analyze-page -- --url "<request url>"`. If the listings are there, use that URL as
   the search URL in `user/config.json`.
3. **Write `user/sites/my-portal.json`** from the draft, or from the closest example.
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
(`<Portal name>_no-listings.*` or `<Portal name>_no-extract.*`). Run `check-site` on the saved
HTML, fix the selectors, and check again.

## When a portal blocks you

Many portals use bot protection (DataDome, Cloudflare, PerimeterX, …) and may answer with a
captcha or an "access denied" page instead of the results. The scraper treats that as a clear
**no**: it does not try to solve or get around the check.

What happens:

1. the block is recognised from the HTTP status (`403`, `429`) or from the page: common
   captchas are built in, and `selectors.blocked` adds the portal's own block page;
2. the scraper stops visiting that portal, saves `data/debug/<Portal name>_blocked.*` and sends
   you a notification, e.g. *"My Portal: access blocked. DataDome captcha. The site will not be
   visited for 6 h"*;
   its browser profile (`browser-profile/<site id>/`) is deleted, so the next visit starts
   without the cookies that may have marked it as a bot;
3. the portal is skipped until the pause ends. Each consecutive block doubles the pause (6, 12,
   24, 48 hours by default, see `blocking` in the settings), and a successful visit resets it.
   The other portals keep running normally.

To try a paused portal before the pause ends, run `npm start -- --retry-blocked`.

`check-site` also recognises block pages: if you run it on one, it says so instead of reporting
empty fields.

If a portal keeps blocking you, it does not want automated visits: remove its search (or set
`"enabled": false`) and check it by hand, or look for an official alternative such as its
saved-search alerts.

## Running on a server or VM

The scraper can run unattended on a machine without a desktop (a VM on Proxmox, a home server,
…). The browser still needs a screen: instead of switching to headless mode, which portals
block more often, give it a **virtual screen** with Xvfb. The instructions below are for
Debian/Ubuntu.

### 1. Install

```bash
sudo apt install xvfb
npm install
npx playwright install --with-deps chromium   # also installs Chromium's system libraries
npm run setup                                  # then edit user/ and .env as usual
```

Set the VM's time zone, because `watch.activeHours` follows the machine's clock:

```bash
sudo timedatectl set-timezone Europe/Rome      # your time zone
```

Try it once in the foreground (Ctrl+C to stop):

```bash
xvfb-run -a -s "-screen 0 1920x1080x24" node src/index.js --watch
```

### 2. Run it as a service

A systemd service starts the scraper at boot, restarts it after a crash and keeps it running
after you log out. Create `/etc/systemd/system/rental-scraper.service`, adapting `User`,
`WorkingDirectory` and the path to `node` (`which node`):

```ini
[Unit]
Description=Rental listings scraper
After=network-online.target
Wants=network-online.target

[Service]
User=scraper
WorkingDirectory=/home/scraper/rental-scraper
ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1920x1080x24" /usr/bin/node src/index.js --watch
# The scraper saves and exits on SIGINT (like Ctrl+C), not on systemd's default SIGTERM
KillSignal=SIGINT
Restart=on-failure
RestartSec=60

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rental-scraper     # start now and at every boot
journalctl -u rental-scraper -f                # follow the logs
sudo systemctl stop rental-scraper             # stop it
```

### Notes

- Always use **watch mode** (`--watch`): `npm start` waits for ENTER at the end of the run.
- Give the VM at least **2 GB of RAM** (4 GB is safer): Chromium is the heavy part.
- **IP address:** from a home server you browse with your home connection. Servers in a data
  centre or a cloud provider are blocked by portals much more often.
- **Debug files** (`data/debug/`) are saved as usual: copy the screenshots to your computer to
  see what the browser saw.
- **Headless mode** is a last resort, if Xvfb is not an option: add
  `"browser": { "headless": true }` to `user/config.json` and run `node src/index.js --watch`
  without `xvfb-run`.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run setup` | Creates `user/` and `.env` from the examples (never overwrites) |
| `npm start` | One run; the last portal's browser stays open until you press ENTER |
| `npm start -- --retry-blocked` | One run that also visits the portals paused after a block |
| `npm run watch` | Periodic runs within the active hours. Stop with Ctrl+C |
| `npm run analyze-page -- <page.html> \| --url <url>` | Analyses a results page and drafts a site definition (`--write <file>` to save it) |
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
src/sites/analyze.js        page analysis and draft definitions for analyze-page
src/sites/blocking.js       recognises captchas and "access denied" pages
src/sites/Site.js           flow for one portal: home -> search -> cookies -> pages
src/sites/index.js          pairs the searches with their definitions
src/human/HumanBehavior.js  mouse, wheel, clicks and pauses
src/models/listing.js       common listing schema, parsing, filters
src/notify/Notifier.js      ntfy and Telegram
src/tools/                  setup, analyze-page and check-site commands
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
