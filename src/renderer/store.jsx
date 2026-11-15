import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SHORTCUTS } from './shortcuts.js';
import { loadPrefs, viewPayload } from './prefs.js';
import { useActions } from './useActions.js';
import { filtersOf } from './filters.js';
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
  const [heartEq, setHeartEq] = useState(null);        // 收藏里精确心数（1–5，null=全部收藏）
  const [untagged, setUntagged] = useState(false);    // 无标签
  const [rejectedOnly, setRejectedOnly] = useState(false); // 只看废标
  const [ageMax, setAgeMax] = useState(null);         // 分级阈值
  const [ageOnly, setAgeOnly] = useState(null);       // 精确分级（L0–L4）
  const [nameLike, setNameLike] = useState('');
  const [tagFilter, setTagFilter] = useState(null);   // {id,name}
  const [collectionId, setCollectionId] = useState(null); // 虚拟收藏夹筛选
  const [collections, setCollections] = useState([]);
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
  /** 当前筛选下的真实总数（browse:count），用于「共 N 张」 */
  const [total, setTotal] = useState(0);
  /** 后台发现新图但没刷新列表时的提示数（不打断滚动） */
  const [pendingNew, setPendingNew] = useState(0);
  /** 悬停即编辑：鼠标停在缩略图上时，操作条和快捷键就作用于它（可在设置里关掉） */
  const [hoverEdit, setHoverEditState] = useState(true);
  /** 大图查看器右侧提示词栏宽度（设置里用滑块调） */
  const [promptWidth, setPromptWidthState] = useState(310);

  const stateRef = useRef({});
  stateRef.current = {
    libraryId, folder, cursor, loading, hasMore, sort,
    heartOnly, heartEq, untagged, rejectedOnly, ageMax, ageOnly, nameLike, tagFilter, collectionId,
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
      window.aiyview.settings.set({ key: 'view', value: viewPayload(stateRef.current, scrollTopRef.current) });
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
    window.aiyview.settings.set({ key: 'sort', value });
  }, []);

  /** 悬停即编辑：写盘并生效 */
  const setHoverEdit = useCallback((v) => {
    setHoverEditState(Boolean(v));
    window.aiyview.settings.set({ key: 'hoverEdit', value: Boolean(v) });
  }, []);

  /** 刷新前通知栅格「记住当前看的那张图」，ImageArea 据此补偿滚动，位置不动 */
  const autoTimerRef = useRef(null);
  const lastRefreshRef = useRef(0);
  const markRefresh = useCallback(() => {
    lastRefreshRef.current = Date.now();
    clearTimeout(autoTimerRef.current);
    window.dispatchEvent(new Event('aiyview:refresh-start'));
  }, []);

  /** 改单个快捷键并持久化 */
  const setShortcut = useCallback((id, combo) => {
    setShortcuts((prev) => {
      const next = { ...prev, [id]: combo };
      window.aiyview.settings.set({ key: 'shortcuts', value: next });
      return next;
    });
  }, []);

  /** 全部恢复默认 */
  const resetShortcuts = useCallback(() => {
    setShortcuts(DEFAULT_SHORTCUTS);
    window.aiyview.settings.set({ key: 'shortcuts', value: DEFAULT_SHORTCUTS });
  }, []);

  const run = useCallback(async (promise, action) => {
    const res = await promise;
    if (!res || !res.ok) {
      say(`${action}失败: ${(res && res.error) || '未知错误'}`);
      return null;
    }
    return res.data;
  }, [say]);

  /* 偏好恢复：主题 + 排序 + 快捷键 + 遮挡 + 侧栏 + 窗口状态 + 瀑布流上次状态 */
  useEffect(() => {
    loadPrefs().then((p) => {
      if (p.theme) document.documentElement.setAttribute('data-theme', p.theme);
      if (p.sort) setSortState(p.sort);
      if (p.shortcuts && typeof p.shortcuts === 'object') setShortcuts({ ...DEFAULT_SHORTCUTS, ...p.shortcuts });
      if (p.occlusion && typeof p.occlusion === 'object') setOcclusion((prev) => ({ ...prev, ...p.occlusion }));
      if (p.sidebar && typeof p.sidebar === 'object') setSidebar((prev) => ({ ...prev, ...p.sidebar }));
      if (p.win) setMaximized(Boolean(p.win.maximized));
      if (typeof p.hoverEdit === 'boolean') setHoverEditState(p.hoverEdit);
      if (Number(p.promptWidth) >= 240 && Number(p.promptWidth) <= 620) setPromptWidthState(Number(p.promptWidth));

      const v = p.view && typeof p.view === 'object' ? p.view : null;
      if (v) {
        if (Number(v.columns) >= 1 && Number(v.columns) <= 30) setColumns(Number(v.columns));
        setHeartOnly(!!v.heartOnly);
        setHeartEq(Number.isInteger(v.heartEq) && v.heartEq >= 1 && v.heartEq <= 5 ? v.heartEq : null);
        setUntagged(!!v.untagged);
        setRejectedOnly(!!v.rejectedOnly);
        setAgeMax(v.ageMax ?? null);
        setAgeOnly(Number.isInteger(v.ageOnly) ? v.ageOnly : null);
        setNameLike(typeof v.nameLike === 'string' ? v.nameLike : '');
        scrollTopRef.current = Number(v.scrollTop) || 0;
        setRestore({
          itemCount: Math.min(1000, Number(v.itemCount) || 0),
          scrollTop: Number(v.scrollTop) || 0,
        });
      }
      viewBootedRef.current = true;
    });
    return window.aiyview.on('window:maximized', (v) => setMaximized(Boolean(v)));
  }, []);

  /* 列数 / 筛选 / 已加载数量变化 → 记住 */
  useEffect(() => {
    persistView();
  }, [columns, heartOnly, heartEq, untagged, rejectedOnly, ageMax, ageOnly, nameLike, items.length, persistView]);

  /* 初始库列表 */
  useEffect(() => {
    window.aiyview.library.list().then((res) => {
      if (res.ok && res.data.length > 0) {
        setLibraries(res.data);
        setLibraryId((cur) => cur ?? res.data[0].id);
      }
    });
  }, []);

  /** 标签栏（打标/加删标签后要刷新，否则计数停在旧值） */
  const refreshTags = useCallback(async () => {
    const s = stateRef.current;
    if (s.libraryId == null) return;
    const res = await window.aiyview.tag.top({ libraryId: s.libraryId, limit: 40 });
    if (res.ok) setTagList(res.data);
  }, []);

  /** 虚拟收藏夹列表（切库/增删后刷新） */
  const refreshCollections = useCallback(async () => {
    const s = stateRef.current;
    if (s.libraryId == null) return;
    const res = await window.aiyview.collection.list({ libraryId: s.libraryId });
    if (res && res.ok) setCollections(res.data || []);
  }, []);

  /** 真实总数：browse:count，与列表同一套筛选口径 */
  const refreshCount = useCallback(async () => {
    const s = stateRef.current;
    if (s.libraryId == null) {
      setTotal(0);
      return;
    }
    const res = await window.aiyview.browse.count({ libraryId: s.libraryId, filters: filtersOf(s) });
    if (res && res.ok) setTotal(Number(res.data) || 0);
  }, [filtersOf]);

  /**
   * 刷新（默认按时间排序时）：只把第 1 页里的「新图」插到最前面，已有卡片原地不动。
   * 这样新图自己出现，滚动位置和当前看的那张都不会跳；其它排序才走整表重置。
   */
  const refreshList = useCallback(async () => {
    const s = stateRef.current;
    markRefresh();
    setPendingNew(0);
    if (s.libraryId == null) return;
    if (s.sort !== 'mtime_desc') {
      setVersion((v) => v + 1);
      return;
    }
    const res = await window.aiyview.browse.page({
      libraryId: s.libraryId, cursor: null, limit: 60, sort: s.sort, filters: filtersOf(s),
    });
    if (!res.ok) {
      setVersion((v) => v + 1);
      return;
    }
    const page = res.data.items;
    setItems((prev) => {
      const ids = new Set(prev.map((i) => i.id));
      const fresh = page.filter((i) => !ids.has(i.id));
      return fresh.length ? fresh.concat(prev) : prev;
    });
    refreshCount();
  }, [markRefresh, filtersOf, refreshCount]);

  /* 切库 → 目录树 + 标签栏；筛选复位 */
  useEffect(() => {
    if (libraryId == null) return;
    window.aiyview.browse.folders({ libraryId }).then((res) => {
      if (res.ok) setFolders(res.data);
    });
    refreshTags();
    refreshCollections();
    setFolder('');
    setTagFilter(null);
    setUntagged(false);
    setCollectionId(null);
  }, [libraryId, version, refreshTags, refreshCollections]);

  /* 任一筛选变化 → 重置分页 */
  useEffect(() => {
    if (libraryId == null) return;
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setSelection(new Set());
  }, [libraryId, folder, sort, heartOnly, heartEq, untagged, rejectedOnly, ageMax, ageOnly, nameLike, tagFilter, collectionId, version]);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.loading || !s.hasMore || s.libraryId == null) return;
    setLoading(true);
    try {
      const res = await window.aiyview.browse.page({
        libraryId: s.libraryId,
        cursor: s.cursor,
        limit: 60,
        sort: s.sort,
        filters: filtersOf(s),
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
  }, [say, filtersOf]);

  useEffect(() => {
    if (hasMore && items.length === 0) loadMore();
  }, [hasMore, items.length, loadMore]);

  /* 筛选变化 → 重新计数 */
  useEffect(() => {
    refreshCount();
  }, [libraryId, folder, sort, heartOnly, heartEq, untagged, rejectedOnly, ageMax, ageOnly, nameLike, tagFilter, collectionId, version, refreshCount]);

  /* 打标状态：重开窗口时若后台还在跑，进度条要接回来（tag:status 原先没人调） */
  useEffect(() => {
    window.aiyview.tag.status().then((r) => {
      if (r.ok && r.data && r.data.running) setTagging(r.data.progress || { done: 0, total: 0 });
    });
  }, []);

  /* 主进程事件 */
  useEffect(() => {
    const offProgress = window.aiyview.on('scan:progress', (p) => setScanProgress(p));
    // 后台扫描/改名发现新图：静默自动刷新（位置靠 ImageArea 锚定补偿），不打断浏览
    const offChanged = window.aiyview.on('browse:changed', (p) => {
      const reason = p && p.reason;
      if (reason !== 'scan' && reason !== 'watch' && reason !== 'rename') return;
      setPendingNew((n) => n + 1);
      refreshCount();
      // 自己刚刷新过就忽略这批变更，避免一次扫描触发两轮重载
      if (Date.now() - lastRefreshRef.current < 4000) return;
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(() => {
        refreshList();
      }, 1200);
    });
    // 打标/加删标签完成后刷新侧栏标签（原先没人订阅，计数一直是旧的）
    const offTags = window.aiyview.on('tags-updated', () => {
      refreshTags();
      refreshCount();
    });
    const offTag = window.aiyview.on('tag:progress', (p) => {
      if (p && p.finished) return;
      setTagging(p);
    });
    const offCollections = window.aiyview.on('collections-updated', () => {
      refreshCollections();
    });
    return () => {
      clearTimeout(autoTimerRef.current);
      offProgress();
      offChanged();
      offTags();
      offTag();
      offCollections();
    };
  }, [refreshCount, refreshTags, refreshCollections, markRefresh, refreshList]);

  const actions = useActions({
    libraryId, run, say, itemsRef: stateRef,
    setItems, setSelection, setLibraries, setLibraryId,
    setScanning, setScanProgress, setTagging, setRevealed,
    setPendingNew, setVersion, markRefresh, refreshList,
  });

  /* 启动自动刷新：打开软件就对当前库扫一遍，新图自己出现（滚动位置由栅格锚定） */
  const bootRef = useRef(new Set());
  useEffect(() => {
    if (libraryId == null || bootRef.current.has(libraryId)) return;
    bootRef.current.add(libraryId);
    window.aiyview.scan.run({ libraryId }).then((r) => {
      if (r && r.ok) actions.refresh();
    });
  }, [libraryId, actions]);

  const value = useMemo(() => ({
    libraries, libraryId, folders, folder, folderSearch, items, hasMore, loading,
    scanning, scanProgress, columns, sort, heartOnly, heartEq, untagged, rejectedOnly, ageMax, ageOnly, nameLike,
    tagFilter, tagList, collectionId, collections, selection, occlusion, sidebar, revealed, tagging, status, version, maximized,
    total, pendingNew, hoverEdit, setHoverEdit,
    promptWidth,
    setPromptWidth: (w) => {
      setPromptWidthState(w);
      window.aiyview.settings.set({ key: 'promptWidth', value: w });
    },
    setLibraryId, setFolder, setFolderSearch, setColumns, setSort,
    shortcuts, setShortcut, resetShortcuts,
    setHeartOnly, setHeartEq, setUntagged, setRejectedOnly, setAgeMax, setAgeOnly, setNameLike, setTagFilter, setSelection,
    setCollectionId, refreshCollections,
    refreshTags, refreshCount,
    setOcclusionWithReset: (next) => {
      setRevealed(new Set());
      setOcclusion(next);
      window.aiyview.settings.set({ key: 'occlusion', value: next });
    },
    setSidebar,
    saveSidebar: (next) => window.aiyview.settings.set({ key: 'sidebar', value: next }),
    restore, rememberScroll,
    loadMore, actions, say,
  }), [libraries, libraryId, folders, folder, folderSearch, items, hasMore, loading,
    scanning, scanProgress, columns, sort, heartOnly, heartEq, untagged, rejectedOnly, ageMax, ageOnly, nameLike,
    tagFilter, tagList, collectionId, collections, selection, occlusion, sidebar, shortcuts, restore, revealed, tagging, status, version, maximized,
    total, pendingNew, refreshTags, refreshCount, refreshCollections,
    hoverEdit, setHoverEdit,
    promptWidth,
    rememberScroll,
    loadMore, actions, say]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}
