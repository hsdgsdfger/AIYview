'use strict';

/**
 * 迁移执行器（纯逻辑层）
 *
 * 约束：
 * - core/ 不得依赖 electron，也不做任何文件 IO；SQL 文本由调用方读入后传入。
 * - 每个迁移在独立事务中执行，失败整体回滚且不写 schema_migrations。
 * - 已应用的迁移做 checksum 校验，被改动过就报错（防止“改老迁移迁就实现”）。
 */

const crypto = require('node:crypto');

const TABLE = 'schema_migrations';
const FILE_PATTERN = /^(\d{3,})_([A-Za-z0-9][A-Za-z0-9_.-]*)\.sql$/;

class MigrationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = details || {};
  }
}

function checksum(sql) {
  const normalized = String(sql).replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 把文件描述转成迁移条目。只接受 `NNN_name.sql` 形式。
 */
function parseMigration(fileName, sql) {
  const match = FILE_PATTERN.exec(String(fileName));
  if (!match) {
    throw new MigrationError('BAD_FILENAME', `迁移文件名不合法：${fileName}（应为 001_name.sql）`, {
      fileName,
    });
  }
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new MigrationError('EMPTY_SQL', `迁移内容为空：${fileName}`, { fileName });
  }
  return {
    version: Number(match[1]),
    name: match[2],
    fileName,
    sql,
    checksum: checksum(sql),
  };
}

/**
 * 校验并排序。版本号必须唯一、必须为正整数。
 */
function buildPlan(entries) {
  const items = (entries || []).map((entry) =>
    entry && typeof entry === 'object' && 'checksum' in entry
      ? entry
      : parseMigration(entry.fileName, entry.sql)
  );

  const seen = new Map();
  for (const item of items) {
    if (!Number.isInteger(item.version) || item.version <= 0) {
      throw new MigrationError('BAD_VERSION', `迁移版本号非法：${item.fileName}`, {
        fileName: item.fileName,
      });
    }
    if (seen.has(item.version)) {
      throw new MigrationError(
        'DUPLICATE_VERSION',
        `迁移版本号重复：${item.version}（${seen.get(item.version).fileName} / ${item.fileName}）`,
        { version: item.version }
      );
    }
    seen.set(item.version, item);
  }

  return items.sort((a, b) => a.version - b.version);
}

function ensureTable(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       version    INTEGER PRIMARY KEY,
       name       TEXT    NOT NULL,
       checksum   TEXT    NOT NULL,
       applied_at INTEGER NOT NULL
     )`
  );
}

function appliedRows(db) {
  ensureTable(db);
  const rows = db.prepare(`SELECT version, name, checksum, applied_at FROM ${TABLE} ORDER BY version`).all();
  const map = new Map();
  for (const row of rows) map.set(row.version, row);
  return map;
}

function nowMs(opts) {
  if (typeof opts?.now === 'function') return opts.now();
  if (Number.isFinite(opts?.now)) return opts.now;
  return Date.now();
}

/**
 * 执行迁移。
 * @returns {{applied: Array, skipped: Array, current: number}}
 */
function migrate(db, entries, opts = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new MigrationError('BAD_DB', '需要一个兼容 better-sqlite3 的数据库句柄');
  }

  const plan = buildPlan(entries);
  const already = appliedRows(db);
  const result = { applied: [], skipped: [], current: 0 };

  for (const item of plan) {
    const prev = already.get(item.version);
    if (!prev) continue;
    if (prev.checksum !== item.checksum) {
      throw new MigrationError(
        'CHECKSUM_MISMATCH',
        `迁移 ${item.fileName} 内容已被改写（库中 checksum ${prev.checksum}，文件 ${item.checksum}）`,
        { version: item.version, expected: prev.checksum, actual: item.checksum }
      );
    }
    result.skipped.push({ version: item.version, name: item.name });
  }

  const insert = db.prepare(
    `INSERT INTO ${TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`
  );

  for (const item of plan) {
    if (already.has(item.version)) continue;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(item.sql);
      insert.run(item.version, item.name, item.checksum, nowMs(opts));
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 事务可能已被 SQLite 自动结束，忽略 */
      }
      throw new MigrationError(
        'APPLY_FAILED',
        `迁移 ${item.fileName} 执行失败：${error.message}`,
        { version: item.version, fileName: item.fileName, cause: error.message }
      );
    }
    result.applied.push({ version: item.version, name: item.name });
  }

  const rows = db.prepare(`SELECT MAX(version) AS v FROM ${TABLE}`).get();
  result.current = rows && rows.v ? rows.v : 0;
  return result;
}

/**
 * 只读状态：返回已应用 / 待应用的迁移清单，供健康检查与 CI 使用。
 */
function status(db, entries) {
  const plan = buildPlan(entries);
  const already = appliedRows(db);
  const applied = [];
  const pending = [];
  for (const item of plan) {
    const prev = already.get(item.version);
    if (prev) {
      applied.push({
        version: item.version,
        name: item.name,
        checksumMatches: prev.checksum === item.checksum,
        appliedAt: prev.applied_at,
      });
    } else {
      pending.push({ version: item.version, name: item.name });
    }
  }
  return { applied, pending, current: applied.length ? applied[applied.length - 1].version : 0 };
}

module.exports = {
  TABLE,
  FILE_PATTERN,
  MigrationError,
  checksum,
  parseMigration,
  buildPlan,
  migrate,
  status,
};
