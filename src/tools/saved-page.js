// Opens a saved HTML page entirely offline: the page's own scripts are disabled and every network
// request is blocked. The page is served at baseUrl so relative links resolve as on the portal.
async function openSavedPage(browser, html, baseUrl) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', route =>
    route.request().url() === baseUrl
      ? route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' })
      : route.abort()
  );

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  return page;
}

module.exports = { openSavedPage };
