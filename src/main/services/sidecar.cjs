'use strict';

/**
 * 侧车文件：把每张图的标记（心数 / 废标 / 分级 / 标签）写成图旁边的一份
 * `<文件名>.aiyview.json`，换机器、换软件、重装程序都不会因为库丢了而全废。
 * 只写侧车，不动原图。
 */

const path = require('node:path');
const fs = require('node:fs');
const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');

function sidecarFor(absPath) {
  return absPath.replace(/(\.[A-Za-z0-9]+)$/, '') + '.aiyview.json';
}

function rowsForLibrary(db, libraryId) {
  const images = db
    .prepare(
      `SELECT id, rel_path, file_name, heart, rejected, age_level AS ageLevel, age_source AS ageSource
       FROM images WHERE library_id = ? ORDER BY id`
    )
    .all(libraryId);
  const tagsByImage = new Map();
  const tagRows = db
    .prepare(
      `SELECT it.image_id AS imageId, t.name AS name, t.name_zh AS nameZh
       FROM image_tags it JOIN tags t ON t.id = it.tag_id
       JOIN images i ON i.id = it.image_id WHERE i.library_id = ?`
    )
    .all(libraryId);
  for (const row of tagRows) {
    if (!tagsByImage.has(row.imageId)) tagsByImage.set(row.imageId, []);
    tagsByImage.get(row.imageId).push(row.nameZh || row.name);
  }
  return { images, tagsByImage };
}

function registerSidecarIpc(broadcast) {
  /**
   * 导出侧车：默认整库，给 ids 就只导出这几张。
   * @returns {{written:number, skipped:number, failed:number}}
   */
  handle('image:export-sidecar', ({ libraryId, ids } = {}) => {
    const db = getDb();
    const lib = libs.getLibrary(db, libraryId);
    if (!lib) throw Object.assign(new Error('图库不存在'), { code: 'NOT_FOUND' });
    const root = lib.root_path.replace(/\//g, path.sep);
    const { images, tagsByImage } = rowsForLibrary(db, libraryId);
    const only = Array.isArray(ids) && ids.length ? new Set(ids) : null;

    let written = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of images) {
      if (only && !only.has(row.id)) continue;
      try {
        const abs = resolveInLibrary(root, row.rel_path);
        const sidecar = sidecarFor(abs);
        const payload = {
          app: 'AIYview',
          version: 1,
          file: row.file_name,
          heart: row.heart || 0,
          rejected: row.rejected ? 1 : 0,
          ageLevel: row.ageLevel === null ? null : row.ageLevel,
          ageSource: row.ageSource || null,
          tags: tagsByImage.get(row.id) || [],
          updatedAt: Date.now(),
        };
        fs.writeFileSync(sidecar, JSON.stringify(payload, null, 2), 'utf8');
        written += 1;
      } catch {
        failed += 1;
      }
    }
    skipped = images.length - written - failed - (only ? images.length - only.size : 0);
    if (typeof broadcast === 'function') broadcast('sidecar:progress', { libraryId, written, failed });
    return { written, failed, skipped: Math.max(0, skipped) };
  });
}

module.exports = { registerSidecarIpc, sidecarFor };
