'use strict';

/**
 * 标签字典 + 图片↔标签关联。
 * 字典可整表导入 illuTag / WD tagger 的 selected_tags.csv（含中文列）。
 */

function importDictionary(db, rows, { source = 'illutag' } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, updated: 0 };
  const upsert = db.prepare(`
    INSERT INTO tags (name, name_zh, category, post_count, source)
    VALUES (@name, @name_zh, @category, @post_count, @source)
    ON CONFLICT(name) DO UPDATE SET
      name_zh    = COALESCE(excluded.name_zh, name_zh),
      category   = excluded.category,
      post_count = excluded.post_count
  `);
  let inserted = 0;
  let updated = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      const name = String(row.name || '').trim();
      if (!name) continue;
      const before = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
      upsert.run({
        name,
        name_zh: (row.name_zh || row.zh_name || '').trim() || null,
        category: Number(row.category) || 0,
        post_count: Number(row.count || row.post_count) || 0,
        source,
      });
      if (before) updated += 1;
      else inserted += 1;
    }
  });
  run();
  return { inserted, updated };
}

function searchTags(db, q, { limit = 30 } = {}) {
  if (!q || !q.trim()) return db.prepare('SELECT * FROM tags ORDER BY post_count DESC LIMIT ?').all(limit);
  const like = `%${q.trim()}%`;
  return db
    .prepare(
      `SELECT * FROM tags WHERE name LIKE @like OR (name_zh IS NOT NULL AND name_zh LIKE @like)
       ORDER BY post_count DESC LIMIT @limit`
    )
    .all({ like, limit });
}

function getOrCreateTag(db, name, { nameZh } = {}) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('标签名不能为空');
  const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(clean);
  if (row) return row.id;
  const info = db
    .prepare('INSERT INTO tags (name, name_zh, source) VALUES (?, ?, ?)')
    .run(clean, nameZh || null, 'manual');
  return Number(info.lastInsertRowid);
}

function attachTags(db, imageId, tagIds, { origin = 'manual', confidence = 1.0 } = {}) {
  if (!Array.isArray(tagIds) || tagIds.length === 0) return 0;
  const upsert = db.prepare(`
    INSERT INTO image_tags (image_id, tag_id, confidence, origin)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(image_id, tag_id) DO UPDATE SET confidence = excluded.confidence, origin = excluded.origin
  `);
  let changed = 0;
  const run = db.transaction(() => {
    for (const tagId of tagIds) changed += upsert.run(imageId, tagId, confidence, origin).changes;
  });
  run();
  return changed;
}

function detachTag(db, imageId, tagId) {
  return db.prepare('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?').run(imageId, tagId).changes;
}

function tagsOfImage(db, imageId) {
  return db
    .prepare(
      `SELECT t.id, t.name, t.name_zh AS nameZh, t.category, it.confidence, it.origin
       FROM image_tags it JOIN tags t ON t.id = it.tag_id
       WHERE it.image_id = ? ORDER BY t.category, t.post_count DESC`
    )
    .all(imageId);
}

/** 联想输入：按名称/中文名前缀 + 词频排序 */
function suggest(db, prefix, { limit = 12 } = {}) {
  const p = String(prefix || '').trim();
  if (!p) return [];
  return db
    .prepare(
      `SELECT id, name, name_zh AS nameZh, category, post_count FROM tags
       WHERE name LIKE @p || '%' OR name_zh LIKE @p || '%'
       ORDER BY post_count DESC LIMIT @limit`
    )
    .all({ p, limit });
}

module.exports = { importDictionary, searchTags, getOrCreateTag, attachTags, detachTag, tagsOfImage, suggest };
