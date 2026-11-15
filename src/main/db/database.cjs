'use strict';

const path = require('node:path');
const { app } = require('electron');
const { openDatabase } = require('./open.cjs');

/** 进程级单例：全应用共用一个连接（WAL 模式，读写都在主进程） */
let instance = null;

function getDb() {
  if (!instance) {
    const { db } = openDatabase({ dbPath: path.join(app.getPath('userData'), 'index.sqlite') });
    instance = db;
    // 003 迁移只加了 sort_key 列：老库在这里一次性补齐（已补齐时是 0 次查询，几乎无开销）
    try {
      require('../../core/db/imageRepository.cjs').backfillSortKeys(db);
    } catch {
      /* 补键失败不影响使用：按名称排序会退回 NULL 优先的旧顺序，下次启动再补 */
    }
  }
  return instance;
}

/** media:// 协议允许读取的目录白名单：已注册图库根 + 缩略图目录 */
const mediaRoots = new Set();

function registerMediaRoot(rootPath) {
  if (rootPath) mediaRoots.add(path.resolve(rootPath));
}

function getMediaRoots() {
  return [...mediaRoots];
}

function thumbnailsDir() {
  return path.join(app.getPath('userData'), 'thumbnails');
}

function ensureMediaRoots(db) {
  const rows = db.prepare('SELECT root_path FROM libraries').all();
  for (const row of rows) registerMediaRoot(row.root_path.replace(/\//g, path.sep));
  registerMediaRoot(thumbnailsDir());
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { getDb, closeDb, registerMediaRoot, getMediaRoots, thumbnailsDir, ensureMediaRoots };
