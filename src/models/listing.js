// Common schema: each site produces raw data, which is turned into a uniform Listing here.
// Raw values may be numbers or text: text is parsed (Italian number formats included).

// Integer part of the first number: "€ 1.200/mese", "$1,200", "1.250,50" and "1,250.50" -> 1200/1250.
// A separator followed by exactly three digits is a thousands separator, otherwise decimals.
function parsePrice(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Math.floor(text);
  const match = String(text).match(/\d+(?:[.,]\d+)*/);
  if (!match) return null;

  let integer = '';
  for (const [i, part] of match[0].split(/[.,]/).entries()) {
    if (i > 0 && part.length !== 3) break;
    integer += part;
  }
  return parseInt(integer, 10);
}

// "85 m²", "72,5 mq" or a bare "85".
function parseSurface(text) {
  if (text == null) return null;
  if (typeof text === 'number') return text;
  const match =
    String(text).match(/(\d+(?:[.,]\d+)?)\s*m/i) || String(text).match(/^\s*(\d+(?:[.,]\d+)?)\s*$/);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

function parseRooms(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeListing(raw, source) {
  if (!raw) return null;

  const id = raw.id != null ? String(raw.id) : null;
  const url = raw.url ?? null;
  if (!id && !url) return null;

  return {
    source,
    id,
    title: raw.title != null ? String(raw.title) : null,
    url,
    priceText: typeof raw.price === 'string' ? raw.price : null,
    price: typeof raw.price === 'number' ? raw.price : parsePrice(raw.price),
    surface: parseSurface(raw.surface),
    rooms: parseRooms(raw.rooms),
    city: raw.city != null ? String(raw.city) : null,
    scrapedAt: new Date().toISOString()
  };
}

function listingKey(listing) {
  return `${listing.source}:${listing.id ?? listing.url}`;
}

// Heuristic key to recognise the same flat on different portals.
function crossKey(listing) {
  if (listing.price == null || listing.surface == null || listing.rooms == null) return null;
  return `${listing.price}|${listing.surface}|${listing.rooms}`;
}

function passesFilters(listing, filters = {}) {
  const { maxPrice, minSurface, minRooms, maxRooms } = filters;

  if (maxPrice != null && listing.price != null && listing.price > maxPrice) return false;
  if (minSurface != null && listing.surface != null && listing.surface < minSurface) return false;
  if (minRooms != null && listing.rooms != null && listing.rooms < minRooms) return false;
  if (maxRooms != null && listing.rooms != null && listing.rooms > maxRooms) return false;

  return true;
}

function formatListing(listing) {
  const parts = [
    listing.priceText || (listing.price != null ? `${listing.price} €` : null),
    listing.surface != null ? `${listing.surface} m²` : null,
    listing.rooms != null ? `${listing.rooms} rooms` : null,
    listing.city,
    listing.duplicateSource ? `possible duplicate of ${listing.duplicateSource}` : null
  ].filter(Boolean);

  return {
    title: `${listing.source}: ${listing.title || 'New listing'}`,
    message: parts.join(' · ') || 'Details not available',
    url: listing.url
  };
}

module.exports = {
  parsePrice,
  parseSurface,
  parseRooms,
  normalizeListing,
  listingKey,
  crossKey,
  passesFilters,
  formatListing
};
