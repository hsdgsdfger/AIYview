'use strict';

/**
 * 路径校验（纯逻辑层，不碰 fs、不依赖 electron）
 *
 * 硬规则：任何写操作的目标必须落在图库根之下。
 * 只看 `startsWith` 会误判 `C:\lib` 与 `C:\lib2`，因此统一用 path.relative 判断。
 */

const path = require('node:path');

class PathGuardError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'PathGuardError';
    this.code = 'OUTSIDE_LIBRARY';
    this.details = details || {};
  }
}

function hasNulByte(value) {
  return typeof value === 'string' && value.indexOf('\u0000') !== -1;
}

/**
 * 判断 target 是否在 root 之内（含 root 自身）。
 * @returns {boolean}
 */
function isInside(root, target, options = {}) {
  const p = options.path || path;
  if (typeof root !== 'string' || typeof target !== 'string') return false;
  if (root.trim() === '' || target.trim() === '') return false;
  if (hasNulByte(root) || hasNulByte(target)) return false;

  const base = p.resolve(root);
  const candidate = p.resolve(target);
  const rel = p.relative(base, candidate);

  if (rel === '') return true;
  // 不同盘符时 relative 会回退成绝对路径
  if (p.isAbsolute(rel)) return false;
  if (rel === '..') return false;
  if (rel.startsWith('..' + p.sep)) return false;
  return true;
}

/**
 * 不满足条件时抛错，供写操作入口统一使用。
 */
function assertInside(root, target, options = {}) {
  if (!isInside(root, target, options)) {
    throw new PathGuardError(`路径不在图库根之下：${String(target)}`, { root, target });
  }
  return true;
}

/**
 * 转成入库用的相对路径（统一正斜杠，不带前导斜杠）。
 */
function toLibraryRelative(root, target, options = {}) {
  const p = options.path || path;
  assertInside(root, target, { path: p });
  const rel = p.relative(p.resolve(root), p.resolve(target));
  return rel.split(p.sep).join('/');
}

/**
 * 把库内相对路径还原成绝对路径；越界直接抛错。
 */
function fromLibraryRelative(root, relPath, options = {}) {
  const p = options.path || path;
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new PathGuardError('相对路径不能为空', { root, relPath });
  }
  const joined = p.resolve(root, relPath);
  assertInside(root, joined, { path: p });
  return joined;
}

module.exports = {
  PathGuardError,
  isInside,
  assertInside,
  toLibraryRelative,
  fromLibraryRelative,
};
