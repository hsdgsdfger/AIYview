'use strict';
/**
 * electron/core/ratingStore.cjs
 * ---------------------------------------------------------------------------
 * 分级结果持久化：图片绝对路径 → l0–l4。
 *
 * 存放位置：<userData>/image_ratings.json（跟随应用数据，不污染图库目录）
 * 体积估算：20 万条 × 约 90 字节 ≈ 18MB，启动加载一次约 100–200ms。
 *
 * 写入策略：防抖 + 原子替换（tmp → rename），避免频繁整文件重写，
 * 也避免断电时留下半个 JSON 把索引搞坏。
 */

class RatingStore {
  /**
   * @param {object} opts
   * @param {string} opts.filePath
   * @param {object} [opts.fs] fs/promises 兼容对象（测试注入）
   * @param {() => number} [opts.now]
   * @param {number} [opts.debounceMs=400]
   */
  constructor(opts = {}) {
    if (!opts.filePath) throw new Error('RatingStore 需要 filePath');
    this.filePath = opts.filePath;
    this.fs = opts.fs || require('fs/promises');
    this.now = opts.now || Date.now;
    this.debounceMs = opts.debounceMs ?? 400;

    /** @type {Map<string, {level:number, key:string, source:string, manual:boolean, updatedAt:number}>} */
    this.entries = new Map();
    this.dirty = false;
    this.timer = null;
    this.metrics = { sets: 0, loads: 0, writes: 0, writeErrors: 0 };
  }

  async init() {
    let payload = null;
    try {
      const raw = await this.fs.readFile(this.filePath, 'utf8');
      payload = JSON.parse(raw);
    } catch (e) {
      // 首次运行或文件损坏：从空表开始，不阻塞启动
      return { entries: 0, recovered: false };
    }

    const ratings = (payload && payload.ratings) || {};
    for (const [p, v] of Object.entries(ratings)) {
      if (!v || typeof v.l !== 'number') continue;
      this.entries.set(p, {
        level: v.l,
        key: `l${v.l}`,
        source: v.s || 'unknown',
        manual: v.m === 1 || v.m === true,  // 落盘写的是 1/0，不是 true/false
        updatedAt: v.t || 0
      });
    }
    this.metrics.loads = this.entries.size;
    return { entries: this.entries.size, recovered: true };
  }

  get(filePath) {
    return this.entries.get(filePath) || null;
  }

  getMany(paths) {
    const out = new Map();
    for (const p of paths || []) {
      const hit = this.entries.get(p);
      if (hit) out.set(p, hit);
    }
    return out;
  }

  /**
   * 写入一条（手动标记优先级高于自动判定）
   * @returns {boolean} 是否真的改动了
   */
  async set(filePath, rating) {
    if (!filePath || !rating || typeof rating.level !== 'number') return false;
    if (rating.level < 0 || rating.level > 4) return false;

    const existing = this.entries.get(filePath);
    // 自动判定不得覆盖用户的手动结果
    if (existing && existing.manual && !rating.manual) return false;

    this.entries.set(filePath, {
      level: rating.level,
      key: `l${rating.level}`,
      source: rating.source || 'unknown',
      manual: rating.manual === true,
      updatedAt: this.now()
    });
    this.metrics.sets++;
    this._scheduleSave();
    return true;
  }

  /** 批量写入，只触发一次落盘 */
  async setMany(items) {
    let changed = 0;
    for (const item of items || []) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.set(item.filePath, item.rating)) changed++;
    }
    if (changed > 0) await this.flush();
    return changed;
  }

  async remove(filePath) {
    if (!this.entries.delete(filePath)) return false;
    this._scheduleSave();
    return true;
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.debounceMs);
    // 不阻止进程退出
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async flush() {
    if (!this.dirty) return false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const ratings = {};
    for (const [p, v] of this.entries) {
      ratings[p] = { l: v.level, s: v.source, m: v.manual ? 1 : 0, t: v.updatedAt };
    }
    const payload = JSON.stringify({ version: 1, updatedAt: this.now(), ratings });
    const tmp = `${this.filePath}.tmp`;

    try {
      await this.fs.writeFile(tmp, payload);
      await this.fs.rename(tmp, this.filePath);
      this.dirty = false;
      this.metrics.writes++;
      return true;
    } catch (e) {
      this.metrics.writeErrors++;
      await this.fs.unlink(tmp).catch(() => {});
      return false;
    }
  }

  stats() {
    const byLevel = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    let manual = 0;
    for (const v of this.entries.values()) {
      byLevel[v.level] = (byLevel[v.level] || 0) + 1;
      if (v.manual) manual++;
    }
    return { total: this.entries.size, byLevel, manual, ...this.metrics };
  }
}

module.exports = { RatingStore };
