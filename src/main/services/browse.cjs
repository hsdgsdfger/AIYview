'use strict';

const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const imgs = require('../../core/db/imageRepository.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');

/**
 * 图库注册 / 目录树 / 分页浏览 / 标记。全部走 core 仓储，本层只做参数校验。
 */
function registerBrowseIpc(broadcast) {
  handle('browse:folders', ({ libraryId }) => {
    return libs.listFolderTree(getDb(), libraryId);
  });

  handle('browse:page', (q) => {
    if (process.env.YIZI_DEBUG) {
      try {
        require('node:fs').appendFileSync(
          require('node:path').join(require('electron').app.getPath('userData'), 'page-debug.log'),
          JSON.stringify(q) + String.fromCharCode(10)
        );
      } catch { /* ignore */ }
    }
    if (!q || !Number.isInteger(q.libraryId)) throw Object.assign(new Error('需要 libraryId'), { code: 'BAD_ARG' });
    return imgs.listPage(getDb(), q);
  });

  handle('browse:count', ({ libraryId, filters }) => {
    return imgs.countImages(getDb(), { ...(filters || {}), libraryId });
  });

  handle('image:get', ({ id }) => {
    const row = imgs.getImage(getDb(), id);
    if (!row) throw Object.assign(new Error('图片不存在'), { code: 'NOT_FOUND' });
    const lib = libs.getLibrary(getDb(), row.library_id);
    return { ...row, absPath: resolveInLibrary(lib.root_path, row.rel_path) };
  });

  handle('image:marks', ({ ids, heart, rejected }) => {
    const changed = imgs.setMarks(getDb(), ids, { heart, rejected });
    broadcast('browse:changed', { ids, heart, rejected });
    return { changed };
  });

  handle('image:age', ({ ids, level, source, confidence }) => {
    const changed = imgs.setAge(getDb(), ids, { level, source, confidence });
    broadcast('browse:changed', { ids, level });
    return { changed };
  });

  handle('image:dimensions', ({ id, width, height }) => {
    return { changed: imgs.setDimensions(getDb(), id, width, height) };
  });
}

module.exports = { registerBrowseIpc };
