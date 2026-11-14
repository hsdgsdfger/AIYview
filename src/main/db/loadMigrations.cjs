'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseMigration } = require('../../core/db/migrator.cjs');

const MIGRATIONS_DIR = path.join(__dirname, '../../core/db/migrations');

/**
 * 读取 SQL 目录。core 层是纯逻辑，文件 IO 留在这里。
 */
function loadMigrations(dir = MIGRATIONS_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort();

  return files.map((fileName) => parseMigration(fileName, fs.readFileSync(path.join(dir, fileName), 'utf8')));
}

module.exports = { loadMigrations, MIGRATIONS_DIR };
