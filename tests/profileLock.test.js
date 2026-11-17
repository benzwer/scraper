const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { removeStaleProfileLock } = require('../src/core/profileLock');

// Chromium's lock is a dangling symlink to "<hostname>-<pid>", next to SingletonCookie/Socket.
function lockedProfile(owner) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
  try {
    fs.symlinkSync(owner, path.join(dir, 'SingletonLock'));
  } catch {
    return null; // symlinks need extra privileges on Windows
  }
  fs.writeFileSync(path.join(dir, 'SingletonCookie'), '');
  return dir;
}

const hasLock = dir => fs.readdirSync(dir).some(name => name.startsWith('Singleton'));

test('removes the lock left by another host (e.g. a recreated container)', async t => {
  const dir = lockedProfile(`old-container-${process.pid}`);
  if (!dir) return t.skip('cannot create symlinks here');

  assert.equal(await removeStaleProfileLock(dir, 'new-container'), `old-container-${process.pid}`);
  assert.equal(hasLock(dir), false);
});

test('removes the lock of a process that no longer exists on this host', async t => {
  const dir = lockedProfile('this-host-999999999');
  if (!dir) return t.skip('cannot create symlinks here');

  assert.equal(await removeStaleProfileLock(dir, 'this-host'), 'this-host-999999999');
  assert.equal(hasLock(dir), false);
});

test('keeps the lock of a running process on this host', async t => {
  const dir = lockedProfile(`this-host-${process.pid}`);
  if (!dir) return t.skip('cannot create symlinks here');

  assert.equal(await removeStaleProfileLock(dir, 'this-host'), null);
  assert.equal(hasLock(dir), true);
});

test('does nothing when the profile has no lock or does not exist yet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-'));
  assert.equal(await removeStaleProfileLock(dir), null);
  assert.equal(await removeStaleProfileLock(path.join(dir, 'missing')), null);
});
