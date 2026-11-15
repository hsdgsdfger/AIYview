'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { migrate } = require('../../core/db/migrator.cjs');
const { loadMigrations, MIGRATIONS_DIR } = require('./loadMigrations.cjs');

/**
 * 加载 better-sqlite3：
 *   - better-sqlite3 的 dlopen 发生在 new Database() 时（bindings 按目录找 .node），
 *     所以 require 本身不会暴露 ABI 问题，必须显式指定 nativeBinding。
 *   - Node 环境（单测/CLI）：用 node_modules 自带的 Node ABI。
 *   - Electron 环境：优先用 .native/electron/better-sqlite3-<版本>/build/Release 的
 *     Electron ABI 副本（scripts/prepare-electron-abi.mjs 维护）。
 */
function resolveDatabase() {
  const Database = require('better-sqlite3');
  if (!process.versions.electron) return { Database, bindingPath: undefined };

  const bindingPath = path.join(
    __dirname,
    '../../../.native/electron',
    `better-sqlite3-${process.versions.electron}`,
    'build',
    'Release',
    'better_sqlite3.node'
  );
  if (fs.existsSync(bindingPath)) return { Database, bindingPath };

  // 没有副本时让 bindings 自己找（打包后的应用由 electron-builder 重编过，能直接命中）
  return { Database, bindingPath: undefined };
}

/**
 * 打开（或创建）库文件并执行迁移。
 */
function openDatabase(options) {
  const dbPath = options.dbPath;
  if (!dbPath) throw new Error('openDatabase 需要 dbPath');
  const { Database, bindingPath } = resolveDatabase();

  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = bindingPath
    ? new Database(dbPath, { nativeBinding: bindingPath })
    : new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // NORMAL 在 WAL 下只在检查点刷盘，进程被强杀会丢最后一批标记；这里改成 FULL，逐次提交即落盘
  db.pragma('synchronous = FULL');

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
