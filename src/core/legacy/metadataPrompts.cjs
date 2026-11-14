'use strict';
/**
 * 提示词解析（metadata 的上层一半）
 * ---------------------------------------------------------------------------
 * A1111 parameters 结构化 + ComfyUI workflow 反推 + 全格式主入口。
 */

const fs = require('fs/promises');
const img = require('./metadataImage.cjs');

const SETTINGS_KEYS = [
  'Steps', 'Sampler', 'Schedule type', 'CFG scale', 'Seed', 'Size', 'Model hash', 'Model',
  'VAE hash', 'VAE', 'Denoising strength', 'Clip skip', 'Version', 'Hires upscale',
  'Hires steps', 'Hires upscaler', 'Lora hashes', 'TI hashes', 'Face restoration', 'ENSD'
];

function parseA1111Parameters(text) {
  if (!text || typeof text !== 'string') return null;

  let body = text;
  let settings = '';
  let params = null;

  const lines = body.split('\n');
  // 设置行：最后一行以 "Steps:" 开头
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^Steps:\s*\d+/.test(lines[i].trim())) {
      settings = lines[i].trim();
      body = lines.slice(0, i).join('\n');
      break;
    }
  }

  if (settings) {
    params = {};
    const re = /([A-Za-z][A-Za-z0-9 _.'-]*?):\s*("[^"]*"|[^,]*)(?:,|$)/g;
    let m;
    while ((m = re.exec(settings)) !== null) {
      const key = m[1].trim();
      const raw = (m[2] || '').trim().replace(/^"|"$/g, '');
      if (SETTINGS_KEYS.some(k => key.toLowerCase() === k.toLowerCase()) || key.length < 40) {
        params[key] = raw;
      }
    }
  }

  let positive = body;
  let negative = '';
  const negMarker = 'Negative prompt:';
  const negIdx = body.indexOf(negMarker);
  if (negIdx !== -1) {
    positive = body.substring(0, negIdx);
    negative = body.substring(negIdx + negMarker.length);
  }

  return {
    positive: positive.trim(),
    negative: negative.trim(),
    settings,
    params
  };
}

function extractPromptsFromJson(json) {
  const found = [];
  if (!json || typeof json !== 'object') return found;

  if (Array.isArray(json.nodes)) {
    for (const node of json.nodes) {
      if (Array.isArray(node.widgets_values)) {
        for (const v of node.widgets_values) {
          if (typeof v === 'string' && v.length > 20) found.push(v);
        }
      }
    }
    return found;
  }

  for (const node of Object.values(json)) {
    if (!node || typeof node !== 'object') continue;
    const inputs = node.inputs || {};
    const cls = node.class_type || '';
    if (typeof inputs.text === 'string') {
      if (cls === 'Text Multiline') found.unshift(inputs.text);
      else found.push(inputs.text);
    }
    for (const key of ['text_g', 'text_l', 'string', 'value', 'prompt']) {
      const v = inputs[key];
      if (typeof v === 'string' && v.length > 20) found.push(v);
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

async function readMetadata(buf) {
  const result = {
    format: 'unknown',
    width: 0,
    height: 0,
    parameters: '',
    prompt: '',
    workflow: '',
    prompt_parsed: '',
    positive: '',
    negative: '',
    settings: '',
    params: null,
    exif: null
  };
  if (!buf || buf.length === 0) return result;

  const format = img.sniffFormat(buf);
  result.format = format;

  let texts = {};
  let tiff = null;
  let xmp = null;

  if (format === 'png') {
    const png = img.parsePng(buf);
    texts = png.texts;
    result.width = png.width;
    result.height = png.height;
  } else if (format === 'jpeg') {
    const jpg = img.scanJpeg(buf);
    result.width = jpg.width;
    result.height = jpg.height;
    tiff = jpg.tiff;
    xmp = jpg.xmp;
  } else if (format === 'webp') {
    const webp = img.scanWebp(buf);
    result.width = webp.width;
    result.height = webp.height;
    tiff = webp.tiff;
    xmp = webp.xmp;
  } else {
    const d = img.simpleDims(buf, format);
    result.width = d.width;
    result.height = d.height;
  }

  result.exif = img.exifSummary(tiff);

  // PNG 文本块
  if (texts.parameters) result.parameters = texts.parameters;
  if (texts.prompt) result.prompt = texts.prompt;
  if (texts.workflow) result.workflow = texts.workflow;

  // EXIF UserComment / ImageDescription（JPEG / WebP 里 A1111 的落点）
  if (!result.parameters && tiff) {
    const comment = tiff[0x9286] ? img.decodeUserComment(tiff[0x9286]) : '';
    const desc = typeof tiff[0x010e] === 'string' ? tiff[0x010e] : '';
    const candidate = (comment && comment.trim()) || (desc && desc.trim()) || '';
    if (candidate) {
      if (candidate.trim().startsWith('{')) result.prompt = candidate;
      else result.parameters = candidate;
    }
  }

  // XMP 兜底：<dc:description> 或 xmp:Label
  if (!result.parameters && xmp) {
    const m = /<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(xmp);
    if (m) {
      const decoded = m[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&').trim();
      if (decoded) result.parameters = decoded;
    }
  }

  // 结构化 A1111
  if (result.parameters) {
    const parsed = parseA1111Parameters(result.parameters);
    if (parsed) {
      result.positive = parsed.positive;
      result.negative = parsed.negative;
      result.settings = parsed.settings;
      result.params = parsed.params;
    }
  }

  // ComfyUI：从 workflow 反推 prompt
  if (!result.prompt && result.workflow) {
    try {
      const prompts = extractPromptsFromJson(JSON.parse(result.workflow));
      if (prompts.length > 0) result.prompt = [...new Set(prompts)].join('\n\n');
    } catch (e) { /* ignore */ }
  }

  // prompt 字段本身是 API JSON 的情况
  if (result.prompt && result.prompt.trim().startsWith('{')) {
    try {
      const prompts = extractPromptsFromJson(JSON.parse(result.prompt));
      if (prompts.length > 0) result.prompt_parsed = [...new Set(prompts)].join('\n\n');
    } catch (e) { /* ignore */ }
  } else if (result.prompt) {
    result.prompt_parsed = result.prompt;
  }

  return result;
}

async function readMetadataFromFile(filePath) {
  const buf = await fs.readFile(filePath);
  const meta = await readMetadata(buf);
  meta.path = filePath;
  return meta;
}

module.exports = {
  readMetadata,
  readMetadataFromFile,
  parseA1111Parameters,
  extractPromptsFromJson,
};
