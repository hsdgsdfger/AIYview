'use strict';
/**
 * electron/core/thumbnailCache.cjs
 * ---------------------------------------------------------------------------
 * 缩略图磁盘缓存索引 + LRU 淘汰 + 配额控制。
 *
 * upstream 行为（v0.9.20, main.cjs:2009-2039）：
 *   - 只写不删：`userData/thumbnails` 无上限增长，10 万张图库能堆出几十 GB；
 *   - 命中判定只比较 mtime，不记录尺寸/总量，无法做任何容量策略；
 *   - `clear-thumbnails-for-folder` 每次把整个缓存目录 readdir 一遍再 O(n*m) 匹配。
 *
 * 改动：JSON 索引（路径→尺寸/字节/atime）+ LRU 淘汰 + 启动 GC + O(1) 命中查询。
 *
 * 适配来源：
 *   - isaacs/node-lru-cache (BlueOak-1.0.0) : sizeCalculation / maxSize / ttl 淘汰模型
 */

const crypto = require('crypto');
const nodePath = require('path');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

class ThumbnailCacheStore {
  /**
   * @param {object} opts
   * @param {string} opts.dir            缓存目录绝对路径
   * @param {string} [opts.indexFile]    索引文件路径，默认 <dir>/index.json
   * @param {number} [opts.quotaBytes]   总容量上限，默认 256MB
   * @param {number} [opts.maxEntries]   条目上限，默认 20000
   * @param {object} [opts.fs]           fs/promises 兼容对象（测试注入）
   * @param {() => number} [opts.now]
   */
  constructor(opts = {}) {
    if (!opts.dir) throw new Error('ThumbnailCacheStore 需要 dir');
    this.dir = opts.dir;
    this.indexFile = opts.indexFile || nodePath.join(opts.dir, 'index.json');
    this.quotaBytes = opts.quotaBytes ?? 256 * 1024 * 1024;
    this.maxEntries = opts.maxEntries ?? 20000;
    this.fs = opts.fs || require('fs/promises');
    this.now = opts.now || Date.now;

    /** @type {Map<string, {filePath:string,size:number,bytes:number,atime:number,mtime:number}>} */
    this.entries = new Map(); // 插入顺序 = LRU 顺序（尾部最新）
    this.totalBytes = 0;
    this.dirty = false;
    this.metrics = { hits: 0, misses: 0, evicted: 0, writes: 0 };
  }

  key(filePath, size) {
    return `${md5(filePath)}_${size}.jpg`;
  }

