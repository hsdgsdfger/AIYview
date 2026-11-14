'use strict';

const path = require('node:path');
const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const imgs = require('../../core/db/imageRepository.cjs');
const libs = require('../../core/db/libraryRepository.cjs');
const tagRepo = require('../../core/db/tagRepository.cjs');
const pp = require('../../core/tagger/postprocess.cjs');
const { resolveInLibrary } = require('../fs/paths.cjs');

/**
 * 手动触发打标（E2）：只处理「无元数据提示词且无模型标签」的图，可中断续跑。
 * 续跑语义 = 幂等：以 DB 中已有 origin='model' 标签的图为跳过依据。
 */
const state = {
  running: false,
  cancelled: false,
  progress: null, // {done, total}
  session: null,
};

function modelDir() {
  // 默认随仓库布局找，settings 可覆盖（settings 表 key/value，value 为 JSON）
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('tagger.modelDir');
  let configured = null;
  if (row) {
    try {
      configured = JSON.parse(row.value);
    } catch {
      configured = row.value;
    }
  }
  if (configured) return configured;
  const candidates = [
    path.join(appRoot(), 'models', 'illuTag', 'wd-swinv2-tagger-v3'),
    path.join(appRoot(), '..', 'models', 'illuTag', 'wd-swinv2-tagger-v3'),
    // 打包版：models 不在 app.asar 里，按 exe 位置往上找（win-unpacked → v3.0 → release → app → 项目根）
    path.join(path.dirname(process.execPath), '..', '..', '..', '..', 'models', 'illuTag', 'wd-swinv2-tagger-v3'),
    // 兜底：exe 同级放 models（便携分发）
    path.join(path.dirname(process.execPath), 'models', 'illuTag', 'wd-swinv2-tagger-v3'),
  ];
  const fs = require('node:fs');
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'model.onnx'))) return dir;
  }
  throw Object.assign(new Error('找不到打标模型（models/illuTag/wd-swinv2-tagger-v3），请在设置里指定 modelDir'), {
    code: 'MODEL_NOT_FOUND',
  });
}

function appRoot() {
  return path.join(__dirname, '..', '..', '..');
}

function ensureSession() {
  if (state.session) return state.session;
  const ort = require('onnxruntime-node');
  const dir = modelDir();
  state.session = { ort, session: ort.InferenceSession.create(path.join(dir, 'model.onnx')) };
  return state.session;
}

