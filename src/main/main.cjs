'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const { createMainWindow } = require('./window.cjs');
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

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';
const SMOKE = process.argv.includes('--smoke');
const SHOT = process.argv.includes('--shot');
const IS_DEV = Boolean(DEV_SERVER_URL);

// 无 TTY 启动时 stdout/stderr 管道可能随时断开，EPIPE 绝不能中断主进程
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

/** 延迟到真正需要时才加载原生模块，窗口启动不依赖 better-sqlite3 的 ABI */
function lazyDb() {
  return require('./db/open.cjs');
}

function log(line) {
  // 双击启动的打包版没有 stdout 管道，写入会抛 EPIPE → 必须吞掉，否则主进程直接崩
  try {
    if (process.stdout.writable) process.stdout.write(`${line}\n`);
  } catch {
    /* stdout 已断开，忽略 */
  }
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

/** 主进程 → 渲染层广播 */
function broadcast(event, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload);
  }
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
  registerMediaRoot(thumbnailsDir());
  registerMediaProtocol(protocol);

  registerIpc();
  const win = createMainWindow();
  applyUiScale(win);

  win.webContents.on('did-finish-load', () => log('[boot] renderer loaded'));

  if (SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.YIZI_CLICKTEST) {
            const c = await win.webContents.executeJavaScript(
              '(() => { const t = document.querySelector(".thumb"); if (!t) return "no-thumb"; t.dispatchEvent(new MouseEvent("click", { bubbles: true })); return "clicked"; })()'
            );
            log(`[click] ${c}`);
            await new Promise((r) => setTimeout(r, 500));
          }
          if (process.env.YIZI_ORDERTEST) {
            const r = await win.webContents.executeJavaScript(`
              (async () => {
                const ids = () => [...document.querySelectorAll('.thumb')].map((el) => el.dataset.thumbId).join(',');
                const before = ids();
                const first = document.querySelector('.thumb');
                first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await new Promise((r) => setTimeout(r, 200));
                const rejectBtn = [...document.querySelectorAll('.ab-btn')].find((b) => b.textContent.trim() === '标废');
                if (rejectBtn) rejectBtn.click();
                await new Promise((r) => setTimeout(r, 700));
                return { changed: before !== ids(), beforeHead: before.split(',').slice(0, 5), afterHead: ids().split(',').slice(0, 5) };
              })()
            `);
            log(`[order] changed=${r.changed} head_before=${r.beforeHead.join('|')} head_after=${r.afterHead.join('|')}`);
          }
          if (process.env.YIZI_STATS) {
            const s = await win.webContents.executeJavaScript(
              `(async () => {
                 const st = await window.yizi.thumb['cache-stats']();
                 const imgs = document.querySelectorAll('.thumb-box img').length;
                 const cards = document.querySelectorAll('.thumb').length;
                 const spinners = document.querySelectorAll('.thumb-placeholder .spin').length;
                 return { stats: st.data, cards, imgs, spinners };
               })()`
            );
            log(`[stats] ${JSON.stringify(s)}`);
          }
          if (process.env.YIZI_WHEELTEST) {
            const r = await win.webContents.executeJavaScript(`
              (() => {
                const before = JSON.parse(JSON.stringify(window.__yiziDebug));
                const canvas = document.querySelector('.canvas');
                canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
                canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
                return new Promise((res) => setTimeout(() => res({ before: before.columns, after: window.__yiziDebug.columns }), 300));
              })()
            `);
            log(`[wheel] columns ${r.before} -> ${r.after}`);
          }
          const dbg = await win.webContents.executeJavaScript('JSON.stringify(window.__yiziDebug || null)');
          log(`[shot] debug ${dbg}`);
          const image = await win.webContents.capturePage();
          const out = path.join(app.getPath('userData'), 'shot.png');
          require('node:fs').writeFileSync(out, image.toPNG());
          log(`[shot] saved ${out}`);
        } catch (error) {
          log(`[shot] failed ${error.message}`);
        }
        app.exit(0);
      }, 6000);
    });
  }

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

if (!app.requestSingleInstanceLock()) {
  log('[main] single-instance lock NOT acquired, quitting');
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
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
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
    closeDb();
  });
}
