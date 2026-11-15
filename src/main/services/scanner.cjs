'use strict';

const path = require('node:path');
const { handle } = require('../ipc.cjs');
const { getDb, registerMediaRoot } = require('../db/database.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const { scanAndIndex } = require('../../core/scan/scanPipeline.cjs');

/**
 * 扫描服务：一次只允许一个扫描任务（互斥），进度经 broadcast 推给渲染层。
 */
const state = {
  running: false,
  /** chokidar watcher per library */
  watchers: new Map(),
};

let chokidar = null;
function loadChokidar() {
  if (!chokidar) chokidar = require('chokidar');
  return chokidar;
}

function registerScanIpc(broadcast) {
  handle('scan:status', () => ({ running: state.running }));

  handle('scan:run', async ({ libraryId, recursive = true, reconcile = true } = {}) => {
    const db = getDb();
    const library = libs.getLibrary(db, libraryId);
    if (!library) throw Object.assign(new Error('图库不存在'), { code: 'NOT_FOUND' });
    if (state.running) throw Object.assign(new Error('已有扫描在进行'), { code: 'SCAN_BUSY' });

    state.running = true;
    const rootAbs = path.resolve(library.root_path.replace(/\//g, path.sep));
    registerMediaRoot(rootAbs);

    try {
      const summary = await scanAndIndex({
        db,
        library: { ...library, root_path: rootAbs },
        recursive,
        reconcile,
        onProgress: (progress) => broadcast('scan:progress', { libraryId, ...progress }),
      });
      watchLibrary(library.id, rootAbs, broadcast);
      broadcast('browse:changed', { libraryId, reason: 'scan' });
      return summary;
    } finally {
      state.running = false;
    }
  });

  handle('scan:watch-stop', ({ libraryId }) => stopWatch(libraryId));
}

/** 停掉某个库的文件监听（移除图库时必须调，否则 chokidar 永不回收） */
function stopWatch(libraryId) {
  const watcher = state.watchers.get(libraryId);
  if (watcher) {
    watcher.close();
    state.watchers.delete(libraryId);
  }
  return true;
}

/** 增量监听：文件变化防抖后重扫对应库 */
function watchLibrary(libraryId, rootAbs, broadcast) {
  const existing = state.watchers.get(libraryId);
  if (existing) return;

  const chokidarLib = loadChokidar();
  let timer = null;
  const watcher = chokidarLib.watch(rootAbs, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  const rescan = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const db = getDb();
      const library = libs.getLibrary(db, libraryId);
      if (!library || state.running) return;
      state.running = true;
      scanAndIndex({ db, library: { ...library, root_path: rootAbs }, recursive: true, reconcile: true })
        .then(() => broadcast('browse:changed', { libraryId, reason: 'watch' }))
        .catch(() => {})
        .finally(() => {
          state.running = false;
        });
    }, 800);
  };

  watcher.on('add', rescan).on('unlink', rescan).on('change', rescan).on('addDir', rescan).on('unlinkDir', rescan);
  state.watchers.set(libraryId, watcher);
}

module.exports = { registerScanIpc, watchLibrary, stopWatch };
