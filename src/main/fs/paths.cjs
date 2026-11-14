'use strict';

const { assertInside, fromLibraryRelative, toLibraryRelative, isInside } = require('../../core/pathGuard.cjs');

/**
 * 所有涉及真实文件的路径解析都走这里，业务层不允许自己拼 path。
 */
function resolveInLibrary(root, relPath) {
  return fromLibraryRelative(root, relPath);
}

function relativeToLibrary(root, absPath) {
  return toLibraryRelative(root, absPath);
}

function assertWritable(root, absPath) {
  return assertInside(root, absPath);
}

module.exports = { resolveInLibrary, relativeToLibrary, assertWritable, isInside };
