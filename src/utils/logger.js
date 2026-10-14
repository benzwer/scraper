function createLogger(scope) {
  const stamp = () => new Date().toLocaleTimeString('en-GB');
  const prefix = level => `${stamp()} ${level} [${scope}]`;

  return {
    info: (...args) => console.log(prefix('INFO '), ...args),
    warn: (...args) => console.warn(prefix('WARN '), ...args),
    error: (...args) => console.error(prefix('ERROR'), ...args)
  };
}

module.exports = { createLogger };
