import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const migrator = require('../../src/core/db/migrator.cjs');

const libs = require('../../src/core/db/libraryRepository.cjs');
const imgs = require('../../src/core/db/imageRepository.cjs');
const prompts = require('../../src/core/db/promptRepository.cjs');
const tags = require('../../src/core/db/tagRepository.cjs');
const dels = require('../../src/core/db/deletionRepository.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../src/core/db/migrations');

function buildDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const files = fs.readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
  const entries = files.map((f) => migrator.parseMigration(f, fs.readFileSync(path.join(migrationsDir, f), 'utf8')));
  migrator.migrate(db, entries);
  return db;
}

function fakeScan(dir, n) {
  // 生成 scanFolder 形状的假数据：mtime 递减保证 mtime 分页稳定
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = `img_${String(i).padStart(4, '0')}.png`;
    const rel = dir ? `${dir}/${name}` : name;
    out.push({
      name,
      path: `D:\\pics\\${rel.split('/').join('\\')}`,
      url: '',
      size: 1024 + i,
      mtimeMs: 1_700_000_000_000 + i * 1000,
      subDir: dir,
    });
  }
  return out;
}

function seedLibrary(db) {
  return libs.registerLibrary(db, { name: '主库', rootPath: 'D:\\pics' });
}

/* ---------------- libraries / folders ---------------- */

test('registerLibrary 同根幂等并更新名称', () => {
  const db = buildDb();
  const a = libs.registerLibrary(db, { name: '', rootPath: 'D:\\pics' });
  assert.equal(a.name, 'pics', '缺省名取目录名');
  const b = libs.registerLibrary(db, { name: '我的图库', rootPath: 'D:/pics/' });
  assert.equal(b.id, a.id, '正斜杠归一后同一库');
  assert.equal(b.name, '我的图库');
  assert.equal(libs.listLibraries(db).length, 1);
  db.close();
});

test('rebuildFolders 建立父目录链，含根目录', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  const scanned = [...fakeScan('', 3), ...fakeScan('sub/deep', 2)];
  imgs.upsertScanned(db, lib.id, scanned, 'D:\\pics');
  libs.rebuildFolders(db, lib.id, imgs.folderChains(scanned, 'D:\\pics'));

  const dirs = libs.listFolderTree(db, lib.id).map((r) => r.dir_path);
  assert.deepEqual(dirs, ['', 'sub', 'sub/deep']);
  const deep = libs.listFolderTree(db, lib.id).find((r) => r.dir_path === 'sub/deep');
  assert.equal(deep.file_count, 2);
  db.close();
});

test('removeLibrary 级联清空图片与目录缓存', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 5), 'D:\\pics');
  libs.removeLibrary(db, lib.id);
  assert.equal(imgs.countImages(db, { libraryId: lib.id }), 0);
  assert.equal(libs.listFolderTree(db, lib.id).length, 0);
  db.close();
});

/* ---------------- upsert / 对账 ---------------- */

test('upsertScanned 首扫全插入；重扫只更新不重复，保留用户标记', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  const scanned = fakeScan('', 10);
  const r1 = imgs.upsertScanned(db, lib.id, scanned, 'D:\\pics');
  assert.deepEqual(r1, { inserted: 10, updated: 0 });

  const firstId = imgs.getImage(db, 1).id;
  imgs.setMarks(db, [firstId], { heart: 3, rejected: 1 });

  // 文件变大 + mtime 变化，重扫
  const changed = scanned.map((s, i) => (i === 0 ? { ...s, size: 9999, mtimeMs: s.mtimeMs + 5000 } : s));
  const r2 = imgs.upsertScanned(db, lib.id, changed, 'D:\\pics');
  assert.deepEqual(r2, { inserted: 0, updated: 10 });

  const row = imgs.getImage(db, firstId);
  assert.equal(row.size_bytes, 9999);
  assert.equal(row.heart, 3, '重扫不丢心数');
  assert.equal(row.rejected, 1, '重扫不丢废标');
  db.close();
});

test('removeMissing 清掉磁盘上已消失的行', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  const scanned = fakeScan('', 6);
  imgs.upsertScanned(db, lib.id, scanned, 'D:\\pics');
  const keep = new Set(scanned.slice(0, 4).map((s) => s.name));
  const removed = imgs.removeMissing(db, lib.id, keep);
  assert.equal(removed, 2);
  assert.equal(imgs.countImages(db, { libraryId: lib.id }), 4);
  db.close();
});

/* ---------------- 游标分页 ---------------- */

test('listPage mtime 排序：翻页无重复无遗漏，游标耗尽返回 null', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 23), 'D:\\pics');

  const seen = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    const page = imgs.listPage(db, { libraryId: lib.id, cursor, limit: 5, sort: 'mtime' });
    pages += 1;
    seen.push(...page.items.map((i) => i.id));
    if (!page.hasMore) {
      assert.equal(page.nextCursor, null);
      break;
    }
    assert.ok(page.nextCursor);
    cursor = page.nextCursor;
  }
  assert.equal(pages, Math.ceil(23 / 5));
  assert.equal(seen.length, 23);
  assert.equal(new Set(seen).size, 23, '分页不得重复');

  const mtimes = seen.map((id) => imgs.getImage(db, id).mtime_ms);
  for (let i = 1; i < mtimes.length; i++) {
    assert.ok(mtimes[i - 1] >= mtimes[i], 'mtime 降序');
  }
  db.close();
});

