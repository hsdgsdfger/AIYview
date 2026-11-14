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
    show: true, // 立即显示：隐藏窗口在部分机器上不会产生首帧，ready-to-show 永不触发（会表现为「双击没反应」）
    frame: false, // 自绘标题栏（品牌 + 添加文件夹 + 布局/面板 + 窗口按钮）
    backgroundColor: '#0d0f13', // 深色底遮住首帧白闪
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

  try {
    require('./logger.cjs').info('window', '窗口已创建并立即显示', {
      visible: win.isVisible(),
      bounds: win.getBounds(),
    });
  } catch {
    /* 日志失败不影响显示 */
  }
  win.once('ready-to-show', () => {
    try {
      require('./logger.cjs').info('window', '首帧就绪（ready-to-show）');
    } catch {
      /* 忽略 */
    }
  });

  // 兜底：首帧慢（大图库 + 高倍缩放）或渲染层异常时，ready-to-show 可能很晚才来，
  // 用户会以为「双击没反应」。3 秒后无论如何先把窗口显示出来。
  const forceShow = setTimeout(() => {
    if (win.isDestroyed()) return;
    if (!win.isVisible()) {
      win.show();
      try {
        require('./logger.cjs').warn('window', 'ready-to-show 超时，已强制显示窗口');
      } catch {
        /* 忽略 */
      }
    }
  }, 3000);
  win.once('closed', () => clearTimeout(forceShow));

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
