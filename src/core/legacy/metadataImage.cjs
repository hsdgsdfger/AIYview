'use strict';
/**
 * 图像容器解析（metadata 的底层一半）
 * ---------------------------------------------------------------------------
 * 纯 Node，无原生依赖，可脱离 Electron 单测。
 * 算法与结构参考（宽松许可，见 docs 报告第 3 节）：
 *   - MikeKovarik/exifr (MIT)          : JPEG APP1 / TIFF IFD 遍历与类型解码
 *   - hughsk/png-chunk-text (MIT)      : PNG 文本块 keyword\0text 结构
 *   - hughsk/png-chunks-extract (MIT)  : PNG chunk 游标推进
 */

const zlib = require('zlib');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 仅在需要时 inflate，避免坏数据把进程打爆 */
function safeInflate(buf) {
  try {
    return zlib.inflateSync(buf, { maxOutputLength: 8 * 1024 * 1024 });
  } catch {
    try {
      return zlib.inflateRawSync(buf, { maxOutputLength: 8 * 1024 * 1024 });
    } catch {
      return null;
    }
  }
}

function sniffFormat(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.length >= 2 && buf.toString('ascii', 0, 2) === 'BM') return 'bmp';
  if (buf.length >= 4 && (buf.toString('ascii', 0, 4) === 'II*\0' || buf.toString('ascii', 0, 4) === 'MM\0*')) return 'tiff';
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

