'use strict';


const { handle } = require('../ipc.cjs');
const { shell } = require('electron');
const { getDb } = require('../db/database.cjs');
const imgs = require('../../core/db/imageRepository.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const dels = require('../../core/db/deletionRepository.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');

/**
 * 回收站删除 + 12h 撤回（F1/F2/F3/F4）。
 * 删除：shell.trashItem（系统回收站，不直删）+ deletions 记账。
 */
function registerTrashIpc() {
  handle('delete:trash', async ({ ids } = {}) => {
    if (!Array.isArray(ids) || ids.length === 0) return { trashed: 0, failed: [] };
    const db = getDb();
    const rows = imgs.getImagesByIds(db, ids);
    const entries = [];
    const failed = [];

    for (const row of rows) {
      const lib = libs.getLibrary(db, row.library_id);
      if (!lib) { failed.push({ id: row.id, reason: 'library-missing' }); continue; }
      let absPath;
      try {
        absPath = resolveInLibrary(lib.root_path, row.rel_path);
      } catch {
        failed.push({ id: row.id, reason: 'outside-library' });
        continue;
      }
      entries.push({ row, absPath });
    }

    const deletedAt = Date.now();
    const ok = [];
    for (const { row, absPath } of entries) {
      try {
        await shell.trashItem(absPath);
        ok.push({ row, absPath });
      } catch (error) {
        failed.push({ id: row.id, reason: error.message });
      }
    }

    if (ok.length > 0) {
      dels.recordDeletion(db, ok.map(({ row, absPath }) => ({
        libraryId: row.library_id,
        imageId: row.id,
        relPath: row.rel_path,
        absPath,
        sizeBytes: row.size_bytes,
        deletedAt,
      })));
      // 按库对账移除 DB 行（分组保持事务粒度小）
      const byLib = new Map();
      for (const { row } of ok) {
        if (!byLib.has(row.library_id)) byLib.set(row.library_id, []);
        byLib.get(row.library_id).push(row.rel_path);
      }
      for (const [libId, rels] of byLib) {
        imgs.removeMissing(db, libId, new Set(rels));
      }
    }

    return { trashed: ok.length, failed };
  });

  handle('delete:list', () => dels.listPending(getDb(), {}));

  handle('delete:restore', async ({ id } = {}) => {
    const db = getDb();
    const rec = dels.get(db, id);
    if (!rec) throw Object.assign(new Error('记录不存在'), { code: 'NOT_FOUND' });
    if (rec.status !== 'pending') throw Object.assign(new Error('已不可撤回'), { code: 'NOT_RESTORABLE' });
    if (rec.expires_at <= Date.now()) throw Object.assign(new Error('已超过 12 小时'), { code: 'EXPIRED' });

    // Windows 回收站还原：走 PowerShell Shell.Application（F2 按路径还原）
    const restored = await restoreFromRecycleBin(rec.abs_path);
    if (!restored) throw Object.assign(new Error('回收站里找不到该文件，无法还原'), { code: 'NOT_IN_BIN' });

    dels.markRestored(db, id);
    // 原行在删除时已 removeMissing；还原后要求重新扫描该库来找回行
    return { restored: true, absPath: rec.abs_path, relPath: rec.rel_path };
  });

  handle('delete:sweep', () => dels.sweepExpired(getDb()));
}

/**
 * 通过 Windows Shell COM 按原始路径还原回收站文件。
 * @returns {Promise<boolean>}
 */
async function restoreFromRecycleBin(absPath) {
  const { execFile } = require('node:child_process');
  const script = `
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(10)
$target = [System.IO.Path]::GetFullPath('${absPath.replace(/'/g, "''")}')
foreach ($item in $bin.Items()) {
  $orig = $bin.GetDetailsOf($item, 1)
  if ($orig -and $target.StartsWith((Split-Path $orig -Parent), [System.StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path $orig -Leaf) -eq (Split-Path $target -Leaf)) {
    $bin.MoveHere($item) | Out-Null
    Write-Output 'RESTORED'
    exit 0
  }
}
Write-Output 'NOT_FOUND'
`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 }, (err, stdout) => {
      resolve(!err && String(stdout).includes('RESTORED'));
    });
  });
}

module.exports = { registerTrashIpc };
