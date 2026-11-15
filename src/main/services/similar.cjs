'use strict';

/**
 * 相似图服务：给每张图算一个 64 位感知哈希（dHash），找相似时按汉明距离排序。
 * 指纹在后台慢慢补（一次 25 张、并发 4），界面先能用，补完自动全库可查。
 */

const path = require('node:path');
const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const hashStore = require('../../core/db/similarStore.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');

const state = { running: false, libraryId: null };

/** 9×8 灰度 → 横向差分 → 64 位哈希（16 位十六进制） */
async function dhashOf(absPath) {
  const sharp = require('sharp');
  const raw = await sharp(absPath, { failOn: 'none' })
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  let hex = '';
  for (let y = 0; y < 8; y += 1) {
    let nibble = 0;
    let bits = 0;
    for (let x = 0; x < 8; x += 1) {
      const bit = raw[y * 9 + x] > raw[y * 9 + x + 1] ? 1 : 0;
      nibble = (nibble << 1) | bit;
      bits += 1;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

async function hashOne(lib, row) {
  try {
    const root = lib.root_path.replace(/\//g, path.sep);
    const abs = resolveInLibrary(root, row.rel_path);
    return { id: row.id, phash: await dhashOf(abs) };
  } catch {
    // 读不了的图打个标记，避免每轮都重试卡住进度
    return { id: row.id, phash: 'ERR' };
  }
}

/**
 * 后台补齐指纹。同一时间只跑一个；已经跑着就直接返回当前状态。
 * @param {{libraryId:number, broadcast?:(ev:string,payload:object)=>void}} opts
 */
async function buildHashes({ libraryId, broadcast } = {}) {
  const db = getDb();
  const lib = libs.getLibrary(db, libraryId);
  if (!lib) throw Object.assign(new Error('图库不存在'), { code: 'NOT_FOUND' });
  if (state.running) return { started: false, ...hashStore.hashStats(db, libraryId) };

  state.running = true;
  state.libraryId = libraryId;
  const total = hashStore.hashStats(db, libraryId).missing;

  (async () => {
    let done = 0;
    try {
      for (;;) {
        const batch = hashStore.missingHashes(db, libraryId, 25);
        if (batch.length === 0) break;
        const results = [];
        for (let i = 0; i < batch.length; i += 4) {
          const slice = batch.slice(i, i + 4);
          const group = await Promise.all(slice.map((row) => hashOne(lib, row)));
          results.push(...group);
        }
        hashStore.setHashes(db, results);
        done += results.length;
        if (typeof broadcast === 'function') broadcast('hash:progress', { libraryId, done, total });
      }
      if (typeof broadcast === 'function') broadcast('hash:progress', { libraryId, done: total, total, finished: true });
    } finally {
      state.running = false;
      state.libraryId = null;
    }
  })().catch(() => {
    state.running = false;
    state.libraryId = null;
  });

  return { started: true, missing: total };
}

function registerSimilarIpc(broadcast) {
  handle('image:hash-build', ({ libraryId } = {}) => buildHashes({ libraryId, broadcast }));

  handle('image:hash-stats', ({ libraryId } = {}) => {
    const db = getDb();
    return { ...hashStore.hashStats(db, libraryId), running: state.running };
  });

  /** 找相似：返回与列表同形的图（带 ageLevel/ageSource），按距离升序 */
  handle('image:find-similar', ({ id, libraryId, threshold = 8, limit = 60 } = {}) => {
    const db = getDb();
    const hits = hashStore.findSimilar(db, libraryId, id, { threshold, limit });
    if (hits.length === 0) return { source: id, items: [] };
    const ids = hits.map((h) => h.id);
    const rows = db
      .prepare(`SELECT id, rel_path, file_name, ext, size_bytes, mtime_ms, width, height,
                       heart, rejected, age_level AS ageLevel, age_source AS ageSource
                FROM images WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = hits
      .map((h) => {
        const row = byId.get(h.id);
        return row ? { ...row, distance: h.distance } : null;
      })
      .filter(Boolean);
    return { source: id, threshold, items };
  });
}

module.exports = { registerSimilarIpc, buildHashes, dhashOf };
