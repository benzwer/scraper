// Page analysis for writing site definitions (npm run analyze-page).
// analyzePage runs in the browser through page.evaluate, so like extract.js it must be
// self-contained: no outer variables, helpers or requires. buildDraft runs in Node and turns its
// report into a draft site definition.

// With `locate` ({ ...extract, index, value }) it only returns the text of that listing and, when
// value is given, candidate field specs reading it; with { type: "clickable", value } the buttons
// and links matching value, with their selectors (used by check-site --fix).
function analyzePage({ saveSearchText, closeName, locate = null }) {
  const SAVE_SEARCH_RE = new RegExp(saveSearchText, 'i');
  const CLOSE_NAME_RE = new RegExp(closeName, 'i');
  const CLOSE_HINT_RE = /close|chiudi|dismiss|annulla|cancel/i;
  const NEXT_RE = /^(pagina )?(successiva|seguente|avanti|next)( pagina| page)?$|^[›»→>]$/i;
  const ACCEPT_RE = /^(accetta|accetto|acconsento|accept|allow|agree|consenti|ok|got it|ho capito)\b/i;
  const COOKIE_CMP = [
    '#onetrust-accept-btn-handler',
    '#didomi-notice-agree-button',
    '.iubenda-cs-accept-btn',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    '#axeptio_btn_acceptAll',
    '.cmplz-accept'
  ];
  const PATTERNS = {
    price: /(€|eur\b|£|\$)\s*\d|\d[\d.,]*\s*(€|eur\b)/i,
    surface: /\d+(?:[.,]\d+)?\s*(m²|m2|mq|sqm|metri)/i,
    rooms: /\d+\+?\s*(local[ei]|vani|camer[ae]|stanz[ae]|rooms?|bedrooms?)\b/i
  };
  // Surface and rooms often share one element ("85 m² · 3 rooms"): a match picks the right number.
  const MATCH = {
    surface: '(\\d+(?:[.,]\\d+)?)\\s*(?:m²|m2|mq|sqm|metri)',
    rooms: '(\\d+)\\+?\\s*(?:local[ei]|vani|camer[ae]|stanz[ae]|rooms?|bedrooms?)'
  };
  const PRICE_MATCH = '(\\d[\\d.,]*)\\s*(?:€|eur\\b)';
  // How a JSON path is recognised as a field. "last": the last key, whole. "words": one of the
  // words of the path ("category.parentId" is category/parent/id: no "rent" in it). "distinct": the
  // value changes from listing to listing (a category id is the same for all). "name": a text with
  // letters, not a code or a path. "notWords": a path with one of these words is never the field.
  // "noArrays": the listing's own value, not one of a list inside it (a photo's id).
  const SORTING_WORDS = /^(weight|order|position|index|sort|rank|priority|level)$/;
  const JSON_FIELDS = {
    id: { last: /^(id|uuid|listing_?id|ad_?id|property_?id)$/i, distinct: true, noArrays: true },
    url: {
      words: /^(url|urls|link|links|href|permalink|slug)$/, string: true, distinct: true, noArrays: true,
      notWords: /^(images?|img|photos?|pictures?|thumbnails?|thumbs?|media|logos?|avatars?|videos?)$/
    },
    title: { last: /^(title|name|headline|subject)$/i, string: true },
    price: { words: /^(prices?|prezzo|rent|canone|cost)$/, numeric: true, notWords: SORTING_WORDS },
    surface: { words: /^(surface|superficie|area|size|sqm|square|mq)$/, numeric: true, notWords: SORTING_WORDS },
    rooms: { words: /^(rooms?|locali|vani|camere|bedrooms?)$/, numeric: true, notWords: SORTING_WORDS },
    city: { words: /^(city|citta|città|comune|town|municipality|locality)$/, string: true, name: true }
  };

  const win = document.defaultView;
  const body = document.body;
  const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const snippet = (value, max = 80) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
  const nameOf = el =>
    (el.getAttribute('aria-label') || text(el) || el.getAttribute('title') || '').trim();
  const qsa = (root, selector) => {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  };
  const quote = value => value.replace(/["\\]/g, '\\$&');

  // Generated names (CSS-in-JS, CSS modules, hashes) change at every deploy: never suggested.
  const isStable = name =>
    name.length <= 40 && !/^(css|sc|jsx|svelte|emotion|tw)-|\d{3,}|_[a-z0-9]*\d[a-z0-9]*$|[^\w-]/i.test(name);

  // Selectors describing the element itself, most readable first; the bare tag is last.
  const ownSelectors = el => {
    const tag = el.tagName.toLowerCase();
    const out = [];
    if (el.id && isStable(el.id)) out.push(`#${el.id}`);
    for (const { name, value } of Array.from(el.attributes)) {
      if (name.startsWith('data-') && value && isStable(value)) out.push(`[${name}="${quote(value)}"]`);
    }
    const classes = Array.from(el.classList).filter(isStable);
    for (const name of classes) out.push(`.${name}`);
    if (classes.length > 1) out.push(`.${classes.slice(0, 2).join('.')}`);
    for (const name of ['aria-label', 'title', 'rel']) {
      const value = el.getAttribute(name);
      if (value && value.length <= 40) out.push(`${tag}[${name}="${quote(value)}"]`);
    }
    out.push(tag);
    return out;
  };

  // A stable selector matching only this element in the page, or null.
  const stableSelector = el => {
    for (const selector of ownSelectors(el)) {
      if (selector === el.tagName.toLowerCase()) continue;
      const found = qsa(document, selector);
      if (found.length === 1 && found[0] === el) return selector;
    }
    return null;
  };

  // Always unique: climbs the ancestors until one has a unique selector, using nth-of-type below it.
  const uniqueSelector = el => {
    const steps = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      for (const own of ownSelectors(node)) {
        const selector = [own, ...steps].join(' > ');
        const found = qsa(document, selector);
        if (found.length === 1 && found[0] === el) return selector;
      }
      const tag = node.tagName.toLowerCase();
      const sameTag = Array.from(node.parentElement?.children || []).filter(s => s.tagName === node.tagName);
      steps.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    }
    return steps.join(' > ');
  };

  // For buttons and links: a stable selector, else their visible text, else the structural path.
  const clickableSelector = el => {
    const name = nameOf(el);
    if (stableSelector(el)) return stableSelector(el);
    if (name && name.length <= 40) return `${el.tagName.toLowerCase()}:has-text("${quote(name)}")`;
    return uniqueSelector(el);
  };

  // ------------------------------------------------------------------
  // Listings as HTML cards
  // ------------------------------------------------------------------

  const linkOf = item =>
    item.matches('a[href]')
      ? item
      : qsa(item, 'a[href]').find(a => !/^(#|javascript:)/i.test(a.getAttribute('href')));

  const looksLikeCard = el => {
    const content = text(el);
    return (
      content.length >= 15 &&
      content.length <= 3000 &&
      Boolean(linkOf(el)) &&
      (PATTERNS.price.test(content) || PATTERNS.surface.test(content) || PATTERNS.rooms.test(content))
    );
  };

  // The deepest element of the item that passes the test.
  const findLeaf = (item, test) => {
    const matches = qsa(item, '*').filter(test);
    return matches.find(el => !matches.some(other => other !== el && el.contains(other))) || null;
  };

  // The selector, relative to the item, that finds `el` in the first item and the most values
  // overall. Climbs to the parent when the element cannot be told apart from its siblings; a bare
  // tag ("li") is only used when it covers more items than any more meaningful selector (a
  // title="…" selector, for one, only fits the listing it was taken from).
  const relativeField = (items, firstItem, el, test) => {
    const meaningful = relativeFieldPass(items, firstItem, el, test, false);
    const any = relativeFieldPass(items, firstItem, el, test, true);
    return !meaningful || (any && any.coverage > meaningful.coverage) ? any : meaningful;
  };

  const relativeFieldPass = (items, firstItem, el, test, allowBareTag) => {
    for (let node = el; node && node !== firstItem; node = node.parentElement) {
      let best = null;
      for (const selector of ownSelectors(node)) {
        if (selector.startsWith('#') || qsa(firstItem, selector)[0] !== node) continue;
        if (!allowBareTag && selector === node.tagName.toLowerCase()) continue;
        const coverage = items.filter(item => {
          const found = qsa(item, selector)[0];
          return found && test(found);
        }).length;
        if (coverage > (best?.coverage ?? 0)) best = { selector, coverage };
      }
      if (best) return best;
    }
    return null;
  };

  const cardField = (items, test, { attr, match } = {}) => {
    const firstItem = items.find(item => findLeaf(item, test));
    if (!firstItem) return null;
    const found = relativeField(items, firstItem, findLeaf(firstItem, test), test);
    if (!found) return null;

    const sampleEl = qsa(firstItem, found.selector)[0];
    let sample = attr ? sampleEl.getAttribute(attr) : text(sampleEl);
    if (match) sample = (sample.match(new RegExp(match, 'i')) || [])[1] ?? sample;
    return { selector: found.selector, attr, match, coverage: found.coverage, sample: snippet(sample || '') };
  };

  const textTest = pattern => el => {
    const content = text(el);
    return content.length <= 120 && pattern.test(content);
  };

  const cardFields = items => {
    const fields = {};
    const total = items.length;

    // id: an attribute of the card with a different, number-like value on every card.
    const first = items[0];
    const idAttr = Array.from(first.attributes)
      .map(attr => attr.name)
      .filter(name => name === 'id' || name.startsWith('data-'))
      .sort((a, b) => /id/i.test(b) - /id/i.test(a))
      .find(name => {
        const values = items.map(item => item.getAttribute(name));
        return values.every(v => v && v.length <= 60 && /\d/.test(v)) && new Set(values).size === total;
      });
    if (idAttr) fields.id = { attr: idAttr, coverage: total, sample: first.getAttribute(idAttr) };

    if (first.matches('a[href]')) {
      fields.url = { attr: 'href', coverage: total, sample: first.href };
    } else {
      const firstWithLink = items.find(linkOf);
      if (firstWithLink) {
        const link = linkOf(firstWithLink);
        const isLink = el => el.matches('a[href]');
        const found = relativeField(items, firstWithLink, link, isLink);
        if (found) {
          const sample = qsa(firstWithLink, found.selector)[0].href || '';
          fields.url = { selector: found.selector, attr: 'href', coverage: found.coverage, sample };
        }
      }
    }

    const isTitle = el => {
      const content = text(el);
      return content.length >= 5 && content.length <= 200 &&
        (/^H[1-6]$/.test(el.tagName) || /title|titolo|heading/i.test(el.getAttribute('class') || ''));
    };
    const title = cardField(items, isTitle);
    if (title) fields.title = title;

    let price = cardField(items, textTest(PATTERNS.price));
    // "1 locale - 770 €": the first number is not the price, so a match picks the one before €.
    const priceText = price && price.sample;
    const beforeCurrency = priceText && priceText.match(new RegExp(PRICE_MATCH, 'i'));
    if (beforeCurrency && priceText.match(/\d[\d.,]*/)[0] !== beforeCurrency[1]) {
      price = cardField(items, textTest(PATTERNS.price), { match: PRICE_MATCH });
    }
    if (price) fields.price = price;
    for (const name of ['surface', 'rooms']) {
      const found = cardField(items, textTest(PATTERNS[name]), { match: MATCH[name] });
      if (found) fields[name] = found;
    }
    return fields;
  };

  const cardSelector = members => {
    const first = members[0];
    const tag = first.tagName.toLowerCase();
    const candidates = ownSelectors(first).filter(c => c !== tag && !/\[(aria-label|title|rel)=/.test(c));
    candidates.push(`${uniqueSelector(first.parentElement)} > ${tag}`);

    // The tightest selector: a generic class (".col-sm-12") also matches the menu or the footer.
    let best = null;
    for (const selector of candidates) {
      const found = new Set(qsa(document, selector));
      if (members.every(m => found.has(m)) && found.size <= members.length * 1.5 + 1 &&
        (!best || found.size < best.count)) {
        best = { selector, count: found.size };
      }
    }
    return best;
  };

  // The only listing of the page: the deepest element with a link and at least two of price,
  // surface and rooms (one alone is too weak without repetition to confirm it). It then grows to
  // the parent while that adds only elements without text, like the photo next to the text block;
  // a wrapper whose other children are empty (clearfix divs) or that has no others is layout.
  const findSingleCard = () => {
    if (!body) return null;
    const hints = el => [PATTERNS.price, PATTERNS.surface, PATTERNS.rooms].filter(p => p.test(text(el))).length;
    const candidates = qsa(body, '*').filter(el =>
      !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg)$/i.test(el.tagName) && looksLikeCard(el) && hints(el) >= 2);
    if (!candidates.length) return null;

    const most = Math.max(...candidates.map(hints));
    const best = candidates.filter(el => hints(el) === most);
    let card = best.find(el => !best.some(other => other !== el && el.contains(other)));
    const hasContent = el => el.children.length > 0 || /^(IMG|PICTURE|A)$/.test(el.tagName);
    const addsOnlyMedia = (parent, child) => text(parent) === text(child) &&
      Array.from(parent.children).some(sibling => sibling !== child && hasContent(sibling));
    while (card.parentElement && card.parentElement !== body && addsOnlyMedia(card.parentElement, card)) {
      card = card.parentElement;
    }
    return card;
  };

  const findCards = () => {
    if (!body) return [];
    const groups = [];

    for (const parent of [body, ...qsa(body, '*')]) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg)$/i.test(parent.tagName)) continue;
      const byTag = new Map();
      for (const child of Array.from(parent.children)) {
        if (!looksLikeCard(child)) continue;
        if (!byTag.has(child.tagName)) byTag.set(child.tagName, []);
        byTag.get(child.tagName).push(child);
      }
      for (const members of byTag.values()) {
        if (members.length < 2) continue;
        const share = pattern => members.filter(m => pattern.test(text(m))).length / members.length;
        const score = members.length * (1 + share(PATTERNS.price) + share(PATTERNS.surface) + share(PATTERNS.rooms));
        groups.push({ members, score });
      }
    }

    // A search with one result has nothing repeated: fall back to that single card.
    const single = groups.length ? null : findSingleCard();
    if (single) groups.push({ members: [single], score: 1 });

    return groups
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ members }) => {
        const found = cardSelector(members);
        if (!found) return null;
        const items = qsa(document, found.selector).slice(0, 20);
        const card = { ...found, sample: snippet(text(members[0]), 100), fields: cardFields(items) };
        return members.length === 1 ? { ...card, single: true } : card;
      })
      .filter(Boolean);
  };

  // ------------------------------------------------------------------
  // Listings as JSON embedded in a <script>
  // ------------------------------------------------------------------

  const resolvePath = (root, path) => {
    let current = [root];
    for (const token of path.match(/[^.[\]]+|\[(?:\d+|\*)\]/g) || []) {
      const next = [];
      for (const value of current) {
        if (value == null) continue;
        if (token === '[*]') {
          if (Array.isArray(value)) next.push(...value);
        } else if (token.startsWith('[')) {
          next.push(value[Number(token.slice(1, -1))]);
        } else {
          next.push(value[token]);
        }
      }
      current = next;
    }
    return current.filter(value => value !== undefined);
  };

  // A key that a path can name: anything without the path's own separators ("/size" included).
  const isPathKey = key => key !== '' && !/[.[\]]/.test(key);

  // "realEstate.features./size.values[0].key" -> real, estate, features, size, values, key.
  const pathWords = path => path
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word && !/^\d+$/.test(word));
  const lastKey = path => path.replace(/(\[\d+\])+$/, '').split(/[.[\]]/).pop();

  // Leaf values of a listing by path; in arrays only the first element is followed ("values[0]").
  const leafPaths = (node, prefix, depth, out) => {
    const entries = Array.isArray(node)
      ? (node[0] && typeof node[0] === 'object' ? [['[0]', node[0]]] : [])
      : Object.entries(node).filter(([key]) => isPathKey(key));
    for (const [key, value] of entries) {
      if (value == null) continue;
      const path = key === '[0]' ? `${prefix}[0]` : prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object') {
        if (depth < 5) leafPaths(value, path, depth + 1, out);
      } else {
        if (!out.has(path)) out.set(path, { count: 0, sample: value });
        out.get(path).count++;
      }
    }
    return out;
  };

  const fitsRule = (rule, path, { sample, values }) => {
    const words = pathWords(path);
    if (rule.last && !rule.last.test(lastKey(path))) return false;
    if (rule.words && !words.some(word => rule.words.test(word))) return false;
    if (rule.notWords && words.some(word => rule.notWords.test(word))) return false;
    if (rule.noArrays && path.includes('[')) return false;
    if (rule.string && typeof sample !== 'string') return false;
    if (rule.numeric && typeof sample !== 'number' && !/\d/.test(String(sample))) return false;
    if (rule.name && (!/\p{L}/u.test(sample) || /^(\/|https?:)/i.test(sample))) return false;
    return !rule.distinct || new Set(values).size === values.length;
  };

  const jsonFields = objects => {
    const paths = new Map();
    for (const object of objects) {
      for (const [path, { sample }] of leafPaths(object, '', 0, new Map())) {
        if (!paths.has(path)) paths.set(path, { count: 0, sample, values: [] });
        paths.get(path).count++;
        paths.get(path).values.push(String(sample));
      }
    }

    const fields = {};
    for (const [field, rule] of Object.entries(JSON_FIELDS)) {
      const candidates = Array.from(paths.entries())
        .filter(([path, info]) => fitsRule(rule, path, info))
        .sort(([pathA, a], [pathB, b]) =>
          b.count - a.count ||
          (typeof b.sample === 'number') - (typeof a.sample === 'number') ||
          pathA.length - pathB.length);
      if (candidates.length) {
        const [path, { count, sample }] = candidates[0];
        fields[field] = { path, coverage: count, sample: snippet(String(sample)) };
      }
    }
    return fields;
  };

  const findJson = () => {
    const results = [];

    for (const script of qsa(document, 'script')) {
      const type = (script.getAttribute('type') || '').toLowerCase();
      const content = (script.textContent || '').trim();
      if (!/^[[{]/.test(content) || (type && !type.includes('json'))) continue;

      let data;
      try {
        data = JSON.parse(content);
      } catch {
        continue;
      }

      const arrays = [];
      let budget = 50000;
      const walk = (value, path, depth) => {
        if (budget-- <= 0 || depth > 12 || value == null || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          const objects = value.filter(v => v && typeof v === 'object' && !Array.isArray(v));
          if (path && objects.length >= 2 && objects.length >= value.length * 0.5) arrays.push({ path, value, objects });
          value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
        } else {
          for (const [key, item] of Object.entries(value)) {
            if (isPathKey(key)) walk(item, path ? `${path}.${key}` : key, depth + 1);
          }
        }
      };
      walk(data, '', 0);

      const selector = script.id && isStable(script.id) ? `script#${script.id}` : uniqueSelector(script);

      for (const { path, value, objects } of arrays) {
        const fields = jsonFields(objects.slice(0, 20));
        const hasKey = fields.id || fields.url;
        const hasData = fields.price || fields.surface || fields.rooms;
        if (!hasKey || !hasData) continue;

        // "sections[1].listings" -> "sections[*].listings" when it still finds the same array:
        // it keeps working if the portal reorders the sections.
        const generic = path.replace(/\[\d+\]/g, '[*]');
        const items = generic !== path && resolvePath(data, generic).find(Array.isArray) === value ? generic : path;

        results.push({
          script: selector,
          items,
          count: value.length,
          fields,
          score: objects.length * Object.keys(fields).length
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 3);
  };

  // ------------------------------------------------------------------
  // check-site --fix: how to read a value the user sees in one listing
  // ------------------------------------------------------------------

  const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRe = value => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(value)}(?![\\p{L}\\p{N}])`, 'iu');
  // Where the value is in the text: as a whole word if possible ("4" is not the 4 in "2.450").
  const indexOfValue = (content, value) => {
    const token = tokenRe(value).exec(content);
    return token ? token.index : content.toLowerCase().indexOf(value.toLowerCase());
  };

  // A regex reading `value` out of a longer text, after the word just before it when there is one
  // ("Rooms: 4" -> "Rooms:\s*(\d[\d.,']*)"): a number, or the text up to the next "label:".
  // null when the text is the value itself, or (needLabel) when there is no word before it.
  const matchFor = (content, value, { needLabel = false } = {}) => {
    const at = indexOfValue(content, value);
    if (at < 0 || content.trim().toLowerCase() === value.toLowerCase()) return null;
    const label = (content.slice(0, at).match(/(\S+)\s*$/) || [])[1];
    if (!label && needLabel) return null;
    const head = label ? `${escapeRe(label)}\\s*` : '';
    if (/^\d[\d.,']*$/.test(value)) return `${head}(\\d[\\d.,']*)`;
    return label ? `${head}(.+?)(?=\\s+[^\\s:]{2,}:|$)` : null;
  };

  // Selectors finding `el` as the first match inside `item` (null: the item itself): its own
  // selectors, then a path from the closest ancestor that has one.
  const selectorsWithin = (item, el) => {
    if (el === item) return [null];
    const out = [];
    for (const own of ownSelectors(el)) {
      if (!own.startsWith('#') && qsa(item, own)[0] === el) out.push(own);
    }
    const steps = [];
    for (let node = el; node && node !== item; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      if (node !== el) {
        const own = ownSelectors(node)
          .find(s => !s.startsWith('#') && s !== tag && qsa(item, [s, ...steps].join(' > '))[0] === el);
        if (own) {
          out.push([own, ...steps].join(' > '));
          return [...new Set(out)];
        }
      }
      const sameTag = Array.from(node.parentElement?.children || []).filter(s => s.tagName === node.tagName);
      steps.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    }
    const path = [':scope', ...steps].join(' > ');
    if (qsa(item, path)[0] === el) out.push(path);
    return [...new Set(out)];
  };

  // For an attribute like href="/flat-bolzano-376568.html" and the value 376568: "-(\d+)".
  const attrMatch = (content, value) => {
    if (content.toLowerCase() === value.toLowerCase() || !/^\d+$/.test(value)) return null;
    const before = content[content.indexOf(value) - 1] || '';
    return `${/\w/.test(before) ? '' : escapeRe(before)}(\\d+)`;
  };

  const locateInCards = ({ item: itemSelector, index, value }) => {
    const items = qsa(document, itemSelector);
    const item = items[index];
    const result = { count: items.length, text: item ? snippet(text(item), 600) : null, candidates: [] };
    if (!item || !value) return result;
    const add = spec => result.candidates.push(spec);
    // Whole words when the listing has the value as one, else any substring.
    const asToken = tokenRe(value).test(text(item));
    const includesValue = content =>
      asToken ? tokenRe(value).test(content) : content.toLowerCase().includes(value.toLowerCase());

    const holders = qsa(item, '*').filter(el => includesValue(text(el)));
    const deepest = holders.filter(el => !holders.some(other => other !== el && el.contains(other)));
    if (!deepest.length && includesValue(text(item))) deepest.push(item);

    for (const el of deepest.slice(0, 5)) {
      const match = matchFor(text(el), value);
      for (const selector of selectorsWithin(item, el)) add({ selector, match });
      // The same value read from a wider block by its label: it still works when a row is missing.
      for (let node = el === item ? null : el.parentElement; node; node = node === item ? null : node.parentElement) {
        const labelled = matchFor(text(node), value, { needLabel: true });
        if (labelled) add({ selector: selectorsWithin(item, node)[0] ?? null, match: labelled });
      }
    }

    for (const el of [item, ...qsa(item, '*')]) {
      for (const { name, value: content } of Array.from(el.attributes)) {
        if (/^(class|style)$/.test(name) || !includesValue(content)) continue;
        add({ selector: selectorsWithin(item, el)[0] ?? null, attr: name, match: attrMatch(content, value) });
      }
    }

    result.candidates = result.candidates.slice(0, 30);
    return result;
  };

  const locateInJson = ({ script, items: itemsPath, index, value }) => {
    const result = { count: 0, text: null, candidates: [] };
    let data;
    try {
      data = JSON.parse(qsa(document, script)[0]?.textContent || '');
    } catch {
      return result;
    }
    const items = resolvePath(data, itemsPath).find(Array.isArray) || [];
    const item = items[index];
    result.count = items.length;
    result.text = item == null ? null : snippet(JSON.stringify(item), 600);
    if (item == null || !value) return result;

    const walk = (node, path, depth) => {
      if (node == null || depth > 6) return;
      if (typeof node === 'object') {
        for (const [key, child] of Object.entries(node)) {
          if (Array.isArray(node)) walk(child, `${path}[${key}]`, depth + 1);
          else if (isPathKey(key)) walk(child, path ? `${path}.${key}` : key, depth + 1);
        }
      } else if (path && String(node).toLowerCase().includes(value.toLowerCase())) {
        const match = matchFor(String(node), value);
        result.candidates.push({ path, match });
        // "photos[0].alt" -> "photos[*].alt" also finds it when the first element lacks it.
        const generic = path.replace(/\[\d+\]/g, '[*]');
        if (generic !== path) result.candidates.push({ path: generic, match });
      }
    };
    walk(item, '', 0);
    result.candidates = result.candidates.slice(0, 30);
    return result;
  };

  // ------------------------------------------------------------------
  // Next page, cookie banner, popups
  // ------------------------------------------------------------------

  const findNext = () =>
    qsa(document, 'a, button, [role="button"], [role="link"]')
      .filter(el => el.getAttribute('rel') === 'next' || NEXT_RE.test(nameOf(el)) ||
        /(^|[\s_-])(next|successiv)/i.test(el.getAttribute('class') || ''))
      .slice(0, 5)
      .map(el => ({ selector: clickableSelector(el), name: snippet(nameOf(el), 40) }));

  const cookieElements = () => {
    const found = new Set(COOKIE_CMP.flatMap(selector => qsa(document, selector)));
    for (const el of qsa(document, 'button, a, [role="button"]')) {
      const name = nameOf(el);
      if (name.length <= 40 && ACCEPT_RE.test(name)) found.add(el);
    }
    return Array.from(found);
  };

  const findCookie = elements =>
    elements.slice(0, 3).map(el => ({ selector: clickableSelector(el), name: snippet(nameOf(el), 40) }));

  // Without layout (jsdom) only the inline/computed styles can be checked.
  const hasLayout = document.documentElement.getBoundingClientRect().width > 0;
  const isVisible = el => {
    const style = win.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (!hasLayout) return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const closeButtons = popup => {
    const out = [];
    for (const el of qsa(popup, 'button, a, [role="button"], [aria-label], [title], [class], [data-dismiss]')) {
      const name = nameOf(el);
      const hint = [el.getAttribute('class'), el.getAttribute('aria-label'), el.getAttribute('title')].join(' ');
      const named = name.length <= 30 && CLOSE_NAME_RE.test(name);
      if (!named && !(text(el).length <= 30 && (CLOSE_HINT_RE.test(hint) || el.hasAttribute('data-dismiss')))) continue;
      if (out.some(other => other.el.contains(el))) continue;

      const role = el.getAttribute('role');
      const isButton = el.tagName === 'BUTTON' || role === 'button' ||
        (el.tagName === 'INPUT' && /^(button|submit)$/i.test(el.type));
      out.push({ el, selector: clickableSelector(el), name: snippet(name, 30), isButton, named });
    }
    return out.map(({ el, ...button }) => button);
  };

  const findPopups = cookies => {
    if (!body) return [];
    const dialogs = qsa(body, '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog').filter(isVisible);
    const overlays = [];
    const viewportArea = win.innerWidth * win.innerHeight;

    for (const el of qsa(body, '*')) {
      if (win.getComputedStyle(el).position !== 'fixed' || !isVisible(el)) continue;
      if (hasLayout) {
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height < viewportArea * 0.15) continue;
      }
      if (overlays.some(o => o.contains(el)) || dialogs.some(d => d.contains(el) || el.contains(d))) continue;
      overlays.push(el);
    }

    return [...dialogs, ...overlays].slice(0, 6).map(el => {
      const role = el.getAttribute('role') || (el.tagName === 'DIALOG' ? 'dialog' : null);
      const content = text(el);
      const buttons = closeButtons(el);
      const aboutSaveSearch = SAVE_SEARCH_RE.test(content);
      return {
        kind: role === 'dialog' ? 'dialog' : role ? role : el.getAttribute('aria-modal') ? 'aria-modal' : 'overlay',
        tag: el.tagName.toLowerCase(),
        selector: uniqueSelector(el),
        text: snippet(content, 100),
        aboutSaveSearch,
        isCookieBanner: cookies.some(c => el.contains(c)) || /cookie/i.test(content),
        // Estimate of what Site.popupCloseLocator does: the CLI confirms it with Playwright.
        automatic: role === 'dialog' && aboutSaveSearch && buttons.some(b => b.isButton && b.named),
        closeButtons: buttons
      };
    });
  };

  // The clickable elements whose text, tooltip or link contains `value` (exact names first), each
  // with selectors that find it: for selectors.next, selectors.cookie and selectors.popups.
  const locateClickable = ({ value }) => {
    const wanted = value.toLowerCase();
    const found = qsa(document, 'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]')
      .filter(el => [nameOf(el), el.getAttribute('aria-label'), el.getAttribute('title'),
        el.getAttribute('href'), el.getAttribute('value')].some(v => v && v.toLowerCase().includes(wanted)))
      .sort((a, b) => (nameOf(b).toLowerCase() === wanted) - (nameOf(a).toLowerCase() === wanted));

    return found.slice(0, 3).map(el => {
      const tag = el.tagName.toLowerCase();
      const name = nameOf(el);
      const selectors = [
        stableSelector(el),
        name && name.length <= 40 ? `${tag}:has-text("${quote(name)}")` : null,
        uniqueSelector(el)
      ].filter(Boolean);
      return { tag, name: snippet(name, 40), href: el.getAttribute('href'), selectors: [...new Set(selectors)] };
    });
  };

  if (locate) {
    if (locate.type === 'clickable') return locateClickable(locate);
    return locate.type === 'json' ? locateInJson(locate) : locateInCards(locate);
  }

  const cookies = cookieElements();
  return {
    url: document.location.href,
    title: document.title,
    cards: findCards(),
    json: findJson(),
    next: findNext(),
    cookie: findCookie(cookies),
    popups: findPopups(cookies)
  };
}

// ------------------------------------------------------------------
// Node side: report -> draft definition
// ------------------------------------------------------------------

function cssFieldSpec({ selector, attr, match }) {
  if (selector && !attr && !match) return selector;
  return Object.fromEntries(Object.entries({ selector, attr, match }).filter(([, v]) => v != null));
}

function chooseExtract(report, origin, notes) {
  const [json] = report.json;
  const [cards] = report.cards;

  if (json) {
    const fields = {};
    for (const [name, field] of Object.entries(json.fields)) {
      if (name !== 'url' || /^https?:\/\//i.test(field.sample)) fields[name] = field.path;
      else if (field.sample.startsWith('/')) fields.url = { path: field.path, template: `${origin}{}` };
      else notes.push(`url: "${field.path}" holds "${field.sample}", not a full link: add it by hand with a "template".`);
    }
    if (fields.url || fields.id) {
      if (cards) notes.push(`The listings are also HTML cards (${cards.selector}): the embedded JSON is usually more robust.`);
      return { type: 'json', script: json.script, items: json.items, fields };
    }
  }

  if (cards && (cards.fields.url || cards.fields.id)) {
    const fields = {};
    for (const [name, field] of Object.entries(cards.fields)) fields[name] = cssFieldSpec(field);
    if (cards.single) {
      notes.push(`Only one listing on the page: "${cards.selector}" is a best guess. ` +
        'Check it with check-site when the search has more results.');
    }
    return { type: 'css', item: cards.selector, fields };
  }

  notes.push('No listings found: the draft has no "extract" block. See README, "Writing a definition".');
  return null;
}

// Returns { definition, notes }. nextHandled: the scraper's built-in next-page detection already
// finds the button, so no selectors.next is needed.
function buildDraft(report, { nextHandled = false } = {}) {
  const { origin, hostname } = new URL(report.url);
  const host = hostname.replace(/^www\./, '');
  const notes = [];

  const selectors = {};
  if (report.cookie[0]) selectors.cookie = report.cookie[0].selector;
  if (!nextHandled && report.next[0]) selectors.next = [report.next[0].selector];
  const popups = report.popups
    .filter(popup => !popup.automatic && !popup.isCookieBanner && popup.closeButtons.length)
    .map(popup => popup.closeButtons[0].selector);
  if (popups.length) selectors.popups = popups;

  const extract = chooseExtract(report, origin, notes);
  const definition = {
    id: host.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-portal',
    name: host || 'My portal',
    homeUrl: `${origin}/`,
    ...(Object.keys(selectors).length ? { selectors } : {}),
    ...(extract ? { extract } : {})
  };

  return { definition, notes };
}

// Some portals load the results with a fetch/XHR request and ignore the filters in the page URL:
// the URL of that request is then the one to use as search URL. Keeps the requests (recorded by
// analyze-page --url) sent to the portal itself that returned HTML or JSON, largest first.
function pickDataRequests(requests, pageUrl, max = 8) {
  const hostOf = url => new URL(url).hostname.replace(/^www\./, '');
  const site = hostOf(pageUrl);
  const latest = new Map(requests.map(request => [request.url, request]));
  return [...latest.values()]
    .filter(({ url, contentType }) => {
      const host = hostOf(url);
      return (host === site || host.endsWith(`.${site}`)) && /html|json/i.test(contentType || '');
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, max);
}

module.exports = { analyzePage, buildDraft, pickDataRequests };
