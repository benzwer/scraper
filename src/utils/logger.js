const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

// When set (the scraper does it at startup; the tools only print), every line is also appended
// to <logDir>/<YYYY-MM-DD>.log: one file per day, so "watch" does not grow a single huge file.
let logDir = null;
let fileFailed = false;

function setLogDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logDir = dir;
}

const pad = number => String(number).padStart(2, '0');
const dayOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function appendToFile(line, date) {
  if (!logDir || fileFailed) return;
  try {
    fs.appendFileSync(path.join(logDir, `${dayOf(date)}.log`), `${dayOf(date)} ${line}\n`, 'utf8');
  } catch (error) {
    // Said once: the terminal keeps every line anyway.
    fileFailed = true;
    console.warn(`Log file not written (${error.message}): logging to the terminal only.`);
  }
}

function createLogger(scope) {
  const writer = (level, method) => (...args) => {
    const date = new Date();
    const line = `${date.toLocaleTimeString('en-GB')} ${level} [${scope}] ${format(...args)}`;
    console[method](line);
    appendToFile(line, date);
  };

  return {
    info: writer('INFO ', 'log'),
    warn: writer('WARN ', 'warn'),
    error: writer('ERROR', 'error')
  };
}

module.exports = { createLogger, setLogDir };
