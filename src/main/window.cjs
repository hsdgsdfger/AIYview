'use strict';

const path = require('node:path');
const { BrowserWindow } = require('electron');
const { shouldAllowRequest } = require('../core/netPolicy.cjs');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';

/**
 * 只允许加载本地文件（或开发期 dev server），其余导航一律拒绝。
 */
function isAllowedNavigation(targetUrl) {
  if (!targetUrl) return false;
  if (targetUrl.startsWith('file://')) return true;
  return Boolean(DEV_SERVER_URL) && targetUrl.startsWith(DEV_SERVER_URL);
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#111318',
    title: 'YiziView Next',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  return win;
}

module.exports = { createMainWindow, isAllowedNavigation, shouldAllowRequest };
