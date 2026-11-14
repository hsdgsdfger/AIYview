import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SHORTCUTS } from './shortcuts.js';

/**
 * 全局状态：库 / 目录 / 分页 / 选中 / 视图 / 筛选 / 标签栏。
 * 数据纪律：渲染层永不持有全量数组，一切靠游标分页增量追加。
 */
const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [libraries, setLibraries] = useState([]);
  const [libraryId, setLibraryId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState('');           // '' = 全库
  const [folderSearch, setFolderSearch] = useState('');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(null);
  const [columns, setColumns] = useState(4);          // 面板数
  const [sort, setSortState] = useState('mtime_desc');
  const [heartOnly, setHeartOnly] = useState(false);  // 收藏图片
  const [untagged, setUntagged] = useState(false);    // 无标签
  const [rejectedOnly, setRejectedOnly] = useState(false); // 只看废标
  const [ageMax, setAgeMax] = useState(null);         // 分级阈值
  const [nameLike, setNameLike] = useState('');
  const [tagFilter, setTagFilter] = useState(null);   // {id,name}
  const [tagList, setTagList] = useState([]);
  const [selection, setSelection] = useState(new Set());
  const [occlusion, setOcclusion] = useState({ mode: 'mask', threshold: 2, strength: 100 });
  const [sidebar, setSidebar] = useState({ width: 208, collapsed: false });
  /** 上次瀑布流的滚动位置与已加载数量（启动时据此续上） */
  const [restore, setRestore] = useState(null);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [revealed, setRevealed] = useState(new Set());
  const [tagging, setTagging] = useState(null);
  const [status, setStatus] = useState('');
  const [version, setVersion] = useState(0);
  const [maximized, setMaximized] = useState(false);

  const stateRef = useRef({});
  stateRef.current = {
    libraryId, folder, cursor, loading, hasMore, sort,
    heartOnly, untagged, rejectedOnly, ageMax, nameLike, tagFilter,
    columns, items,
  };

  const say = useCallback((text) => {
    setStatus(text);
    if (text) setTimeout(() => setStatus((s) => (s === text ? '' : s)), 3200);
  }, []);

  /* 瀑布流视图状态（列数/筛选/滚动位置）→ settings.view，防抖写盘 */
  const viewBootedRef = useRef(false);
  const viewTimerRef = useRef(null);
  const scrollTopRef = useRef(0);
  const persistView = useCallback(() => {
    if (!viewBootedRef.current) return;
    clearTimeout(viewTimerRef.current);
    viewTimerRef.current = setTimeout(() => {
      const s = stateRef.current;
      window.yizi.settings.set({
        key: 'view',
        value: {
          columns: s.columns,
          heartOnly: s.heartOnly,
          untagged: s.untagged,
          rejectedOnly: s.rejectedOnly,
          ageMax: s.ageMax,
          nameLike: s.nameLike,
          itemCount: (s.items || []).length,
          scrollTop: Math.round(scrollTopRef.current || 0),
        },
      });
    }, 500);
  }, []);

  /** 滚动位置只记数，不进 React 状态，免得每滚一下重渲染整栅格 */
  const rememberScroll = useCallback((top) => {
    scrollTopRef.current = top;
    persistView();
  }, [persistView]);

  /** 改排序：立刻重排列表，并记住到 settings */
  const setSort = useCallback((value) => {
    setSortState(value);
    window.yizi.settings.set({ key: 'sort', value });
  }, []);

  /** 改单个快捷键并持久化 */
  const setShortcut = useCallback((id, combo) => {
    setShortcuts((prev) => {
      const next = { ...prev, [id]: combo };
      window.yizi.settings.set({ key: 'shortcuts', value: next });
      return next;
    });
  }, []);

  /** 全部恢复默认 */
  const resetShortcuts = useCallback(() => {
    setShortcuts(DEFAULT_SHORTCUTS);
    window.yizi.settings.set({ key: 'shortcuts', value: DEFAULT_SHORTCUTS });
  }, []);

  const run = useCallback(async (promise, action) => {
    const res = await promise;
    if (!res || !res.ok) {
      say(`${action}失败: ${(res && res.error) || '未知错误'}`);
      return null;
    }
    return res.data;
  }, [say]);

  /* 主题恢复 + 窗口状态 + 排序恢复 */
  useEffect(() => {
    window.yizi.settings.get({ key: 'theme' }).then((r) => {
      if (r.ok && r.data) document.documentElement.setAttribute('data-theme', r.data);
    });
    window.yizi.settings.get({ key: 'sort' }).then((r) => {
      if (r.ok && r.data) setSortState(r.data);
    });
    window.yizi.settings.get({ key: 'shortcuts' }).then((r) => {
      if (r.ok && r.data && typeof r.data === 'object') setShortcuts({ ...DEFAULT_SHORTCUTS, ...r.data });
    });
    window.yizi.settings.get({ key: 'occlusion' }).then((r) => {
      if (r.ok && r.data && typeof r.data === 'object') {
        setOcclusion((prev) => ({ ...prev, ...r.data }));
      }
    });
    window.yizi.settings.get({ key: 'sidebar' }).then((r) => {
      if (r.ok && r.data && typeof r.data === 'object') {
        setSidebar((prev) => ({ ...prev, ...r.data }));
      }
    });
    window.yizi.window.state().then((r) => r.ok && setMaximized(r.data.maximized));
    /* 瀑布流上次状态：列数 + 筛选 + 加载深度 + 滚动位置 */
    window.yizi.settings.get({ key: 'view' }).then((r) => {
      const v = r.ok && r.data && typeof r.data === 'object' ? r.data : null;
      if (v) {
        if (Number(v.columns) >= 1 && Number(v.columns) <= 30) setColumns(Number(v.columns));
        setHeartOnly(!!v.heartOnly);
        setUntagged(!!v.untagged);
        setRejectedOnly(!!v.rejectedOnly);
        setAgeMax(v.ageMax ?? null);
        setNameLike(typeof v.nameLike === 'string' ? v.nameLike : '');
        scrollTopRef.current = Number(v.scrollTop) || 0;
        setRestore({
          itemCount: Math.min(1000, Number(v.itemCount) || 0),
          scrollTop: Number(v.scrollTop) || 0,
        });
      }
      viewBootedRef.current = true;
    });
    return window.yizi.on('window:maximized', (v) => setMaximized(Boolean(v)));
  }, []);

  /* 列数 / 筛选 / 已加载数量变化 → 记住 */
  useEffect(() => {
    persistView();
  }, [columns, heartOnly, untagged, rejectedOnly, ageMax, nameLike, items.length, persistView]);

  /* 初始库列表 */
  useEffect(() => {
    window.yizi.library.list().then((res) => {
      if (res.ok && res.data.length > 0) {
        setLibraries(res.data);
        setLibraryId((cur) => cur ?? res.data[0].id);
      }
    });
  }, []);

  /* 切库 → 目录树 + 标签栏 */
  useEffect(() => {
    if (libraryId == null) return;
    window.yizi.browse.folders({ libraryId }).then((res) => {
      if (res.ok) setFolders(res.data);
    });
    window.yizi.tag.top({ libraryId, limit: 40 }).then((res) => {
      if (res.ok) setTagList(res.data);
    });
    setFolder('');
    setTagFilter(null);
    setUntagged(false);
  }, [libraryId, version]);

  /* 任一筛选变化 → 重置分页 */
  useEffect(() => {
    if (libraryId == null) return;
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setSelection(new Set());
  }, [libraryId, folder, sort, heartOnly, untagged, rejectedOnly, ageMax, nameLike, tagFilter, version]);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.loading || !s.hasMore || s.libraryId == null) return;
    setLoading(true);
    try {
      const res = await window.yizi.browse.page({
        libraryId: s.libraryId,
        cursor: s.cursor,
        limit: 60,
        sort: s.sort,
        filters: {
          folder: s.folder || null,
          heartMin: s.heartOnly ? 1 : null,
          untaggedOnly: s.untagged,
          rejectedOnly: s.rejectedOnly,
          ageMax: s.ageMax,
          nameLike: s.nameLike || '',
          tagId: s.tagFilter ? s.tagFilter.id : null,
        },
      });
      if (!res.ok) {
        say(res.error);
        setHasMore(false);
        return;
      }
      const { items: page, nextCursor, hasMore: more } = res.data;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return prev.concat(page.filter((i) => !seen.has(i.id)));
      });
      setCursor(nextCursor);
      setHasMore(more);
    } finally {
      setLoading(false);
    }
  }, [say]);

  useEffect(() => {
    if (hasMore && items.length === 0) loadMore();
  }, [hasMore, items.length, loadMore]);

  /* 主进程事件 */
  useEffect(() => {
    const offProgress = window.yizi.on('scan:progress', (p) => setScanProgress(p));
    // 扫描/标记等后台变更不再强制刷新列表：排序只在用户主动改排序/切目录时才变
    const offChanged = window.yizi.on('browse:changed', () => { /* 保持列表稳定 */ });
    const offTag = window.yizi.on('tag:progress', (p) => {
      if (p && p.finished) return;
      setTagging(p);
    });
    return () => {
      offProgress();
      offChanged();
      offTag();
    };
  }, []);

  const actions = useMemo(() => ({
    /** 添加文件夹：系统目录选择框 → 注册（同路径幂等）→ 自动扫描 */
    async addFolder() {
      const data = await run(window.yizi.library.pick(), '添加文件夹');
      if (!data || data.canceled || !data.libraries || data.libraries.length === 0) return;
      setLibraries((prev) => {
        const map = new Map(prev.map((l) => [l.id, l]));
        for (const lib of data.libraries) map.set(lib.id, lib);
        return [...map.values()];
      });
      const target = data.libraries[data.libraries.length - 1];
      setLibraryId(target.id);
      say(`已添加「${target.name}」，开始扫描…`);
      setScanning(true);
      const summary = await run(window.yizi.scan.run({ libraryId: target.id }), '扫描');
      setScanning(false);
      setScanProgress(null);
      if (summary) {
        say(`扫描完成：${summary.total} 张（新增 ${summary.inserted}，${(summary.elapsedMs / 1000).toFixed(1)}s）`);
      }
    },
    async scanCurrent() {
      if (libraryId == null) return;
      setScanning(true);
      const summary = await run(window.yizi.scan.run({ libraryId }), '扫描');
      setScanning(false);
      setScanProgress(null);
      if (summary) {
        say(`扫描完成：${summary.total} 张，新增 ${summary.inserted}，耗时 ${(summary.elapsedMs / 1000).toFixed(1)}s`);
      }
    },
    /** 显式刷新列表（唯一会重新排序的入口，除改排序/切目录外） */
    refresh() {
      setVersion((v) => v + 1);
    },
    async removeLibrary(id) {
      await run(window.yizi.library.remove({ id }), '移除图库');
      setLibraries((prev) => prev.filter((l) => l.id !== id));
      setLibraryId((cur) => (cur === id ? null : cur));
    },
    async setMarks(ids, patch) {
      const res = await run(window.yizi.image.marks({ ids, ...patch }), '标记');
      if (res) {
        setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, ...patch } : it)));
        // 任何标记都不重排列表（用户硬要求：只有主动改排序才变）
      }
    },
    async setAge(ids, level) {
      await run(window.yizi.image.age({ ids, level, source: 'manual' }), '分级');
      setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, ageLevel: level, ageSource: 'manual' } : it)));
      // 分级也不重排
    },
    async trash(ids) {
      const res = await run(window.yizi.delete.trash({ ids }), '删除');
      if (res) {
        const gone = new Set(ids);
        setItems((prev) => prev.filter((it) => !gone.has(it.id)));
        setSelection(new Set());
        say(`已移入回收站 ${res.trashed} 张${res.failed.length ? `，失败 ${res.failed.length}` : ''}`);
      }
    },
    toggleSelect(id, additive) {
      setSelection((prev) => {
        const next = additive ? new Set(prev) : new Set();
        if (additive && prev.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    selectRange(ids, additive) {
      setSelection((prev) => {
        const next = additive ? new Set(prev) : new Set();
        for (const id of ids) next.add(id);
        return next;
      });
    },
    clearSelection() {
      setSelection(new Set());
    },
    reveal(id) {
      setRevealed((prev) => new Set(prev).add(id));
    },
    /** 点已显示的遮挡图 → 恢复遮挡 */
    unreveal(id) {
      setRevealed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    async startTagging() {
      if (libraryId == null) return;
      setTagging({ done: 0, total: 0 });
      const r = await run(window.yizi.tag.run({ libraryId }), '打标');
      setTagging(null);
      if (r) {
        const failed = r.failed ? `，${r.failed} 张失败${r.firstError ? `（${r.firstError}）` : ''}` : '';
        say(r.cancelled ? `打标中断 ${r.done}/${r.total}（可续跑）` : `打标完成：${r.tagged} 张${failed}`);
      }
    },
    async stopTagging() {
      await run(window.yizi.tag.stop(), '停止打标');
    },
  }), [libraryId, run, say]);

  const value = useMemo(() => ({
    libraries, libraryId, folders, folder, folderSearch, items, hasMore, loading,
    scanning, scanProgress, columns, sort, heartOnly, untagged, rejectedOnly, ageMax, nameLike,
    tagFilter, tagList, selection, occlusion, sidebar, revealed, tagging, status, version, maximized,
    setLibraryId, setFolder, setFolderSearch, setColumns, setSort,
    shortcuts, setShortcut, resetShortcuts,
    setHeartOnly, setUntagged, setRejectedOnly, setAgeMax, setNameLike, setTagFilter, setSelection,
    setOcclusionWithReset: (next) => {
      setRevealed(new Set());
      setOcclusion(next);
      window.yizi.settings.set({ key: 'occlusion', value: next });
    },
    setSidebar,
    saveSidebar: (next) => window.yizi.settings.set({ key: 'sidebar', value: next }),
    restore, rememberScroll,
    loadMore, actions, say,
  }), [libraries, libraryId, folders, folder, folderSearch, items, hasMore, loading,
    scanning, scanProgress, columns, sort, heartOnly, untagged, rejectedOnly, ageMax, nameLike,
    tagFilter, tagList, selection, occlusion, sidebar, shortcuts, restore, revealed, tagging, status, version, maximized,
    rememberScroll,
    loadMore, actions, say]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}
