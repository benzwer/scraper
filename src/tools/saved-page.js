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

// Shows the same saved page in a visible browser, for the eye only: scripts run and stylesheets,
// images and scripts are loaded from the portal, so the page looks as it did. Only baseUrl itself
// is answered with the saved HTML. Nothing is read from this window.
async function showSavedPage(chromium, html, baseUrl) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  await context.route('**/*', route =>
    route.request().url() === baseUrl
      ? route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' })
      : route.continue()
  );

  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    await browser.close();
    throw error;
  }
  return browser;
}

module.exports = { openSavedPage, showSavedPage };
