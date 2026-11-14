import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import nodePath from 'node:path';

const require = createRequire(import.meta.url);
const guard = require('../../src/core/pathGuard.cjs');

const W = nodePath.win32;

test('图库内的普通路径通过', () => {
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics\\a.png'), true);
  assert.equal(guard.isInside('D:\\pics\\', 'D:\\pics\\sub\\b.png'), true);
});

test('图库根本身视为在内', () => {
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics'), true);
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics\\'), true);
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics\\.'), true);
});

test('父目录与任意 .. 逃逸被拒绝', () => {
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics\\..\\other\\a.png'), false);
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics'), true);
  assert.equal(guard.isInside('D:\\pics\\sub', 'D:\\pics\\a.png'), false);
  assert.equal(guard.isInside('D:\\pics', '..'), false);
});

test('同前缀兄弟目录不能被 startsWith 蒙过', () => {
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics2\\a.png'), false);
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics-backup\\a.png'), false);
  assert.equal(guard.isInside('C:\\lib', 'C:\\library\\x.png'), false);
});

test('跨盘符一律拒绝', () => {
  assert.equal(guard.isInside('D:\\pics', 'C:\\pics\\a.png'), false);
  assert.equal(guard.isInside('C:\\pics', 'D:\\pics\\a.png'), false);
});

test('大小写差异按 Windows 规则视为同一路径', () => {
  assert.equal(guard.isInside('D:\\Pics', 'd:\\pics\\a.png'), true);
});

test('空值、非字符串、NUL 字节都判为不安全', () => {
  assert.equal(guard.isInside('', 'D:\\pics\\a.png'), false);
  assert.equal(guard.isInside('D:\\pics', ''), false);
  assert.equal(guard.isInside(null, 'D:\\pics\\a.png'), false);
  assert.equal(guard.isInside('D:\\pics', 123), false);
  assert.equal(guard.isInside('D:\\pics', 'D:\\pics\\a\u0000.png'), false);
});

test('assertInside 越界时抛 PathGuardError', () => {
  assert.throws(
    () => guard.assertInside('D:\\pics', 'D:\\other\\a.png'),
    (err) => err.code === 'OUTSIDE_LIBRARY' && err.name === 'PathGuardError'
  );
  assert.equal(guard.assertInside('D:\\pics', 'D:\\pics\\a.png'), true);
});

test('toLibraryRelative 输出正斜杠相对路径', () => {
  assert.equal(guard.toLibraryRelative('D:\\pics', 'D:\\pics\\a\\b.png'), 'a/b.png');
  assert.equal(guard.toLibraryRelative('D:\\pics\\', 'D:\\pics\\deep\\c.jpg'), 'deep/c.jpg');
});

test('fromLibraryRelative 还原绝对路径并能拦截穿越', () => {
  assert.equal(guard.fromLibraryRelative('D:\\pics', 'a/b.png'), W.resolve('D:\\pics\\a\\b.png'));
  assert.throws(() => guard.fromLibraryRelative('D:\\pics', '..\\evil.png'), (err) => err.code === 'OUTSIDE_LIBRARY');
  assert.throws(() => guard.fromLibraryRelative('D:\\pics', '   '), (err) => err.code === 'OUTSIDE_LIBRARY');
});

test('中文与空格路径正常处理', () => {
  const root = 'D:\\素材 库\\出图';
  assert.equal(guard.isInside(root, 'D:\\素材 库\\出图\\2024 年\\猫 娘.png'), true);
  assert.equal(guard.toLibraryRelative(root, 'D:\\素材 库\\出图\\2024 年\\猫 娘.png'), '2024 年/猫 娘.png');
});

test('可注入 posix 实现，便于跨平台推理', () => {
  assert.equal(guard.isInside('/home/u/pics', '/home/u/pics/a.png', { path: nodePath.posix }), true);
  assert.equal(guard.isInside('/home/u/pics', '/home/u/pics2/a.png', { path: nodePath.posix }), false);
});
