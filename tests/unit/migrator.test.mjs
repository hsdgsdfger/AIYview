import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const migrator = require('../../src/core/db/migrator.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

const M1 = { fileName: '001_alpha.sql', sql: 'CREATE TABLE alpha (id INTEGER PRIMARY KEY, name TEXT);' };
const M2 = { fileName: '002_beta.sql', sql: 'CREATE TABLE beta (id INTEGER PRIMARY KEY, ref INTEGER);' };

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row);
}

test('parseMigration 接受 NNN_name.sql 并算出 checksum', () => {
  const item = migrator.parseMigration('007_add_tags.sql', 'CREATE TABLE t (id INTEGER);');
  assert.equal(item.version, 7);
  assert.equal(item.name, 'add_tags');
  assert.equal(item.checksum.length, 16);
});

test('parseMigration 拒绝非法文件名', () => {
  assert.throws(() => migrator.parseMigration('init.sql', 'SELECT 1;'), /文件名不合法/);
  assert.throws(() => migrator.parseMigration('1_short.sql', 'SELECT 1;'), /文件名不合法/);
  assert.throws(() => migrator.parseMigration('001_.sql', 'SELECT 1;'), /文件名不合法/);
});

test('parseMigration 拒绝空 SQL', () => {
  assert.throws(() => migrator.parseMigration('001_empty.sql', '   \n  '), (err) => err.code === 'EMPTY_SQL');
});

test('checksum 对换行风格不敏感，对内容敏感', () => {
  const a = migrator.checksum('CREATE TABLE t (id INTEGER);\nSELECT 1;');
  const b = migrator.checksum('CREATE TABLE t (id INTEGER);\r\nSELECT 1;');
  const c = migrator.checksum('CREATE TABLE t (id INTEGER);\nSELECT 2;');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('buildPlan 按版本升序，不受入参顺序影响', () => {
  const plan = migrator.buildPlan([M2, M1].map((m) => migrator.parseMigration(m.fileName, m.sql)));
  assert.deepEqual(
    plan.map((p) => p.version),
    [1, 2]
  );
});

test('buildPlan 拒绝重复版本号', () => {
  const dup = [migrator.parseMigration('001_a.sql', 'SELECT 1;'), migrator.parseMigration('001_b.sql', 'SELECT 1;')];
  assert.throws(() => migrator.buildPlan(dup), (err) => err.code === 'DUPLICATE_VERSION');
});

test('migrate 首次执行全部应用并建立版本表', () => {
  const db = freshDb();
  const result = migrator.migrate(db, [M1, M2], { now: 1700000000000 });

  assert.equal(result.applied.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.current, 2);
  assert.ok(tableExists(db, 'alpha'));
  assert.ok(tableExists(db, 'beta'));
  assert.ok(tableExists(db, migrator.TABLE));

  const rows = db.prepare(`SELECT version, name, checksum, applied_at FROM ${migrator.TABLE} ORDER BY version`).all();
  assert.deepEqual(
    rows.map((r) => r.version),
    [1, 2]
  );
  assert.equal(rows[0].applied_at, 1700000000000);
  db.close();
});

test('migrate 重复执行是幂等的（跳过且不改版本表）', () => {
  const db = freshDb();
  migrator.migrate(db, [M1, M2]);
  const second = migrator.migrate(db, [M1, M2]);

  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.equal(second.current, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${migrator.TABLE}`).get().c, 2);
  db.close();
});

test('migrate 只补未应用的那一条', () => {
  const db = freshDb();
  migrator.migrate(db, [M1]);
  const result = migrator.migrate(db, [M1, M2]);

  assert.deepEqual(result.applied, [{ version: 2, name: 'beta' }]);
  assert.deepEqual(result.skipped, [{ version: 1, name: 'alpha' }]);
  assert.ok(tableExists(db, 'beta'));
  db.close();
});

test('已应用迁移被改写时报 CHECKSUM_MISMATCH', () => {
  const db = freshDb();
  migrator.migrate(db, [M1]);

  const tampered = { fileName: '001_alpha.sql', sql: 'CREATE TABLE alpha (id INTEGER PRIMARY KEY);' };
  assert.throws(
    () => migrator.migrate(db, [tampered]),
    (err) => err.code === 'CHECKSUM_MISMATCH' && err.details.version === 1
  );
  db.close();
});

test('迁移失败整体回滚：表不留下、版本不记录', () => {
  const db = freshDb();
  const broken = {
    fileName: '003_broken.sql',
    sql: 'CREATE TABLE gamma (id INTEGER PRIMARY KEY); INSERT INTO not_exists (a) VALUES (1);',
  };

  assert.throws(() => migrator.migrate(db, [broken]), (err) => err.code === 'APPLY_FAILED');
  assert.equal(tableExists(db, 'gamma'), false);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${migrator.TABLE}`).get().c, 0);
  db.close();
});

test('失败后库仍可用，修好后能继续迁移', () => {
  const db = freshDb();
  const broken = { fileName: '002_broken.sql', sql: 'CREATE TABLE beta (id INTEGER); BAD SQL HERE;' };
  assert.throws(() => migrator.migrate(db, [M1, broken]));
  assert.ok(tableExists(db, 'alpha'), '已成功的 001 不应被回滚');

  const fixed = { fileName: '002_beta.sql', sql: 'CREATE TABLE beta (id INTEGER PRIMARY KEY);' };
  const result = migrator.migrate(db, [M1, fixed]);
  assert.deepEqual(result.applied, [{ version: 2, name: 'beta' }]);
  db.close();
});

test('status 分开报告已应用与待应用', () => {
  const db = freshDb();
  migrator.migrate(db, [M1]);
  const st = migrator.status(db, [M1, M2]);

  assert.equal(st.current, 1);
  assert.equal(st.applied.length, 1);
  assert.equal(st.applied[0].checksumMatches, true);
  assert.deepEqual(st.pending, [{ version: 2, name: 'beta' }]);
  db.close();
});

test('status 能发现磁盘上的迁移被改动', () => {
  const db = freshDb();
  migrator.migrate(db, [M1]);
  const st = migrator.status(db, [{ fileName: '001_alpha.sql', sql: 'SELECT 1;' }]);
  assert.equal(st.applied[0].checksumMatches, false);
  db.close();
});

test('migrate 拒绝非数据库句柄', () => {
  assert.throws(() => migrator.migrate({}, [M1]), (err) => err.code === 'BAD_DB');
});
