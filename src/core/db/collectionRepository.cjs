'use strict';

/**
 * 虚拟收藏夹：只存「哪张图属于哪个集」的关系，不复制、不移动任何文件。
 */

function listCollections(db, libraryId) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.created_at AS createdAt,
              (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS count
       FROM collections c WHERE c.library_id = ? ORDER BY c.id`
    )
    .all(libraryId);
}

function createCollection(db, libraryId, name) {
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('收藏夹名字不能为空'), { code: 'BAD_NAME' });
  const existing = db
    .prepare('SELECT id, name FROM collections WHERE library_id = ? AND name = ?')
    .get(libraryId, clean);
  if (existing) return { id: existing.id, name: existing.name, existed: true };
  const info = db
    .prepare('INSERT INTO collections (library_id, name) VALUES (?, ?)')
    .run(libraryId, clean);
  return { id: Number(info.lastInsertRowid), name: clean, count: 0 };
}

function renameCollection(db, id, name) {
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('收藏夹名字不能为空'), { code: 'BAD_NAME' });
  db.prepare('UPDATE collections SET name = ?, updated_at = unixepoch() * 1000 WHERE id = ?').run(clean, id);
  return { id, name: clean };
}

function removeCollection(db, id) {
  db.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(id);
  return db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes;
}

function addItems(db, collectionId, imageIds) {
  const stmt = db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, image_id) VALUES (?, ?)');
  let added = 0;
  const run = db.transaction(() => {
    for (const id of imageIds) added += stmt.run(collectionId, id).changes;
  });
  run();
  return added;
}

function removeItems(db, collectionId, imageIds) {
  const stmt = db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND image_id = ?');
  let removed = 0;
  const run = db.transaction(() => {
    for (const id of imageIds) removed += stmt.run(collectionId, id).changes;
  });
  run();
  return removed;
}

module.exports = {
  listCollections,
  createCollection,
  renameCollection,
  removeCollection,
  addItems,
  removeItems,
};
