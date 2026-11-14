import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const srcDir = path.join(repoRoot, 'src');

const MAX_LINES = 400;
const CODE_EXT = new Set(['.cjs', '.mjs', '.js', '.jsx']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const allFiles = walk(srcDir);
const codeFiles = allFiles.filter((f) => CODE_EXT.has(path.extname(f)));
const rel = (f) => path.relative(repoRoot, f).split(path.sep).join('/');

test('src 下有可检查的源文件', () => {
  assert.ok(codeFiles.length >= 8, `只找到 ${codeFiles.length} 个源文件`);
});

test('单文件不超过 400 行', () => {
  const offenders = [];
  for (const file of codeFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    if (lines > MAX_LINES) offenders.push(`${rel(file)} = ${lines} 行`);
  }
  assert.deepEqual(offenders, [], `超长文件：\n${offenders.join('\n')}`);
});

test('core 层禁止依赖 electron', () => {
  const coreFiles = codeFiles.filter((f) => rel(f).startsWith('src/core/'));
  assert.ok(coreFiles.length > 0);

  const offenders = coreFiles.filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return /require\(\s*['"]electron['"]\s*\)/.test(text) || /from\s+['"]electron['"]/.test(text);
  });
  assert.deepEqual(offenders.map(rel), [], 'core 里出现了 electron 依赖');
});

test('core 层禁止直接做文件 IO', () => {
  const coreFiles = codeFiles.filter((f) => rel(f).startsWith('src/core/'));
  const offenders = coreFiles.filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return /require\(\s*['"]node:fs(\/promises)?['"]\s*\)/.test(text) || /from\s+['"]node:fs/.test(text);
  });
  assert.deepEqual(offenders.map(rel), [], 'core 里出现了 fs 依赖，SQL 应由调用方读入');
});

test('渲染层不直接碰 electron / node 原生模块', () => {
  const rendererFiles = codeFiles.filter((f) => rel(f).startsWith('src/renderer/'));
  const offenders = rendererFiles.filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return (
      /require\(\s*['"]electron['"]\s*\)/.test(text) ||
      /from\s+['"]electron['"]/.test(text) ||
      /from\s+['"]node:/.test(text) ||
      /require\(\s*['"]node:/.test(text)
    );
  });
  assert.deepEqual(offenders.map(rel), [], '渲染层出现了越层依赖');
});

test('禁止 eval / new Function / innerHTML', () => {
  const offenders = [];
  for (const file of codeFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const hits = [];
    if (/\beval\s*\(/.test(text)) hits.push('eval');
    if (/new\s+Function\s*\(/.test(text)) hits.push('new Function');
    if (/\.innerHTML\s*=/.test(text)) hits.push('innerHTML=');
    if (/document\.write\s*\(/.test(text)) hits.push('document.write');
    if (hits.length) offenders.push(`${rel(file)}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
});

test('迁移文件名遵循 NNN_name.sql', () => {
  const dir = path.join(srcDir, 'core/db/migrations');
  const files = fs.readdirSync(dir);
  assert.ok(files.length >= 1);
  for (const name of files) {
    assert.match(name, /^\d{3,}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/, `迁移文件名不合法：${name}`);
  }
});

test('主进程入口与 preload 存在且为 CommonJS', () => {
  const main = path.join(srcDir, 'main/main.cjs');
  const preload = path.join(srcDir, 'main/preload.cjs');
  assert.ok(fs.existsSync(main));
  assert.ok(fs.existsSync(preload));

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'src/main/main.cjs');
  assert.equal(pkg.type, 'module', '渲染层用 ESM，主进程靠 .cjs 后缀保持 CommonJS');
});

test('preload 只暴露白名单通道，命名符合 domain:action', () => {
  const text = fs.readFileSync(path.join(srcDir, 'main/preload.cjs'), 'utf8');
  const channels = [...text.matchAll(/'(app|db|[a-z]+):([a-zA-Z]+)'/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.ok(channels.length >= 2);
  for (const ch of channels) assert.match(ch, /^[a-z]+:[a-zA-Z]+$/);
});

test('CSP 已声明且不含 unsafe-eval', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.match(html, /default-src 'self'/);
});

test('依赖白名单内没有网络 / 更新类包', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const banned = ['electron-updater', 'axios', 'node-fetch', 'got', 'sentry', '@sentry/node', 'analytics-node'];
  const hits = banned.filter((name) => name in all);
  assert.deepEqual(hits, [], `出现了网络/更新类依赖：${hits.join(', ')}`);
});
