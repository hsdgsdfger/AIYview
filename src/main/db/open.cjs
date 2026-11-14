'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { migrate } = require('../../core/db/migrator.cjs');
const { loadMigrations, MIGRATIONS_DIR } = require('./loadMigrations.cjs');

/**
 * 打开（或创建）库文件并执行迁移。
 * better-sqlite3 是原生模块，必须与当前运行时的 ABI 匹配：
 * 单测跑在 Node 下；Electron 里跑之前需要先做 rebuild（M1 打包环节处理）。
 */
function openDatabase(options) {
  const dbPath = options.dbPath;
  if (!dbPath) throw new Error('openDatabase 需要 dbPath');
  const Database = require('better-sqlite3');

  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  const migration = migrate(db, loadMigrations(options.migrationsDir || MIGRATIONS_DIR), {
    now: options.now,
  });

  return { db, migration };
}

/**
 * 只读健康检查，供 IPC 自检使用；任何失败都以结构化结果返回，不抛到渲染层。
 */
function probeDatabase(dbPath) {
  try {
    const { db, migration } = openDatabase({ dbPath });
    const userVersion = db.pragma('user_version', { simple: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    db.close();
    return { ok: true, current: migration.current, applied: migration.applied, tables, userVersion };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code || 'DB_PROBE_FAILED' };
  }
}

module.exports = { openDatabase, probeDatabase };
