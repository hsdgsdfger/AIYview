import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import scanPkg from '../../src/core/legacy/scanFolder.cjs';

const { scanFolder, mapLimit } = scanPkg;

async function makeTree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yizi-scan-'));
  await fs.mkdir(path.join(root, 'sub1', 'deep'), { recursive: true });
  await fs.mkdir(path.join(root, 'sub2'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });

  await fs.writeFile(path.join(root, 'a.png'), 'x');
  await fs.writeFile(path.join(root, 'b.JPG'), 'x');
  await fs.writeFile(path.join(root, 'notes.txt'), 'x');
  await fs.writeFile(path.join(root, 'sub1', 'c.webp'), 'x');
  await fs.writeFile(path.join(root, 'sub1', 'deep', 'd.png'), 'x');
  await fs.writeFile(path.join(root, 'sub2', 'e.mp4'), 'x');
  await fs.writeFile(path.join(root, 'node_modules', 'ignored.png'), 'x');
  return root;
}

test('非递归：只扫当前层，扩展名大小写不敏感', async () => {
  const root = await makeTree();
  try {
    const images = await scanFolder(root, { recursive: false });
    const names = images.map((i) => i.name).sort();
    assert.deepEqual(names, ['a.png', 'b.JPG']);
    assert.equal(images[0].subDir, '');
    assert.ok(images[0].url.startsWith('media://local/'), 'url 应为 media:// 协议');
    assert.ok(images[0].size > 0, 'size 应来自 stat');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('递归：带 subDir、跳过 node_modules、包含视频', async () => {
  const root = await makeTree();
  try {
    const images = await scanFolder(root, { recursive: true });
    const byName = Object.fromEntries(images.map((i) => [i.name, i]));

    assert.ok(byName['d.png'], '深层文件应被扫到');
    assert.equal(byName['d.png'].subDir, 'sub1/deep', 'subDir 用正斜杠');
    assert.equal(byName['c.webp'].subDir, 'sub1');
    assert.equal(byName['a.png'].subDir, '');
    assert.ok(byName['e.mp4'], '视频应被识别');
    assert.equal(byName['ignored.png'], undefined, 'node_modules 应被忽略');
    assert.equal(byName['notes.txt'], undefined, '非媒体文件应被过滤');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('排序稳定：两次扫描结果顺序一致', async () => {
  const root = await makeTree();
  try {
    const a = await scanFolder(root, { recursive: true });
    const b = await scanFolder(root, { recursive: true });
    assert.deepEqual(a.map((i) => i.path), b.map((i) => i.path));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stat 并发不超过 concurrency 上限', async () => {
  const root = await makeTree();
  try {
    let running = 0;
    let peak = 0;
    const realFs = fs;
    const spyFs = {
      readdir: (...args) => realFs.readdir(...args),
      stat: async (...args) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running--;
        return realFs.stat(...args);
      }
    };

    await scanFolder(root, { recursive: true, concurrency: 2, fs: spyFs });
    assert.ok(peak <= 2, `peak=${peak} 超过并发上限 2`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('目录不存在：返回空数组而非抛错', async () => {
  const images = await scanFolder(path.join(os.tmpdir(), 'definitely-not-exists-yizi'), {});
  assert.deepEqual(images, []);
});

test('mapLimit: 保持输入顺序', async () => {
  const input = [5, 1, 4, 2, 3];
  const out = await mapLimit(input, 2, async (n) => {
    await new Promise((r) => setTimeout(r, n));
    return n * 2;
  });
  assert.deepEqual(out, [10, 2, 8, 4, 6]);
});
