'use strict';

const { handle } = require('../ipc.cjs');
const { dialog, BrowserWindow } = require('electron');
const libs = require('../../core/db/libraryRepository.cjs');
const { getDb, registerMediaRoot } = require('../db/database.cjs');
const path = require('node:path');

/**
 * 图库注册相关的「系统交互」类 IPC：目录选择框、移除、窗口控制。
 */
function registerLibraryPickerIpc() {
  /** 系统目录选择框：选完即注册（同路径幂等） */
  handle('library:pick', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: '添加文件夹',
      buttonLabel: '添加',
      properties: ['openDirectory', 'multiSelections'],
      defaultPath: undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, libraries: [] };

    const db = getDb();
    const libraries = [];
    for (const dir of result.filePaths) {
      const lib = libs.registerLibrary(db, { name: '', rootPath: dir });
      registerMediaRoot(path.resolve(lib.root_path.replace(/\//g, path.sep)));
      libraries.push(lib);
    }
    return { canceled: false, libraries };
  });

  /** 手动输入路径注册（保留给无对话框环境/自动化） */
  handle('library:register', ({ name, rootPath }) => {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
      throw Object.assign(new Error('需要 rootPath'), { code: 'BAD_ARG' });
    }
    const db = getDb();
    const lib = libs.registerLibrary(db, { name, rootPath });
    registerMediaRoot(path.resolve(lib.root_path.replace(/\//g, path.sep)));
    return lib;
  });

  handle('library:list', () => libs.listLibraries(getDb()));

  handle('library:remove', ({ id }) => {
    // 先停监听再删库，否则 chokidar 会一直盯着已移除目录
    try {
      require('./scanner.cjs').stopWatch(id);
    } catch {
      /* 扫描服务还没起来时忽略 */
    }
    libs.removeLibrary(getDb(), id);
    return true;
  });

  /* 无边框窗口的自绘控制按钮 */
  const current = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  /** 界面缩放：实时改 zoomFactor 并持久化到 settings.uiScale */
  handle('window:set-zoom', ({ factor } = {}) => {
    const win = current();
    const f = Math.min(Math.max(Number(factor), 0.8), 2.0);
    if (!win || !Number.isFinite(f)) {
      throw Object.assign(new Error('缩放值非法'), { code: 'BAD_ARG' });
    }
    win.webContents.setZoomFactor(f);
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('uiScale', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch() * 1000`
      )
      .run(JSON.stringify(f));
    return f;
  });
  handle('window:minimize', () => {
    current()?.minimize();
    return true;
  });
  handle('window:maximize', () => {
    const win = current();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  handle('window:close', () => {
    current()?.close();
    return true;
  });
  handle('window:state', () => {
    const win = current();
    return { maximized: Boolean(win && win.isMaximized()) };
  });
}

module.exports = { registerLibraryPickerIpc };
