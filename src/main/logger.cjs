'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 主进程日志：解决「应用卡死/打不开却查不到原因」。
 *
 * 落盘位置：<userData>/logs/app.log（超过 2MB 自动滚到 app.1.log）
 * 级别：error > warn > info > debug（settings.logLevel 可调，默认 info）
 *
 * 双层输出：
 *   1) 控制台（dev 有 TTY 时）—— 判空，双击启动没有 stdout 也不会崩
 *   2) 文件 —— 永远写，带时间戳/级别/标签
 */

const MAX_BYTES = 2 * 1024 * 1024;
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let logFile = null;
let logDir = null;
let minLevel = LEVELS.info;
let seq = 0;
let enabled = true;

function earlyUserData() {
  try {
    // 延迟 require，避免在 app ready 前加载 electron 造成副作用
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    const base = process.env.APPDATA || process.env.LOCALAPPDATA || require('node:os').tmpdir();
    return path.join(base, 'yiziview-next');
  }
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(logFile);
    if (st.size > MAX_BYTES) {
      const prev = path.join(logDir, 'app.1.log');
      fs.rmSync(prev, { force: true });
      fs.renameSync(logFile, prev);
    }
  } catch {
    /* 第一次写，文件还不存在 */
  }
}

/** 初始化（幂等）：创建目录、解析级别 */
function init(options = {}) {
  if (logFile) return { logFile, logDir };
  logDir = options.dir || path.join(earlyUserData(), 'logs');
  logFile = path.join(logDir, 'app.log');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    enabled = false; // 目录都建不了就别再尝试写盘了
  }
  if (options.level && LEVELS[options.level] != null) minLevel = LEVELS[options.level];
  write('info', 'boot', '应日志系统就绪', { pid: process.pid, electron: process.versions.electron });
  return { logFile, logDir };
}

function setLevel(level) {
  if (LEVELS[level] != null) minLevel = LEVELS[level];
}

function getLevel() {
  return Object.keys(LEVELS).find((k) => LEVELS[k] === minLevel) || 'info';
}

function serialize(extra) {
  if (extra == null) return '';
  try {
    const text = typeof extra === 'string' ? extra : JSON.stringify(extra);
    return text && text.length > 2000 ? ` ${text.slice(0, 2000)}…` : ` ${text}`;
  } catch {
    return ' [extra 不可序列化]';
  }
}

function write(level, tag, message, extra) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${tag}] #${++seq} ${message}${serialize(extra)}`;

  // 控制台（双击启动时 process.stdout 可能是 undefined）
  try {
    const out = level === 'error' ? process.stderr : process.stdout;
    if (out && out.writable && typeof out.write === 'function') out.write(`${line}\n`);
  } catch {
    /* 忽略 EPIPE */
  }

  if (!enabled || !logFile) return;
  try {
    rotateIfNeeded();
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    /* 写盘失败（磁盘满/权限）不能影响主流程 */
  }
}

const logger = {
  init,
  setLevel,
  getLevel,
  getFile: () => logFile,
  getDir: () => logDir,
  error: (tag, msg, extra) => write('error', tag, msg, extra),
  warn: (tag, msg, extra) => write('warn', tag, msg, extra),
  info: (tag, msg, extra) => write('info', tag, msg, extra),
  debug: (tag, msg, extra) => {
    if (minLevel >= LEVELS.debug) write('debug', tag, msg, extra);
  },
  /** 兼容旧调用：log('文本') */
  log: (msg, extra) => write('info', 'app', msg, extra),
  /** 计时器：fn 耗时超过阈值时告警 */
  time(tag, label, fn) {
    const t0 = Date.now();
    try {
      return fn();
    } finally {
      const cost = Date.now() - t0;
      if (cost > 200) write('warn', tag, `${label} 耗时 ${cost}ms`, null);
      else write('debug', tag, `${label} ${cost}ms`, null);
    }
  },
  async timeAsync(tag, label, fn) {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      const cost = Date.now() - t0;
      if (cost > 500) write('warn', tag, `${label} 耗时 ${cost}ms`, null);
      else write('debug', tag, `${label} ${cost}ms`, null);
    }
  },
};

module.exports = logger;
