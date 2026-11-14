/**
 * better-sqlite3 原生 ABI 切换器
 *
 *   --electron  打包前：把 .native/electron/better-sqlite3-<ver> 的 Electron ABI
 *               二进制覆盖到 node_modules（electron-builder 打包时原样收进 asar）
 *               没有副本时退回 @electron/rebuild 重编
 *   --node      打包后：npm rebuild 还原 Node ABI（单测/CLI 用）
 *
 * 背景见 .workbuddy/memory：@electron/rebuild 的 .forge-meta 标记会被 npm rebuild
 * 弄脏，导致后续 rebuild 静默跳过，这里完全绕开它。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const mode = process.argv.includes('--electron') ? 'electron' : 'node';
const bindingPath = path.join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');

function verifyNodeAbi() {
  // 直接 require .node 文件：better-sqlite3 的包级 require 是惰性的（构造时才 dlopen），
  // 所以必须直载二进制才能验证 ABI。Node ABI 下应成功。
  try {
    delete require.cache[bindingPath];
    require(bindingPath);
    return true;
  } catch {
    return false;
  }
}

if (mode === 'node') {
  const result = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error('npm rebuild 失败');
  if (!verifyNodeAbi()) throw new Error('npm rebuild 后仍不是 Node ABI');
  console.log('[abi] node_modules = Node ABI ✓');
  process.exit(0);
}

// --electron
const electronPkg = require(path.join(root, 'node_modules/electron/package.json'));
const electronVersion = electronPkg.version;
const prepared = path.join(
  root, '.native', 'electron', `better-sqlite3-${electronVersion}`, 'build', 'Release', 'better_sqlite3.node'
);

if (fs.existsSync(prepared)) {
  fs.copyFileSync(prepared, bindingPath);
  console.log(`[abi] 打包用 Electron ABI 二进制已就位（来自 .native 副本, electron ${electronVersion}）`);
  process.exit(0);
}

// 没有副本：退回 electron-rebuild 强制重编
console.log('[abi] 无 .native 副本，走 electron-rebuild 强制重编…');
const bin = path.join(root, 'node_modules', '.bin');
const electronRebuild = process.platform === 'win32'
  ? path.join(bin, 'electron-rebuild.cmd')
  : path.join(bin, 'electron-rebuild');
const marker = path.join(root, 'node_modules/better-sqlite3/build/Release/.forge-meta');
fs.rmSync(marker, { force: true }); // 清掉会被 npm rebuild 弄脏的标记
const result = spawnSync(electronRebuild, ['-f', '-w', 'better-sqlite3', '--module-dir', root], {
  stdio: 'inherit', shell: process.platform === 'win32',
});
if (result.status !== 0) throw new Error('electron-rebuild 失败');
console.log('[abi] 打包用 Electron ABI 二进制已就位（electron-rebuild 重编）');
