/**
 * tests/fixtures/make-fixtures.mjs
 * ---------------------------------------------------------------------------
 * 生成元数据解析用的真实二进制夹具（PNG / JPEG / WebP），不依赖外部样本库。
 *
 * 只做两件事：
 *   1. 用 sharp 渲染真实像素（保证 SOI/IHDR/RIFF 结构合法）；
 *   2. 按格式规范注入 tEXt / zTXt / iTXt / APP1(EXIF) / EXIF(WebP) 块。
 *
 * 输出：tests/fixtures/images/*.{png,jpg,webp}
 */

import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.join(__dirname, 'images');

/* ----------------------------- CRC32 (PNG) ----------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function tEXt(keyword, text) {
  return pngChunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]));
}

function zTXt(keyword, text) {
  return pngChunk('zTXt', Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0]),
    zlib.deflateSync(Buffer.from(text, 'utf8'))
  ]));
}

function iTXt(keyword, text) {
  return pngChunk('iTXt', Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0]), // keyword\0 + compFlag=0 + compMethod=0
    Buffer.from([0]), // langTag 空
    Buffer.from([0]), // translatedKeyword 空
    Buffer.from(text, 'utf8')
  ]));
}

/** 在 IEND 前插入若干 chunk */
function injectPngChunks(pngBuf, chunks) {
  const iendPos = pngBuf.lastIndexOf(Buffer.from('IEND', 'ascii')) - 4;
  if (iendPos <= 0) throw new Error('IEND not found');
  return Buffer.concat([pngBuf.subarray(0, iendPos), ...chunks, pngBuf.subarray(iendPos)]);
}

/* --------------------------- TIFF / EXIF 构造 --------------------------- */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * @param {Array<{tag:number,type:number,values:any}>} entries
 */
function buildTiff(entries) {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const ifdOffset = 8;
  const ifdSize = 2 + sorted.length * 12 + 4;
  let dataOffset = ifdOffset + ifdSize;

  // 先算 data 区
  const dataBlocks = [];
  const encoded = sorted.map((e) => {
    let bytes;
    let count;
    if (e.type === 2) {
      bytes = Buffer.from(String(e.values), 'latin1');
      if (bytes[bytes.length - 1] !== 0) bytes = Buffer.concat([bytes, Buffer.from([0])]);
      count = bytes.length;
    } else if (e.type === 3) {
      const arr = Array.isArray(e.values) ? e.values : [e.values];
      count = arr.length;
      bytes = Buffer.alloc(count * 2);
      arr.forEach((v, i) => bytes.writeUInt16LE(v, i * 2));
    } else if (e.type === 4) {
      const arr = Array.isArray(e.values) ? e.values : [e.values];
      count = arr.length;
      bytes = Buffer.alloc(count * 4);
      arr.forEach((v, i) => bytes.writeUInt32LE(v, i * 4));
    } else if (e.type === 7) {
      bytes = Buffer.isBuffer(e.values) ? e.values : Buffer.from(String(e.values), 'latin1');
      count = bytes.length;
    } else {
      throw new Error(`unsupported type ${e.type}`);
    }
    return { tag: e.tag, type: e.type, count, bytes };
  });

  // 分配：>4 字节的进 data 区
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(sorted.length, 0);
  let cursor = 0;

  encoded.forEach((e, i) => {
    const entryOffset = 2 + i * 12;
    ifd.writeUInt16LE(e.tag, entryOffset);
    ifd.writeUInt16LE(e.type, entryOffset + 2);
    ifd.writeUInt32LE(e.count, entryOffset + 4);

    if (e.bytes.length <= 4) {
      e.bytes.copy(ifd, entryOffset + 8);
    } else {
      ifd.writeUInt32LE(dataOffset + cursor, entryOffset + 8);
      dataBlocks.push(e.bytes);
      cursor += e.bytes.length;
    }
  });
  ifd.writeUInt32LE(0, 2 + sorted.length * 12); // next IFD = 0

  const header = Buffer.alloc(8);
  header.write('II', 0, 'ascii');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(ifdOffset, 4);

  return Buffer.concat([header, ifd, ...dataBlocks]);
}

/** UNICODE 前缀 + UTF-16BE，Photoshop/A1111 写 UserComment 的方式 */
function unicodeUserComment(text) {
  const body = Buffer.from(text, 'utf16le').swap16();
  return Buffer.concat([Buffer.from('UNICODE\0', 'latin1'), body]);
}

