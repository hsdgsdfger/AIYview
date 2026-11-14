/**
 * 迁移 CLI：node scripts/db-migrate.mjs --db ./tmp/index.sqlite [--status]
 * 用来在不启动 Electron 的情况下验证 001_init.sql 真的能建库。
 */
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { openDatabase, probeDatabase } = require('../src/main/db/open.cjs');
const migrator = require('../src/core/db/migrator.cjs');
const { loadMigrations } = require('../src/main/db/loadMigrations.cjs');

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : path.join(process.cwd(), 'tmp', 'index.sqlite');

if (args.includes('--status')) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const st = migrator.status(db, loadMigrations());
  console.log(JSON.stringify(st, null, 2));
  db.close();
  process.exit(0);
}

const started = Date.now();
const { db, migration } = openDatabase({ dbPath });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
const indexes = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
db.close();

console.log(`db        : ${dbPath}`);
console.log(`applied   : ${migration.applied.length}  skipped: ${migration.skipped.length}  current: ${migration.current}`);
console.log(`elapsed   : ${Date.now() - started}ms`);
console.log(`tables(${tables.length})  : ${tables.join(', ')}`);
console.log(`indexes(${indexes.length}) : ${indexes.join(', ')}`);
console.log(`reopen    : ${JSON.stringify(probeDatabase(dbPath))}`);
