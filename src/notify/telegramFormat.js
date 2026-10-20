// Telegram versions of the notifications, sent with parse_mode HTML.
// Every value coming from a portal is escaped: titles may contain <, > or &.

const MAX_TITLE = 200;
const MAX_DIGEST_TITLE = 80;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Telegram rejects the whole message when a link or button points to something else.
const isWebUrl = url => typeof url === 'string' && /^https?:\/\/\S+$/i.test(url);

const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function detailLine(listing) {
  const price = listing.priceText || (listing.price != null ? `${listing.price} €` : null);
  return [
    price && `💶 ${price}`,
    listing.surface != null && `📐 ${listing.surface} m²`,
    listing.rooms != null && `🚪 ${listing.rooms} rooms`
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join('  ·  ');
}

const duplicateLine = listing =>
  listing.duplicateSource ? `⚠️ possible duplicate of ${escapeHtml(listing.duplicateSource)}` : null;

function listingMessage(listing) {
  const title = shorten(listing.title || 'New listing', MAX_TITLE);
  return [
    `🏠 <b>${escapeHtml(title)}</b>`,
    `<i>${escapeHtml(listing.source)}</i>`,
    '',
    detailLine(listing) || 'Details not available',
    listing.city && `📍 ${escapeHtml(listing.city)}`,
    duplicateLine(listing)
  ]
    .filter(line => line != null && line !== false)
    .join('\n');
}

// shown: the listings to list; total: how many new listings there are in all.
function digestMessage(siteName, shown, total) {
  const items = shown.map((listing, index) => {
    const title = escapeHtml(shorten(listing.title || 'New listing', MAX_DIGEST_TITLE));
    const name = isWebUrl(listing.url) ? `<a href="${escapeHtml(listing.url)}">${title}</a>` : title;
    const details = [detailLine(listing), listing.city && `📍 ${escapeHtml(listing.city)}`]
      .filter(Boolean)
      .join('  ·  ');
    return [`${index + 1}. <b>${name}</b>`, details, duplicateLine(listing)].filter(Boolean).join('\n');
  });
  if (total > shown.length) items.push(`<i>…and ${total - shown.length} more</i>`);

  return [`🔔 <b>${escapeHtml(siteName)}</b>: ${total} new listings`, '', items.join('\n\n')].join('\n');
}

// Any other notification (e.g. a blocked site): bold title, plain message.
const plainMessage = (title, message) =>
  [title && `<b>${escapeHtml(title)}</b>`, message && escapeHtml(message)].filter(Boolean).join('\n');

module.exports = { escapeHtml, isWebUrl, listingMessage, digestMessage, plainMessage };