test('listPage name 排序：img_0002 在 img_0010 前（自然序由上层做，此处按字典序稳定翻页）', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 12), 'D:\\pics');

  const seen = [];
  let cursor = null;
  for (;;) {
    const page = imgs.listPage(db, { libraryId: lib.id, cursor, limit: 4, sort: 'name' });
    seen.push(...page.items.map((i) => i.rel_path));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  assert.equal(seen.length, 12);
  assert.equal(new Set(seen).size, 12);
  assert.equal(seen[0], 'img_0000.png');
  db.close();
});

test('listPage name 排序走自然序：img_2 在 img_10 前，跨页稳定', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  const names = ['img_10.png', 'img_2.png', 'img_1.png', 'img_100.png', 'img_21.png', 'a10/x_3.png'];
  const scanned = names.map((rel, i) => ({
    name: rel.split('/').pop(),
    path: `D:\\pics\\${rel.split('/').join('\\')}`,
    size: 1,
    mtimeMs: 1_700_000_000_000 + i,
  }));
  imgs.upsertScanned(db, lib.id, scanned, 'D:\\pics');

  const seen = [];
  let cursor = null;
  for (;;) {
    const page = imgs.listPage(db, { libraryId: lib.id, cursor, limit: 2, sort: 'name' });
    seen.push(...page.items.map((i) => i.rel_path));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen, ['a10/x_3.png', 'img_1.png', 'img_2.png', 'img_10.png', 'img_21.png', 'img_100.png']);
  assert.equal(imgs.naturalKey('img_10.png'), 'img_00000010.png');
  db.close();
});

test('listPage 全部筛选条件可用且参数化', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  const scanned = [...fakeScan('', 6), ...fakeScan('sub', 4)];
  imgs.upsertScanned(db, lib.id, scanned, 'D:\\pics');

  imgs.setMarks(db, [1, 2], { heart: 5 });
  imgs.setMarks(db, [3], { rejected: 1 });
  imgs.setAge(db, [4], { level: 2, source: 'manual' });

  assert.equal(imgs.countImages(db, { libraryId: lib.id, heartMin: 1 }), 2);
  assert.equal(imgs.countImages(db, { libraryId: lib.id, rejectedOnly: true }), 1);
  assert.equal(imgs.countImages(db, { libraryId: lib.id, hideRejected: true }), 9);
  assert.equal(imgs.countImages(db, { libraryId: lib.id, folder: 'sub' }), 4, '目录前缀筛选');
  assert.equal(imgs.countImages(db, { libraryId: lib.id, ageMax: 2 }), 9, 'age<2 含未判定，不含 l2');
  assert.equal(imgs.countImages(db, { libraryId: lib.id, ageOnly: 2 }), 1);
  assert.equal(imgs.countImages(db, { libraryId: lib.id, nameLike: 'img_0000' }), 2, 'LIKE 含通配符语义：根目录与 sub 各 1 张 img_0000');

  const page = imgs.listPage(db, { libraryId: lib.id, filters: { heartMin: 1 }, limit: 1 });
  assert.equal(page.items.length, 1);
  assert.ok(page.hasMore);
  db.close();
});

test('游标格式非法时报错而不是静默从头开始', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 3), 'D:\\pics');
  assert.throws(() => imgs.listPage(db, { libraryId: lib.id, cursor: '!!!bad!!!' }));
  db.close();
});

/* ---------------- marks / age ---------------- */

test('setMarks 批量事务生效，heart 越界被 CHECK 拦截', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 5), 'D:\\pics');
  assert.equal(imgs.setMarks(db, [1, 2, 3], { heart: 4 }), 3);
  assert.equal(imgs.getImage(db, 2).heart, 4);
  assert.throws(() => imgs.setMarks(db, [1], { heart: 9 }), /CHECK/);
  assert.equal(imgs.setMarks(db, [1], { heart: 0 }), 1);
  db.close();
});

test('setAge 可写回 null（手动清除判定）', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 2), 'D:\\pics');
  imgs.setAge(db, [1], { level: 3, source: 'meta', confidence: 0.9 });
  assert.equal(imgs.getImage(db, 1).age_level, 3);
  imgs.setAge(db, [1], { level: null, source: 'none' });
  assert.equal(imgs.getImage(db, 1).age_level, null);
  assert.equal(imgs.getImage(db, 1).age_source, 'none');
  db.close();
});

/* ---------------- prompt library ---------------- */

