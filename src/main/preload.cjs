'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 白名单桥：每个通道显式声明，命名统一 domain:action。
 * invoke 统一返回 {ok, data|error}；事件经 api.on 订阅并返回取消函数。
 */
const CHANNELS = Object.freeze([
  'app:info',
  'db:status',
  'library:list', 'library:register', 'library:remove',
  'scan:status', 'scan:run', 'scan:watch-stop',
  'browse:folders', 'browse:page', 'browse:count',
  'image:get', 'image:marks', 'image:age', 'image:dimensions', 'image:prompt',
  'thumb:get', 'thumb:cache-stats',
  'prompt:save', 'prompt:save-manual', 'prompt:list', 'prompt:get', 'prompt:update', 'prompt:remove',
  'tag:import-csv', 'tag:search', 'tag:suggest', 'tag:of-image', 'tag:attach', 'tag:detach',
  'delete:trash', 'delete:list', 'delete:restore', 'delete:sweep',
  'settings:get', 'settings:set', 'settings:all',
]);

const EVENTS = Object.freeze(['scan:progress', 'browse:changed', 'tags-updated']);

async function invoke(channel, payload) {
  if (!CHANNELS.includes(channel)) {
    return { ok: false, error: '通道未在白名单: ' + channel, code: 'CHANNEL_FORBIDDEN' };
  }
  return ipcRenderer.invoke(channel, payload);
}

const api = { invoke, channels: CHANNELS };

for (const channel of CHANNELS) {
  const [domain, action] = channel.split(':');
  api[domain] = api[domain] || {};
  api[domain][action] = (payload) => invoke(channel, payload);
}

const listeners = new Map();
api.on = (event, callback) => {
  if (!EVENTS.includes(event)) return () => {};
  const wrapped = (_e, payload) => callback(payload);
  ipcRenderer.on(event, wrapped);
  listeners.set(callback, wrapped);
  return () => {
    ipcRenderer.removeListener(event, wrapped);
    listeners.delete(callback);
  };
};

contextBridge.exposeInMainWorld('yizi', api);
contextBridge.exposeInMainWorld('yiziChannels', CHANNELS);
