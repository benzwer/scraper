// npm run help (also: npm start -- --help): every command, with its options.
// The usage lines here are also the error messages of the tools, so they stay in one place.

const COMMANDS = [
  {
    group: 'Running',
    name: 'start',
    usage: ['npm start [-- --site <id or name>] [--retry-blocked]'],
    summary: 'One run of every enabled search; the last browser stays open until you press ENTER. ' +
      'The log is also saved in data/logs/<date>.log.',
    options: [
      ['--site <id or name>', 'only this site, even if its search is disabled (repeat it for more)'],
      ['--retry-blocked', 'also visit the portals paused after a block']
    ],
    example: 'npm start -- --site my-portal'
  },
  {
    group: 'Running',
    name: 'watch',
    usage: ['npm run watch [-- --site <id or name>]'],
    summary: 'A run every 30-60 minutes within the active hours (07:00-22:00). Stop with Ctrl+C. ' +
      'The log is also saved in data/logs/<date>.log.',
    options: [['--site <id or name>', 'only this site (repeat it for more)']]
  },
  {
    group: 'Site definitions',
    name: 'setup',
    usage: ['npm run setup'],
    summary: 'Creates user/ (config.json, example sites) and .env from the examples. Never overwrites.'
  },
  {
    group: 'Site definitions',
    name: 'analyze-page',
    usage: [
      'npm run analyze-page -- --url "<url>" [--write <definition.json>]',
      'npm run analyze-page -- <page.html> [--base-url <url>] [--write <definition.json>]'
    ],
    summary: 'Analyses a results page, live or saved, and drafts a site definition. Offers to save it ' +
      'in user/sites/ and to add the search to user/config.json.',
    options: [
      ['--url "<url>"', 'open it in a visible browser, press ENTER when the results are shown'],
      ['<page.html>', 'analyse a saved page, offline'],
      ['--base-url <url>', 'with a saved page: the portal address, for real links'],
      ['--write <file>', 'save the draft there without asking (never overwrites)']
    ],
    notes: ['Put the URL in quotes: characters like & and ; would otherwise cut it.'],
    example: 'npm run analyze-page -- --url "https://www.my-portal.example/rent?city=x&sort=newest"'
  },
  {
    group: 'Site definitions',
    name: 'check-site',
    usage: ['npm run check-site -- <id | file> <page.html> [--base-url <url>] [--show <n>] [--fix] [--open]'],
    summary: 'Tests a site definition on a saved page, offline, and shows what it extracts.',
    options: [
      ['--base-url <url>', 'address the page is served at, for relative links (default: homeUrl)'],
      ['--show <n>', 'listings to print (default 5)'],
      ['--fix', 'fill empty fields and missing buttons from what you see on the page'],
      ['--open', 'also show the page in a visible browser, with its scripts and styles']
    ],
    notes: [
      '--fix shows the text of a listing where a field is empty, finds the value you type in it and',
      'proposes selectors or JSON paths, tried on every listing. Then, for the next-page button, the',
      'cookie banner and popups the scraper does not find, it finds the button by the text you type.',
      'The choices are saved after confirmation.'
    ],
    example: 'npm run check-site -- my-portal data/debug/analyze_my-portal.example.html --fix'
  },
  {
    group: 'Data',
    name: 'clear-today',
    usage: ['npm run clear-today -- [--site <id or name>] [--yes]'],
    summary: 'Forgets the listings first seen today, so the next run notifies them again. ' +
      'Run it while the scraper is stopped.',
    options: [
      ['--site <id or name>', 'only the listings of that portal'],
      ['--yes', 'do not ask for confirmation']
    ],
    example: 'npm run clear-today -- --site my-portal'
  },
  {
    group: 'Other',
    name: 'test',
    usage: ['npm test'],
    summary: 'Unit tests, no network.'
  },
  {
    group: 'Other',
    name: 'help',
    usage: ['npm run help', 'npm run <command> -- --help'],
    summary: 'This list, or the details of one command.'
  }
];

const find = name => {
  const command = COMMANDS.find(item => item.name === name);
  if (!command) throw new Error(`help: unknown command "${name}"`);
  return command;
};

// "Usage: ..." lines of one command, for the tools' error messages.
const usage = name => find(name).usage
  .map((line, i) => `${i ? '       ' : 'Usage: '}${line}`)
  .join('\n');

// Splits text into lines of at most `width` characters, each starting with indent.
function wrap(text, indent, width = 96) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return [...lines, indent + line];
}

function optionLines(options = [], indent) {
  const width = Math.max(...options.map(([flag]) => flag.length));
  return options.map(([flag, text]) => `${indent}${flag.padEnd(width)}  ${text}`);
}

function commandHelp(name) {
  const command = find(name);
  return [
    usage(name),
    '',
    ...wrap(command.summary, ''),
    ...(command.options ? ['', 'Options:', ...optionLines(command.options, '  ')] : []),
    ...(command.notes ? ['', ...command.notes] : []),
    ...(command.example ? ['', `Example: ${command.example}`] : [])
  ].join('\n');
}

function generalHelp() {
  const lines = [
    'Rental listings scraper: watches the portals in user/config.json, notifies only new listings.',
    ''
  ];
  for (const group of [...new Set(COMMANDS.map(command => command.group))]) {
    lines.push(`${group}:`);
    for (const command of COMMANDS.filter(item => item.group === group)) {
      for (const line of command.usage) lines.push(`  ${line}`);
      lines.push(...wrap(command.summary, '      '));
      if (command.options) lines.push(...optionLines(command.options, '        '));
    }
    lines.push('');
  }
  lines.push('Details of a command: npm run <command> -- --help   (e.g. npm run analyze-page -- --help)');
  lines.push('Full guide: README.md');
  return lines.join('\n');
}

// For the tools: prints the command's help and returns true when --help or -h was passed.
function handleHelp(name, argv) {
  if (!argv.includes('--help') && !argv.includes('-h')) return false;
  console.log(commandHelp(name));
  return true;
}

if (require.main === module) console.log(generalHelp());

module.exports = { COMMANDS, usage, commandHelp, generalHelp, handleHelp };
