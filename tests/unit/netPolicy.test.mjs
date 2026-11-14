import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const policy = require('../../src/core/netPolicy.cjs');

test('本地资源放行', () => {
  assert.equal(policy.isBlockedUrl('file:///D:/app/dist/index.html'), false);
  assert.equal(policy.isBlockedUrl('data:image/png;base64,AAAA'), false);
  assert.equal(policy.isBlockedUrl('blob:file:///abc'), false);
  assert.equal(policy.isBlockedUrl('devtools://devtools/bundled/inspector.html'), false);
  assert.equal(policy.isBlockedUrl('about:blank'), false);
});

test('生产环境下任何 http/https 都拦截', () => {
  assert.equal(policy.isBlockedUrl('https://api.github.com/repos'), true);
  assert.equal(policy.isBlockedUrl('http://127.0.0.1:8080/x'), true);
  assert.equal(policy.isBlockedUrl('https://fonts.googleapis.com/css'), true);
  assert.equal(policy.isBlockedUrl('wss://echo.example.com'), true);
});

test('开发模式下仅放行 dev server 同源', () => {
  const opts = { devServerUrl: 'http://127.0.0.1:15173' };
  assert.equal(policy.isBlockedUrl('http://127.0.0.1:15173/@vite/client', opts), false);
  assert.equal(policy.isBlockedUrl('ws://127.0.0.1:15173', opts), false);
  assert.equal(policy.isBlockedUrl('http://127.0.0.1:9999/x', opts), true);
  assert.equal(policy.isBlockedUrl('https://cdn.example.com/a.js', opts), true);
  assert.equal(policy.isBlockedUrl('http://localhost:15173/x', opts), true);
});

test('无法解析的 URL 按拦截处理（fail closed）', () => {
  assert.equal(policy.isBlockedUrl('not a url'), true);
  assert.equal(policy.isBlockedUrl(''), true);
  assert.equal(policy.isBlockedUrl(null), true);
});

test('shouldAllowRequest 是取反的便捷封装', () => {
  assert.equal(policy.shouldAllowRequest('file:///D:/a.png'), true);
  assert.equal(policy.shouldAllowRequest('https://example.com/a.png'), false);
});

test('media:// 是本地只读协议，不当作网络请求拦截', () => {
  assert.equal(policy.isBlockedUrl('media://local/D:/pics/a.png'), false);
  assert.equal(policy.isBlockedUrl('media://local/C:/Users/x/AppData/Roaming/yiziview-next/thumbnails/abc_320.jpg'), false);
});

test('media: 之外的自定义协议仍然拦截（防绕过）', () => {
  assert.equal(policy.isBlockedUrl('foo://bar/baz'), true);
  assert.equal(policy.isBlockedUrl('http://evil.example/x.png'), true);
});
