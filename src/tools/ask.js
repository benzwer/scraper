// One question in the terminal; resolves to the trimmed answer.
const readline = require('node:readline/promises');

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

module.exports = { ask };
