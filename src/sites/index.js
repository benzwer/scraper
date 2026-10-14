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

module.exports = { createSites };
