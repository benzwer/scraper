// Generic extractor driven by a site definition's "extract" block (already validated and
// normalised by definitions.js). It runs in the browser through page.evaluate, so it must be
// self-contained: no outer variables, helpers or requires.
function extractListings(extract) {
  const FIELDS = ['id', 'url', 'title', 'price', 'surface', 'rooms', 'city', 'description'];

  // "a.b[0].c" -> every value reached; "[*]" fans out over all the elements of an array.
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

  // Applies the optional "match" regex and "template" to a raw value.
  const finish = (value, spec) => {
    if (value == null) return null;
    let result = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;

    if (spec.match) {
      const found = String(result).match(new RegExp(spec.match, 'i'));
      if (!found) return null;
      result = (found[1] ?? found[0]).trim();
    }

    if (spec.template) result = spec.template.replace('{}', String(result));
    return result === '' ? null : result;
  };

  const readCss = (itemEl, spec) => {
    const el = spec.selector ? itemEl.querySelector(spec.selector) : itemEl;
    if (!el) return null;
    if (!spec.attr) return el.textContent;

    const raw = el.getAttribute(spec.attr);
    if (raw == null || (spec.attr !== 'href' && spec.attr !== 'src')) return raw;
    try {
      return new URL(raw, document.baseURI).href;
    } catch {
      return raw;
    }
  };

  const readJson = (item, spec) => {
    for (const path of spec.path) {
      const found = resolvePath(item, path).find(value => value != null);
      if (found !== undefined) return found;
    }
    return null;
  };

  let items;
  let read;

  if (extract.type === 'css') {
    items = Array.from(document.querySelectorAll(extract.item));
    read = readCss;
  } else {
    const script = document.querySelector(extract.script);
    if (!script) return [];
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      return [];
    }
    items = resolvePath(data, extract.items).find(Array.isArray) || [];
    read = readJson;
  }

  return items.map(item => {
    const raw = {};
    for (const field of FIELDS) {
      const spec = extract.fields[field];
      raw[field] = spec ? finish(read(item, spec), spec) : null;
    }
    return raw;
  });
}

module.exports = { extractListings };
