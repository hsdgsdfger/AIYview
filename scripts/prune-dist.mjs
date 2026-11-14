/**
 * 裁剪已打包的 win-unpacked（只删运行期用不到的东西，不动 asar 内容）
 *
 *   node scripts/prune-dist.mjs [--dry-run]
 *
 * 三轮实测的安全项：
 *   1. onnxruntime-node 只留 win32/x64（darwin、linux、win32/arm64 全删）≈ 228MB
 *   2. better-sqlite3 删编译中间件（.iobj/.ipdb/obj/*.lib/*.exp/*.vcxproj）≈ 33MB
 *      —— 保留 build/Release/better_sqlite3.node 与 bin 下 win32-x64 的 better-sqlite3.node
 *   3. Electron locales 只留 en-US / zh-CN / zh-TW ≈ 43MB
 *
 * 每一步删完都自检关键文件还在，任何一项缺失直接抛错（不静默留残包）。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const appDir = path.join(decodeURIComponent(root), 'release', 'v3.0', 'win-unpacked');
const res = path.join(appDir, 'resources');
const nm = path.join(res, 'app.asar.unpacked', 'node_modules');
const dryRun = process.argv.includes('--dry-run');

let removed = 0;
function sizeOf(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) total += sizeOf(path.join(p, e.name));
  return total;
}
function rm(p) {
  if (!fs.existsSync(p)) return;
  const bytes = sizeOf(p);
  removed += bytes;
  console.log(`${dryRun ? '[dry] ' : ''}del ${(bytes / 1048576).toFixed(1)}MB  ${path.relative(appDir, p)}`);
  if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
}

if (!fs.existsSync(nm)) throw new Error('找不到 ' + nm + '（先跑 scripts/repack-asar.mjs）');

// 1) onnxruntime 只留本平台
const onnxBin = path.join(nm, 'onnxruntime-node', 'bin');
for (const version of fs.readdirSync(onnxBin)) {
  const vDir = path.join(onnxBin, version);
  if (!fs.statSync(vDir).isDirectory()) continue;
  for (const platform of fs.readdirSync(vDir)) {
    const pDir = path.join(vDir, platform);
    if (!fs.statSync(pDir).isDirectory()) continue;
    if (platform !== 'win32') {
      rm(pDir);
      continue;
    }
    for (const arch of fs.readdirSync(pDir)) {
      const aDir = path.join(pDir, arch);
      if (fs.statSync(aDir).isDirectory() && arch !== 'x64') rm(aDir);
    }
  }
}

// 2) better-sqlite3 编译中间件
const bs3 = path.join(nm, 'better-sqlite3');
if (fs.existsSync(bs3)) {
  const rel = path.join(bs3, 'build', 'Release');
  if (fs.existsSync(rel)) {
    rm(path.join(rel, 'obj'));
    for (const e of fs.readdirSync(rel)) {
      if (/\.(iobj|ipdb|lib|exp)$/i.test(e) || /^test_extension\./i.test(e)) rm(path.join(rel, e));
    }
  }
  const buildDir = path.join(bs3, 'build');
  if (fs.existsSync(buildDir)) {
    for (const e of fs.readdirSync(buildDir)) {
      if (/\.vcxproj(\.filters)?$/i.test(e)) rm(path.join(buildDir, e));
    }
  }
}

// 3) 语言包
const keepLocales = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);
const locDir = path.join(appDir, 'locales');
if (fs.existsSync(locDir)) {
  for (const e of fs.readdirSync(locDir)) {
    if (!keepLocales.has(e)) rm(path.join(locDir, e));
  }
}

// 4) 运行期出现的调试残留
rm(path.join(appDir, 'debug.log'));

// 自检
const must = [
  path.join(nm, 'onnxruntime-node', 'bin'),
  path.join(nm, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  path.join(nm, '@img', 'colour', 'package.json'),
  path.join(nm, '@img', 'sharp-win32-x64'),
  path.join(res, 'app.asar'),
  path.join(appDir, 'locales', 'zh-CN.pak'),
];
for (const p of must) if (!fs.existsSync(p)) throw new Error('裁剪后缺失：' + path.relative(appDir, p));
if (!dryRun) {
  const onnxX64 = fs.readdirSync(path.join(nm, 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64'));
  if (!onnxX64.some((f) => f.endsWith('.dll'))) throw new Error('onnxruntime win32-x64 里没有 dll');
}

console.log(`${dryRun ? '[dry] ' : ''}共释放 ${(removed / 1048576).toFixed(1)}MB`);
