'use strict';

/**
 * 相似图（感知哈希）的读写：指纹列 phash 由 similar 服务写入，
 * 这里只负责存取与汉明距离比较。
 */

/** 取一组「id, 指纹」用于汉明距离比较（只取有指纹的） */
function getHashes(db, libraryId) {
  return db
    .prepare("SELECT id, phash FROM images WHERE library_id = ? AND phash IS NOT NULL AND phash != ''")
    .all(libraryId);
}

/** 还没算指纹的图（按 id 升序，方便续跑） */
function missingHashes(db, libraryId, limit = 200) {
  return db
    .prepare("SELECT id, rel_path FROM images WHERE library_id = ? AND (phash IS NULL OR phash = '') ORDER BY id LIMIT ?")
    .all(libraryId, limit);
}
function hashStats(db, libraryId) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM images WHERE library_id = ?').get(libraryId).c;
  const hashed = db
    .prepare("SELECT COUNT(*) AS c FROM images WHERE library_id = ? AND phash IS NOT NULL AND phash != ''")
    .get(libraryId).c;
  return { total, hashed, missing: total - hashed };
}

function setHashes(db, rows) {
  const stmt = db.prepare('UPDATE images SET phash = ? WHERE id = ?');
  let changed = 0;
  const run = db.transaction(() => {
    for (const row of rows) changed += stmt.run(row.phash, row.id).changes;
  });
  run();
  return changed;
}

/** 汉明距离（16 位十六进制 = 64 位） */
function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * 找相似：返回 [{id, distance}]，距离升序，不含自己。
 * 数量小（万级以内）直接全库比，够快；阈值默认 10/64。
 */
function findSimilar(db, libraryId, sourceId, { threshold = 10, limit = 60 } = {}) {
  const source = db.prepare('SELECT id, phash FROM images WHERE id = ?').get(sourceId);
  if (!source || !source.phash) return [];
  const rows = getHashes(db, libraryId);
  const out = [];
  for (const row of rows) {
    if (row.id === sourceId) continue;
    const distance = hammingHex(source.phash, row.phash);
    if (distance <= threshold) out.push({ id: row.id, distance });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}


module.exports = { getHashes, missingHashes, hashStats, setHashes, hammingHex, findSimilar };