function parsePng(buf) {
  const out = { width: 0, height: 0, texts: {} };
  let offset = 8;
  const len = buf.length;

  while (offset + 8 <= len) {
    const dataLen = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + dataLen;
    if (dataEnd + 4 > len) break; // 截断文件，放弃后续

    if (type === 'IHDR' && dataLen >= 8) {
      out.width = buf.readUInt32BE(dataStart);
      out.height = buf.readUInt32BE(dataStart + 4);
    } else if (type === 'tEXt') {
      const nul = buf.indexOf(0, dataStart);
      if (nul !== -1 && nul < dataEnd) {
        const key = buf.toString('latin1', dataStart, nul);
        const val = buf.toString('latin1', nul + 1, dataEnd);
        out.texts[key] = val;
      }
    } else if (type === 'zTXt') {
      const nul = buf.indexOf(0, dataStart);
      if (nul !== -1 && nul + 2 <= dataEnd) {
        const key = buf.toString('latin1', dataStart, nul);
        const method = buf[nul + 1];
        if (method === 0) {
          const raw = safeInflate(buf.subarray(nul + 2, dataEnd));
          if (raw) out.texts[key] = raw.toString('utf8');
        }
      }
    } else if (type === 'iTXt') {
      // keyword \0 compFlag(1) compMethod(1) langTag \0 translatedKeyword \0 text
      const nul = buf.indexOf(0, dataStart);
      if (nul !== -1 && nul + 3 <= dataEnd) {
        const key = buf.toString('latin1', dataStart, nul);
        const compFlag = buf[nul + 1];
        let p = nul + 3;
        const langEnd = buf.indexOf(0, p);
        if (langEnd !== -1 && langEnd < dataEnd) {
          p = langEnd + 1;
          const transEnd = buf.indexOf(0, p);
          if (transEnd !== -1 && transEnd < dataEnd) {
            p = transEnd + 1;
            const raw = buf.subarray(p, dataEnd);
            const decoded = compFlag === 1 ? (safeInflate(raw) || Buffer.alloc(0)).toString('utf8') : raw.toString('utf8');
            if (decoded) out.texts[key] = decoded;
          }
        }
      }
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // + CRC
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * TIFF / EXIF
 * ------------------------------------------------------------------ */

const TIFF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

function decodeUserComment(buf) {
  if (!buf || buf.length === 0) return '';
  const head = buf.toString('latin1', 0, Math.min(8, buf.length));
  let body = buf;
  let enc = 'utf8';
  if (head.startsWith('UNICODE')) {
    body = buf.subarray(8);
    enc = 'utf16be';
  } else if (head.startsWith('ASCII')) {
    body = buf.subarray(8);
    enc = 'latin1';
  } else if (head.startsWith('JIS')) {
    body = buf.subarray(8);
  } else if (buf[0] === 0 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
    body = buf.subarray(8);
    enc = 'utf16be';
  }

  // 去掉尾部 padding
  let end = body.length;
  while (end > 0 && body[end - 1] === 0) end--;
  const slice = body.subarray(0, end);
  if (enc === 'utf16be') {
    if (slice.length % 2 === 1) return slice.subarray(0, slice.length - 1).swap16().toString('utf16le');
    return Buffer.from(slice).swap16().toString('utf16le');
  }
  return slice.toString(enc === 'latin1' ? 'latin1' : 'utf8');
}

function parseTiff(buf, tiffStart = 0) {
  const tags = {};
  if (buf.length < tiffStart + 8) return tags;

  const order = buf.toString('ascii', tiffStart, tiffStart + 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return tags;

  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const magic = u16(tiffStart + 2);
  if (magic !== 42) return tags;

  const readValue = (type, count, valueOffset) => {
    const size = (TIFF_TYPE_SIZE[type] || 1) * count;
    let dataStart;
    if (size <= 4) {
      dataStart = valueOffset; // 内联值，valueOffset 实为 tiff 内偏移字段位置
    } else {
      const ptr = u32(valueOffset);
      dataStart = tiffStart + ptr;
    }
    if (dataStart < 0 || dataStart + size > buf.length) return null;

    switch (type) {
      case 2: // ASCII
        return buf.toString('latin1', dataStart, dataStart + count).replace(/\0+$/, '');
      case 1:
      case 7:
        return buf.subarray(dataStart, dataStart + size);
      case 3: {
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(u16(dataStart + i * 2));
        return count === 1 ? arr[0] : arr;
      }
      case 4: {
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(u32(dataStart + i * 4));
        return count === 1 ? arr[0] : arr;
      }
      case 9: {
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(le ? buf.readInt32LE(dataStart + i * 4) : buf.readInt32BE(dataStart + i * 4));
        return count === 1 ? arr[0] : arr;
      }
      case 5: {
        const arr = [];
        for (let i = 0; i < count; i++) {
          const num = u32(dataStart + i * 8);
          const den = u32(dataStart + i * 8 + 4);
          arr.push(den === 0 ? 0 : num / den);
        }
        return count === 1 ? arr[0] : arr;
      }
      case 10: {
        const arr = [];
        for (let i = 0; i < count; i++) {
          const num = le ? buf.readInt32LE(dataStart + i * 8) : buf.readInt32BE(dataStart + i * 8);
          const den = le ? buf.readInt32LE(dataStart + i * 8 + 4) : buf.readInt32BE(dataStart + i * 8 + 4);
          arr.push(den === 0 ? 0 : num / den);
        }
        return count === 1 ? arr[0] : arr;
      }
      default:
        return null;
    }
  };

  const readIfd = (ifdOffset, depth = 0) => {
    if (depth > 3) return;
    if (ifdOffset <= 0 || ifdOffset + 2 > buf.length - tiffStart) return;
    const base = tiffStart + ifdOffset;
    const count = u16(base);
    if (count > 512) return; // 防御性上限

    for (let i = 0; i < count; i++) {
      const entry = base + 2 + i * 12;
      if (entry + 12 > buf.length) break;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      const valueOffset = entry + 8;
      const value = readValue(type, n, valueOffset);
      if (value === null || value === undefined) continue;
      if (!(tag in tags)) tags[tag] = value;

      // ExifIFD / GPS 指针
      if ((tag === 0x8769 || tag === 0x8825) && typeof value === 'number') {
        readIfd(value, depth + 1);
      }
    }

    const nextPtrPos = base + 2 + count * 12;
    if (nextPtrPos + 4 <= buf.length) {
      const next = u32(nextPtrPos);
      if (next > 0) readIfd(next, depth + 1);
    }
  };

  readIfd(u32(tiffStart + 4), 0);
  return tags;
}

function exifSummary(tags) {
  if (!tags || Object.keys(tags).length === 0) return null;
  const out = {};
  if (tags[0x010f]) out.make = String(tags[0x010f]);
  if (tags[0x0110]) out.model = String(tags[0x0110]);
  if (tags[0x0131]) out.software = String(tags[0x0131]);
  if (tags[0x0132]) out.dateTime = String(tags[0x0132]);
  if (tags[0x0112]) out.orientation = Number(tags[0x0112]);
  if (tags[0xa002]) out.pixelWidth = Number(tags[0xa002]);
  if (tags[0xa003]) out.pixelHeight = Number(tags[0xa003]);
  if (tags[0x829a]) out.exposureTime = tags[0x829a];
  if (tags[0x829d]) out.fNumber = tags[0x829d];
  if (tags[0x8827]) out.iso = Number(tags[0x8827]);
  if (tags[0x920a]) out.focalLength = tags[0x920a];
  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------------------------------------------------ *
 * JPEG / WebP 包装
 * ------------------------------------------------------------------ */

function scanJpeg(buf) {
  const res = { width: 0, height: 0, tiff: null, xmp: null };
  let o = 2;
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const marker = buf[o + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
    if (marker === 0xda) break; // SOS，图像数据开始
    const segLen = buf.readUInt16BE(o + 2);
    const segStart = o + 4;
    const segEnd = o + 2 + segLen;
    if (segLen < 2 || segEnd > buf.length) break;

    if (marker === 0xe1) {
      const header = buf.toString('latin1', segStart, Math.min(segStart + 29, segEnd));
      if (header.startsWith('Exif\0\0')) {
        res.tiff = parseTiff(buf.subarray(segStart + 6, segEnd), 0);
      } else if (header.startsWith('http://ns.adobe.com/xap/1.0/\0')) {
        const xmlStart = segStart + 29;
        res.xmp = buf.toString('utf8', xmlStart, segEnd);
      }
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (segLen >= 7) {
        res.height = buf.readUInt16BE(segStart + 1);
        res.width = buf.readUInt16BE(segStart + 3);
      }
    }
    o = segEnd;
  }
  return res;
}

function scanWebp(buf) {
  const res = { width: 0, height: 0, tiff: null, xmp: null };
  let o = 12;
  while (o + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    const dataStart = o + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) break;

    if (fourcc === 'VP8X' && size >= 10) {
      res.width = 1 + buf.readUIntLE(dataStart + 4, 3);
      res.height = 1 + buf.readUIntLE(dataStart + 7, 3);
    } else if (fourcc === 'VP8 ' && size >= 10) {
      res.width = buf.readUInt16LE(dataStart + 6) & 0x3fff;
      res.height = buf.readUInt16LE(dataStart + 8) & 0x3fff;
    } else if (fourcc === 'VP8L' && size >= 5) {
      const bits = buf.readUInt32LE(dataStart + 1);
      res.width = (bits & 0x3fff) + 1;
      res.height = ((bits >> 14) & 0x3fff) + 1;
    } else if (fourcc === 'EXIF') {
      const hasPrefix = buf.toString('latin1', dataStart, Math.min(dataStart + 6, dataEnd)).startsWith('Exif\0\0');
      res.tiff = parseTiff(buf.subarray(hasPrefix ? dataStart + 6 : dataStart, dataEnd), 0);
    } else if (fourcc === 'XMP ') {
      res.xmp = buf.toString('utf8', dataStart, dataEnd);
    }
    o = dataEnd + (size % 2); // RIFF 双字节对齐
  }
  return res;
}

function simpleDims(buf, format) {
  try {
    if (format === 'gif' && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (format === 'bmp' && buf.length >= 26) return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
    if (format === 'tiff') {
      const tags = parseTiff(buf, 0);
      return { width: Number(tags[0x0100]) || 0, height: Number(tags[0x0101]) || 0 };
    }
  } catch { /* ignore */ }
  return { width: 0, height: 0 };
}

module.exports = {
  safeInflate,
  sniffFormat,
  parsePng,
  decodeUserComment,
  parseTiff,
  exifSummary,
  scanJpeg,
  scanWebp,
  simpleDims,
};
