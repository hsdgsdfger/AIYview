import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pp = require('../../src/core/tagger/postprocess.cjs');

test('sigmoid 数值稳定且单调', () => {
  assert.equal(pp.sigmoid(0), 0.5);
  assert.ok(pp.sigmoid(20) > 0.999999);
  assert.ok(pp.sigmoid(-20) < 1e-8);
  assert.ok(pp.sigmoid(-20) > 0, '极端负值不返回 0，避免除零');
  assert.ok(pp.sigmoid(1) > pp.sigmoid(0));
});

test('pixelsToTensor 输出 NHWC 布局且归一到 0–1', () => {
  const w = 2;
  const h = 1;
  const px = new Uint8Array([255, 0, 0, 0, 255, 128]);
  const { dims, data } = pp.pixelsToTensor(px, { width: w, height: h });
  assert.deepEqual(dims, [1, h, w, 3], 'NHWC：batch,height,width,channel');
  assert.equal(data.length, 6);
  assert.equal(data[0], 1);
  assert.equal(data[1], 0);
  assert.ok(Math.abs(data[5] - 128 / 255) < 1e-6, 'float32 精度内归一正确');
});

test('pixelsToTensor 对尺寸不符的缓冲报错', () => {
  assert.throws(() => pp.pixelsToTensor(new Uint8Array(5), { width: 2, height: 1 }), /尺寸不符/);
  assert.throws(() => pp.pixelsToTensor(null), /尺寸不符/);
});

test('mapOutputs 按 category 分组：9=rating、4=character、其余=general', () => {
  const labels = [
    { name: 'general', category: 9 },
    { name: 'explicit', category: 9 },
    { name: '1girl', category: 0 },
    { name: 'akemi_homura', category: 4 },
  ];
  const { rating, general, character } = pp.mapOutputs([-5, 3, 1, -1], labels);
  assert.equal(rating.length, 2);
  assert.equal(general.length, 1);
  assert.equal(character.length, 1);
  assert.ok(rating[1].prob > rating[0].prob);
});

test('mapOutputs 维度不一致直接报错（模型与标签表必须对齐）', () => {
  const labels = [{ name: 'a', category: 0 }];
  assert.throws(() => pp.mapOutputs([1, 2], labels), /维度与标签表不符/);
});

test('selectTags 阈值截断 + topN + rating 取最大', () => {
  const mapped = {
    rating: [
      { name: 'general', prob: 0.2 },
      { name: 'explicit', prob: 0.9 },
    ],
    general: [
      { name: 'a', prob: 0.9 },
      { name: 'b', prob: 0.5 },
      { name: 'c', prob: 0.2 },
      { name: 'd', prob: 0.8 },
    ],
    character: [{ name: 'x', prob: 0.6 }, { name: 'y', prob: 0.1 }],
  };
  const chosen = pp.selectTags(mapped, { threshold: 0.35, topN: 2 });
  assert.equal(chosen.rating.name, 'explicit');
  assert.deepEqual(chosen.general.map((t) => t.name), ['a', 'd'], '过阈值且按概率降序、截断 topN');
  assert.deepEqual(chosen.character.map((t) => t.name), ['x']);
});

test('selectTags 全低于阈值时标签为空但 rating 仍返回最高项', () => {
  const chosen = pp.selectTags(
    { rating: [{ name: 'general', prob: 0.1 }], general: [{ name: 'a', prob: 0.1 }], character: [] },
    { threshold: 0.35 }
  );
  assert.deepEqual(chosen.general, []);
  assert.deepEqual(chosen.character, []);
  assert.equal(chosen.rating.name, 'general', 'rating 是分类轴，不分阈值');
});

test('ratingToLevel 映射 Danbooru 四档，未知返回 null', () => {
  assert.equal(pp.ratingToLevel('general'), 0);
  assert.equal(pp.ratingToLevel('sensitive'), 1);
  assert.equal(pp.ratingToLevel('questionable'), 2);
  assert.equal(pp.ratingToLevel('explicit'), 3);
  assert.equal(pp.ratingToLevel('EXPLICIT'), 3, '大小写不敏感');
  assert.equal(pp.ratingToLevel('unknown'), null);
  assert.equal(pp.ratingToLevel(null), null);
});
