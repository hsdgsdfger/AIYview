'use strict';

/**
 * 全库备份：把当前 index.sqlite 快照一份到 userData/backups/，
 * 文件名带时间戳，不覆盖旧备份；只读拷贝，不改当前库。
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, shell } = require('electron');
const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');

function backupDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function stamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

function registerBackupIpc(broadcast) {
  handle('app:backup', () => {
    const db = getDb();
    // 先把 WAL 合并进主库，否则拷出来的快照可能少最近几次操作
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* 检查点失败也继续拷，顶多丢最近事务 */
    }
    const src = path.join(app.getPath('userData'), 'index.sqlite');
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `index-${stamp()}.sqlite`);
    fs.copyFileSync(src, dest);
    const size = fs.statSync(dest).size;
    if (typeof broadcast === 'function') broadcast('app:backup-done', { path: dest, size });
    return { path: dest, size };
  });

  handle('app:backup-open', async () => {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
}

module.exports = { registerBackupIpc, backupDir };
