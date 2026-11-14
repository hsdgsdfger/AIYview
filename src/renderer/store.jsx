import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 全局状态：库 / 目录 / 分页 / 选中 / 视图 / 筛选。
 * 数据纪律：渲染层永不持有全量数组，一切靠游标分页增量追加。
 */
const StoreContext = createContext(null);

const VIEW_DEFAULTS = { mode: 'grid', gridSize: 180 };

export function StoreProvider({ children }) {
  const [libraries, setLibraries] = useState([]);
  const [libraryId, setLibraryId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(null);
  const [view, setView] = useState(VIEW_DEFAULTS);
  const [selection, setSelection] = useState(new Set());
  const [filters, setFilters] = useState({ heartMin: null, rejectedOnly: false, hideRejected: true, ageMax: null, nameLike: '' });
  const [sort, setSort] = useState('mtime');
  const [status, setStatus] = useState('');
  const [version, setVersion] = useState(0); // browse:changed 触发重载
  const [occlusion, setOcclusion] = useState({ mode: 'mask', threshold: 2 }); // M3 三态遮挡
  const [revealed, setRevealed] = useState(new Set()); // C3 单图解除（会话内）
  const [tagging, setTagging] = useState(null); // M4 {done,total,tagged}
  const [tagFilter, setTagFilter] = useState(null); // {id, name}

  const stateRef = useRef({});
  stateRef.current = { libraryId, folder, cursor, filters, sort, loading, hasMore };

  const say = useCallback((text) => {
    setStatus(text);
    if (text) setTimeout(() => setStatus((s) => (s === text ? '' : s)), 3000);
  }, []);

  const run = useCallback(async (promise, action) => {
    const res = await promise;
    if (!res.ok) {
      say(`${action}失败: ${res.error}`);
      return null;
    }
    return res.data;
  }, [say]);

  /* 启动恢复主题 */
  useEffect(() => {
    window.yizi.settings.get({ key: 'theme' }).then((r) => {
      if (r.ok && r.data) document.documentElement.setAttribute('data-theme', r.data);
    });
  }, []);

  /* 初始加载库列表 */
  useEffect(() => {
    window.yizi.library.list().then((res) => {
      if (res.ok && res.data.length > 0) {
        setLibraries(res.data);
        setLibraryId((cur) => cur ?? res.data[0].id);
      }
    });
  }, []);

  /* 切库 → 目录树 */
  useEffect(() => {
    if (libraryId == null) return;
    window.yizi.browse.folders({ libraryId }).then((res) => {
      if (res.ok) setFolders(res.data);
    });
    setFolder('');
  }, [libraryId, version]);

  /* 目录/筛选/排序变化 → 重置分页 */
  useEffect(() => {
    if (libraryId == null) return;
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setSelection(new Set());
  }, [libraryId, folder, filters, sort, version]);

  /* 首屏 + 续页 */
  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.loading || !s.hasMore || s.libraryId == null) return;
    setLoading(true);
    try {
      const res = await window.yizi.browse.page({
        libraryId: s.libraryId,
        cursor: s.cursor,
        limit: 500,
        sort: s.sort,
        filters: { ...s.filters, folder: s.folder || null, tagId: s.tagFilter ? s.tagFilter.id : null },
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

  /* 首屏触发 */
  useEffect(() => {
    if (hasMore && items.length === 0) loadMore();
  }, [hasMore, items.length, loadMore]);

  /* 主进程事件 */
  useEffect(() => {
    const offProgress = window.yizi.on('scan:progress', (p) => setScanProgress(p));
    const offChanged = window.yizi.on('browse:changed', () => setVersion((v) => v + 1));
    const offTag = window.yizi.on('tag:progress', (p) => {
      if (!p || p.finished) {
        setTagging((cur) => (p && p.finished && p.cancelled ? { ...p, cancelled: true } : cur));
        return;
      }
      setTagging(p);
    });
    return () => {
      offProgress();
      offChanged();
      offTag();
    };
  }, []);

  const actions = useMemo(() => ({
    async registerLibrary(name, rootPath) {
      const lib = await run(window.yizi.library.register({ name, rootPath }), '注册图库');
      if (lib) {
        setLibraries((prev) => (prev.some((l) => l.id === lib.id) ? prev : prev.concat(lib)));
        setLibraryId(lib.id);
        say(`图库已注册: ${lib.name}`);
      }
    },
    async removeLibrary(id) {
      await run(window.yizi.library.remove({ id }), '移除图库');
      setLibraries((prev) => prev.filter((l) => l.id !== id));
      setLibraryId((cur) => (cur === id ? null : cur));
    },
    async scan() {
      if (libraryId == null) return;
      setScanning(true);
      const summary = await run(window.yizi.scan.run({ libraryId }), '扫描');
      setScanning(false);
      setScanProgress(null);
      if (summary) say(`扫描完成: ${summary.total} 张，新增 ${summary.inserted}，耗时 ${(summary.elapsedMs / 1000).toFixed(1)}s`);
    },
    async setMarks(ids, patch) {
      const res = await run(window.yizi.image.marks({ ids, ...patch }), '标记');
      if (res) {
        setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, ...patch } : it)));
        setVersion((v) => v + 1); // 让筛选即时生效
      }
    },
    async setAge(ids, level) {
      await run(window.yizi.image.age({ ids, level, source: 'manual' }), '分级');
      setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, ageLevel: level, ageSource: 'manual' } : it)));
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
      setRevealed((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    conceal(id) {
      setRevealed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    async startTagging() {
      if (libraryId == null) return;
      setTagging({ done: 0, total: 0, tagged: 0 });
      const r = await run(window.yizi.tag.run({ libraryId }), '打标');
      setTagging(null);
      if (r) say(r.cancelled ? `打标已中断：${r.done}/${r.total}，新打标 ${r.tagged} 张（可续跑）` : `打标完成：${r.tagged} 张`);
      setVersion((v) => v + 1);
    },
    async stopTagging() {
      await run(window.yizi.tag.stop(), '停止打标');
    },
    async importDictionary() {
      const r = await run(window.yizi.tag['import-dictionary']({}), '导入标签字典');
      if (r) say(`字典导入：新增 ${r.inserted}，更新 ${r.updated}`);
    },
  }), [libraryId, run, say]);

  const value = useMemo(() => ({
    libraries, libraryId, folders, folder, items, cursor, hasMore, loading,
    scanning, scanProgress, view, selection, filters, sort, status, version,
    occlusion, revealed, tagging, tagFilter,
    setLibraryId, setFolder, setView, setFilters, setSort, setOcclusion, setTagFilter,
    loadMore, actions, say,
  }), [libraries, libraryId, folders, folder, items, cursor, hasMore, loading,
    scanning, scanProgress, view, selection, filters, sort, status, version,
    occlusion, revealed, tagging, tagFilter, loadMore, actions, say]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}
