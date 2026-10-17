// Recognises the pages a site shows when it refuses automated access (captchas, bot checks,
// "access denied"). The scraper does not try to get past them: it stops visiting the site
// for a while and tells the user (see Scraper.handleBlock).

// HTTP statuses that mean "you are not welcome right now".
const BLOCK_STATUSES = new Set([403, 429]);

function blockedStatus(response) {
  const status = response?.status();
  return BLOCK_STATUSES.has(status) ? `HTTP ${status}` : null;
}

// Runs in the browser: must be self-contained. Returns the name of the bot check found, or null.
function findBlockSignal() {
  const SIGNALS = [
    ['DataDome captcha', 'iframe[src*="captcha-delivery.com"]'],
    ['Cloudflare challenge', '#challenge-form, #challenge-stage, iframe[src*="challenges.cloudflare.com"]'],
    ['PerimeterX captcha', '#px-captcha'],
    ['hCaptcha', 'iframe[src*="hcaptcha.com"]'],
    ['reCAPTCHA', 'iframe[src*="/recaptcha/"]']
  ];

  for (const [name, selector] of SIGNALS) {
    if (document.querySelector(selector)) return name;
  }
  return null;
}

module.exports = { blockedStatus, findBlockSignal };