  cachePathFor(filePath, size) {
    return nodePath.join(this.dir, this.key(filePath, size));
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  async init() {
    await this.fs.mkdir(this.dir, { recursive: true }).catch(() => {});

    let loaded = [];
    try {
      const raw = await this.fs.readFile(this.indexFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) loaded = parsed;
    } catch { /* 首次运行或索引损坏 */ }

    // 按 atime 升序回填，保证 LRU 顺序正确
    loaded.sort((a, b) => (a.atime || 0) - (b.atime || 0));
    for (const item of loaded) {
      if (!item || !item.filePath || !item.bytes) continue;
      const cachePath = item.cachePath || this.cachePathFor(item.filePath, item.size || 600);
      this.entries.set(cachePath, {
        filePath: item.filePath,
        size: item.size || 600,
        bytes: item.bytes,
        atime: item.atime || 0,
        mtime: item.mtime || 0
      });
      this.totalBytes += item.bytes;
    }

    // 对账：文件被外部删掉的条目要剔除（抽样上限，避免启动拖慢）
    const keys = Array.from(this.entries.keys());
    const probe = keys.length > 2000 ? keys.slice(0, 2000) : keys;
    await Promise.all(probe.map(async (cachePath) => {
      try {
        await this.fs.access(cachePath);
      } catch {
        this._drop(cachePath);
      }
    }));

    const evicted = await this.enforceQuota();
    this.dirty = true;
    await this.save();
    return { entries: this.entries.size, bytes: this.totalBytes, evicted };
  }

  async save() {
    if (!this.dirty) return;
    const payload = Array.from(this.entries.entries()).map(([cachePath, e]) => ({
      cachePath,
      filePath: e.filePath,
      size: e.size,
      bytes: e.bytes,
      atime: e.atime,
      mtime: e.mtime
    }));
    try {
      await this.fs.writeFile(this.indexFile, JSON.stringify(payload));
      this.dirty = false;
    } catch { /* 索引写失败不影响出图 */ }
  }

  /* ------------------------------ 查询/写入 ------------------------------ */

  /**
   * 命中判定：索引里有 + 源文件 mtime 不新于缓存 mtime。
   * @returns {{hit:boolean, cachePath:string, entry?:object}}
   */
  lookup(filePath, size, sourceMtimeMs) {
    const cachePath = this.cachePathFor(filePath, size);
    const entry = this.entries.get(cachePath);
    if (!entry) {
      this.metrics.misses++;
      return { hit: false, cachePath };
    }
    if (typeof sourceMtimeMs === 'number' && entry.mtime && sourceMtimeMs > entry.mtime) {
      this.metrics.misses++;
      return { hit: false, cachePath, stale: true };
    }
    // LRU 提权
    this.entries.delete(cachePath);
    entry.atime = this.now();
    this.entries.set(cachePath, entry);
    this.metrics.hits++;
    return { hit: true, cachePath, entry };
  }

  async put(filePath, size, bytes, options = {}) {
    const cachePath = this.cachePathFor(filePath, size);
    const existing = this.entries.get(cachePath);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries.delete(cachePath);
    }

    const t = this.now();
    this.entries.set(cachePath, {
      filePath,
      size,
      bytes: bytes || 0,
      atime: t,
      mtime: options.mtime || t
    });
    this.totalBytes += bytes || 0;
    this.metrics.writes++;
    this.dirty = true;

    const evicted = await this.enforceQuota();
    return { cachePath, evicted };
  }

  /**
   * LRU 淘汰到配额高水位（90%）以下。
   * @returns {Promise<number>} 淘汰条数
   */
  async enforceQuota() {
    let evicted = 0;
    const highWater = Math.floor(this.quotaBytes * 0.9);

    const needEvict = () =>
      this.totalBytes > highWater || this.entries.size > this.maxEntries;

    if (!needEvict()) return 0;

    const victims = [];
    for (const [cachePath, entry] of this.entries) {
      if (!needEvict()) break;
      victims.push(cachePath);
      this.totalBytes -= entry.bytes;
      this.entries.delete(cachePath);
      evicted++;
    }

    await Promise.all(victims.map((p) => this.fs.unlink(p).catch(() => {})));
    this.metrics.evicted += evicted;
    if (evicted > 0) this.dirty = true;
    return evicted;
  }

  _drop(cachePath) {
    const entry = this.entries.get(cachePath);
    if (!entry) return false;
    this.totalBytes -= entry.bytes;
    this.entries.delete(cachePath);
    this.dirty = true;
    return true;
  }

  /**
   * 清掉某个目录下所有文件的缩略图（替代原 O(n*m) 的 readdir 匹配）。
   */
  async clearFolder(folderPath) {
    // 路径分隔符与大小写都要归一，否则 C:/pics 与 C:\pics 匹配不上
    const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
    const base = norm(folderPath).replace(/\/+$/, '');
    const prefix = base + '/';
    const victims = [];
    for (const [cachePath, entry] of this.entries) {
      if (norm(entry.filePath).startsWith(prefix)) victims.push(cachePath);
    }
    for (const p of victims) this._drop(p);
    await Promise.all(victims.map((p) => this.fs.unlink(p).catch(() => {})));
    if (victims.length > 0) await this.save();
    return victims.length;
  }

  async clearAll() {
    const victims = Array.from(this.entries.keys());
    this.entries.clear();
    this.totalBytes = 0;
    this.dirty = true;
    await Promise.all(victims.map((p) => this.fs.unlink(p).catch(() => {})));
    await this.save();
    return victims.length;
  }

  stats() {
    return {
      entries: this.entries.size,
      bytes: this.totalBytes,
      quotaBytes: this.quotaBytes,
      usageRatio: this.quotaBytes > 0 ? this.totalBytes / this.quotaBytes : 0,
      ...this.metrics
    };
  }
}

module.exports = { ThumbnailCacheStore, md5 };
