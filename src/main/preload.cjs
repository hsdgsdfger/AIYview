'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 白名单桥：每个通道显式声明，命名统一 domain:action。
 * M0 只有一条自检通道，业务通道一律等到对应 Milestone 再加。
 */
const CHANNELS = Object.freeze(['app:info', 'db:status']);

const api = {
  info: () => ipcRenderer.invoke('app:info'),
  dbStatus: () => ipcRenderer.invoke('db:status'),
};

contextBridge.exposeInMainWorld('yizi', api);
contextBridge.exposeInMainWorld('yiziChannels', CHANNELS);
