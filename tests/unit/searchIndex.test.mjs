import test from 'node:test';
import assert from 'node:assert/strict';

import {
  naturalCompare,
  filterImages,
  matchImage,
  tokenize
} from '../../src/core/legacy/searchIndex.js';

test('naturalCompare: 数字按数值大小排序', () => {
  const names = ['img_10.png', 'img_2.png', 'img_1.png', 'img_20.png'];
  const sorted = [...names].sort(naturalCompare);
  assert.deepEqual(sorted, ['img_1.png', 'img_2.png', 'img_10.png', 'img_20.png']);

  assert.ok(naturalCompare('a2', 'a10') < 0);
  assert.ok(naturalCompare('a10', 'a2') > 0);
  assert.equal(naturalCompare('a2', 'a2'), 0);
  assert.ok(naturalCompare('a02', 'a2') > 0, '位数多的在后，保证稳定');
});

test('naturalCompare: 大小写与中文不崩', () => {
  assert.ok(naturalCompare('Apple', 'banana') < 0);
  assert.ok(naturalCompare('作品2', '作品10') < 0);
  assert.equal(naturalCompare('', ''), 0);
});

test('tokenize: 小写化 + 多 token 拆分', () => {
  assert.deepEqual(tokenize('  Red Dress  '), ['red', 'dress']);
  assert.deepEqual(tokenize(''), []);
});

test('matchImage: 子串命中 + 多 token AND', () => {
  const img = { name: 'red_dress_final.png', subDir: 'shoot/2026' };
  assert.equal(matchImage(img, ['red']), true);
  assert.equal(matchImage(img, ['dress']), true);
  assert.equal(matchImage(img, ['red', 'dress']), true);
  assert.equal(matchImage(img, ['red', 'blue']), false);
});

test('matchImage: 词首前缀命中（不必匹配完整单词）', () => {
  const img = { name: 'character_sheet.png', subDir: '' };
  assert.equal(matchImage(img, ['char']), true);
  assert.equal(matchImage(img, ['sheet']), true);
});

test('matchImage: 拼写容错（1 个编辑距离）', () => {
  const img = { name: 'character_sheet.png', subDir: '' };
  assert.equal(matchImage(img, ['charactar']), true, 'character→charactar 应命中');
  assert.equal(matchImage(img, ['chracter']), true, '少一个字母应命中');
});

test('matchImage: 短词不做容错，避免误命中', () => {
  const img = { name: 'cat.png', subDir: '' };
  assert.equal(matchImage(img, ['cot']), false, '2 字符查询不应模糊匹配');
});

test('filterImages: 过滤掉 header 卡片并保持原顺序', () => {
  const images = [
    { name: 'a.png', subDir: '' },
    { name: '__header__x', isHeaderCard: true },
    { name: 'b_red.png', subDir: '' },
    { name: 'c.png', subDir: '' }
  ];
  const out = filterImages(images, 'red');
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'b_red.png');
  assert.equal(out[0].isHeaderCard, undefined);
});

test('filterImages: 空查询原样返回', () => {
  const images = [{ name: 'a.png' }];
  assert.equal(filterImages(images, '   '), images);
});
