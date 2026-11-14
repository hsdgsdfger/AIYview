'use strict';

const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const tags = require('../../core/db/tagRepository.cjs');

/**
 * 标签 IPC：字典导入（本地 CSV，零网络）、搜索/联想、关联增删。
 */
function registerTagIpc() {
  handle('tag:import-csv', ({ path: csvPath, source } = {}) => {
    const fsp = require('node:fs/promises');
    return fsp.readFile(csvPath, 'utf8').then((text) => {
      const rows = parseTagCsv(text);
      return tags.importDictionary(getDb(), rows, { source: source || 'illutag' });
    });
  });

  handle('tag:search', ({ q, limit } = {}) => tags.searchTags(getDb(), q, { limit }));
  handle('tag:suggest', ({ prefix, limit } = {}) => tags.suggest(getDb(), prefix, { limit }));
  handle('tag:of-image', ({ imageId } = {}) => tags.tagsOfImage(getDb(), imageId));

  handle('tag:attach', ({ imageId, names, origin, confidence } = {}) => {
    const db = getDb();
    const ids = (names || []).map((n) => tags.getOrCreateTag(db, n));
    const changed = tags.attachTags(db, imageId, ids, { origin, confidence });
    return { changed, ids };
  });

  handle('tag:detach', ({ imageId, tagId } = {}) => tags.detachTag(getDb(), imageId, tagId));
  handle('tag:get-or-create', ({ name, nameZh } = {}) => ({ id: tags.getOrCreateTag(getDb(), name, { nameZh }) }));
}

/**
 * 极简 CSV 解析：只处理 selected_tags.csv 的规则形状（无引号包裹字段、首行表头）。
 * 列名兼容 tag_id,name,category,count[,zh_name,...] 与 name,category,count 形状。
 */
function parseTagCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  const nameIdx = header.indexOf('name');
  const zhIdx = header.indexOf('zh_name');
  const catIdx = header.indexOf('category');
  const cntIdx = header.indexOf('count');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const name = (nameIdx >= 0 ? cols[nameIdx] : cols[0]).trim();
    if (!name) continue;
    out.push({
      name,
      zh_name: zhIdx >= 0 ? (cols[zhIdx] || '').trim() : '',
      category: catIdx >= 0 ? Number(cols[catIdx]) || 0 : 0,
      count: cntIdx >= 0 ? Number(cols[cntIdx]) || 0 : 0,
    });
  }
  return out;
}

module.exports = { registerTagIpc, parseTagCsv };