function injectJpegApp1(jpegBuf, tiffBuf) {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffBuf]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  // SOI 之后插入
  return Buffer.concat([jpegBuf.subarray(0, 2), seg, payload, jpegBuf.subarray(2)]);
}

function injectWebpExif(webpBuf, tiffBuf) {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffBuf]);
  const header = Buffer.alloc(8);
  header.write('EXIF', 0, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  const pad = payload.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
  const chunk = Buffer.concat([header, payload, pad]);

  const body = Buffer.concat([webpBuf, chunk]);
  const out = Buffer.from(body);
  out.writeUInt32LE(body.length - 8, 4); // RIFF size 重算
  return out;
}

/* ------------------------------- 生成夹具 ------------------------------- */

const A1111_PARAMETERS = [
  'masterpiece, best quality, 1girl, silver hair, cinematic lighting, 8k',
  'Negative prompt: lowres, bad anatomy, bad hands, missing fingers',
  'Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234567890, Size: 832x1216, Model hash: 6ce0161689, Model: v1-5-pruned-emaonly'
].join('\n');

const COMFY_PROMPT = JSON.stringify({
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 42, steps: 20, cfg: 8, positive: ['6', 0], negative: ['7', 0] }
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'a cyberpunk alley at night, neon reflections, ultra detailed' }
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'blurry, watermark, text' }
  }
});

const COMFY_WORKFLOW = JSON.stringify({
  nodes: [
    { id: 1, type: 'Text Multiline', widgets_values: ['a serene mountain lake at dawn, mist over water, photorealistic'] },
    { id: 2, type: 'KSampler', widgets_values: [42, 'fixed', 20, 8] }
  ],
  links: []
});

export async function makeFixtures() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const base = sharp({
    create: { width: 64, height: 96, channels: 3, background: { r: 30, g: 40, b: 60 } }
  });

  const pngBase = await base.clone().png().toBuffer();
  const jpgBase = await base.clone().jpeg({ quality: 80 }).toBuffer();
  const webpBase = await base.clone().webp({ quality: 80 }).toBuffer();

  const files = {};

  // 1) PNG + tEXt parameters（A1111）
  files.pngA1111 = path.join(OUT_DIR, 'a1111_basic.png');
  await fs.writeFile(files.pngA1111, injectPngChunks(pngBase, [tEXt('parameters', A1111_PARAMETERS)]));

  // 2) PNG + tEXt prompt/workflow（ComfyUI）
  files.pngComfy = path.join(OUT_DIR, 'comfy_prompt.png');
  await fs.writeFile(files.pngComfy, injectPngChunks(pngBase, [
    tEXt('prompt', COMFY_PROMPT),
    tEXt('workflow', COMFY_WORKFLOW)
  ]));

  // 3) PNG + zTXt（压缩文本，旧实现读不到）
  files.pngZtxt = path.join(OUT_DIR, 'a1111_ztxt.png');
  await fs.writeFile(files.pngZtxt, injectPngChunks(pngBase, [zTXt('parameters', A1111_PARAMETERS)]));

  // 4) PNG + iTXt（旧实现只有注释没有实现）
  files.pngItxt = path.join(OUT_DIR, 'a1111_itxt.png');
  await fs.writeFile(files.pngItxt, injectPngChunks(pngBase, [iTXt('parameters', A1111_PARAMETERS)]));

  // 5) JPEG + APP1 EXIF UserComment（UNICODE）
  files.jpgExif = path.join(OUT_DIR, 'a1111_exif.jpg');
  const jpgTiff = buildTiff([
    { tag: 0x010f, type: 2, values: 'YiziView' },
    { tag: 0x0110, type: 2, values: 'FixtureCam' },
    { tag: 0x0112, type: 3, values: 1 },
    { tag: 0x9286, type: 7, values: unicodeUserComment(A1111_PARAMETERS) }
  ]);
  await fs.writeFile(files.jpgExif, injectJpegApp1(jpgBase, jpgTiff));

  // 6) JPEG 纯图（无元数据，只校验尺寸与不崩）
  files.jpgPlain = path.join(OUT_DIR, 'plain.jpg');
  await fs.writeFile(files.jpgPlain, jpgBase);

  // 7) WebP + EXIF
  files.webpExif = path.join(OUT_DIR, 'a1111_exif.webp');
  await fs.writeFile(files.webpExif, injectWebpExif(webpBase, jpgTiff));

  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  makeFixtures().then((f) => {
    console.log('fixtures written:', Object.keys(f).length);
    for (const [k, v] of Object.entries(f)) console.log(' ', k, '->', v);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
