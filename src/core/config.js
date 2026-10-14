const fs = require('node:fs');
const path = require('node:path');

// Personal settings live in <userDir>/config.json (not versioned): it overrides
// config/default.js and lists the searches to run.

const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

// Plain objects are merged key by key; arrays and other values replace the default.
function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return result;
}

function validateUserConfig(user, defaults, file) {
  const errors = [];

  for (const key of Object.keys(user)) {
    if (key !== 'searches' && !(key in defaults)) {
      errors.push(`unknown key "${key}" (allowed: searches, ${Object.keys(defaults).join(', ')})`);
    }
  }

  if (!Array.isArray(user.searches) || user.searches.length === 0) {
    errors.push('"searches" must be a non-empty array of { "site": "...", "url": "..." }');
  } else {
    user.searches.forEach((search, i) => {
      const where = `searches[${i}]`;
      if (!isObject(search)) return errors.push(`${where}: must be an object`);
      if (typeof search.site !== 'string' || !search.site) errors.push(`${where}.site: required (a site id)`);
      if (!/^https?:\/\//.test(search.url ?? '')) errors.push(`${where}.url: required http(s) URL of the search results`);
      if (search.enabled != null && typeof search.enabled !== 'boolean') errors.push(`${where}.enabled: must be true or false`);
    });
  }

  if (errors.length) throw new Error(`${file}:\n  - ${errors.join('\n  - ')}`);
}

// Returns { config, searches }.
function loadConfig(defaults, userDir = defaults.paths.userDir) {
  const file = path.join(userDir, 'config.json');

  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found. Run "npm run setup" to create it from the examples.`);
  }

  let user;
  try {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${error.message})`);
  }
  if (!isObject(user)) throw new Error(`${file}: must contain a JSON object`);

  validateUserConfig(user, defaults, file);

  const { searches, ...overrides } = user;
  return { config: deepMerge(defaults, overrides), searches };
}

module.exports = { loadConfig, deepMerge };
