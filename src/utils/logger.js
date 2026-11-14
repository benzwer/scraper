const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');

// When set (the scraper does it at startup; the tools only print), every line is also appended
// to <logDir>/<YYYY-MM-DD>.log: one file per day, so "watch" does not grow a single huge file.
// Files older than retentionDays are deleted at startup and whenever a new day's file begins.
let logDir = null;
let retentionDays = null;
let currentDay = null;
let fileFailed = false;
// Called with { level, scope, text } on every warning and error (the scraper sends them as
// notifications; the tools set none).
let alertHandler = null;

const LOG_FILE_RE = /^(\d{4})-(\d\d)-(\d\d)\.log$/;
const pad = number => String(number).padStart(2, '0');
const dayOf = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Deletes the daily files dated before today minus `days` (today's file and the previous `days`
// are kept). Only names like 2026-10-18.log are touched. Returns the deleted names.
function removeOldLogs(dir, days, now = new Date()) {
  if (days == null) return [];
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    const match = LOG_FILE_RE.exec(name);
    if (!match || new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) >= cutoff) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch {
      // In use or already gone: tried again the next day.
    }
  }
  return removed;
}

function setLogDir(dir, { retentionDays: days = null } = {}) {
  if (days != null && !(Number.isInteger(days) && days >= 0)) {
    throw new Error('logs.retentionDays: must be a whole number of days, or null to keep every log');
  }
  fs.mkdirSync(dir, { recursive: true });
  logDir = dir;
  retentionDays = days;
  currentDay = null;
}

function appendToFile(line, date) {
  if (!logDir || fileFailed) return;
  const day = dayOf(date);
  try {
    if (day !== currentDay) {
      currentDay = day;
      removeOldLogs(logDir, retentionDays, date);
    }
    fs.appendFileSync(path.join(logDir, `${day}.log`), `${day} ${line}\n`, 'utf8');
  } catch (error) {
    // Said once: the terminal keeps every line anyway.
    fileFailed = true;
    console.warn(`Log file not written (${error.message}): logging to the terminal only.`);
  }
}

function setAlertHandler(handler) {
  alertHandler = handler;
}

function createLogger(scope) {
  const writer = (level, method) => (...args) => {
    const date = new Date();
    const text = format(...args);
    const line = `${date.toLocaleTimeString('en-GB')} ${level} [${scope}] ${text}`;
    console[method](line);
    appendToFile(line, date);
    if (alertHandler && method !== 'log') {
      try {
        alertHandler({ level: method, scope, text });
      } catch {
        // A failing alert must not break the code that logged.
      }
    }
  };

  return {
    info: writer('INFO ', 'log'),
    warn: writer('WARN ', 'warn'),
    error: writer('ERROR', 'error')
  };
}

module.exports = { createLogger, setLogDir, setAlertHandler, removeOldLogs };
