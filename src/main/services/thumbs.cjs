'use strict';

const path = require('node:path');
const { handle } = require('../ipc.cjs');
const { getDb, thumbnailsDir } = require('../db/database.cjs');
const imgs = require('../../core/db/imageRepository.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const { ThumbnailScheduler, PRIORITY } = require('../../core/legacy/thumbnailQueue.cjs');
const { ThumbnailCacheStore } = require('../../core/legacy/thumbnailCache.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');

/**
 * 缩略图管线：批量 IPC + 优先级队列 + 磁盘缓存配额。
 * 失败一律返回 null url（渲染层画占位），绝不回退原图（性能根因 5）。
 */
const SIZES = { xs: 220, sm: 600, md: 1024 }; // xs: 一行几十张时省内存；sm 与原版一致 // 与原版一致（原 thumbnailCache 默认 600）

let cache = null;
let scheduler = null;

function ensurePipelines() {
  if (!cache) {
    cache = new ThumbnailCacheStore({
      dir: thumbnailsDir(),
      quotaBytes: 8 * 1024 * 1024 * 1024,
      maxEntries: 500000,
    });
    cache.init();
  }
  if (!scheduler) {
    scheduler = new ThumbnailScheduler({
      concurrency: 4,
      maxConcurrency: 8,
      generate: generateThumbnail,
    });
  }
  return { cache, scheduler };
}

async function generateThumbnail(srcAbs, size) {
  const sharp = require('sharp');
  const fsp = require('node:fs/promises');
  const target = cache.cachePathFor(srcAbs, size);
  await sharp(srcAbs, { failOn: 'none' })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(`${target}.tmp`);
  await fsp.rename(`${target}.tmp`, target);
  const st = await fsp.stat(target);
  return { bytes: st.size };
}

function toMediaUrl(absPath) {
  return 'media://local/' + absPath.split(path.sep).join('/');
}

/**
 * @param {{ids:number[], size:'sm'|'md', priority?:number}} payload
 * @returns {Promise<Array<{id:number,url:string|null,hit:boolean,w:number,h:number}>>}
 */
async function getThumbnails({ ids, size = 'sm', priority = PRIORITY.NEAR } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { cache: cacheStore, scheduler: queue } = ensurePipelines();
  const db = getDb();
  const px = SIZES[size] || SIZES.sm;
  const rows = imgs.getImagesByIds(db, ids);
  if (rows.length === 0) return [];

  const libCache = new Map();
  const getLib = (id) => {
    if (!libCache.has(id)) libCache.set(id, libs.getLibrary(db, id));
    return libCache.get(id);
  };

  return Promise.all(
    rows.map(async (row) => {
      const lib = getLib(row.library_id);
      const blank = { id: row.id, url: null, hit: false, w: row.width, h: row.height };
      if (!lib) return blank;

      let srcAbs;
      try {
        srcAbs = resolveInLibrary(lib.root_path, row.rel_path);
      } catch {
        return blank; // rel_path 越界 = 数据异常，拒绝读
      }

      const cached = cacheStore.lookup(srcAbs, px, row.mtime_ms);
      if (cached.hit) {
        return { id: row.id, url: toMediaUrl(cached.cachePath), hit: true, w: row.width, h: row.height };
      }

      try {
        const result = await queue.request(srcAbs, px, priority);
        await cacheStore.put(srcAbs, px, result.bytes, { mtime: row.mtime_ms });
        return {
          id: row.id,
          url: toMediaUrl(cacheStore.cachePathFor(srcAbs, px)),
          hit: false,
          w: row.width,
          h: row.height,
        };
      } catch (error) {
        if (process.env.AIY_DEBUG) {
          try {
            const fs = require('node:fs');
            const logPath = require('node:path').join(
              require('electron').app.getPath('userData'),
              'thumb-errors.log'
            );
            fs.appendFileSync(logPath, `${srcAbs} :: ${error.message}\n`);
          } catch {
            /* 排障日志写失败不影响出图 */
          }
        }
        return blank;
      }
    })
  );
}

function registerThumbIpc() {
  handle('thumb:get', getThumbnails);
  handle('thumb:cache-stats', () => {
    const { cache: cacheStore, scheduler: queue } = ensurePipelines();
    return { cache: cacheStore.stats(), scheduler: queue.stats() };
  });
}

module.exports = { registerThumbIpc, getThumbnails, SIZES };
