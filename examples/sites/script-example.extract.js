// Custom extractor for script-example.json.
// It runs INSIDE the browser page: no require(), no variables from outside the function.
// It receives extract.options from the site definition and must return an array of
// { id, url, title, price, surface, rooms, city } (any of them may be null, but url or id is needed).
module.exports = function extract(options) {
  return Array.from(document.querySelectorAll(options.card)).map(card => {
    const text = card.textContent.replace(/\s+/g, ' ');
    const surface = text.match(/(\d+(?:[.,]\d+)?)\s*m²/);
    const rooms = text.match(/(\d+)\+?\s*rooms?/i);

    return {
      id: card.getAttribute('data-id'),
      url: card.querySelector('a')?.href || null,
      title: card.querySelector('h2')?.textContent.trim() || null,
      price: card.querySelector('.listing-card__price')?.textContent.trim() || null,
      surface: surface ? surface[1] : null,
      rooms: rooms ? rooms[1] : null,
      city: card.querySelector('.listing-card__city')?.textContent.trim() || null
    };
  });
};
