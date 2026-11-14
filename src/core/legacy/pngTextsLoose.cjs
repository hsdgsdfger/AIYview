'use strict';

/**
 * 大 PNG 局部文本块扫描（metadataImage 的补充）
 * A1111/ComfyUI 的 parameters 块位于 IDAT 之后的文件尾部，
 * 大文件免整读：头尾各取一段，在此按「长度前缀 + 类型」定位文本块。
 */
const zlib = require('zlib');

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

const PNG_CHUNK_TYPE_RE = /^(IHDR|IEND|IDAT|PLTE|tEXt|zTXt|iTXt|tIME|gAMA|pHYs|tRNS|bKGD|sRGB|sBIT|cHRM|acTL|fcTL)$/;

/**
 * 大 PNG 免整读：在任意缓冲区片段里按「长度前缀 + 类型」定位文本块。
 * A1111/ComfyUI 的 parameters 在 IDAT 之后的尾部，只读头会漏；头尾各读一段即可覆盖。
 * 校验：dataLen 合理（≤16MB），且类型必须是已知 chunk。
 */
function parsePngTextsLoose(buf) {
  const out = { width: 0, height: 0, texts: {} };
  let i = 0;
  while (i + 12 <= buf.length) {
    const dataLen = buf.readUInt32BE(i);
    if (dataLen > 16 * 1024 * 1024) { i += 1; continue; }
    const type = buf.toString('latin1', i + 4, i + 8);
    if (!PNG_CHUNK_TYPE_RE.test(type)) {
      i += 1;
      continue;
    }
    const dataStart = i + 8;
    const dataEnd = dataStart + dataLen;
    if (dataEnd + 4 > buf.length) {
      if (type === 'IHDR' && dataLen >= 8) {
        out.width = buf.readUInt32BE(dataStart);
        out.height = buf.readUInt32BE(dataStart + 4);
      }
      break;
    }

    if (type === 'IHDR' && dataLen >= 8) {
      out.width = buf.readUInt32BE(dataStart);
      out.height = buf.readUInt32BE(dataStart + 4);
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const text = decodePngTextChunk(buf.subarray(dataStart, dataEnd), type);
      if (text.key && text.value && !(text.key in out.texts)) out.texts[text.key] = text.value;
    } else if (type === 'IEND') {
      break;
    }
    i = dataEnd + 4;
  }
  return out;
}

function decodePngTextChunk(data, type) {
  const nul = data.indexOf(0);
  if (nul === -1) return {};
  const key = data.toString('latin1', 0, nul);
  if (!key) return {};
  if (type === 'tEXt') return { key, value: data.toString('latin1', nul + 1) };

  if (type === 'zTXt') {
    if (data[nul + 1] !== 0) return {};
    const raw = safeInflate(data.subarray(nul + 2));
    return raw ? { key, value: raw.toString('utf8') } : {};
  }

  // iTXt: keyword\0 compFlag compMethod lang\0 translated\0 text
  if (data.length < nul + 3) return {};
  const compFlag = data[nul + 1];
  let p = nul + 3;
  let langEnd = data.indexOf(0, p);
  if (langEnd === -1) return {};
  p = langEnd + 1;
  let transEnd = data.indexOf(0, p);
  if (transEnd === -1) return {};
  p = transEnd + 1;
  const raw = data.subarray(p);
  const decoded = compFlag === 1 ? (safeInflate(raw) || Buffer.alloc(0)).toString('utf8') : raw.toString('utf8');
  return decoded ? { key, value: decoded } : {};
}


module.exports = { parsePngTextsLoose };
