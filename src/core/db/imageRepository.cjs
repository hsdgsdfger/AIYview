'use strict';

/**
 * 图片仓储（纯 DB 逻辑）
 *
 * 关键设计：20 万张图永不一次性返回，全部走 keyset 游标分页。
 * 游标 = base64(JSON)，按 (mtime_ms, id) 或 (rel_path) 排序定位，
 * 复杂度 O(log n)，翻一万页也不会像 OFFSET 那样变慢。
 */

const PAGE_DEFAULT = 500;
const PAGE_MAX = 2000;

const path = require('node:path');

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw new Error('游标格式非法');
  }
}

function extOf(fileName) {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

/**
 * 自然排序键：小写 + 数字段左补 8 位。
 * img_2.png → img_00000002.png，img_10.png → img_00000010.png，于是 2 排在 10 前面。
 * 数字段超过 8 位的（极少见）保持原样，仍然可比较。
 */
const DIGIT_RUN = /\d+/g;
function naturalKey(relPath) {
  return String(relPath || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(DIGIT_RUN, (digits) => (digits.length >= 8 ? digits : digits.padStart(8, '0')));
}

/**
 * 老库补 sort_key（003 迁移只加了列）：一次全量补齐，之后靠 upsert 维护。
 * @returns {number} 补了多少行
 */
function backfillSortKeys(db, batchSize = 2000) {
  const select = db.prepare('SELECT id, rel_path FROM images WHERE sort_key IS NULL LIMIT ?');
  const update = db.prepare('UPDATE images SET sort_key = ? WHERE id = ?');
  let total = 0;
  for (;;) {
    const rows = select.all(batchSize);
    if (rows.length === 0) break;
    const run = db.transaction(() => {
      for (const row of rows) update.run(naturalKey(row.rel_path), row.id);
    });
    run();
    total += rows.length;
  }
  return total;
}

/**
 * 批量 upsert：重复扫描只更新文件事实，保留用户标记（heart/rejected/age）。
 * @param {Array<{name,path,size,mtimeMs,subDir}>} scanned scanFolder 的输出
 * @param {string} root 图库根（用于算 rel_path）
 * @returns {{inserted:number, updated:number}}
 */
function upsertScanned(db, libraryId, scanned, root) {
  const upsert = db.prepare(`
    INSERT INTO images (library_id, rel_path, file_name, ext, size_bytes, mtime_ms, sort_key)
    VALUES (@library_id, @rel_path, @file_name, @ext, @size_bytes, @mtime_ms, @sort_key)
    ON CONFLICT(library_id, rel_path) DO UPDATE SET
      file_name = excluded.file_name,
      ext       = excluded.ext,
      size_bytes= excluded.size_bytes,
      mtime_ms  = excluded.mtime_ms,
      sort_key  = excluded.sort_key,
      updated_at= unixepoch() * 1000
  `);
  const selectId = db.prepare('SELECT id FROM images WHERE library_id = ? AND rel_path = ?');

  let inserted = 0;
  let updated = 0;

  const run = db.transaction((rows) => {
    for (const row of rows) {
      const before = selectId.get(row.library_id, row.rel_path);
      upsert.run(row);
      if (before) updated += 1;
      else inserted += 1;
    }
  });

  // 分批跑，避免 20 万行单事务占内存
  const BATCH = 1000;
  for (let i = 0; i < scanned.length; i += BATCH) {
    const rows = scanned.slice(i, i + BATCH).map((item) => {
      const rel = root
        ? path.relative(root, item.path).split('\\').join('/')
        : String(item.subDir ? `${item.subDir}/` : '') + item.name;
      return {
        library_id: libraryId,
        rel_path: rel,
        file_name: item.name,
        ext: extOf(item.name),
        size_bytes: item.size || 0,
        mtime_ms: Math.round(item.mtimeMs || 0),
        sort_key: naturalKey(rel),
      };
    });
    run(rows);
  }

  return { inserted, updated };
}

/**
 * 收集目录链（配合 rebuildFolders 使用）
 */
function folderChains(scanned, root) {
  const out = [];
  for (const item of scanned) {
    const rel = root
      ? path.relative(root, item.path).split('\\').join('/')
      : String(item.subDir ? `${item.subDir}/` : '') + item.name;
    out.push({ rel_path: rel });
  }
  return out;
}

/**
 * 统一筛选条件 -> SQL 片段。全部参数化，杜绝拼接注入。
 */
function buildFilters(filters = {}) {
  const where = ['library_id = @libraryId'];
  const params = { libraryId: filters.libraryId };
  if (filters.folder !== undefined && filters.folder !== null && filters.folder !== '') {
    where.push("rel_path LIKE @folderPrefix || '/%'");
    params.folderPrefix = filters.folder;
  }
  if (filters.heartMin !== undefined && filters.heartMin !== null) {
    where.push('heart >= @heartMin');
    params.heartMin = filters.heartMin;
  }
  if (filters.rejectedOnly) {
    where.push('rejected = 1');
  } else if (filters.hideRejected) {
    where.push('rejected = 0');
  }
  if (filters.ageMax !== undefined && filters.ageMax !== null) {
    // 阈值筛选：「隐藏 ≥ l2」= 只显示 age_level < 阈值 或 未判定(NULL)
    where.push('(age_level IS NULL OR age_level < @ageMax)');
    params.ageMax = filters.ageMax;
  }
  if (filters.ageOnly !== undefined && filters.ageOnly !== null) {
    where.push('age_level = @ageOnly');
    params.ageOnly = filters.ageOnly;
  }
  if (filters.untaggedOnly) {
    where.push('id NOT IN (SELECT image_id FROM image_tags)');
  }
  if (filters.tagId !== undefined && filters.tagId !== null) {
    where.push('id IN (SELECT image_id FROM image_tags WHERE tag_id = @tagId)');
    params.tagId = filters.tagId;
  }
  if (filters.nameLike) {
    const raw = String(filters.nameLike).trim();
    // `tag:` 前缀 = 只在标签里找；否则文件名 / 标签 / 提示词一起找
    const tagOnly = /^tag:/i.test(raw) ? raw.slice(4).trim() : '';
    const q = `%${tagOnly || raw}%`;
    const tagHit = `id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON t.id = it.tag_id
      WHERE t.name LIKE @q OR IFNULL(t.name_zh, '') LIKE @q)`;
    if (tagOnly) {
      where.push(tagHit);
    } else {
      where.push(`(file_name LIKE @q
        OR ${tagHit}
        OR id IN (SELECT image_id FROM image_prompts
          WHERE IFNULL(positive, '') LIKE @q OR IFNULL(negative, '') LIKE @q))`);
    }
    params.q = q;
  }
  return { where: `WHERE ${where.join(' AND ')}`, params };
}

/**
 * 游标分页列表。
 * @param {object} q {libraryId, cursor, limit, sort:'mtime_desc'|'mtime_asc'|'name_asc'|'name_desc', filters}
 *   （兼容旧值 'mtime' = mtime_desc、'name' = name_asc）
 * @returns {{items:Array, nextCursor:string|null, hasMore:boolean}}
 */
function listPage(db, q) {
  const limit = Math.min(Math.max(Number(q.limit) || PAGE_DEFAULT, 1), PAGE_MAX);
  const sortKey = normalizeSort(q.sort);
  const byName = sortKey === 'name_asc' || sortKey === 'name_desc';
  const desc = sortKey === 'mtime_desc' || sortKey === 'name_desc';
  const { where, params } = buildFilters({ ...(q.filters || {}), libraryId: q.libraryId });
  const cursor = decodeCursor(q.cursor);

  let orderSql;
  let cursorSql = '';
  if (byName) {
    // 自然排序：sort_key 是「数字段补零」的路径键（img_2 排在 img_10 前）
    orderSql = `ORDER BY sort_key ${desc ? 'DESC' : 'ASC'}, id ${desc ? 'DESC' : 'ASC'}`;
    if (cursor && cursor.k !== undefined) {
      cursorSql = desc
        ? 'AND (sort_key < @curK OR (sort_key = @curK AND id < @curId))'
        : 'AND (sort_key > @curK OR (sort_key = @curK AND id > @curId))';
      params.curK = cursor.k;
      params.curId = cursor.id || 0;
    }
  } else {
    orderSql = `ORDER BY mtime_ms ${desc ? 'DESC' : 'ASC'}, id ${desc ? 'DESC' : 'ASC'}`;
    if (cursor && cursor.m !== undefined) {
      cursorSql = desc
        ? 'AND (mtime_ms < @curM OR (mtime_ms = @curM AND id < @curId))'
        : 'AND (mtime_ms > @curM OR (mtime_ms = @curM AND id > @curId))';
      params.curM = cursor.m;
      params.curId = cursor.id || 0;
    }
  }

  const items = db
    .prepare(`SELECT id, rel_path, file_name, ext, size_bytes, mtime_ms, width, height,
                     heart, rejected, age_level AS ageLevel, age_source AS ageSource, sort_key
              FROM images ${where} ${cursorSql} ${orderSql} LIMIT @limit`)
    .all({ ...params, limit: limit + 1 });

  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  let nextCursor = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = byName
      ? encodeCursor({ k: last.sort_key, id: last.id })
      : encodeCursor({ m: last.mtime_ms, id: last.id });
  }

  return { items, nextCursor, hasMore };
}

/** 排序值归一；未知值按 mtime_desc */
function normalizeSort(value) {
  switch (value) {
    case 'mtime_asc':
      return 'mtime_asc';
    case 'name_asc':
    case 'name':
      return 'name_asc';
    case 'name_desc':
      return 'name_desc';
    default:
      return 'mtime_desc';
  }
}

function countImages(db, filters = {}) {
  const { where, params } = buildFilters(filters);
  if (!('libraryId' in params) || params.libraryId === undefined) {
    throw new Error('countImages 需要 libraryId');
  }
  return db.prepare(`SELECT COUNT(*) AS c FROM images ${where}`).get(params).c;
}

function getImage(db, id) {
  return db.prepare('SELECT * FROM images WHERE id = ?').get(id) || null;
}

function getImagesByIds(db, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const sorted = [...ids].sort((a, b) => a - b);
  return db
    .prepare(
      `SELECT * FROM images WHERE id IN (${sorted.map(() => '?').join(',')})`
    )
    .all(...sorted);
}

/**
 * 批量打标（心数/废标），一次事务。
 */
function setMarks(db, ids, { heart, rejected } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  let changed = 0;
  const run = db.transaction(() => {
    if (heart !== undefined && heart !== null) {
      const stmt = db.prepare('UPDATE images SET heart = ?, updated_at = unixepoch() * 1000 WHERE id = ?');
      for (const id of ids) changed += stmt.run(heart, id).changes;
    }
    if (rejected !== undefined && rejected !== null) {
      const stmt = db.prepare('UPDATE images SET rejected = ?, updated_at = unixepoch() * 1000 WHERE id = ?');
      for (const id of ids) changed += stmt.run(rejected ? 1 : 0, id).changes;
    }
  });
  run();
  return changed;
}

function setAge(db, ids, { level, source, confidence } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const stmt = db.prepare(
    'UPDATE images SET age_level = ?, age_source = ?, age_confidence = ?, updated_at = unixepoch() * 1000 WHERE id = ?'
  );
  let changed = 0;
  const run = db.transaction(() => {
    for (const id of ids) {
      changed += stmt.run(
        level === undefined || level === null ? null : level,
        source || 'manual',
        confidence === undefined ? null : confidence,
        id
      ).changes;
    }
  });
  run();
  return changed;
}

function setDimensions(db, id, width, height) {
  return db
    .prepare('UPDATE images SET width = ?, height = ?, updated_at = unixepoch() * 1000 WHERE id = ?')
    .run(width, height, id).changes;
}

/**
 * 对账：库里存在但磁盘上已消失的行按库删除（默认关，扫描时可选）。
 */
function removeMissing(db, libraryId, existingRelPaths) {
  const keep = new Set(existingRelPaths);
  const rows = db.prepare('SELECT id, rel_path FROM images WHERE library_id = ?').all(libraryId);
  const gone = rows.filter((r) => !keep.has(r.rel_path)).map((r) => r.id);
  if (gone.length === 0) return 0;
  const del = db.prepare('DELETE FROM images WHERE id = ?');
  const run = db.transaction(() => {
    for (const id of gone) del.run(id);
  });
  run();
  return gone.length;
}

module.exports = {
  PAGE_DEFAULT,
  PAGE_MAX,
  encodeCursor,
  decodeCursor,
  upsertScanned,
  naturalKey,
  backfillSortKeys,
  folderChains,
  listPage,
  countImages,
  getImage,
  getImagesByIds,
  setMarks,
  setAge,
  setDimensions,
  removeMissing,
};
