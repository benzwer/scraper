const fs = require('node:fs/promises');
const path = require('node:path');

const { listingKey, crossKey } = require('../models/listing');

// On-disk memory: listings already seen (to report only new ones) and cross-portal duplicates.
class ResultStore {
  // retentionDays: listings not seen for longer than this are dropped on save (null = keep forever).
  constructor(dataDir, { retentionDays = null } = {}) {
    this.dir = dataDir;
    this.retentionDays = retentionDays;
    this.file = path.join(dataDir, 'seen.json');
    this.data = { listings: {}, cross: {} };
  }

  async load() {
    await fs.mkdir(this.dir, { recursive: true });

    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.data = {
        listings: parsed.listings || {},
        cross: parsed.cross || {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  hasSource(source) {
    return Object.values(this.data.listings).some(item => item.source === source);
  }

  // Registers the listings and returns only the ones that are really new.
  // "duplicates" are listings already seen on ANOTHER portal (same price, surface and rooms).
  registerMany(listings) {
    const now = new Date().toISOString();
    const added = [];
    const duplicates = [];

    for (const listing of listings) {
      const key = listingKey(listing);
      const existing = this.data.listings[key];

      if (existing) {
        existing.lastSeen = now;
        continue;
      }

      const cross = crossKey(listing);
      const prior = cross ? this.data.cross[cross] : null;
      const isDuplicate = Boolean(prior && prior.source !== listing.source);

      this.data.listings[key] = {
        ...listing,
        firstSeen: now,
        lastSeen: now,
        duplicateOf: isDuplicate ? prior.key : null
      };

      if (cross && !prior) this.data.cross[cross] = { source: listing.source, key };

      if (isDuplicate) {
        duplicates.push({ ...listing, duplicateSource: prior.source });
      } else {
        added.push(listing);
      }
    }

    return { added, duplicates };
  }

  // Removes listings not seen since before the retention window, and the cross keys pointing to them.
  prune(now = Date.now()) {
    if (this.retentionDays == null) return 0;

    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [key, item] of Object.entries(this.data.listings)) {
      if (Date.parse(item.lastSeen) < cutoff) {
        delete this.data.listings[key];
        removed++;
      }
    }

    for (const [cross, entry] of Object.entries(this.data.cross)) {
      if (!this.data.listings[entry.key]) delete this.data.cross[cross];
    }

    return removed;
  }

  async save() {
    this.prune();
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  async exportRun(listings, fileName = 'latest.json') {
    await fs.writeFile(
      path.join(this.dir, fileName),
      JSON.stringify(listings, null, 2),
      'utf8'
    );
  }
}

module.exports = { ResultStore };
