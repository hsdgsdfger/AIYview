import test from 'node:test';
import assert from 'node:assert/strict';

import queuePkg from '../../src/core/legacy/thumbnailQueue.cjs';

const { ThumbnailScheduler, MinHeap, PRIORITY } = queuePkg;

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

test('MinHeap: 同优先级保持 FIFO，低数值优先', () => {
  const heap = new MinHeap();
  heap.push({ key: 'a', priority: 1, resolve() {}, reject() {} });
  heap.push({ key: 'b', priority: 0, resolve() {}, reject() {} });
  heap.push({ key: 'c', priority: 1, resolve() {}, reject() {} });

  assert.equal(heap.pop().key, 'b');
  assert.equal(heap.pop().key, 'a');
  assert.equal(heap.pop().key, 'c');
  assert.equal(heap.pop(), null);
});

test('Scheduler: 队列内按优先级出队（已启动的任务不受影响）', async () => {
  const started = [];
  const scheduler = new ThumbnailScheduler({
    concurrency: 1,
    maxConcurrency: 1,
    generate: async (filePath) => {
      started.push(filePath);
      await tick(2);
      return filePath;
    }
  });

  // 第一个立即被 pop 启动，用于占住唯一的并发位
  const first = scheduler.request('t0', 600, PRIORITY.IDLE);
  const rest = [];
  const plan = [
    ['t9', 8], ['t1', 0], ['t7', 6], ['t2', 1], ['t5', 4],
    ['t3', 2], ['t8', 7], ['t4', 3], ['t6', 5]
  ];
  for (const [name, pri] of plan) rest.push(scheduler.request(name, 600, pri));

  await Promise.all([first, ...rest]);

  assert.equal(started[0], 't0');
  const queuedOrder = started.slice(1);
  assert.deepEqual(queuedOrder, ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']);
});

test('Scheduler: 同 key 请求去重，只生成一次', async () => {
  let calls = 0;
  const scheduler = new ThumbnailScheduler({
    concurrency: 2,
    maxConcurrency: 2,
    generate: async () => { calls++; await tick(2); return 'ok'; }
  });

  const a = scheduler.request('/x/a.png', 600);
  const b = scheduler.request('/x/a.png', 600);
  const c = scheduler.request('/x/a.png', 900); // 尺寸不同 → 不同 key

  const results = await Promise.all([a, b, c]);
  assert.deepEqual(results, ['ok', 'ok', 'ok']);
  assert.equal(calls, 2);
  assert.equal(scheduler.stats().deduped, 1);
});

test('Scheduler: 并发不超过 maxConcurrency，且积压时允许扩容', async () => {
  let running = 0;
  let peak = 0;
  const scheduler = new ThumbnailScheduler({
    concurrency: 2,
    maxConcurrency: 6,
    backlogFactor: 2,
    generate: async () => {
      running++;
      peak = Math.max(peak, running);
      await tick(2);
      running--;
      return true;
    }
  });

  const jobs = [];
  for (let i = 0; i < 60; i++) jobs.push(scheduler.request(`/f/${i}.png`, 600, i % 2));
  await Promise.all(jobs);

  assert.ok(peak <= 6, `peak 并发 ${peak} 超过上限 6`);
  assert.ok(peak > 2, `积压时应扩容，实际 peak=${peak}`);
});

test('Scheduler: 失败任务不影响后续调度', async () => {
  const scheduler = new ThumbnailScheduler({
    concurrency: 1,
    maxConcurrency: 1,
    generate: async (filePath) => {
      if (filePath === 'bad') throw new Error('boom');
      return 'ok';
    }
  });

  await assert.rejects(scheduler.request('bad', 600));
  assert.equal(await scheduler.request('good', 600), 'ok');
  assert.equal(scheduler.stats().failed, 1);
});
