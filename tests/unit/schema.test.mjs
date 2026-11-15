import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const migrator = require('../../src/core/db/migrator.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const migrationsDir = path.join(repoRoot, 'src/core/db/migrations');

function buildDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((n) => n.endsWith('.sql'))
    .sort();
  const entries = files.map((f) => migrator.parseMigration(f, fs.readFileSync(path.join(migrationsDir, f), 'utf8')));
  const result = migrator.migrate(db, entries);
  return { db, result, files };
}

function tables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function indexes(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

test('迁移目录按序就位（001 基础表 + 002 目录缓存 + 003 排序键）', () => {
  const files = fs.readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
  assert.deepEqual(files, ['001_init.sql', '002_folders.sql', '003_sort_key.sql']);
});

test('迁移能一次建成全部表', () => {
  const { db, result } = buildDb();
  assert.equal(result.applied.length, 3);
  assert.equal(result.applied[2].version, 3);

  assert.deepEqual(tables(db), [
    'deletions',
    'folders',
    'image_prompts',
    'image_tags',
    'images',
    'libraries',
    'prompt_library',
    'schema_migrations',
    'settings',
    'tags',
  ]);
  db.close();
});

test('索引齐全：列表页、心数、分级、标签、删除扫描', () => {
  const { db } = buildDb();
  const names = indexes(db);
  for (const name of [
    'idx_images_library_mtime',
    'idx_images_library_name',
    'idx_images_heart',
    'idx_images_age',
    'idx_images_rejected',
    'idx_folders_library',
    'idx_image_tags_tag',
    'idx_tags_name_zh',
    'idx_prompt_library_time',
    'idx_deletions_sweep',
    'idx_deletions_path',
  ]) {
    assert.ok(names.includes(name), `缺少索引 ${name}`);
  }
  db.close();
});

test('user_version 与迁移数对齐', () => {
  const { db } = buildDb();
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  db.close();
});

function seedLibrary(db) {
  const info = db.prepare('INSERT INTO libraries (name, root_path) VALUES (?, ?)').run('主库', 'D:\\pics');
  return Number(info.lastInsertRowid);
}

function insertImage(db, libraryId, overrides = {}) {
  const row = {
    library_id: libraryId,
    rel_path: 'a.png',
    file_name: 'a.png',
    ext: 'png',
    size_bytes: 1024,
    mtime_ms: 1700000000000,
    ...overrides,
  };
  return db
    .prepare(
      `INSERT INTO images (library_id, rel_path, file_name, ext, size_bytes, mtime_ms)
       VALUES (@library_id, @rel_path, @file_name, @ext, @size_bytes, @mtime_ms)`
    )
    .run(row);
}

test('心数默认 0，范围 0–5 硬约束', () => {
  const { db } = buildDb();
  const lib = seedLibrary(db);
  const info = insertImage(db, lib);
  const id = Number(info.lastInsertRowid);

  assert.equal(db.prepare('SELECT heart FROM images WHERE id = ?').get(id).heart, 0);
  assert.equal(db.prepare('SELECT rejected FROM images WHERE id = ?').get(id).rejected, 0);

  db.prepare('UPDATE images SET heart = 5 WHERE id = ?').run(id);
  assert.equal(db.prepare('SELECT heart FROM images WHERE id = ?').get(id).heart, 5);
  assert.throws(() => db.prepare('UPDATE images SET heart = 6 WHERE id = ?').run(id), /CHECK/);
  assert.throws(() => db.prepare('UPDATE images SET heart = -1 WHERE id = ?').run(id), /CHECK/);
  db.close();
});

test('「未判定」必须能留空，不能默认成 l0', () => {
  const { db } = buildDb();
  const lib = seedLibrary(db);
  const id = Number(insertImage(db, lib).lastInsertRowid);

  const row = db.prepare('SELECT age_level, age_source FROM images WHERE id = ?').get(id);
  assert.equal(row.age_level, null);
  assert.equal(row.age_source, 'none');

  db.prepare("UPDATE images SET age_level = 0, age_source = 'manual' WHERE id = ?").run(id);
  assert.equal(db.prepare('SELECT age_level FROM images WHERE id = ?').get(id).age_level, 0);

  db.prepare('UPDATE images SET age_level = 4 WHERE id = ?').run(id);
  assert.throws(() => db.prepare('UPDATE images SET age_level = 5 WHERE id = ?').run(id), /CHECK/);
  assert.throws(() => db.prepare("UPDATE images SET age_source = 'guess' WHERE id = ?").run(id), /CHECK/);
  db.close();
});

test('同一图库内 rel_path 唯一，跨图库可重复', () => {
  const { db } = buildDb();
  const libA = seedLibrary(db);
  const libB = Number(
    db.prepare('INSERT INTO libraries (name, root_path) VALUES (?, ?)').run('副库', 'E:\\pics').lastInsertRowid
  );

  insertImage(db, libA);
  assert.throws(() => insertImage(db, libA), /UNIQUE/);
  insertImage(db, libB);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM images').get().c, 2);
  db.close();
});

test('删除图库级联清空图片与关联标签', () => {
  const { db } = buildDb();
  const lib = seedLibrary(db);
  const imageId = Number(insertImage(db, lib).lastInsertRowid);
  const tagId = Number(db.prepare("INSERT INTO tags (name, name_zh) VALUES ('1girl', '一个女孩')").run().lastInsertRowid);
  db.prepare('INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(imageId, tagId);

  db.prepare('DELETE FROM libraries WHERE id = ?').run(lib);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM images').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM image_tags').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM tags').get().c, 1, '标签字典不该被删');
  db.close();
});

test('提示词库可脱离原图存在（原图删掉不带走提示词）', () => {
  const { db } = buildDb();
  const lib = seedLibrary(db);
  const imageId = Number(insertImage(db, lib).lastInsertRowid);
  db.prepare(
    `INSERT INTO prompt_library (title, positive, seed, source_image_id, source_rel_path)
     VALUES ('夜景', 'night, city', 12345, ?, 'a.png')`
  ).run(imageId);

  db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
  const row = db.prepare('SELECT source_image_id, positive FROM prompt_library').get();
  assert.equal(row.source_image_id, null);
  assert.equal(row.positive, 'night, city');
  db.close();
});

test('删除记录默认 pending，并区分 restored / expired', () => {
  const { db } = buildDb();
  const lib = seedLibrary(db);

  const info = db
    .prepare(
      `INSERT INTO deletions (library_id, rel_path, abs_path, deleted_at, expires_at)
       VALUES (?, 'a.png', 'D:\\pics\\a.png', 1000, 44200000)`
    )
    .run(lib);
  const row = db.prepare('SELECT status, restored_at FROM deletions WHERE id = ?').get(info.lastInsertRowid);
  assert.equal(row.status, 'pending');
  assert.equal(row.restored_at, null);

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO deletions (library_id, rel_path, abs_path, deleted_at, expires_at, status)
           VALUES (?, 'b.png', 'D:\\pics\\b.png', 1000, 2000, 'done')`
        )
        .run(lib),
    /CHECK/
  );
  db.close();
});

test('12 小时窗口可按 expires_at 直接查出待撤回项', () => {
  const { db } = buildDb();
  const lib = seedLibrary(db);
  const deletedAt = 1_700_000_000_000;
  const expiresAt = deletedAt + 12 * 3600 * 1000;

  db.prepare(
    `INSERT INTO deletions (library_id, rel_path, abs_path, deleted_at, expires_at)
     VALUES (?, 'a.png', 'D:\\pics\\a.png', ?, ?)`
  ).run(lib, deletedAt, expiresAt);

  const due = db
    .prepare("SELECT rel_path FROM deletions WHERE status = 'pending' AND expires_at > ?")
    .all(deletedAt + 1000);
  assert.deepEqual(due, [{ rel_path: 'a.png' }]);
  db.close();
});

test('标签名全局唯一，中文名可空', () => {
  const { db } = buildDb();
  db.prepare("INSERT INTO tags (name, name_zh, category, post_count) VALUES ('1girl', '一个女孩', 0, 100)").run();
  assert.throws(() => db.prepare("INSERT INTO tags (name) VALUES ('1girl')").run(), /UNIQUE/);
  db.prepare("INSERT INTO tags (name) VALUES ('solo')").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM tags').get().c, 2);
  db.close();
});

test('settings 以 key 为主键可覆盖', () => {
  const { db } = buildDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'dark')").run();
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('theme', 'light') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run();
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'theme'").get().value, 'light');
  db.close();
});

test('重复打开同一库文件不会重复执行迁移', () => {
  const tmp = path.join(repoRoot, 'tmp', `schema-test-${process.pid}.sqlite`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.rmSync(tmp, { force: true });

  const entries = fs
    .readdirSync(migrationsDir)
    .filter((n) => n.endsWith('.sql'))
    .map((f) => migrator.parseMigration(f, fs.readFileSync(path.join(migrationsDir, f), 'utf8')));

  const first = new Database(tmp);
  first.pragma('foreign_keys = ON');
  const r1 = migrator.migrate(first, entries);
  first.close();

  const second = new Database(tmp);
  second.pragma('foreign_keys = ON');
  const r2 = migrator.migrate(second, entries);
  second.close();

  assert.equal(r1.applied.length, 3);
  assert.equal(r2.applied.length, 0);
  assert.equal(r2.current, 3);

  fs.rmSync(tmp, { force: true });
  fs.rmSync(`${tmp}-wal`, { force: true });
  fs.rmSync(`${tmp}-shm`, { force: true });
});
