/**
 * 原地重打 app.asar（不跑 electron-builder）
 *
 *   node scripts/repack-asar.mjs [--dist-only]
 *
 * 流程：解出 win-unpacked 里现有的 app.asar → 覆盖 dist（及可选 src）→ 用 asar pack
 * 重打 → 备份旧 asar → 覆盖 asar **并把新生成的 app.asar.unpacked 一起同步过去**。
 *
 * 最后一步是关键：pack 时被 --unpack-dir 记为“解包”的模块（@img/sharp*、@img/colour、
 * better-sqlite3、onnxruntime-node）物理文件都在 <out>.unpacked 里，只换 asar 不同步
 * 这个目录，运行时会报 Cannot find module '@img/colour'，表现为缩略图全部加载失败。
 *
 * 背景：本机 electron-builder 打包会挂在 packaging 阶段（CPU 归零），所以改代码后
 * 走这条只重打 asar 的路。原生模块 ABI 用 scripts/set-native-abi.mjs 管。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const asarLib = require(path.join(root, 'node_modules', '@electron', 'asar', 'lib', 'asar.js'));

const releaseRes = path.join(root, 'release', 'v3.0', 'win-unpacked', 'resources');
const targetAsar = path.join(releaseRes, 'app.asar');
const targetUnpacked = path.join(releaseRes, 'app.asar.unpacked');
const work = path.join(root, 'tmp', 'repack');
const outAsar = path.join(root, 'tmp', 'app.asar.new');
const asarBin = path.join(root, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');

/** 需要解包到磁盘的原生/二进制模块（其余一律留在 asar 内） */
const UNPACK_DIR = 'node_modules/**/{@img,better-sqlite3,onnxruntime-node}';

if (!fs.existsSync(targetAsar)) throw new Error(`找不到 ${targetAsar}，先跑一次 electron-builder 或确认版本目录`);

const distOnly = process.argv.includes('--dist-only');

function run(args) {
  const r = spawnSync(process.execPath, [asarBin, ...args], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`asar ${args[0]} 失败`);
}

/** 手写递归复制：本机 Node 22 上 fs.cpSync 会直接崩（0xC0000409），别用它 */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(outAsar, { force: true });
fs.rmSync(`${outAsar}.unpacked`, { recursive: true, force: true });

console.log('[repack] 解出现有 asar…');
run(['extract', targetAsar, work]);

console.log('[repack] 覆盖 dist…');
fs.rmSync(path.join(work, 'dist'), { recursive: true, force: true });
copyDir(path.join(root, 'dist'), path.join(work, 'dist'));
if (!distOnly) {
  console.log('[repack] 覆盖 src…');
  fs.rmSync(path.join(work, 'src'), { recursive: true, force: true });
  copyDir(path.join(root, 'src'), path.join(work, 'src'));
}

console.log('[repack] 打包…');
run(['pack', work, outAsar, '--unpack-dir', UNPACK_DIR]);

// 备份旧 asar（只留一份，够回滚即可）
const backup = path.join(root, 'tmp', 'app.asar.prev');
fs.copyFileSync(targetAsar, backup);

fs.copyFileSync(outAsar, targetAsar);
if (fs.existsSync(`${outAsar}.unpacked`)) {
  console.log('[repack] 同步解包目录…');
  copyDir(`${outAsar}.unpacked`, targetUnpacked);
}

// 自检：sharp 依赖链上的纯 JS 包必须真的在解包目录里，否则缩略图会静默全挂
const colourPkg = path.join(targetUnpacked, 'node_modules', '@img', 'colour', 'package.json');
if (!fs.existsSync(colourPkg)) throw new Error('@img/colour 未同步到 app.asar.unpacked，缩略图会加载失败');

const list = asarLib.listPackage(targetAsar).map((p) => p.replace(/\\/g, '/'));
for (const need of ['/node_modules/@img/colour/package.json', '/node_modules/sharp/lib/index.js', '/dist/index.html']) {
  if (!list.includes(need)) throw new Error(`asar 内缺少 ${need}`);
}

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(outAsar, { force: true });
fs.rmSync(`${outAsar}.unpacked`, { recursive: true, force: true });

const size = fs.statSync(targetAsar).size;
console.log(`[repack] 完成：${targetAsar} ${size} 字节（旧包备份 tmp/app.asar.prev）`);
