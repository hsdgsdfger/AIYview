'use strict';

const { ipcMain } = require('electron');
const logger = require('./logger.cjs');

/**
 * 统一 IPC 注册：所有 handler 的异常折叠成 {ok:false, error} 返回渲染层，
 * 主进程不因单次调用崩溃；通道名强制 domain:action。
 *
 * 日志：每次调用记录耗时（>200ms 记 warn），异常一律记 error 带堆栈——
 * 界面「点了没反应/卡住」时能直接从 ipc 日志定位是哪个通道、耗时多久、报什么错。
 */
const registered = new Set();

function handle(channel, fn) {
  if (!/^[a-z]+:[a-zA-Z][a-zA-Z-]*$/.test(channel)) {
    throw new Error('IPC 通道命名必须是 domain:action: ' + channel);
  }
  if (registered.has(channel)) throw new Error('通道重复注册: ' + channel);
  registered.add(channel);

  ipcMain.handle(channel, async (_event, payload) => {
    const t0 = Date.now();
    try {
      const data = await fn(payload || {}, _event);
      const cost = Date.now() - t0;
      if (cost > 200) logger.warn('ipc', `${channel} 慢调用 ${cost}ms`, summarize(payload));
      else logger.debug('ipc', `${channel} ${cost}ms`, null);
      return { ok: true, data };
    } catch (error) {
      const cost = Date.now() - t0;
      logger.error('ipc', `${channel} 失败 ${cost}ms: ${error.message}`, {
        code: error.code || 'IPC_ERROR',
        payload: summarize(payload),
        stack: (error.stack || '').split('\n').slice(0, 4).join(' | '),
      });
      return { ok: false, error: error.message, code: error.code || 'IPC_ERROR' };
    }
  });
}

/** 只保留能帮助定位的字段，避免把大数组打进日志 */
function summarize(payload) {
  if (!payload || typeof payload !== 'object') return payload ?? null;
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v)) out[k] = `[${v.length}]`;
    else if (typeof v === 'string' && v.length > 120) out[k] = `${v.slice(0, 120)}…`;
    else if (v && typeof v === 'object') out[k] = '{…}';
    else out[k] = v;
  }
  return out;
}

function sender(event) {
  return event && event.sender ? event.sender : null;
}

module.exports = { handle, sender, registered };
