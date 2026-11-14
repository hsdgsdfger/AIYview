'use strict';
/**
 * electron/core/batchRename.cjs
 * ---------------------------------------------------------------------------
 * 批量重命名引擎：模板渲染 + 非法字符清洗 + 冲突消解 + 两阶段落盘。
 *
 * upstream 缺口：只有单文件 `rename-item`（main.cjs:806），多选图片后只能一张张改。
 *
 * 适配来源：
 *   - sindresorhus/filenamify (MIT) : Windows 保留名 / 非法字符 / 尾部点空格 清洗表
 *
 * 两阶段落盘：先全部 rename 到临时名，再 rename 到目标名。
 * 单阶段在 a.jpg → b.jpg、b.jpg → a.jpg 这种互换场景下会互相覆盖。
 */

const nodePath = require('path');
const crypto = require('crypto');

const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

// Windows 非法字符 + C0/C1 控制字符
// 文件名清洗需要显式匹配控制字符（刻意的），对 eslint 豁免
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f\u0080-\u009f]/g;
const MAX_FILENAME_LENGTH = 180;

/**
 * filenamify 的精简移植：清洗 Windows 非法文件名。
 * @param {string} input
 * @param {{replacement?: string, maxLength?: number}} [opts]
 */
function sanitizeFilename(input, opts = {}) {
  const replacement = opts.replacement ?? '-';
  const maxLength = opts.maxLength ?? MAX_FILENAME_LENGTH;

  let name = String(input ?? '')
    .normalize('NFC')
    .replace(ILLEGAL_CHARS, replacement)
    .replace(/\s+/g, ' ')
    .trim();

  // 尾部点与空格在 Windows 上会被系统吞掉，直接去掉
  name = name.replace(/[. ]+$/, '');

  // 保留名（含带扩展名的 CON.txt）
  const stem = name.split('.')[0].toLowerCase();
  if (RESERVED_NAMES.has(stem)) name = `_${name}`;

  if (name.length > maxLength) {
    const ext = nodePath.extname(name);
    const keep = Math.max(1, maxLength - ext.length);
    name = name.slice(0, keep) + ext;
  }

  return name;
}

function pad(num, width) {
  const s = String(num);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

/**
 * 模板渲染。支持 {name} {ext} {index} {index:3} {date} {parent}
 * @param {string} template
 * @param {{name:string, ext:string, index:number, date?:string, parent?:string}} ctx
 */
function renderTemplate(template, ctx) {
  return String(template).replace(/\{(\w+)(?::(\d+))?\}/g, (match, key, width) => {
    switch (key) {
      case 'name':
        return ctx.name ?? '';
      case 'ext':
        return ctx.ext ?? '';
      case 'index':
        return width ? pad(ctx.index, parseInt(width, 10)) : String(ctx.index);
      case 'date':
        return ctx.date ?? '';
      case 'parent':
        return ctx.parent ?? '';
      default:
        return match; // 未知占位符原样保留，避免静默吞字符
    }
  });
}

function formatDate(ms, fmt = 'YYYYMMDD') {
  const d = ms ? new Date(ms) : new Date();
  const map = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1, 2),
    DD: pad(d.getDate(), 2),
    HH: pad(d.getHours(), 2),
    mm: pad(d.getMinutes(), 2),
    ss: pad(d.getSeconds(), 2)
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => map[t]);
}

/**
 * 生成重命名计划（纯函数，不落盘）。
 *
 * @param {Array<{path:string, name:string, mtimeMs?:number, width?:number, height?:number}>} files
 * @param {object} opts
 * @param {string} opts.template
 * @param {number} [opts.startIndex=1]
 * @param {string[]} [opts.existingNames] 目标目录已存在的文件名（用于冲突检测）
 * @param {boolean} [opts.dryRun=true]
 * @returns {{plan:Array, conflicts:Array, skipped:number}}
 */
