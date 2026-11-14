'use strict';
/**
 * electron/core/thumbnailQueue.cjs
 * ---------------------------------------------------------------------------
 * 缩略图任务调度器：优先级 + 去重 + 有界并发 + 自适应扩容。
 *
 * upstream 行为（v0.9.20, main.cjs:1987-2007）：
 *   - `thumbnailQueue` 是普通数组，`shift()` FIFO；
 *   - 固定 `MAX_CONCURRENT_THUMBNAILS = 4`；
 *   - 快速滚动时已滚出视口的请求仍按入队顺序先算 → 用户盯着占位图等半天。
 *
 * 改动：二叉堆优先级队列（数值小优先，同优先级 FIFO）+ 去重 Promise 复用 +
 *       队列积压自适应升并发（上限 maxConcurrency）。
 *
 * 适配来源：
 *   - sindresorhus/p-queue (MIT)  : priority 队列语义
 *   - sindresorhus/p-limit (MIT)  : 并发限制器
 */

const PRIORITY = Object.freeze({
  VISIBLE: 0,   // 视口内，立即要
  NEAR: 1,      // rootMargin 预取
  IDLE: 5       // 背景/预热
});

class MinHeap {
  constructor() {
    this.items = [];
    this.seq = 0;
  }

  get size() {
    return this.items.length;
  }

  push(task) {
    task.seq = this.seq++;
    this.items.push(task);
    this._up(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this._down(0);
    }
    return top;
  }

  /** 把某个已存在任务的优先级降级并上浮（视口滚回来时用） */
  bump(fn) {
    for (let i = 0; i < this.items.length; i++) {
      if (fn(this.items[i])) {
        this._up(i);
        return true;
      }
    }
    return false;
  }

  _less(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.seq < b.seq; // 同优先级 FIFO，保证行为可预测
  }

  _up(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._less(this.items[i], this.items[parent])) {
        [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
        i = parent;
      } else break;
    }
  }

  _down(i) {
    const n = this.items.length;
    for (;;) {
      let smallest = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && this._less(this.items[l], this.items[smallest])) smallest = l;
      if (r < n && this._less(this.items[r], this.items[smallest])) smallest = r;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

class ThumbnailScheduler {
  /**
   * @param {object} opts
   * @param {(filePath: string, size: number) => Promise<any>} opts.generate
   * @param {number} [opts.concurrency=4]
   * @param {number} [opts.maxConcurrency=8]
   * @param {number} [opts.backlogFactor=4] 积压超过 concurrency*factor 时扩容
   */
  constructor(opts = {}) {
    this.generate = opts.generate;
    if (typeof this.generate !== 'function') throw new Error('ThumbnailScheduler 需要 generate 函数');

    this.baseConcurrency = opts.concurrency ?? 4;
    this.maxConcurrency = Math.max(this.baseConcurrency, opts.maxConcurrency ?? 8);
    this.backlogFactor = opts.backlogFactor ?? 4;
    this.concurrency = this.baseConcurrency;

    this.heap = new MinHeap();
    this.inflight = new Map(); // key -> Promise（去重）
    this.running = 0;
    this.metrics = { enqueued: 0, deduped: 0, done: 0, failed: 0, peakRunning: 0, peakQueue: 0 };
  }

  get queueLength() {
    return this.heap.size;
  }

  /**
   * @param {string} filePath
   * @param {number} size
   * @param {number} [priority]
   * @returns {Promise<any>}
   */
  request(filePath, size = 600, priority = PRIORITY.NEAR) {
    const key = `${filePath}_${size}`;

    // 去重：同一文件同一尺寸只跑一次
    const existing = this.inflight.get(key);
    if (existing) {
      this.metrics.deduped++;
      // 已在队列里但优先级更高了 → 上浮
      this.heap.bump((t) => t.key === key && t.priority > priority && ((t.priority = priority), true));
      return existing;
    }

    let resolveFn, rejectFn;
    const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
    this.inflight.set(key, promise);
    this.metrics.enqueued++;

    this.heap.push({ key, filePath, size, priority, resolve: resolveFn, reject: rejectFn });
    if (this.heap.size > this.metrics.peakQueue) this.metrics.peakQueue = this.heap.size;

    this._pump();
    return promise;
  }

  _desiredConcurrency() {
    const backlog = this.heap.size;
    if (backlog >= this.concurrency * this.backlogFactor) {
      return Math.min(this.maxConcurrency, this.baseConcurrency + Math.ceil(backlog / this.backlogFactor));
    }
    return this.baseConcurrency;
  }

  _pump() {
    this.concurrency = this._desiredConcurrency();

    while (this.running < this.concurrency && this.heap.size > 0) {
      const task = this.heap.pop();
      this.running++;
      if (this.running > this.metrics.peakRunning) this.metrics.peakRunning = this.running;

      Promise.resolve()
        .then(() => this.generate(task.filePath, task.size))
        .then((value) => {
          this.metrics.done++;
          task.resolve(value);
        })
        .catch((err) => {
          this.metrics.failed++;
          task.reject(err);
        })
        .finally(() => {
          this.running--;
          this.inflight.delete(task.key);
          this._pump();
        });
    }
  }

  stats() {
    return { ...this.metrics, running: this.running, queue: this.heap.size, concurrency: this.concurrency };
  }
}

module.exports = { ThumbnailScheduler, MinHeap, PRIORITY };
