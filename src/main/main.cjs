'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createMainWindow } = require('./window.cjs');
const { applyNetworkPolicy } = require('./security.cjs');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';
const SMOKE = process.argv.includes('--smoke');
const IS_DEV = Boolean(DEV_SERVER_URL);

/** 延迟到真正需要时才加载原生模块，M0 的窗口启动不依赖 better-sqlite3 的 ABI。 */
function lazyDb() {
  return require('./db/open.cjs');
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    dev: IS_DEV,
  }));

  ipcMain.handle('db:status', () => {
    try {
      const { probeDatabase } = lazyDb();
      return probeDatabase(path.join(app.getPath('userData'), 'index.sqlite'));
    } catch (error) {
      return { ok: false, error: error.message, code: error.code || 'DB_UNAVAILABLE' };
    }
  });
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

function bootstrap() {
  applyNetworkPolicy(session.defaultSession, {
    devServerUrl: DEV_SERVER_URL,
    onBlocked: (url) => log(`[net-policy] blocked ${url}`),
  });

  registerIpc();
  const win = createMainWindow();

  win.webContents.on('did-finish-load', () => log('[boot] renderer loaded'));

  if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        try {
          const { probeDatabase } = lazyDb();
          const probe = probeDatabase(path.join(app.getPath('userData'), 'index.sqlite'));
          log(
            probe.ok
              ? `[smoke] db ok=true current=${probe.current} tables=${probe.tables.length}`
              : `[smoke] db ok=false code=${probe.code} error=${probe.error}`
          );
        } catch (error) {
          log(`[smoke] db error ${error.message}`);
        }
        log('[smoke] window-ready');
        app.exit(0);
      }, 300);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      log(`[smoke] renderer-gone ${details.reason}`);
      app.exit(1);
    });
    setTimeout(() => {
      log('[smoke] timeout');
      app.exit(2);
    }, 20000).unref?.();
  }

  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    log(`[boot] electron ${process.versions.electron} node ${process.versions.node}`);
    bootstrap();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
