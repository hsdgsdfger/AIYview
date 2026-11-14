'use strict';
/**
 * electron/core/scanFolder.cjs
 * ---------------------------------------------------------------------------
 * 目录扫描器（从 main.cjs 的 scan-folder 内联实现抽取并加固）。
 *
 * upstream 行为（v0.9.20, main.cjs:649-731）：
 *   - 递归用 BFS 队列串行 readdir（一次读一层）；
 *   - 但每个文件都 `await fs.stat` 且包在 Promise.all 里 → 3000 张图一次性发起
 *     3000 个并发 stat，Windows 上直接 EMFILE / 句柄抖动；
 *   - 返回顺序依赖 readdir 返回顺序，无稳定保证。
 *
 * 改动：有界并发（默认 32）的 stat 池 + 稳定排序 + 可注入 fs（便于单测）。
 *
 * 适配来源：
 *   - sindresorhus/p-limit (MIT)   : 有界并发执行器 mapLimit 语义
 */

const nodePath = require('path');
const { pathToFileURL } = require('url');

const DEFAULT_IMAGE_EXT = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.avif',
  '.mp4', '.webm', '.mov', '.mkv'
];

const DEFAULT_IGNORE_DIRS = ['.git', 'node_modules', '.vscode', 'build', 'dist', '.aiyview-thumbnails', '.thumbcache'];

/**
 * 有界并发 map，保持输入顺序（p-limit 语义的精简实现）。
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  if (items.length === 0) return results;

  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * BFS 收集文件绝对路径。
 * @returns {Promise<string[]>}
 */
async function collectFiles(root, opts) {
  const {
    fs,
    recursive = false,
    maxDepth = 20,
    ignoreDirs = DEFAULT_IGNORE_DIRS
  } = opts;

  if (!recursive) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const entry of entries) {
      if (entry.isFile()) out.push(nodePath.join(root, entry.name));
    }
    return out;
  }

  const files = [];
  const queue = [{ dir: root, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // 权限不足 / 目录已删
    }

    const subDirs = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !ignoreDirs.includes(entry.name)) {
          subDirs.push(nodePath.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        files.push(nodePath.join(dir, entry.name));
      }
    }
    // 目录名排序，保证跨平台稳定的遍历顺序
    subDirs.sort();
    for (const sub of subDirs) queue.push({ dir: sub, depth: depth + 1 });
  }
  return files;
}

function toMediaUrl(absPath) {
  const href = pathToFileURL(absPath).href; // file:///C:/x/y.png
  return href.replace('file:///', 'media://local/');
}

/**
 * @param {string} root 目录绝对路径
 * @param {object} opts
 * @param {boolean} [opts.recursive=false]
 * @param {number}  [opts.concurrency=32] stat 并发上限
 * @param {string[]}[opts.extensions] 允许的扩展名（含点，小写）
 * @returns {Promise<Array<{name,path,url,size,mtimeMs,subDir}>>}
 */
async function scanFolder(root, opts = {}) {
  const {
    fs = require('fs/promises'),
    recursive = false,
    maxDepth = 20,
    concurrency = 32,
    extensions = DEFAULT_IMAGE_EXT,
    ignoreDirs = DEFAULT_IGNORE_DIRS
  } = opts;

  const allPaths = await collectFiles(root, { fs, recursive, maxDepth, ignoreDirs });

  const wanted = allPaths.filter((p) => extensions.includes(nodePath.extname(p).toLowerCase()));
  // 稳定排序：先目录后文件名，避免 readdir 顺序抖动导致 UI 抖动
  wanted.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const images = await mapLimit(wanted, Math.max(1, concurrency), async (fullPath) => {
    let stats = { size: 0, mtimeMs: 0 };
    try {
      stats = await fs.stat(fullPath);
    } catch { /* 文件在扫描过程中消失 */ }

    let subDir = '';
    if (recursive) {
      const rel = nodePath.relative(root, fullPath);
      const parent = nodePath.dirname(rel);
      if (parent && parent !== '.') subDir = parent.split(nodePath.sep).join('/');
    }

    return {
      name: nodePath.basename(fullPath),
      path: fullPath,
      url: toMediaUrl(fullPath),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      subDir
    };
  });

  return images;
}

module.exports = { scanFolder, collectFiles, mapLimit, toMediaUrl, DEFAULT_IMAGE_EXT, DEFAULT_IGNORE_DIRS };
