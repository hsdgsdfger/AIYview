/**
 * 维护一份 Electron ABI 的 better-sqlite3 副本（.native/electron/better-sqlite3）。
 *
 * 背景：单仓两套运行时——单测/CLI 跑 Node ABI，dev Electron 跑 Electron ABI。
 * 方案：借助依赖树内的 @electron/rebuild 先把 node_modules 重编成 Electron ABI，
 * 拷贝成副本，再把 node_modules 还原回 Node ABI。默认包永远保持 Node ABI。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const electronPkg = require(path.join(root, 'node_modules/electron/package.json'));
const electronVersion = electronPkg.version;
const dest = path.join(root, '.native', 'electron', 'better-sqlite3');
const marker = path.join(dest, 'build', 'Release', 'better_sqlite3.node');
const versionMarker = path.join(dest, '.abi-version');

function needPrepare() {
  if (!fs.existsSync(marker)) return true;
  try {
    return fs.readFileSync(versionMarker, 'utf8').trim() !== electronVersion;
  } catch {
    return true;
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 失败，exit ${result.status}`);
  }
}

function prepare() {
  const bin = path.join(root, 'node_modules', '.bin');
  const electronRebuild = process.platform === 'win32'
    ? path.join(bin, 'electron-rebuild.cmd')
    : path.join(bin, 'electron-rebuild');

  console.log(`[abi] rebuilding better-sqlite3 for electron ${electronVersion} ...`);
  run(electronRebuild, ['-f', '-w', 'better-sqlite3', '--module-dir', root]);

  console.log('[abi] copying to .native/electron/better-sqlite3 ...');
  const src = path.join(root, 'node_modules/better-sqlite3');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // 只排除嵌套 node_modules（src 自身在 node_modules 下，要按相对路径判断）
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s);
      if (!rel) return true;
      return !rel.split(path.sep).includes('node_modules');
    },
  });
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(versionMarker, electronVersion);

  console.log('[abi] restoring node_modules to Node ABI ...');
  run('npm', ['rebuild', 'better-sqlite3'], { cwd: root });
}

if (needPrepare()) {
  prepare();
  console.log('[abi] electron ABI 副本就绪:', marker);
} else {
  console.log('[abi] electron ABI 副本已是最新:', marker);
}
