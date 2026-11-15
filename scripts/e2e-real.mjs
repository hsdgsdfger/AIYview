/**
 * 真库端到端验收：注册 → 扫描入库 → 游标分页 → 缩略图 → 提示词读取 → 筛选
 * 直接用 Node 侧核心模块（不走 Electron），指标与需求文档的性能目标对照。
 * 用法: node scripts/e2e-real.mjs "<图库根目录绝对路径>"
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const migrator = require(path.join(root, 'src/core/db/migrator.cjs'));
const libs = require(path.join(root, 'src/core/db/libraryRepository.cjs'));
const imgs = require(path.join(root, 'src/core/db/imageRepository.cjs'));
const { scanAndIndex } = require(path.join(root, 'src/core/scan/scanPipeline.cjs'));
const meta = require(path.join(root, 'src/core/legacy/metadata.cjs'));

const libRoot = process.argv[2];
if (!libRoot) {
  console.error('用法: node scripts/e2e-real.mjs "<图库根目录绝对路径>"');
  process.exit(2);
}
const tmpDb = path.join(root, '.native', 'e2e-real.sqlite');
fs.mkdirSync(path.dirname(tmpDb), { recursive: true });
try {
  fs.rmSync(tmpDb, { force: true });
} catch {
  /* 首次运行没有旧库 */
}

const db = new Database(tmpDb);
db.pragma('foreign_keys = ON');
const dir = path.join(root, 'src/core/db/migrations');
migrator.migrate(db, fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => migrator.parseMigration(f, fs.readFileSync(path.join(dir, f), 'utf8'))));

const t = (label, fn) => {
  const s = performance.now();
  const r = fn();
  console.log(`  ${label}: ${(performance.now() - s).toFixed(1)}ms`);
  return r;
};

const lib = libs.registerLibrary(db, { name: '真实图库', rootPath: libRoot });
console.log(`库: ${lib.name} (${lib.root_path})`);

const s0 = performance.now();
const summary = await scanAndIndex({ db, library: lib });
const scanMs = performance.now() - s0;
console.log(`扫描入库: 总数 ${summary.total}，新增 ${summary.inserted}，耗时 ${scanMs.toFixed(0)}ms（${(summary.total / (scanMs / 1000)).toFixed(0)} 张/秒）`);

console.log('游标分页（每页 100）:');
let cursor = null;
let acc = 0;
let pages = 0;
const pageTimes = [];
for (;;) {
  const s = performance.now();
  const page = imgs.listPage(db, { libraryId: lib.id, cursor, limit: 100, sort: 'mtime' });
  pageTimes.push(performance.now() - s);
  pages += 1;
  acc += page.items.length;
  if (!page.hasMore) break;
  cursor = page.nextCursor;
}
pageTimes.sort((a, b) => a - b);
const p95 = pageTimes[Math.floor(pageTimes.length * 0.95)] || pageTimes[pageTimes.length - 1];
console.log(`  共 ${pages} 页 / ${acc} 张；单页中位 ${pageTimes[Math.floor(pageTimes.length / 2)].toFixed(2)}ms，p95 ${p95.toFixed(2)}ms`);

console.log('缩略图（320px，前 30 张，串行）:');
const sharp = require(path.join(root, 'node_modules/sharp'));
const rows = imgs.listPage(db, { libraryId: lib.id, limit: 30 }).items;
const thumbTimes = [];
const thumbDir = path.join(root, '.native', 'e2e-thumbs');
fs.mkdirSync(thumbDir, { recursive: true });
for (const row of rows) {
  const abs = path.join(libRoot, row.rel_path.split('/').join(path.sep));
  const s = performance.now();
  await sharp(abs, { failOn: 'none' }).rotate().resize(320, 320, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 }).toFile(path.join(thumbDir, `${row.id}.jpg`));
  thumbTimes.push(performance.now() - s);
}
thumbTimes.sort((a, b) => a - b);
console.log(`  生成 ${thumbTimes.length} 张；中位 ${thumbTimes[Math.floor(thumbTimes.length / 2)].toFixed(1)}ms，p95 ${thumbTimes[Math.floor(thumbTimes.length * 0.95)].toFixed(1)}ms`);

console.log('提示词读取（前 20 张，全文件解析）:');
const metaTimes = [];
let withPrompt = 0;
for (const row of imgs.listPage(db, { libraryId: lib.id, limit: 20 }).items) {
  const abs = path.join(libRoot, row.rel_path.split('/').join(path.sep));
  const s = performance.now();
  const m = await meta.readMetadataFromFile(abs);
  metaTimes.push(performance.now() - s);
  if (m.positive || m.prompt) withPrompt += 1;
}
metaTimes.sort((a, b) => a - b);
console.log(`  解析 20 张；中位 ${metaTimes[Math.floor(metaTimes.length / 2)].toFixed(1)}ms，p95 ${metaTimes[metaTimes.length - 1].toFixed(1)}ms；有提示词 ${withPrompt}/20`);

console.log('筛选:');
t('心数≥1 计数', () => imgs.setMarks(db, rows.slice(0, 5).map((r) => r.id), { heart: 3 }));
console.log(`  心数≥1: ${imgs.countImages(db, { libraryId: lib.id, heartMin: 1 })} 张`);
console.log(`  未判定分级: ${imgs.countImages(db, { libraryId: lib.id, ageMax: 1 })} 张`);
console.log(`  按目录 sub: ${imgs.countImages(db, { libraryId: lib.id, folder: rows[0].rel_path.includes('/') ? rows[0].rel_path.split('/')[0] : '' })} 张`);

db.close();
console.log('E2E 完成 ✓');
