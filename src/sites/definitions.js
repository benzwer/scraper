const fs = require('node:fs');
const path = require('node:path');

// Loads and validates the site definitions (one JSON file per site, see README).
// Validation is strict on purpose: a typo in a key would otherwise fail silently while scraping.

const FIELDS = ['id', 'url', 'title', 'price', 'surface', 'rooms', 'city'];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const ALLOWED = {
  root: ['id', 'name', 'description', 'homeUrl', 'reloadIfStale', 'selectors', 'extract'],
  selectors: ['ready', 'items', 'cookie', 'next'],
  css: ['type', 'item', 'fields'],
  json: ['type', 'script', 'items', 'fields'],
  script: ['type', 'file', 'options'],
  cssField: ['selector', 'attr', 'match', 'template'],
  jsonField: ['path', 'match', 'template']
};

const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim() !== '';

function checkKeys(object, allowed, where, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      errors.push(`${where}: unknown key "${key}" (allowed: ${allowed.join(', ')})`);
    }
  }
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function normalizeField(name, spec, type, errors) {
  const where = `extract.fields.${name}`;

  if (type === 'css') {
    if (isText(spec)) return { selector: spec };
    if (!isObject(spec)) {
      errors.push(`${where}: must be a CSS selector string or an object`);
      return null;
    }
    checkKeys(spec, ALLOWED.cssField, where, errors);
    if (spec.selector != null && !isText(spec.selector)) errors.push(`${where}.selector: must be a string`);
    if (spec.attr != null && !isText(spec.attr)) errors.push(`${where}.attr: must be a string`);
  } else {
    if (isText(spec) || Array.isArray(spec)) spec = { path: spec };
    if (!isObject(spec)) {
      errors.push(`${where}: must be a path string, an array of paths or an object`);
      return null;
    }
    checkKeys(spec, ALLOWED.jsonField, where, errors);
    spec = { ...spec, path: [].concat(spec.path ?? []) };
    if (spec.path.length === 0 || !spec.path.every(isText)) {
      errors.push(`${where}.path: must be a non-empty string or array of strings`);
    }
  }

  if (spec.match != null) {
    try {
      new RegExp(spec.match, 'i');
    } catch (error) {
      errors.push(`${where}.match: invalid regular expression (${error.message})`);
    }
  }
  if (spec.template != null && !(isText(spec.template) && spec.template.includes('{}'))) {
    errors.push(`${where}.template: must be a string containing "{}"`);
  }

  return spec;
}

function normalizeExtract(extract, baseDir, errors) {
  if (!isObject(extract)) {
    errors.push('extract: missing or not an object');
    return null;
  }

  const { type } = extract;
  if (!['css', 'json', 'script'].includes(type)) {
    errors.push('extract.type: must be "css", "json" or "script"');
    return null;
  }
  checkKeys(extract, ALLOWED[type], 'extract', errors);

  if (type === 'script') {
    if (!isText(extract.file)) {
      errors.push('extract.file: required for type "script"');
      return null;
    }
    const file = path.resolve(baseDir, extract.file);
    if (!fs.existsSync(file)) {
      errors.push(`extract.file: ${file} not found`);
      return null;
    }
    const fn = require(file);
    if (typeof fn !== 'function') {
      errors.push(`extract.file: ${file} must export a function (module.exports = function ...)`);
      return null;
    }
    return { type, file, fn, options: extract.options ?? null };
  }

  if (type === 'css' && !isText(extract.item)) errors.push('extract.item: required CSS selector for a listing card');
  if (type === 'json') {
    if (!isText(extract.script)) errors.push('extract.script: required CSS selector of the <script> holding the JSON');
    if (!isText(extract.items)) errors.push('extract.items: required path to the array of listings');
  }

  if (!isObject(extract.fields)) {
    errors.push('extract.fields: missing or not an object');
    return null;
  }

  const fields = {};
  for (const [name, spec] of Object.entries(extract.fields)) {
    if (!FIELDS.includes(name)) {
      errors.push(`extract.fields: unknown field "${name}" (allowed: ${FIELDS.join(', ')})`);
      continue;
    }
    fields[name] = normalizeField(name, spec, type, errors);
  }
  if (!fields.url && !fields.id) errors.push('extract.fields: at least "url" or "id" is required');

  return { ...extract, fields };
}

function normalizeSelectors(selectors = {}, extract, errors) {
  if (!isObject(selectors)) {
    errors.push('selectors: must be an object');
    return null;
  }
  checkKeys(selectors, ALLOWED.selectors, 'selectors', errors);

  for (const key of ['ready', 'items', 'cookie']) {
    if (selectors[key] != null && !isText(selectors[key])) errors.push(`selectors.${key}: must be a string`);
  }

  const next = [].concat(selectors.next ?? []);
  if (!next.every(isText)) errors.push('selectors.next: must be a string or an array of strings');

  // Sensible defaults: the listing card (css) or the JSON script (json) means "the page is ready".
  const ready = selectors.ready ?? (extract?.type === 'css' ? extract.item : extract?.script) ?? null;
  if (!ready) errors.push('selectors.ready: required when extract.type is "script"');

  return {
    ready,
    items: selectors.items ?? (extract?.type === 'css' ? extract.item : null),
    cookie: selectors.cookie ?? null,
    next
  };
}

// Returns a normalised definition or throws an Error listing every problem found.
function validateDefinition(raw, { file = '(site definition)' } = {}) {
  const errors = [];

  if (!isObject(raw)) throw new Error(`${file}: the definition must be a JSON object`);
  checkKeys(raw, ALLOWED.root, 'definition', errors);

  if (!isText(raw.id) || !ID_RE.test(raw.id)) {
    errors.push('id: required, lowercase letters, digits and dashes (e.g. "my-portal")');
  }
  if (!isText(raw.name)) errors.push('name: required (shown in logs and notifications)');
  if (raw.homeUrl != null && !isHttpUrl(raw.homeUrl)) errors.push('homeUrl: must be an http(s) URL');
  if (raw.reloadIfStale != null && typeof raw.reloadIfStale !== 'boolean') {
    errors.push('reloadIfStale: must be true or false');
  }

  const baseDir = file.startsWith('(') ? process.cwd() : path.dirname(file);
  const extract = normalizeExtract(raw.extract, baseDir, errors);
  const selectors = normalizeSelectors(raw.selectors, extract, errors);

  if (errors.length) throw new Error(`${file}:\n  - ${errors.join('\n  - ')}`);

  return {
    id: raw.id,
    name: raw.name,
    homeUrl: raw.homeUrl ?? null,
    reloadIfStale: raw.reloadIfStale ?? false,
    selectors,
    extract,
    file
  };
}

function loadSiteDefinition(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: cannot read the definition (${error.message})`);
  }
  return validateDefinition(raw, { file });
}

// Loads every *.json in the directory. Ids must be unique.
function loadSiteDefinitions(dir) {
  if (!fs.existsSync(dir)) return [];

  const definitions = fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => loadSiteDefinition(path.join(dir, name)));

  const byId = new Map();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(
        `Duplicate site id "${definition.id}" in ${byId.get(definition.id).file} and ${definition.file}`
      );
    }
    byId.set(definition.id, definition);
  }

  return definitions;
}

module.exports = { validateDefinition, loadSiteDefinition, loadSiteDefinitions, FIELDS };
