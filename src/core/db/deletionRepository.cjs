'use strict';

/**
 * 删除记录：系统回收站 + 12 小时撤回（F1/F2/F3/F4）。
 * 文件操作（真删/还原）在 src/main/fs/ 里做，这里只管账。
 */

const UNDO_WINDOW_MS = 12 * 3600 * 1000;

/**
 * 记录一次待删除。deletedAt 由调用方传入（同一批共享时间戳）。
 */
function recordDeletion(db, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO deletions (library_id, image_id, rel_path, abs_path, size_bytes, deleted_at, expires_at, status)
     VALUES (@library_id, @image_id, @rel_path, @abs_path, @size_bytes, @deleted_at, @expires_at, 'pending')`
  );
  const ids = [];
  const run = db.transaction(() => {
    for (const e of entries) {
      const info = insert.run({
        library_id: e.libraryId,
        image_id: e.imageId || null,
        rel_path: e.relPath,
        abs_path: e.absPath,
        size_bytes: e.sizeBytes || 0,
        deleted_at: e.deletedAt || now,
        expires_at: (e.deletedAt || now) + UNDO_WINDOW_MS,
      });
      ids.push(Number(info.lastInsertRowid));
    }
  });
  run();
  return ids;
}

/** 最近删除面板（F4）：只列未过期的 pending */
function listPending(db, { limit = 200 } = {}) {
  return db
    .prepare(
      `SELECT * FROM deletions WHERE status = 'pending' AND expires_at > ?
       ORDER BY deleted_at DESC LIMIT ?`
    )
    .all(Date.now(), limit);
}

/** 标记已撤回（还原成功后调用） */
function markRestored(db, deletionId) {
  return db
    .prepare("UPDATE deletions SET status = 'restored', restored_at = ? WHERE id = ?")
    .run(Date.now(), deletionId).changes;
}

/** 到期清扫：pending 且 expires_at 已过的记为 expired。返回条数。 */
function sweepExpired(db, now = Date.now()) {
  return db
    .prepare("UPDATE deletions SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?")
    .run(now).changes;
}

/** 撤回时查原始位置 */
function get(db, id) {
  return db.prepare('SELECT * FROM deletions WHERE id = ?').get(id) || null;
}

module.exports = { UNDO_WINDOW_MS, recordDeletion, listPending, markRestored, sweepExpired, get };
