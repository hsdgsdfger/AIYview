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
    width: 1500,
    height: 940,
    minWidth: 1000,
    minHeight: 620,
    show: false,
    frame: false, // 自绘标题栏（品牌 + 添加文件夹 + 布局/面板 + 窗口按钮）
    backgroundColor: '#0d0f13',
    title: 'YiziView',
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

  // 排障：把渲染层控制台（含 CSP/资源加载错误）落盘
  if (process.argv.includes('--shot') || process.env.YIZI_DEBUG) {
    const fs = require('node:fs');
    const path2 = require('node:path');
    const logPath = path2.join(require('electron').app.getPath('userData'), 'renderer.log');
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      try {
        fs.appendFileSync(logPath, `[${level}] ${message} (${sourceId}:${line})\n`);
      } catch {
        /* 排障日志写失败不影响主流程 */
      }
    });
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // 最大化状态变化要通知渲染层切换按钮图标
  const notifyMaximize = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized());
  };
  win.on('maximize', notifyMaximize);
  win.on('unmaximize', notifyMaximize);

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  return win;
}

module.exports = { createMainWindow, isAllowedNavigation, shouldAllowRequest };
