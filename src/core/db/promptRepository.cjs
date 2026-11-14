'use strict';

/**
 * 提示词库（需求 D2 / 4.1）：存进软件自己的库，可搜、可跳回原图、可导出，不写原图目录。
 */

function saveFromImage(db, imageId, meta, { title, note } = {}) {
  const image = db.prepare('SELECT id, rel_path FROM images WHERE id = ?').get(imageId);
  if (!image) throw new Error('图片不存在: ' + imageId);

  const info = db
    .prepare(
      `INSERT INTO prompt_library (title, positive, negative, model, sampler, steps, cfg, seed,
                                  note, source_image_id, source_rel_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title || image.rel_path,
      meta.positive || '',
      meta.negative || '',
      (meta.params && meta.params.Model) || '',
      (meta.params && meta.params.Sampler) || '',
      toInt(meta.params && meta.params.Steps),
      toFloat(meta.params && meta.params['CFG scale']),
      toInt(meta.params && meta.params.Seed),
      note || '',
      image.id,
      image.rel_path
    );
  return Number(info.lastInsertRowid);
}

function saveManual(db, { title, positive, negative, model, sampler, steps, cfg, seed, note }) {
  const info = db
    .prepare(
      `INSERT INTO prompt_library (title, positive, negative, model, sampler, steps, cfg, seed, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title || '', positive || '', negative || '', model || '', sampler || '', toInt(steps), toFloat(cfg), toInt(seed), note || '');
  return Number(info.lastInsertRowid);
}

function listPage(db, { cursor, limit = 100, search } = {}) {
  const where = [];
  const params = {};
  if (search) {
    where.push('(positive LIKE @q OR negative LIKE @q OR title LIKE @q OR model LIKE @q)');
    params.q = `%${search}%`;
  }
  if (cursor) {
    where.push('id < @curId');
    params.curId = decode(cursor).id;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = db
    .prepare(`SELECT * FROM prompt_library ${whereSql} ORDER BY id DESC LIMIT @limit`)
    .all({ ...params, limit: limit + 1 });
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return {
    items,
    nextCursor: hasMore && items.length ? encode({ id: items[items.length - 1].id }) : null,
    hasMore,
  };
}

function get(db, id) {
  return db.prepare('SELECT * FROM prompt_library WHERE id = ?').get(id) || null;
}

function update(db, id, { title, positive, negative, note } = {}) {
  const row = get(db, id);
  if (!row) return 0;
  return db
    .prepare(
      `UPDATE prompt_library SET title = ?, positive = ?, negative = ?, note = ?, updated_at = unixepoch() * 1000 WHERE id = ?`
    )
    .run(title ?? row.title, positive ?? row.positive, negative ?? row.negative, note ?? row.note, id).changes;
}

function remove(db, id) {
  return db.prepare('DELETE FROM prompt_library WHERE id = ?').run(id).changes;
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toFloat(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function encode(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decode(cursor) {
  return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
}

module.exports = { saveFromImage, saveManual, listPage, get, update, remove };
