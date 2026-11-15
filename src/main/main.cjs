'use strict';

// 日志与崩溃兜底放在最前面：后续 require 阶段出错也能留下记录
const path = require('node:path');
const logger = require('./logger.cjs');
logger.init();
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') stream.on('error', () => {});
}
const { app, BrowserWindow, ipcMain, session, protocol, shell } = require('electron');
const { createMainWindow } = require('./window.cjs');
const { installDevHooks } = require('./devHooks.cjs');
const { applyNetworkPolicy } = require('./security.cjs');
const { registerMediaProtocol } = require('./mediaProtocol.cjs');
const { getDb, closeDb, ensureMediaRoots, thumbnailsDir, registerMediaRoot } = require('./db/database.cjs');
const { registerBrowseIpc } = require('./services/browse.cjs');
const { registerLibraryPickerIpc } = require('./services/libraryPicker.cjs');
const { registerScanIpc } = require('./services/scanner.cjs');
const { registerThumbIpc } = require('./services/thumbs.cjs');
const { registerPromptIpc } = require('./services/prompts.cjs');
const { registerPromptLibraryIpc } = require('./services/promptLibrary.cjs');
const { registerTagIpc } = require('./services/tags.cjs');
const { registerTrashIpc } = require('./services/trash.cjs');
const { registerSettingsIpc } = require('./services/settings.cjs');
const { registerTaggerIpc } = require('./services/tagger.cjs');
const { registerRenameIpc } = require('./services/rename.cjs');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';
const SMOKE = process.argv.includes('--smoke');
const IS_DEV = Boolean(DEV_SERVER_URL);


// 双击启动的 GUI 进程没有 stdout/stderr 流（可能是 undefined），
// 直接 .on() 会在模块加载阶段抛 TypeError 让应用静默退出——必须判空。
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') {
    stream.on('error', () => {}); // EPIPE 不能中断主进程
  }
}

/** 延迟到真正需要时才加载原生模块，窗口启动不依赖 better-sqlite3 的 ABI */
function lazyDb() {
  return require('./db/open.cjs');
}

function log(line) {
  // 统一走 logger：控制台（判空）+ 文件（<userData>/logs/app.log，自动滚动）
  logger.info('app', line);
  if (SMOKE) {
    // GUI 进程重定向 stdout 会被 app.exit 截断，落盘一份供冒烟脚本验证
    try {
      const fs = require('node:fs');
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.appendFileSync(path.join(app.getPath('userData'), 'smoke.log'), `${line}\n`);
    } catch {
      /* 尽力而为：日志落盘失败不影响主流程 */
    }
  }
}

/**
 * 卡死看门狗：主进程事件循环被长任务堵住时（同步大查询、同步 IO），
 * 心跳会明显延迟 —— 记 warn，事后能定位是哪个阶段卡住。
 */
function startWatchdog() {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const lag = now - last - 5000;
    if (lag > 1200) {
      logger.warn('watchdog', `主进程事件循环阻塞约 ${lag}ms`, { heapMB: Math.round(process.memoryUsage().heapUsed / 1048576) });
    }
    last = now;
  }, 5000).unref();
}

/** 主进程 → 渲染层广播 */
function broadcast(event, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload);
  }
}

/**
 * 回收站过期清理：启动跑一次，之后每小时一次。
 * 没有这个定时器时 deletions 表里的 pending 记录只进不出（列表靠 expires_at 过滤，界面看不出来）。
 */
function startTrashSweep() {
  const dels = require('../core/db/deletionRepository.cjs');
  const sweep = () => {
    try {
      const removed = dels.sweepExpired(getDb());
      if (removed) log(`[trash] 清理过期删除记录 ${removed} 条`);
    } catch (error) {
      logger.warn('trash', '过期清理失败', { message: error.message });
    }
  };
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

/**
 * UI 缩放：整窗按 1.5 倍放大（用户要求），可在设置里改 uiScale。
 * webContents zoomFactor 会等比放大整个界面，比逐个改 CSS 更稳。
 */
const DEFAULT_UI_SCALE = 1.5;

function readUiScale() {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('uiScale');
    const v = row ? JSON.parse(row.value) : null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0.75 && n <= 2.5 ? n : DEFAULT_UI_SCALE;
  } catch {
    return DEFAULT_UI_SCALE;
  }
}

