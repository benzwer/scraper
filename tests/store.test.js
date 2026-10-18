const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ResultStore } = require('../src/core/ResultStore');

const make = (source, id, extra = {}) => ({
  source, id, url: `https://x/${id}`, price: 1000, surface: 80, rooms: 3, ...extra
});

test('reports only never-seen listings as new and remembers them across runs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));

  const store = new ResultStore(dir);
  await store.load();
  assert.equal(store.hasSource('A'), false);

  let res = store.registerMany([make('A', '1'), make('A', '2', { price: 1500 })]);
  assert.equal(res.added.length, 2);
  assert.equal(store.hasSource('A'), true);
  await store.save();

  const reloaded = new ResultStore(dir);
  await reloaded.load();
  res = reloaded.registerMany([make('A', '1'), make('A', '3', { price: 1700 })]);
  assert.deepEqual(res.added.map(l => l.id), ['3']);
});

test('recognises the same flat on another portal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const store = new ResultStore(dir);
  await store.load();

  store.registerMany([make('A', '1')]);
  const res = store.registerMany([make('B', '9')]);   // same price/surface/rooms
  assert.equal(res.added.length, 0);
  assert.equal(res.duplicates.length, 1);
  assert.equal(res.duplicates[0].duplicateSource, 'A');
});

test('prune drops listings not seen within the retention window and their cross keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const store = new ResultStore(dir, { retentionDays: 90 });
  await store.load();

  store.registerMany([make('A', 'old'), make('A', 'recent', { price: 1500 })]);
  store.data.listings['A:old'].lastSeen = new Date(Date.now() - 91 * 86400000).toISOString();

  assert.equal(store.prune(), 1);
  assert.deepEqual(Object.keys(store.data.listings), ['A:recent']);
  assert.deepEqual(Object.keys(store.data.cross), ['1500|80|3']);
});

test('prune keeps everything when retentionDays is null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const store = new ResultStore(dir);
  await store.load();

  store.registerMany([make('A', '1')]);
  store.data.listings['A:1'].lastSeen = '2000-01-01T00:00:00.000Z';
  assert.equal(store.prune(), 0);
});

test('removeWhere forgets the matching listings, which are then new again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const store = new ResultStore(dir);
  await store.load();

  store.registerMany([make('A', '1'), make('A', '2', { price: 1500 }), make('B', '7', { price: 1700 })]);
  const removed = store.removeWhere(item => item.source === 'A' && item.id === '1');

  assert.deepEqual(removed.map(item => item.id), ['1']);
  assert.deepEqual(Object.keys(store.data.listings), ['A:2', 'B:7']);
  assert.deepEqual(Object.keys(store.data.cross), ['1500|80|3', '1700|80|3']);
  assert.deepEqual(store.registerMany([make('A', '1')]).added.map(item => item.id), ['1']);
});
