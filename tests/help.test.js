const test = require('node:test');
const assert = require('node:assert/strict');

const { COMMANDS, usage, commandHelp, generalHelp } = require('../src/tools/help');
const { scripts } = require('../package.json');

test('help lists exactly the npm scripts', () => {
  assert.deepEqual(COMMANDS.map(command => command.name).sort(), Object.keys(scripts).sort());
});

test('help texts: usage lines, one command, every command', () => {
  assert.equal(usage('clear-today'), 'Usage: npm run clear-today -- [--site <id or name>] [--yes]');
  assert.match(commandHelp('check-site'), /Options:\n {2}--base-url <url>/);
  assert.ok(generalHelp().split('\n').every(line => line.length <= 100));
  for (const command of COMMANDS) assert.ok(generalHelp().includes(command.usage[0]));
  assert.throws(() => usage('nope'), /unknown command "nope"/);
});
