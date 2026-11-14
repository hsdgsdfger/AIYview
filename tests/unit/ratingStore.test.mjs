import test from 'node:test';
import assert from 'node:assert/strict';

import storePkg from '../../src/core/legacy/ratingStore.cjs';

const { RatingStore } = storePkg;

function memfs() {
  const files = new Map();
  return {
    files,
    async readFile(p) {
      if (!files.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files.get(p);
    },
    async writeFile(p, data) { files.set(p, String(data)); },
    async rename(from, to) {
      if (!files.has(from)) throw new Error('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
    async unlink(p) { files.delete(p); }
  };
}

function makeStore(fs, now = 1000) {
  return new RatingStore({ filePath: 'C:/app/image_ratings.json', fs, now: () => now, debounceMs: 1 });
}

test('set/get：写入后立即可读', async () => {
  const store = makeStore(memfs());
  await store.set('C:/pics/a.png', { level: 2, source: 'keyword' });
  const hit = store.get('C:/pics/a.png');
  assert.equal(hit.level, 2);
  assert.equal(hit.key, 'l2');
  assert.equal(hit.manual, false);
});

test('非法档位被拒绝', async () => {
  const store = makeStore(memfs());
  assert.equal(await store.set('C:/a.png', { level: 9 }), false);
  assert.equal(await store.set('', { level: 1 }), false);
});

test('手动结果不被自动判定覆盖', async () => {
  const store = makeStore(memfs());
  await store.set('C:/a.png', { level: 4, source: 'manual', manual: true });
  const changed = await store.set('C:/a.png', { level: 0, source: 'keyword', manual: false });
  assert.equal(changed, false);
  assert.equal(store.get('C:/a.png').level, 4);
});

test('手动可覆盖手动（用户改主意）', async () => {
  const store = makeStore(memfs());
  await store.set('C:/a.png', { level: 4, manual: true });
  await store.set('C:/a.png', { level: 1, manual: true });
  assert.equal(store.get('C:/a.png').level, 1);
});

test('落盘格式紧凑，重新加载后一致', async () => {
  const fs = memfs();
  const store = makeStore(fs);
  await store.set('C:/a.png', { level: 3, source: 'keyword', manual: true });
  await store.flush();

  const raw = JSON.parse(fs.files.get('C:/app/image_ratings.json'));
  assert.equal(raw.version, 1);
  assert.equal(raw.ratings['C:/a.png'].l, 3);
  assert.equal(raw.ratings['C:/a.png'].m, 1);

  const reopened = makeStore(fs);
  const res = await reopened.init();
  assert.equal(res.entries, 1);
  assert.equal(reopened.get('C:/a.png').level, 3);
  assert.equal(reopened.get('C:/a.png').manual, true);
});

test('索引损坏时从空表启动，不抛错', async () => {
  const fs = memfs();
  fs.files.set('C:/app/image_ratings.json', '{ broken json');
  const store = makeStore(fs);
  const res = await store.init();
  assert.equal(res.entries, 0);
  assert.equal(res.recovered, false);
});

test('setMany 只写一次盘', async () => {
  const fs = memfs();
  let writes = 0;
  const rawWrite = fs.writeFile.bind(fs);
  fs.writeFile = async (p, d) => { writes++; return rawWrite(p, d); };

  const store = makeStore(fs);
  const changed = await store.setMany([
    { filePath: 'C:/a.png', rating: { level: 1 } },
    { filePath: 'C:/b.png', rating: { level: 2 } },
    { filePath: 'C:/c.png', rating: { level: 3 } }
  ]);
  assert.equal(changed, 3);
  assert.equal(writes, 1);
});

test('remove 与统计', async () => {
  const store = makeStore(memfs());
  await store.set('C:/a.png', { level: 0 });
  await store.set('C:/b.png', { level: 2, manual: true });
  await store.set('C:/c.png', { level: 2 });

  const stats = store.stats();
  assert.equal(stats.total, 3);
  assert.equal(stats.byLevel[2], 2);
  assert.equal(stats.manual, 1);

  assert.equal(await store.remove('C:/a.png'), true);
  assert.equal(store.stats().total, 2);
});
