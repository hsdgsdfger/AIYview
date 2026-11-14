'use strict';

/**
 * 扫描入库管线（纯逻辑，fs 可注入，可脱离 Electron 测试）
 *
 * 流程：scanFolder（有界并发 stat）→ 批量 upsert → 目录重建 → 对账 → 更新计数。
 * 大库首扫 20 万张也只做一次全量；后续默认增量（对账可关）。
 */

const { scanFolder, DEFAULT_IMAGE_EXT } = require('../legacy/scanFolder.cjs');
const { upsertScanned, folderChains, removeMissing } = require('../db/imageRepository.cjs');
const { rebuildFolders, touchScan } = require('../db/libraryRepository.cjs');

const WHITELIST_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

/**
 * @param {object} opts
 * @param {object} opts.db          better-sqlite3 句柄
 * @param {object} opts.library     libraries 行（含 id/root_path）
 * @param {boolean} [opts.recursive=true]
 * @param {boolean} [opts.reconcile=true]   删除磁盘上已消失的行
 * @param {(progress:object)=>void} [opts.onProgress]  {phase, done, total}
 * @returns {Promise<{total:number, inserted:number, updated:number, removed:number, elapsedMs:number}>}
 */
async function scanAndIndex({ db, library, recursive = true, reconcile = true, onProgress, scanOpts = {} }) {
  const started = Date.now();
  // root_path 统一存正斜杠；Windows 的 path API 对混合分隔符兼容
  const root = library.root_path;

  if (typeof onProgress === 'function') onProgress({ phase: 'walk', done: 0, total: 0 });

  const scanned = await scanFolder(root, {
    recursive,
    extensions: WHITELIST_EXT.length ? WHITELIST_EXT : DEFAULT_IMAGE_EXT,
    ...scanOpts,
  });

  if (typeof onProgress === 'function') onProgress({ phase: 'index', done: 0, total: scanned.length });

  const result = upsertScanned(db, library.id, scanned, root);
  rebuildFolders(db, library.id, folderChains(scanned, root));

  let removed = 0;
  if (reconcile) {
    const keep = new Set(scanned.map((item) => relOf(item, root)));
    removed = removeMissing(db, library.id, keep);
  }

  const total = require('../db/imageRepository.cjs').countImages(db, { libraryId: library.id });
  touchScan(db, library.id, { imageCount: total });

  if (typeof onProgress === 'function') {
    onProgress({ phase: 'done', done: scanned.length, total: scanned.length });
  }

  return {
    total,
    inserted: result.inserted,
    updated: result.updated,
    removed,
    elapsedMs: Date.now() - started,
  };
}

function relOf(item, root) {
  const nodePath = require('node:path');
  return nodePath.relative(root, item.path).split('\\').join('/');
}

module.exports = { scanAndIndex, relOf, WHITELIST_EXT };