function applyUiScale(win) {
  const scale = readUiScale();
  // did-finish-load 之后再设一次，避免导航重置
  win.webContents.setZoomFactor(scale);
  win.webContents.once('did-finish-load', () => {
    win.webContents.setZoomFactor(scale);
    log(`[ui] zoomFactor=${scale}`);
  });
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

  ipcMain.handle('app:log-path', () => logger.getFile());
  ipcMain.handle('app:log-open', () => {
    try {
      shell.showItemInFolder(logger.getFile());
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('log:renderer', (_event, payload = {}) => {
    const level = payload.level === 'warn' ? 'warn' : 'error';
    logger[level]('renderer', payload.message || '未知渲染层错误', payload.extra);
    return true;
  });

  ipcMain.handle('db:status', () => {
    try {
      const { probeDatabase } = lazyDb();
      return probeDatabase(path.join(app.getPath('userData'), 'index.sqlite'));
    } catch (error) {
      return { ok: false, error: error.message, code: error.code || 'DB_UNAVAILABLE' };
    }
  });

  registerLibraryPickerIpc();
  registerBrowseIpc(broadcast);
  registerScanIpc(broadcast);
  registerThumbIpc();
  registerPromptIpc();
  registerPromptLibraryIpc();
  registerTagIpc();
  registerTrashIpc();
  registerSettingsIpc();
  registerTaggerIpc(broadcast);
  registerRenameIpc(broadcast);
}

function bootstrap() {
  applyNetworkPolicy(session.defaultSession, {
    devServerUrl: DEV_SERVER_URL,
    onBlocked: (url) => log(`[net-policy] blocked ${url}`),
  });

  log("[boot] step: getDb");
  const db = getDb();
  log("[boot] step: getDb ok");
  ensureMediaRoots(db);
  log("[boot] step: media roots ok");
  startTrashSweep();
  registerMediaRoot(thumbnailsDir());
  registerMediaProtocol(protocol);

  registerIpc();
  const win = createMainWindow();
  applyUiScale(win);

  win.webContents.on('did-finish-load', () => log('[boot] renderer loaded'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error('window', '页面加载失败', { code, desc, url });
  });
  win.webContents.on('unresponsive', () => logger.error('window', '渲染进程无响应（界面会卡住）'));
  win.webContents.on('responsive', () => logger.info('window', '渲染进程恢复响应'));
  win.webContents.on('render-process-gone', (_e, details) => logger.error('window', '渲染进程退出', details));
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    logger.error('window', 'preload 抛错', { preloadPath, message: error && error.message });
  });
  app.on('child-process-gone', (_e, details) => logger.error('app', '子进程退出', details));

  installDevHooks(win, log);


  if (SMOKE) {
    try {
      require('node:fs').rmSync(path.join(app.getPath('userData'), 'smoke.log'), { force: true });
    } catch {
      /* 清旧日志失败无所谓 */
    }
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        try {
          log('[smoke] start');
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

log('[main] loaded, smoke=' + SMOKE);

process.on('uncaughtException', (error) => {
  log('[fatal] uncaught: ' + (error && error.stack ? error.stack : error));
});
process.on('unhandledRejection', (reason) => {
  log('[fatal] rejection: ' + (reason && reason.stack ? reason.stack : reason));
});

logger.init();
logger.info('boot', 'main.cjs loaded', { argv: process.argv.slice(1), electron: process.versions.electron });
startWatchdog();

if (!app.requestSingleInstanceLock()) {
  logger.warn('app', '单例锁未获取到：已有实例在运行，本次启动请求已转交给它');
  app.quit();
} else {
  // 自定义协议必须在 app ready 前声明特权，否则 <img src="media://..."> 会被 Chromium 拒绝
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
    },
  ]);
  app.on('second-instance', () => {
    // 用户又双击了一次：把已有窗口拉到前台，而不是「什么都没发生」
    logger.info('app', '收到第二个实例的启动请求，前置已有窗口');
    const [win] = BrowserWindow.getAllWindows();
    if (!win) {
      logger.warn('app', 'second-instance 但没有任何窗口，可能是首帧未完成');
      return;
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    win.moveTop();
    win.flashFrame(true);
    setTimeout(() => {
      if (!win.isDestroyed()) win.flashFrame(false);
    }, 1500);
  });

  app.whenReady().then(() => {
    log(`[boot] electron ${process.versions.electron} node ${process.versions.node}`);
    try {
      bootstrap();
    } catch (error) {
      log(`[boot] bootstrap failed: ${error.message}`);
      if (error.stack) log(`[boot] at: ${error.stack.split('\n').slice(1, 8).join(' | ')}`);
      if (SMOKE) log('[smoke] bootstrap-failed');
      app.exit(1);
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch((error) => {
    log(`[boot] whenReady failed: ${error.message}`);
    if (SMOKE) log('[smoke] bootstrap-failed');
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    // 退出前把 WAL 收进主库，避免下次启动前的强杀丢掉刚刚点的标记
    try {
      const db = getDb();
      db.pragma('wal_checkpoint(TRUNCATE)');
      // 顺手留一份库备份（标记都在里面，几 MB 而已）
      require('node:fs').copyFileSync(
        path.join(app.getPath('userData'), 'index.sqlite'),
        path.join(app.getPath('userData'), 'index.sqlite.bak')
      );
    } catch (error) {
      logger.warn('db', '退出前检查点失败', { message: error.message });
    }
    closeDb();
  });
}
