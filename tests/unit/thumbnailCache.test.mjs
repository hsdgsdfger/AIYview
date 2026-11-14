import test from 'node:test';
import assert from 'node:assert/strict';

import cachePkg from '../../src/core/legacy/thumbnailCache.cjs';

const { ThumbnailCacheStore } = cachePkg;

/** 内存 fs，仅实现 store 用到的接口 */
function memfs() {
  const files = new Map();
  return {
    files,
    async mkdir() {},
    async readFile(p) {
      if (!files.has(p)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p).data;
    },
    async writeFile(p, data) {
      files.set(p, { data: Buffer.from(data), size: Buffer.byteLength(data) });
    },
    async access(p) {
      if (!files.has(p)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
    },
    async unlink(p) {
      if (!files.has(p)) throw new Error('ENOENT');
      files.delete(p);
    },
    put(p, size) {
      files.set(p, { data: Buffer.alloc(size), size });
    }
  };
}

function makeStore(fs, overrides = {}) {
  return new ThumbnailCacheStore({
    dir: 'C:/cache',
    quotaBytes: overrides.quotaBytes ?? 1024,
    maxEntries: overrides.maxEntries ?? 100,
    fs,
    now: overrides.now || (() => 1000)
  });
}

test('cachePath 稳定：同路径同尺寸哈希一致', () => {
  const store = makeStore(memfs());
  const a = store.cachePathFor('C:/pics/a.png', 600);
  const b = store.cachePathFor('C:/pics/a.png', 600);
  const c = store.cachePathFor('C:/pics/a.png', 900);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a.endsWith('_600.jpg'));
});

test('put/lookup 命中并记录字节数', async () => {
  const fs = memfs();
  const store = makeStore(fs);
  await store.put('C:/pics/a.png', 600, 200, { mtime: 500 });

  const hit = store.lookup('C:/pics/a.png', 600, 400);
  assert.equal(hit.hit, true);
  assert.equal(store.stats().entries, 1);
  assert.equal(store.stats().bytes, 200);
});

test('源文件更新后失效（mtime 比缓存新）', async () => {
  const store = makeStore(memfs());
  await store.put('C:/pics/a.png', 600, 100, { mtime: 500 });

  const stale = store.lookup('C:/pics/a.png', 600, 900);
  assert.equal(stale.hit, false);
  assert.equal(stale.stale, true);

  const fresh = store.lookup('C:/pics/a.png', 600, 500);
  assert.equal(fresh.hit, true);
});

test('配额淘汰：先进先出按 LRU，落盘文件同步删除', async () => {
  const fs = memfs();
  const now = { v: 1 };
  const store = makeStore(fs, { quotaBytes: 1000, now: () => now.v });

  for (let i = 0; i < 6; i++) {
    const p = `C:/pics/${i}.png`;
    await store.put(p, 600, 300, { mtime: 1 });
    fs.put(store.cachePathFor(p, 600), 300);
    now.v++;
  }

  const stats = store.stats();
  assert.ok(stats.bytes <= Math.floor(1000 * 0.9), `淘汰后字节 ${stats.bytes} 应 ≤ 900`);
  assert.ok(stats.evicted > 0, '应发生淘汰');

  // 最早写入的应当已经被淘汰
  assert.equal(store.lookup('C:/pics/0.png', 600, 1).hit, false);
  // 最新的必须还在
  assert.equal(store.lookup('C:/pics/5.png', 600, 1).hit, true);
});

test('LRU 提权：被访问过的条目不会先被淘汰', async () => {
  const fs = memfs();
  const now = { v: 1 };
  const store = makeStore(fs, { quotaBytes: 1000, now: () => now.v });

  await store.put('C:/pics/keep.png', 600, 300, { mtime: 1 });
  now.v++;
  await store.put('C:/pics/drop.png', 600, 300, { mtime: 1 });
  now.v++;

  // 访问 keep → 提到 LRU 尾部
  store.lookup('C:/pics/keep.png', 600, 1);
  now.v++;

  await store.put('C:/pics/new1.png', 600, 300, { mtime: 1 });
  now.v++;
  await store.put('C:/pics/new2.png', 600, 300, { mtime: 1 });

  assert.equal(store.lookup('C:/pics/keep.png', 600, 1).hit, true, '被访问过的条目应保留');
  assert.equal(store.lookup('C:/pics/drop.png', 600, 1).hit, false, '最久未访问的应被淘汰');
});

test('clearFolder 只清掉该目录下的条目', async () => {
  const fs = memfs();
  const store = makeStore(fs, { quotaBytes: 1024 * 1024 });
  await store.put('C:/pics/a/1.png', 600, 10, { mtime: 1 });
  await store.put('C:/pics/a/2.png', 600, 10, { mtime: 1 });
  await store.put('C:/pics/b/1.png', 600, 10, { mtime: 1 });

  const removed = await store.clearFolder('C:/pics/a');
  assert.equal(removed, 2);
  assert.equal(store.lookup('C:/pics/b/1.png', 600, 1).hit, true);
});

test('索引持久化：重建 store 后条目仍在', async () => {
  const fs = memfs();
  const store = makeStore(fs, { quotaBytes: 1024 * 1024 });
  await store.put('C:/pics/a.png', 600, 42, { mtime: 7 });
  fs.put(store.cachePathFor('C:/pics/a.png', 600), 42);
  await store.save();

  const reopened = makeStore(fs, { quotaBytes: 1024 * 1024 });
  await reopened.init();

  assert.equal(reopened.stats().entries, 1);
  assert.equal(reopened.lookup('C:/pics/a.png', 600, 5).hit, true);
});

test('init 对账：索引里有但磁盘没有的条目被剔除', async () => {
  const fs = memfs();
  const store = makeStore(fs, { quotaBytes: 1024 * 1024 });
  await store.put('C:/pics/ghost.png', 600, 99, { mtime: 1 });
  await store.save(); // 故意不写实际缓存文件

  const reopened = makeStore(fs, { quotaBytes: 1024 * 1024 });
  const res = await reopened.init();
  assert.equal(res.entries, 0);
});
