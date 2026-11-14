import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import renamePkg from '../../src/core/legacy/batchRename.cjs';

const { sanitizeFilename, renderTemplate, planBatchRename, applyBatchRename, formatDate } = renamePkg;

const files = (...names) => names.map((n) => ({ path: `C:/pics/${n}`, name: n, mtimeMs: 0 }));

test('sanitizeFilename: 非法字符、保留名、尾部点空格', () => {
  assert.equal(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j.png'), 'a-b-c-d-e-f-g-h-i-j.png');
  assert.equal(sanitizeFilename('CON.png'), '_CON.png');
  assert.equal(sanitizeFilename('nul'), '_nul');
  assert.equal(sanitizeFilename('trailing...  '), 'trailing');
  assert.equal(sanitizeFilename('ok name.png'), 'ok name.png');
});

test('renderTemplate: {name} {ext} {index} {index:3} {date} {parent}', () => {
  const ctx = { name: 'photo', ext: '.png', index: 7, date: '20260101', parent: 'shoot' };
  assert.equal(renderTemplate('{name}{ext}', ctx), 'photo.png');
  assert.equal(renderTemplate('IMG_{index}', ctx), 'IMG_7');
  assert.equal(renderTemplate('IMG_{index:3}', ctx), 'IMG_007');
  assert.equal(renderTemplate('{date}_{parent}_{name}{ext}', ctx), '20260101_shoot_photo.png');
  assert.equal(renderTemplate('{unknown}', ctx), '{unknown}', '未知占位符原样保留');
});

test('formatDate: 零填充', () => {
  const d = new Date(2026, 0, 5, 9, 8, 7).getTime();
  assert.equal(formatDate(d, 'YYYYMMDD'), '20260105');
  assert.equal(formatDate(d, 'YYYY-MM-DD_HHmmss'), '2026-01-05_090807');
});

test('planBatchRename: 序号模板 + 自动补扩展名', () => {
  const result = planBatchRename(files('a.png', 'b.png', 'c.jpg'), {
    template: 'IMG_{index:3}',
    startIndex: 1,
    existingNames: ['a.png', 'b.png', 'c.jpg']
  });
  assert.deepEqual(result.plan.map((p) => p.name), ['IMG_001.png', 'IMG_002.png', 'IMG_003.jpg']);
  assert.equal(result.skipped, 0);
});

test('planBatchRename: 计划内重名自动加 (n)', () => {
  const result = planBatchRename(files('a.png', 'b.png'), {
    template: 'same',
    existingNames: []
  });
  assert.deepEqual(result.plan.map((p) => p.name), ['same.png', 'same (2).png']);
});

test('planBatchRename: 与目录内既有文件冲突时加 (n)', () => {
  const result = planBatchRename(files('a.png'), {
    template: 'taken',
    existingNames: ['taken.png']
  });
  assert.equal(result.plan[0].name, 'taken (2).png');
});

test('planBatchRename: 结果未变化则跳过', () => {
  const result = planBatchRename(files('keep.png'), {
    template: '{name}',
    existingNames: ['keep.png']
  });
  assert.equal(result.skipped, 1);
  assert.equal(result.plan[0].skip, true);
  assert.equal(result.plan[0].reason, 'unchanged');
});

test('applyBatchRename: 互换文件名不会互相覆盖', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yizi-rename-'));
  try {
    await fs.writeFile(path.join(dir, 'a.png'), 'AAA');
    await fs.writeFile(path.join(dir, 'b.png'), 'BBB');

    // a->b, b->a 的互换场景
    const plan = {
      plan: [
        { from: path.join(dir, 'a.png'), to: path.join(dir, 'b.png'), name: 'b.png', skip: false },
        { from: path.join(dir, 'b.png'), to: path.join(dir, 'a.png'), name: 'a.png', skip: false }
      ]
    };
    const result = await applyBatchRename(plan);
    assert.equal(result.renamed, 2);
    assert.equal(result.failed.length, 0);

    const a = await fs.readFile(path.join(dir, 'a.png'), 'utf8');
    const b = await fs.readFile(path.join(dir, 'b.png'), 'utf8');
    assert.equal(a, 'BBB', 'a.png 应拿到原 b 的内容');
    assert.equal(b, 'AAA', 'b.png 应拿到原 a 的内容');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('applyBatchRename: dryRun 不落盘', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yizi-rename-dry-'));
  try {
    await fs.writeFile(path.join(dir, 'x.png'), 'X');
    const plan = { plan: [{ from: path.join(dir, 'x.png'), to: path.join(dir, 'y.png'), name: 'y.png', skip: false }] };
    const result = await applyBatchRename(plan, { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.renamed, 1);
    await assert.rejects(fs.access(path.join(dir, 'y.png')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
