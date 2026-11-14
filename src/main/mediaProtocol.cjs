'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { getMediaRoots } = require('./db/database.cjs');

/**
 * media://local/<绝对路径> —— 只读协议。
 * 只放行已注册图库根与缩略图目录下的文件，渲染层拿不到任意文件读。
 * 注意：Electron 的全局 fetch 不支持 file://，这里直接读盘返回字节。
 */
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

function resolveMediaPath(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'media:') return null;
  // media://local/D:/x/y.png → pathname 是 /D:/x/y.png
  let filePath = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
  return filePath.split('/').join(path.sep);
}

function isAllowedPath(absPath) {
  if (!absPath) return false;
  const resolved = path.resolve(absPath);
  for (const root of getMediaRoots()) {
    const rel = path.relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

function registerMediaProtocol(protocol) {
  protocol.handle('media', async (request) => {
    const filePath = resolveMediaPath(request.url);
    if (!filePath || !isAllowedPath(filePath)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const data = await fs.readFile(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': type,
          'content-length': String(data.byteLength),
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

module.exports = { registerMediaProtocol, resolveMediaPath, isAllowedPath };
