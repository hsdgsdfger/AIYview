'use strict';

/**
 * 图库与目录树仓储（纯 DB 逻辑，句柄由调用方注入）
 */

function normalizeRoot(p) {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
}

/**
 * 注册图库：同根目录幂等，名称可更新。返回完整行。
 */
function registerLibrary(db, { name, rootPath }) {
  const root = normalizeRoot(rootPath);
  if (!root) throw new Error('rootPath 不能为空');
  const displayName = (name || '').trim() || root.split('/').pop() || root;

  const row = db
    .prepare('SELECT id FROM libraries WHERE root_path = ?')
    .get(root);

  if (row) {
    db.prepare('UPDATE libraries SET name = ?, updated_at = ? WHERE id = ?').run(
      displayName,
      Date.now(),
      row.id
    );
    return getLibrary(db, row.id);
  }

  const info = db
    .prepare('INSERT INTO libraries (name, root_path) VALUES (?, ?)')
    .run(displayName, root);
  return getLibrary(db, Number(info.lastInsertRowid));
}

function getLibrary(db, id) {
  return db.prepare('SELECT * FROM libraries WHERE id = ?').get(id) || null;
}

function listLibraries(db) {
  return db.prepare('SELECT * FROM libraries ORDER BY id').all();
}

function removeLibrary(db, id) {
  db.prepare('DELETE FROM libraries WHERE id = ?').run(id);
}

function touchScan(db, id, { imageCount }) {
  db.prepare('UPDATE libraries SET image_count = ?, last_scan_at = ?, updated_at = ? WHERE id = ?').run(
    imageCount,
    Date.now(),
    Date.now(),
    id
  );
}

/* ---------------- 目录树 ---------------- */

function parentChain(relPath) {
  const parts = String(relPath).split('/');
  const chain = [''];
  for (let i = 1; i < parts.length; i++) {
    chain.push(parts.slice(0, i).join('/'));
  }
  return chain;
}

/**
 * 重建目录缓存（扫描完成后调用，事务内全量替换最简单且 20 万级也够快）。
 * @param {Array<{rel_path: string}>} rows
 */
function rebuildFolders(db, libraryId, rows) {
  const dirs = new Map();
  for (const row of rows) {
    for (const dir of parentChain(row.rel_path)) {
      dirs.set(dir, (dirs.get(dir) || 0) + 1);
    }
  }

  const insert = db.prepare(
    'INSERT INTO folders (library_id, dir_path, file_count) VALUES (?, ?, ?)'
  );
  db.prepare('DELETE FROM folders WHERE library_id = ?').run(libraryId);
  for (const [dir, count] of dirs) {
    insert.run(libraryId, dir, count);
  }
}

function listFolderTree(db, libraryId) {
  return db
    .prepare('SELECT dir_path, file_count FROM folders WHERE library_id = ? ORDER BY dir_path')
    .all(libraryId);
}

module.exports = {
  normalizeRoot,
  registerLibrary,
  getLibrary,
  listLibraries,
  removeLibrary,
  touchScan,
  parentChain,
  rebuildFolders,
  listFolderTree,
};
