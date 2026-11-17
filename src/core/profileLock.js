const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// On Linux Chromium marks a profile in use with SingletonLock, a symlink to "<hostname>-<pid>".
// If the browser is killed (container stopped mid-run, crash) the lock stays in the profile, and
// a recreated Docker container has a new hostname: Chromium then refuses the profile as "in use
// by another computer". The scraper is the only user of its profiles, so a lock left by another
// host, or by a process that no longer exists, is stale and can be removed.
const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Returns the lock owner ("host-pid") when a stale lock was removed, otherwise null.
async function removeStaleProfileLock(profileDir, hostname = os.hostname()) {
  let owner;
  try {
    owner = await fs.readlink(path.join(profileDir, 'SingletonLock'));
  } catch {
    return null; // no lock (or not a symlink, e.g. on Windows, where Chromium handles it itself)
  }

  const match = /^(.*)-(\d+)$/.exec(owner);
  if (!match) return null;
  const [, host, pid] = match;
  if (host === hostname && isRunning(Number(pid))) return null;

  await Promise.all(LOCK_FILES.map(name => fs.rm(path.join(profileDir, name), { force: true })));
  return owner;
}

module.exports = { removeStaleProfileLock };
