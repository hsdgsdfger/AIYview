'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const { createMainWindow } = require('./window.cjs');
const { applyNetworkPolicy } = require('./security.cjs');
const { registerMediaProtocol } = require('./mediaProtocol.cjs');
const { getDb, closeDb, ensureMediaRoots, thumbnailsDir, registerMediaRoot } = require('./db/database.cjs');
const { registerBrowseIpc } = require('./services/browse.cjs');
const { registerScanIpc } = require('./services/scanner.cjs');
const { registerThumbIpc } = require('./services/thumbs.cjs');
const { registerPromptIpc } = require('./services/prompts.cjs');
const { registerPromptLibraryIpc } = require('./services/promptLibrary.cjs');
const { registerTagIpc } = require('./services/tags.cjs');
const { registerTrashIpc } = require('./services/trash.cjs');
const { registerSettingsIpc } = require('./services/settings.cjs');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';
const SMOKE = process.argv.includes('--smoke');
const IS_DEV = Boolean(DEV_SERVER_URL);

/** 延迟到真正需要时才加载原生模块，窗口启动不依赖 better-sqlite3 的 ABI */
function lazyDb() {
  return require('./db/open.cjs');
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

/** 主进程 → 渲染层广播 */
function broadcast(event, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload);
  }
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

  registerBrowseIpc(broadcast);
  registerScanIpc(broadcast);
  registerThumbIpc();
  registerPromptIpc();
  registerPromptLibraryIpc();
  registerTagIpc();
  registerTrashIpc();
  registerSettingsIpc();
}

function bootstrap() {
  applyNetworkPolicy(session.defaultSession, {
    devServerUrl: DEV_SERVER_URL,
    onBlocked: (url) => log(`[net-policy] blocked ${url}`),
  });

  const db = getDb();
  ensureMediaRoots(db);
  registerMediaRoot(thumbnailsDir());
  registerMediaProtocol(protocol);

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

  app.on('will-quit', () => {
    closeDb();
  });
}
