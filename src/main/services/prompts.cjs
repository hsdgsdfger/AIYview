'use strict';

const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const imgs = require('../../core/db/imageRepository.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const meta = require('../../core/legacy/metadata.cjs');
const loose = require('../../core/legacy/pngTextsLoose.cjs');
const { parseA1111Parameters, extractPromptsFromJson } = require('../../core/legacy/metadataPrompts.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');

/**
 * 提示词懒读取（性能根因 4：不为读几十字节文本整读 20MB 文件）
 *   - ≤ 4MB          整读（绝大多数 AI 出图）
 *   - PNG > 4MB      头 64KB + 尾 600KB，loose 扫 tEXt/zTXt/iTXt（A1111 文本块在 IDAT 后的尾部）
 *   - JPEG/WebP 大图 头 256KB（EXIF 恒在文件头）
 */
const SMALL_FILE = 4 * 1024 * 1024;
const HEAD = 256 * 1024;
const PNG_HEAD = 64 * 1024;
const PNG_TAIL = 600 * 1024;

async function readImagePrompt({ id } = {}) {
  const db = getDb();
  const row = imgs.getImage(db, id);
  if (!row) throw Object.assign(new Error('图片不存在'), { code: 'NOT_FOUND' });

  const existing = db.prepare('SELECT * FROM image_prompts WHERE image_id = ?').get(id);
  if (existing) return existing;

  const lib = libs.getLibrary(db, row.library_id);
  const absPath = resolveInLibrary(lib.root_path, row.rel_path);
  const fsp = require('node:fs/promises');
  const st = await fsp.stat(absPath).catch(() => null);
  if (!st) return null;

  const info = st.size <= SMALL_FILE
    ? await parseSmall(fsp, absPath)
    : await parseBig(fsp, absPath, st.size, row.ext);

  if (!info || (!info.positive && !info.promptText)) return null;

  db.prepare(
    `INSERT INTO image_prompts (image_id, positive, negative, model, sampler, steps, cfg, seed, source, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'meta', ?)`
  ).run(
    id,
    info.positive || '',
    info.negative || '',
    (info.params && info.params.Model) || '',
    (info.params && info.params.Sampler) || '',
    intOrNull(info.params && info.params.Steps),
    floatOrNull(info.params && info.params['CFG scale']),
    intOrNull(info.params && info.params.Seed),
    JSON.stringify({ workflow: info.workflow || '', exif: info.exif || null })
  );

  if (!row.width && info.width) imgs.setDimensions(db, id, info.width, info.height);

  return db.prepare('SELECT * FROM image_prompts WHERE image_id = ?').get(id);
}

async function parseSmall(fsp, absPath) {
  const buf = await fsp.readFile(absPath);
  const m = await meta.readMetadata(buf);
  return {
    positive: m.positive,
    negative: m.negative,
    params: m.params,
    workflow: m.workflow,
    exif: m.exif,
    promptText: m.prompt_parsed || m.prompt || m.parameters,
    width: m.width,
    height: m.height,
  };
}

async function parseBig(fsp, absPath, size, ext) {
  const fh = await fsp.open(absPath, 'r').catch(() => null);
  if (!fh) return null;
  try {
    if (ext === 'png') {
      const head = Buffer.alloc(PNG_HEAD);
      const tail = Buffer.alloc(Math.min(PNG_TAIL, size));
      await fh.read(head, 0, head.length, 0);
      await fh.read(tail, 0, tail.length, size - tail.length);

      const h = loose.parsePngTextsLoose(head);
      const t = loose.parsePngTextsLoose(tail);
      const texts = { ...t.texts, ...h.texts };

      let positive = '';
      let negative = '';
      let params = null;
      let promptText = '';
      let workflow = texts.workflow || '';

      const parameters = texts.parameters || '';
      if (parameters) {
        const parsed = parseA1111Parameters(parameters);
        if (parsed) {
          positive = parsed.positive;
          negative = parsed.negative;
          params = parsed.params;
        }
      } else if (texts.prompt) {
        promptText = texts.prompt;
        if (promptText.trim().startsWith('{')) {
          try {
            const list = extractPromptsFromJson(JSON.parse(promptText));
            promptText = [...new Set(list)].join('\n\n');
          } catch { /* 保留原文 */ }
        }
      }
      if (!promptText && workflow) {
        try {
          const list = extractPromptsFromJson(JSON.parse(workflow));
          if (list.length) promptText = [...new Set(list)].join('\n\n');
        } catch { /* ignore */ }
      }
      return { positive, negative, params, workflow, exif: null, promptText, width: h.width, height: h.height };
    }

    // JPEG / WebP：EXIF/XMP 恒在头部
    const head = Buffer.alloc(Math.min(HEAD, size));
    await fh.read(head, 0, head.length, 0);
    const m = await meta.readMetadata(head);
    return {
      positive: m.positive,
      negative: m.negative,
      params: m.params,
      workflow: m.workflow,
      exif: m.exif,
      promptText: m.prompt_parsed || m.prompt || m.parameters,
      width: m.width,
      height: m.height,
    };
  } finally {
    await fh.close();
  }
}

function registerPromptIpc() {
  handle('image:prompt', readImagePrompt);
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function floatOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { registerPromptIpc, readImagePrompt };
