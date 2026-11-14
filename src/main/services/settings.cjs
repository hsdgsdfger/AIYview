'use strict';

const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');

/** 应用设置（主题 / 遮挡阈值等），value 为 JSON 字符串 */
function registerSettingsIpc() {
  handle('settings:get', ({ key } = {}) => {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  });

  handle('settings:set', ({ key, value } = {}) => {
    if (!key) throw Object.assign(new Error('需要 key'), { code: 'BAD_ARG' });
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch() * 1000`
      )
      .run(key, JSON.stringify(value));
    return true;
  });

  handle('settings:all', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  });
}

module.exports = { registerSettingsIpc };