async function runTagger({ libraryId, threshold = 0.35, topN = 24, batchSize = 8 } = {}) {
  if (state.running) throw Object.assign(new Error('打标已在进行'), { code: 'TAGGER_BUSY' });

  const db = getDb();
  const lib = libs.getLibrary(db, libraryId);
  if (!lib) throw Object.assign(new Error('图库不存在'), { code: 'NOT_FOUND' });

  const { session: ortSession } = await ensureSession();
  const labels = loadLabels(modelDir());

  // 待打标队列：无模型标签、无元数据提示词的图（有元数据的图按 E1 不需要打标）
  const queue = db
    .prepare(
      `SELECT id, library_id, rel_path, mtime_ms FROM images
       WHERE library_id = ?
         AND id NOT IN (SELECT image_id FROM image_tags WHERE origin = 'model')
         AND id NOT IN (SELECT image_id FROM image_prompts)
       ORDER BY id`
    )
    .all(libraryId);

  state.running = true;
  state.cancelled = false;
  state.progress = { done: 0, total: queue.length };

  const sharp = require('sharp');
  let done = 0;
  let tagged = 0;

  try {
    for (const row of queue) {
      if (state.cancelled) break;

      let lib0 = lib;
      if (row.library_id !== lib.id) {
        lib0 = libs.getLibrary(db, row.library_id);
        if (!lib0) { done += 1; continue; }
      }
      let absPath;
      try {
        absPath = resolveInLibrary(lib0.root_path, row.rel_path);
} catch {
        done += 1;
        continue;
      }

      try {
        const pixels = await sharp(absPath, { failOn: 'none' })
          .resize(pp.IMG_SIZE, pp.IMG_SIZE, { fit: 'fill' })
          .removeAlpha()
          .toColourspace('srgb')
          .raw()
          .toBuffer();

        const input = pp.pixelsToTensor(pixels);
        const ort = require('onnxruntime-node');
        const tensor = new ort.Tensor('float32', input.data, input.dims);
        const results = await ortSession.run({ [ortSession.inputNames[0]]: tensor });
        const outputKey = Object.keys(results)[0];
        const logits = results[outputKey].data;

        const mapped = pp.mapOutputs(logits, labels);
        const chosen = pp.selectTags(mapped, { threshold, topN });

        const names = [
          ...chosen.general.map((t) => t.name),
          ...chosen.character.map((t) => t.name),
        ];
        if (names.length > 0) {
          const ids = names.map((n) => tagRepo.getOrCreateTag(db, n));
          tagRepo.attachTags(db, row.id, ids, { origin: 'model', confidence: chosen.general[0]?.prob ?? 1 });
          tagged += 1;
        }

        // rating 顺带写 age_level 候选（用户口径：显式标记直接采用）
        const level = pp.ratingToLevel(chosen.rating && chosen.rating.name);
        if (level != null) {
          imgs.setAge(db, [row.id], { level, source: 'meta', confidence: chosen.rating.prob });
        }
} catch {
        // 单张失败不中断任务
      }

      done += 1;
      state.progress = { done, total: queue.length };
      if (done % batchSize === 0) {
        broadcastEvent('tag:progress', { libraryId, done, total: queue.length, tagged });
      }
    }
  } finally {
    state.running = false;
    const summary = { done, total: queue.length, tagged, cancelled: state.cancelled };
    broadcastEvent('tags-updated', { libraryId, ...summary });
    broadcastEvent('tag:progress', { libraryId, ...summary, finished: true });
    state.progress = null;
  }

  return { done, total: queue.length, tagged, cancelled: state.cancelled };
}

let broadcaster = null;
function broadcastEvent(event, payload) {
  if (broadcaster) broadcaster(event, payload);
}

function loadLabels(dir) {
  const fs = require('node:fs');
  const csv = fs.readFileSync(require('node:path').join(dir, 'selected_tags.csv'), 'utf8');
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines[0].split(',');
  const nameIdx = header.indexOf('name');
  const catIdx = header.indexOf('category');
  const labels = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2 || !cols[nameIdx]) continue;
    labels.push({ name: cols[nameIdx].trim(), category: Number(cols[catIdx]) || 0 });
  }
  return labels;
}

function registerTaggerIpc(broadcast) {
  broadcaster = broadcast;
  handle('tag:run', runTagger);
  handle('tag:stop', () => {
    state.cancelled = true;
    return { stopping: true };
  });
  handle('tag:status', () => ({
    running: state.running,
    cancelled: state.cancelled,
    progress: state.progress,
  }));
  handle('tag:import-dictionary', ({ csvPath } = {}) => {
    const dir = csvPath || modelDir();
    const fs = require('node:fs');
    const csv = fs.readFileSync(require('node:path').join(dir, 'selected_tags.csv'), 'utf8');
    const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
    const header = lines[0].split(',');
    const nameIdx = header.indexOf('name');
    const zhIdx = header.indexOf('zh_name');
    const catIdx = header.indexOf('category');
    const cntIdx = header.indexOf('count');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 2 || !cols[nameIdx]) continue;
      rows.push({
        name: cols[nameIdx].trim(),
        zh_name: zhIdx >= 0 ? (cols[zhIdx] || '').trim() : '',
        category: Number(cols[catIdx]) || 0,
        count: Number(cols[cntIdx]) || 0,
      });
    }
    return tagRepo.importDictionary(getDb(), rows, { source: 'illutag' });
  });
}

module.exports = { registerTaggerIpc, runTagger, state };
