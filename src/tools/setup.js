// npm run setup: creates user/ from examples/ (never overwrites existing files).
const fs = require('node:fs');
const path = require('node:path');

const defaults = require('../../config/default');

const examplesDir = path.join(defaults.paths.root, 'examples');
const { userDir } = defaults.paths;

function copyIfMissing(from, to) {
  if (fs.existsSync(to)) {
    console.log(`kept     ${path.relative(defaults.paths.root, to)} (already exists)`);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`created  ${path.relative(defaults.paths.root, to)}`);
}

copyIfMissing(path.join(examplesDir, 'config.json'), path.join(userDir, 'config.json'));

for (const name of fs.readdirSync(path.join(examplesDir, 'sites'))) {
  copyIfMissing(path.join(examplesDir, 'sites', name), path.join(userDir, 'sites', name));
}

const envFile = path.join(defaults.paths.root, '.env');
copyIfMissing(path.join(defaults.paths.root, '.env.example'), envFile);

console.log(`
Next steps:
  1. Describe your portals in user/sites/ (start from the *-example.json files).
  2. Put your search URLs and filters in user/config.json.
  3. Check each site on a saved page:  npm run check-site -- <site-id> <page.html>
  4. Fill in a notification channel in .env, then run:  npm start`);
