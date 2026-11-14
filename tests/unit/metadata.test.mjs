import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

import metadataPkg from '../../src/core/legacy/metadata.cjs';

const { readMetadataFromFile, parseA1111Parameters, decodeUserComment } = metadataPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG = (name) => path.join(__dirname, '..', 'fixtures', 'images', name);

test('PNG tEXt: A1111 parameters 解析出正负提示词与采样参数', async () => {
  const meta = await readMetadataFromFile(IMG('a1111_basic.png'));
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 64);
  assert.equal(meta.height, 96);
  assert.match(meta.positive, /silver hair/);
  assert.match(meta.negative, /bad anatomy/);
  assert.equal(meta.params.Sampler, 'DPM++ 2M Karras');
  assert.equal(meta.params.Steps, '28');
  assert.equal(meta.params['Model hash'], '6ce0161689');
});

test('PNG tEXt: ComfyUI prompt JSON 被展平为 prompt_parsed', async () => {
  const meta = await readMetadataFromFile(IMG('comfy_prompt.png'));
  assert.ok(meta.prompt.startsWith('{'), 'prompt 应保留原始 JSON');
  assert.match(meta.prompt_parsed, /cyberpunk alley/);
  assert.doesNotMatch(meta.prompt_parsed, /blurry, watermark, text\n\nblurry/, '负向词不应重复堆叠');
});

test('PNG zTXt: 压缩文本块可解析（旧实现读不到）', async () => {
  const meta = await readMetadataFromFile(IMG('a1111_ztxt.png'));
  assert.match(meta.positive, /silver hair/);
  assert.equal(meta.params.Seed, '1234567890');
});

test('PNG iTXt: 国际化文本块可解析（旧实现未实现）', async () => {
  const meta = await readMetadataFromFile(IMG('a1111_itxt.png'));
  assert.match(meta.positive, /cinematic lighting/);
  assert.match(meta.negative, /missing fingers/);
});

test('JPEG APP1 EXIF: UNICODE UserComment 按 UTF-16BE 解出 A1111 参数', async () => {
  const meta = await readMetadataForJpeg();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 64);
  assert.match(meta.positive, /masterpiece/);
  assert.equal(meta.params['CFG scale'], '7');
  assert.equal(meta.exif.make, 'YiziView');
  assert.equal(meta.exif.model, 'FixtureCam');
  assert.equal(meta.exif.orientation, 1);
});

async function readMetadataForJpeg() {
  return readMetadataFromFile(IMG('a1111_exif.jpg'));
}

test('JPEG 无元数据: 不抛异常且仍返回尺寸', async () => {
  const meta = await readMetadataFromFile(IMG('plain.jpg'));
  assert.equal(meta.parameters, '');
  assert.equal(meta.width, 64);
  assert.equal(meta.exif, null);
});

test('WebP EXIF chunk: 参数可解析', async () => {
  const meta = await readMetadataFromFile(IMG('a1111_exif.webp'));
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 64);
  assert.match(meta.positive, /silver hair/);
});

test('parseA1111Parameters: 无 Negative prompt 也能正确切分', () => {
  const parsed = parseA1111Parameters('a cat\nSteps: 20, Sampler: Euler a, CFG scale: 5');
  assert.equal(parsed.positive, 'a cat');
  assert.equal(parsed.negative, '');
  assert.equal(parsed.params.Sampler, 'Euler a');
});

test('decodeUserComment: ASCII 前缀与纯 UTF-16BE 都支持', () => {
  const ascii = Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from('hello', 'latin1')]);
  assert.equal(decodeUserComment(ascii), 'hello');

  const utf16 = Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.from('中文注释', 'utf16le').swap16()
  ]);
  assert.equal(decodeUserComment(utf16), '中文注释');
});

test('非图片数据: 优雅降级为空元数据', async () => {
  const meta = await readMetadataFromFile(path.join(__dirname, '..', 'fixtures', 'make-fixtures.mjs'));
  assert.equal(meta.parameters, '');
  assert.equal(meta.width, 0);
});
