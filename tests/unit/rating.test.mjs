import test from 'node:test';
import assert from 'node:assert/strict';

import ratingPkg from '../../src/core/legacy/rating.cjs';

const { classifyMetadata, listLevels, stripPromptDecorations, positiveTextFromMetadata } = ratingPkg;

const meta = (positive, extra = {}) => ({ positive, parameters: '', prompt: '', ...extra });

test('档位表：l0–l4 与 Danbooru 映射', () => {
  const levels = listLevels();
  assert.equal(levels.length, 5);
  assert.deepEqual(levels.map((l) => l.key), ['l0', 'l1', 'l2', 'l3', 'l4']);
  assert.deepEqual(levels.map((l) => l.danbooru), ['s', 'q', 'e', 'e', 'e']);
  assert.equal(levels[4].name, '极端');
});

test('l1 暗示：泳装/内衣/露肩', () => {
  assert.equal(classifyMetadata(meta('1girl, bikini, beach')).level, 1);
  assert.equal(classifyMetadata(meta('少女, 泳装, 海边')).level, 1);
  assert.equal(classifyMetadata(meta('lingerie, garter belt')).level, 1);
  assert.equal(classifyMetadata(meta('露肩, 高开叉')).level, 1);
});

test('l2 露骨：全裸/露点/透视', () => {
  assert.equal(classifyMetadata(meta('nude, standing')).level, 2);
  assert.equal(classifyMetadata(meta('全裸, 卧室')).level, 2);
  assert.equal(classifyMetadata(meta('nipples visible')).level, 2);
  assert.equal(classifyMetadata(meta('透视, 半裸')).level, 2);
});

test('l3 硬核：性行为/束缚/体液', () => {
  assert.equal(classifyMetadata(meta('sex, bedroom')).level, 3);
  assert.equal(classifyMetadata(meta('bondage, shibari')).level, 3);
  assert.equal(classifyMetadata(meta('性交, 体液')).level, 3);
});

test('l4 极端：血腥/群体/扩张', () => {
  assert.equal(classifyMetadata(meta('guro, blood')).level, 4);
  assert.equal(classifyMetadata(meta('血腥, 肢解')).level, 4);
  assert.equal(classifyMetadata(meta('group sex, expansion')).level, 4);
});

test('多词命中取最高档', () => {
  const r = classifyMetadata(meta('bikini, nude, sex'));
  assert.equal(r.level, 3);
  assert.ok(r.matched.some((m) => m.term === 'bikini'));
  assert.ok(r.matched.some((m) => m.term === 'nude'));
});

test('显式 sfw 声明 → l0', () => {
  const r = classifyMetadata(meta('1girl, smile, sfw'));
  assert.equal(r.level, 0);
  assert.equal(r.source, 'explicit');
});

test('无任何信号 → null（未判定），不能默认当全年龄', () => {
  const r = classifyMetadata(meta('a serene mountain lake at dawn'));
  assert.equal(r.level, null);
  assert.equal(r.source, 'none');
});

test('负向提示词必须被排除（A1111 常见误判来源）', () => {
  const parameters = [
    'a cat sitting on a sofa',
    'Negative prompt: nude, nsfw, nipples, bad anatomy',
    'Steps: 20, Sampler: Euler a'
  ].join('\n');
  const r = classifyMetadata({ parameters, positive: '' });
  assert.equal(r.level, null, '负向词不应参与分级');
});

test('positive 已解析时优先使用它', () => {
  const r = classifyMetadata({ positive: 'bikini', parameters: 'Negative prompt: nude' });
  assert.equal(r.level, 1);
});

test('权重语法 (nude:1.3) 会被剥壳后命中', () => {
  assert.equal(classifyMetadata(meta('(nude:1.3), soft light')).level, 2);
  assert.equal(classifyMetadata(meta('((swimsuit:1.2))')).level, 1);
});

test('LoRA 标签不会干扰判定', () => {
  const r = classifyMetadata(meta('<lora:detailXL:0.8>, a castle, <lora:nsfw_helper:0.5>'));
  assert.equal(r.level, null, 'lora 名称里的 nsfw 不应触发分级');
});

test('sexy 归 l1，不被 sex 误判为 l3', () => {
  assert.equal(classifyMetadata(meta('sexy pose')).level, 1);
  assert.equal(classifyMetadata(meta('sex pose')).level, 3);
});

test('Danbooru rating 标记：rating:e → l2，rating:q → l1', () => {
  assert.equal(classifyMetadata(meta('rating:e, 1girl')).level, 2);
  assert.equal(classifyMetadata(meta('rating:q, 1girl')).level, 1);
  assert.equal(classifyMetadata(meta('rating:s, 1girl')).level, 0);
});

test('Civitai nsfwLevel 位掩码映射', () => {
  assert.equal(classifyMetadata(meta('nsfwLevel: 1')).level, 0);
  assert.equal(classifyMetadata(meta('nsfwLevel: 8')).level, 2);
  assert.equal(classifyMetadata(meta('nsfwLevel: 16')).level, 3);
});

test('显式标记与内容词共存时取较高者，并标记 mixed', () => {
  const r = classifyMetadata(meta('rating:q, nude'));
  assert.equal(r.level, 2);
  assert.equal(r.source, 'mixed');
});

test('ComfyUI prompt_parsed 作为兜底文本源', () => {
  const r = classifyMetadata({ positive: '', parameters: '', prompt_parsed: 'bikini, beach' });
  assert.equal(r.level, 1);
});

test('stripPromptDecorations: 去权重与 lora，保留正文', () => {
  const out = stripPromptDecorations('<lora:a:0.6> (masterpiece:1.2), {silver hair}, 1girl');
  assert.equal(out, 'masterpiece , silver hair , 1girl');
  assert.doesNotMatch(out, /lora/);
});

test('positiveTextFromMetadata: 切掉负向段与参数行', () => {
  const text = positiveTextFromMetadata({
    parameters: 'a dog\nNegative prompt: ugly\nSteps: 30, Sampler: DPM++'
  });
  assert.equal(text.trim(), 'a dog');
});