test('promptRepository 从图片保存并可分页检索', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 3), 'D:\\pics');

  const id1 = prompts.saveFromImage(db, 1, {
    positive: '1girl, night city',
    negative: 'bad hands',
    params: { Model: 'animagineXL', Sampler: 'Euler a', Steps: '28', 'CFG scale': '7', Seed: '42' },
  });
  const row = prompts.get(db, id1);
  assert.equal(row.source_rel_path, 'img_0000.png');
  assert.equal(row.model, 'animagineXL');
  assert.equal(row.seed, 42);
  assert.equal(row.cfg, 7);

  for (let i = 0; i < 5; i++) prompts.saveManual(db, { title: `m${i}`, positive: `p${i}` });

  const page1 = prompts.listPage(db, { limit: 3 });
  assert.equal(page1.items.length, 3);
  assert.ok(page1.hasMore);
  const page2 = prompts.listPage(db, { limit: 3, cursor: page1.nextCursor });
  assert.equal(page2.items.length, 3);
  const ids1 = page1.items.map((r) => r.id);
  const ids2 = page2.items.map((r) => r.id);
  assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0, '两页无交集');

  const found = prompts.listPage(db, { search: 'night city' });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].negative, 'bad hands');

  assert.equal(prompts.update(db, id1, { title: '夜景模板' }), 1);
  assert.equal(prompts.get(db, id1).title, '夜景模板');
  assert.equal(prompts.remove(db, id1), 1);
  assert.equal(prompts.get(db, id1), null);
  db.close();
});

test('promptRepository 保存引用不存在的图片时报错', () => {
  const db = buildDb();
  assert.throws(() => prompts.saveFromImage(db, 999, { positive: 'x' }), /不存在/);
  db.close();
});

/* ---------------- tags ---------------- */

test('tagRepository 字典导入幂等 + 中文联想 + 关联查询', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 4), 'D:\\pics');

  const dict = [
    { name: '1girl', zh_name: '一个女孩', category: 0, count: 999999 },
    { name: 'solo', zh_name: '单人', category: 0, count: 888888 },
    { name: 'night', zh_name: '夜晚', category: 3, count: 123456 },
    { name: 'nipples', zh_name: '', category: 9, count: 234567 },
  ];
  const r1 = tags.importDictionary(db, dict);
  assert.deepEqual(r1, { inserted: 4, updated: 0 });
  const r2 = tags.importDictionary(db, [{ name: '1girl', zh_name: '一名少女', category: 0, count: 1000000 }]);
  assert.deepEqual(r2, { inserted: 0, updated: 1 });
  assert.equal(tags.searchTags(db, '1girl')[0].name_zh, '一名少女', '中文列被更新');

  const girlId = tags.getOrCreateTag(db, '1girl');
  const customId = tags.getOrCreateTag(db, '我的原创角色', { nameZh: 'OC' });
  assert.equal(tags.attachTags(db, 1, [girlId, customId], { origin: 'model', confidence: 0.87 }), 2);
  assert.equal(tags.attachTags(db, 1, [girlId], { origin: 'manual' }), 1, '重复关联走 upsert');

  const of1 = tags.tagsOfImage(db, 1);
  assert.equal(of1.length, 2);
  const girl = of1.find((t) => t.name === '1girl');
  assert.equal(girl.origin, 'manual', '后写覆盖 origin');

  assert.equal(tags.suggest(db, '一名')[0].name, '1girl', '中文名联想');
  assert.equal(tags.suggest(db, 'night')[0].name, 'night');
  assert.deepEqual(tags.suggest(db, ''), []);

  assert.equal(imgs.countImages(db, { libraryId: lib.id, tagId: girlId }), 1);
  assert.equal(imgs.countImages(db, { libraryId: lib.id, untaggedOnly: true }), 3);

  assert.equal(tags.detachTag(db, 1, girlId), 1);
  assert.equal(tags.tagsOfImage(db, 1).length, 1);
  db.close();
});

/* ---------------- deletions ---------------- */

test('deletionRepository 记账、列 pending、撤回、到期清扫', () => {
  const db = buildDb();
  const lib = seedLibrary(db);
  imgs.upsertScanned(db, lib.id, fakeScan('', 3), 'D:\\pics');

  const t0 = Date.now() - 2000; // listPending 按“现在”过滤过期，时间戳要贴近当下
  const ids = dels.recordDeletion(db, [
    { libraryId: lib.id, imageId: 1, relPath: 'img_0000.png', absPath: 'D:\\pics\\img_0000.png', sizeBytes: 1024, deletedAt: t0 },
    { libraryId: lib.id, imageId: 2, relPath: 'img_0001.png', absPath: 'D:\\pics\\img_0001.png', sizeBytes: 2048, deletedAt: t0 + 1000 },
  ]);
  assert.equal(ids.length, 2);

  const rec = dels.get(db, ids[0]);
  assert.equal(rec.status, 'pending');
  assert.equal(rec.expires_at - rec.deleted_at, dels.UNDO_WINDOW_MS, '12 小时窗口');

  assert.equal(dels.listPending(db, {}).length, 2);
  assert.equal(dels.markRestored(db, ids[0]), 1);
  assert.equal(dels.listPending(db, {}).length, 1);
  assert.equal(dels.get(db, ids[0]).status, 'restored');

  assert.equal(dels.sweepExpired(db, t0 + dels.UNDO_WINDOW_MS + 5000), 1);
  assert.equal(dels.listPending(db, {}).length, 0);
  db.close();
});
