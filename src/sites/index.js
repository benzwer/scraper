const { Site } = require('./Site');

// Pairs every enabled search in the user config with its site definition.
function createSites(searches, definitions, deps) {
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const used = new Set();

  return searches
    .filter(search => search.enabled !== false)
    .map(search => {
      const definition = byId.get(search.site);
      if (!definition) {
        const known = [...byId.keys()].join(', ') || 'none';
        throw new Error(`Search for unknown site "${search.site}" (site definitions found: ${known})`);
      }

      // The site name identifies the listings in data/seen.json, so one search per site.
      if (used.has(search.site)) {
        throw new Error(`Site "${search.site}" has more than one enabled search: keep only one`);
      }
      used.add(search.site);

      return new Site(definition, search, deps);
    });
}

// For --site: the searches of the sites asked for by id or name. A disabled search is used too,
// since the site was asked for by name; "forced" lists those sites. Each site runs once.
function searchesForSites(searches, definitions, wanted, { invalid = new Set() } = {}) {
  const chosen = new Map();
  const forced = [];

  for (const value of wanted) {
    const definition = definitions.find(item =>
      item.id === value || item.name.toLowerCase() === value.toLowerCase());
    if (!definition) {
      throw new Error(invalid.has(value)
        ? `--site ${value}: its definition is not valid (see above)`
        : `--site ${value}: no site with this id or name (sites: ${definitions.map(item => item.id).join(', ') || 'none'})`);
    }
    if (chosen.has(definition.id)) continue;

    const ofSite = searches.filter(search => search.site === definition.id);
    const search = ofSite.find(item => item.enabled !== false) || ofSite[0];
    if (!search) throw new Error(`--site ${value}: no search for "${definition.id}" in user/config.json`);
    if (search.enabled === false) forced.push(definition.name);
    chosen.set(definition.id, { ...search, enabled: true });
  }

  return { searches: [...chosen.values()], forced };
}

module.exports = { createSites, searchesForSites };
