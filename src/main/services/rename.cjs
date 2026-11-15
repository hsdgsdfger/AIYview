'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const imgs = require('../../core/db/imageRepository.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');
const { planBatchRename, applyBatchRename } = require('../../core/legacy/batchRename.cjs');

/**
 * 批量重命名接线：把 core/legacy/batchRename.cjs 接到 IPC 上。
 * 预览 = 纯函数出计划（不落盘）；应用 = 两阶段 rename + DB 同步更新 rel_path。
 */
function registerRenameIpc(broadcast) {
  handle('image:rename-preview', ({ ids, template, startIndex = 1 } = {}) => buildPlan({ ids, template, startIndex }));
  handle('image:rename-apply', async ({ ids, template, startIndex = 1 } = {}) => {
    const plan = await buildPlan({ ids, template, startIndex });
    if (!plan.plan.some((item) => !item.skip)) return { ...plan, renamed: 0, failed: [] };

    const result = await applyBatchRename(plan, {});
    const renamed = plan.plan.filter((item) => !item.skip && item.to);
    const done = renamed.length - (result.failed || []).length;
    if (done > 0) {
      syncDb(renamed.filter((item) => !(result.failed || []).some((f) => f.from === item.from)));
      broadcast('browse:changed', { reason: 'rename' });
    }
    return { ...plan, renamed: done, failed: result.failed || [] };
  });
}

/**
 * 收集选中图片的文件事实，按目录分组出计划。
 * 目录内已存在文件名用于冲突消解（排除本次要改的源文件名，否则自己会撞自己）。
 */
async function buildPlan({ ids, template, startIndex = 1 } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return { plan: [], conflicts: [], skipped: 0, missing: [] };
  if (typeof template !== 'string' || template.trim() === '') {
    throw Object.assign(new Error('需要重命名模板'), { code: 'BAD_ARG' });
  }

  const db = getDb();
  const rows = imgs.getImagesByIds(db, ids);
  const missing = [];
  const files = [];

  const libCache = new Map();
  for (const row of rows) {
    if (!libCache.has(row.library_id)) libCache.set(row.library_id, libs.getLibrary(db, row.library_id));
    const lib = libCache.get(row.library_id);
    if (!lib) {
      missing.push({ id: row.id, reason: 'library-missing' });
      continue;
    }
    try {
      const absPath = resolveInLibrary(lib.root_path, row.rel_path);
      files.push({
        id: row.id,
        path: absPath,
        name: row.file_name,
        mtimeMs: row.mtime_ms,
        libraryId: row.library_id,
        root: lib.root_path,
      });
    } catch {
      missing.push({ id: row.id, reason: 'outside-library' });
    }
  }

  // 按目录分组：文件名冲突只在同目录内发生；index 跨组连续，保证编号不重复
  const groups = new Map();
  for (const file of files) {
    const dir = path.dirname(file.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }

  const merged = { plan: [], conflicts: [], skipped: 0, missing };
  let index = Number.isInteger(startIndex) ? startIndex : 1;

  for (const [dir, groupFiles] of groups) {
    let existingNames = [];
    try {
      const names = await fsp.readdir(dir);
      const selected = new Set(groupFiles.map((f) => path.basename(f.path).toLowerCase()));
      existingNames = names.filter((name) => !selected.has(name.toLowerCase()));
    } catch {
      /* 读不到目录就只做计划内去重 */
    }
    const result = planBatchRename(groupFiles, { template, startIndex: index, existingNames });
    for (const item of result.plan) {
      const file = groupFiles.find((f) => f.path === item.from);
      merged.plan.push({ ...item, id: file ? file.id : null });
      if (item.skip) merged.skipped += 1;
    }
    merged.conflicts.push(...result.conflicts);
    index += groupFiles.length;
  }

  merged.plan.sort((a, b) => (a.id || 0) - (b.id || 0));
  return merged;
}

/**
 * 文件改名后同步 DB。
 * 两阶段更新：先把所有行挪到临时 rel_path，再写最终值，
 * 否则 A→B、B→A 这种互换会在 UNIQUE(library_id, rel_path) 上撞车。
 */
function syncDb(items) {
  const db = getDb();
  const rows = new Map();
  for (const item of items) {
    const row = db.prepare('SELECT id, library_id, rel_path FROM images WHERE id = ?').get(item.id);
    if (row) rows.set(item.id, row);
  }

  const run = db.transaction(() => {
    const setTmp = db.prepare('UPDATE images SET rel_path = ?, updated_at = unixepoch() * 1000 WHERE id = ?');
    for (const [id] of rows) setTmp.run(`#renaming-${id}-${Date.now()}`, id);

    const setFinal = db.prepare(
      'UPDATE images SET rel_path = ?, file_name = ?, sort_key = ?, updated_at = unixepoch() * 1000 WHERE id = ?'
    );
    for (const item of items) {
      const row = rows.get(item.id);
      if (!row) continue;
      const lib = libs.getLibrary(db, row.library_id);
      if (!lib) continue;
      const root = path.resolve(lib.root_path.replace(/\//g, path.sep));
      const rel = path.relative(root, item.to).split(path.sep).join('/');
      setFinal.run(rel, path.basename(item.to), imgs.naturalKey(rel), item.id);
    }
  });
  run();
}

module.exports = { registerRenameIpc };
