'use strict';

const { ipcMain } = require('electron');

/**
 * 统一 IPC 注册：所有 handler 的异常折叠成 {ok:false, error} 返回渲染层，
 * 主进程不因单次调用崩溃；通道名强制 domain:action。
 */
const registered = new Set();

function handle(channel, fn) {
  if (!/^[a-z]+:[a-zA-Z][a-zA-Z-]*$/.test(channel)) {
    throw new Error('IPC 通道命名必须是 domain:action: ' + channel);
  }
  if (registered.has(channel)) throw new Error('通道重复注册: ' + channel);
  registered.add(channel);

  ipcMain.handle(channel, async (_event, payload) => {
    try {
      const data = await fn(payload || {}, _event);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code || 'IPC_ERROR' };
    }
  });
}

function sender(event) {
  return event && event.sender ? event.sender : null;
}

module.exports = { handle, sender, registered };