function planBatchRename(files, opts = {}) {
  const template = opts.template || '{name}';
  const startIndex = Number.isInteger(opts.startIndex) ? opts.startIndex : 1;
  const existing = new Set((opts.existingNames || []).map((n) => n.toLowerCase()));

  const plan = [];
  const used = new Set(); // 本次计划内已占用的目标名（小写）
  const sourceNames = new Set(files.map((f) => nodePath.basename(f.path).toLowerCase()));
  let skipped = 0;

  files.forEach((file, i) => {
    const base = nodePath.basename(file.path);
    const ext = nodePath.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;

    const rendered = renderTemplate(template, {
      name: stem,
      ext,
      index: startIndex + i,
      date: formatDate(file.mtimeMs),
      parent: nodePath.basename(nodePath.dirname(file.path))
    });

    // 模板里没写扩展名就补上，避免生成无后缀文件
    const hasExt = nodePath.extname(rendered).length > 0;
    let targetName = sanitizeFilename(hasExt ? rendered : rendered + ext);

    if (!targetName || targetName === ext) {
      plan.push({ from: file.path, to: null, name: null, skip: true, reason: 'empty-name' });
      skipped++;
      return;
    }

    const lower = targetName.toLowerCase();
    const isSelf = lower === base.toLowerCase();

    // 计划内重名 / 与目录内既有文件重名 → 追加 (n)
    let candidate = targetName;
    if (!isSelf) {
      let n = 2;
      while (used.has(candidate.toLowerCase()) || (existing.has(candidate.toLowerCase()) && !sourceNames.has(candidate.toLowerCase()))) {
        const cExt = nodePath.extname(targetName);
        const cStem = cExt ? targetName.slice(0, -cExt.length) : targetName;
        candidate = sanitizeFilename(`${cStem} (${n})${cExt}`);
        n++;
        if (n > 9999) break;
      }
      targetName = candidate;
    }

    used.add(targetName.toLowerCase());

    if (isSelf) {
      plan.push({ from: file.path, to: file.path, name: base, skip: true, reason: 'unchanged' });
      skipped++;
      return;
    }

    plan.push({
      from: file.path,
      to: nodePath.join(nodePath.dirname(file.path), targetName),
      name: targetName,
      skip: false,
      reason: null,
      renamedFrom: base
    });
  });

  const conflicts = plan.filter((p) => p.reason && p.reason !== 'unchanged' && p.reason !== 'empty-name');
  return { plan, conflicts, skipped };
}

/**
 * 执行计划（两阶段）。
 * @param {{plan:Array}} planResult
 * @param {{fs?:object, dryRun?:boolean}} [opts]
 */
async function applyBatchRename(planResult, opts = {}) {
  const fs = opts.fs || require('fs/promises');
  const dryRun = opts.dryRun === true;
  const actionable = (planResult.plan || []).filter((p) => !p.skip && p.to);

  if (dryRun) return { dryRun: true, renamed: actionable.length, failed: [] };

  const staged = [];
  const failed = [];

  // Phase 1: 全部挪到临时名，规避互换覆盖
  for (const item of actionable) {
    const dir = nodePath.dirname(item.from);
    const tmp = nodePath.join(dir, `.aiyview-rename-${crypto.randomBytes(4).toString('hex')}${nodePath.extname(item.from)}`);
    try {
      await fs.rename(item.from, tmp);
      staged.push({ ...item, tmp });
    } catch (error) {
      failed.push({ from: item.from, to: item.to, error: error.message });
    }
  }

  // Phase 2: 临时名 → 目标名
  let renamed = 0;
  for (const item of staged) {
    try {
      await fs.rename(item.tmp, item.to);
      renamed++;
    } catch {
      // 回滚这一条，别让文件卡在临时名上
      try {
        await fs.rename(item.tmp, item.from);
      } catch (error) { /* 尽力而为 */
        failed.push({ from: item.from, to: item.to, error: error.message });
      }
    }
  }

  return { dryRun: false, renamed, failed };
}

module.exports = {
  sanitizeFilename,
  renderTemplate,
  planBatchRename,
  applyBatchRename,
  formatDate
};
