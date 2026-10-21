// Terminal styling for the tools (check-site, analyze-page): colours, status marks, headings and
// coverage bars. Colours are only used on a terminal, and never with NO_COLOR set
// (https://no-color.org); FORCE_COLOR turns them on anyway. Without colours the output stays
// plain text, readable in a log file.
const { env } = process;

const colors = 'FORCE_COLOR' in env ? env.FORCE_COLOR !== '0'
  : Boolean(process.stdout.isTTY) && !('NO_COLOR' in env) && env.TERM !== 'dumb';

const paint = (open, close) => value => (colors ? `\x1b[${open}m${value}\x1b[${close}m` : String(value));

const bold = paint(1, 22);
const dim = paint(2, 22);
const red = paint(31, 39);
const green = paint(32, 39);
const yellow = paint(33, 39);
const cyan = paint(36, 39);

const mark = {
  ok: green('✓'),
  warn: yellow('!'),
  fail: red('✗'),
  info: cyan('›')
};

const WIDTH = 72;

// "━━ Title ━━━━━━━…", preceded by an empty line.
function heading(title, detail = '') {
  const label = detail ? `${title}  ${detail}` : title;
  const rule = '━'.repeat(Math.max(3, WIDTH - label.length - 4));
  console.log(`\n${cyan('━━')} ${bold(title)}${detail ? `  ${dim(detail)}` : ''} ${cyan(rule)}`);
}

// "████████░░░░ 12/16": green when full, yellow when partial, red when empty.
function bar(count, total, width = 16) {
  const filled = total ? Math.round((count / total) * width) : 0;
  const color = count === total && total ? green : count ? yellow : red;
  return `${color('█'.repeat(filled))}${dim('░'.repeat(width - filled))} ${color(`${count}/${total}`)}`;
}

// "  label      value", with the labels lined up.
const row = (label, value, width = 11) => `  ${dim(label.padEnd(width))} ${value}`;

const shorten = (value, max = 80) => {
  const content = String(value);
  return content.length > max ? `${content.slice(0, max - 1)}…` : content;
};

module.exports = { colors, bold, dim, red, green, yellow, cyan, mark, heading, bar, row, shorten };
