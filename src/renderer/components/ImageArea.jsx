import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store.jsx';
import Thumb from './Thumb.jsx';
import Hearts from './Hearts.jsx';
import Icon from './Icon.jsx';
import { setSizePref, getSizePref, getBusStats } from '../thumbBus.js';

/**
 * 主视图：顶部操作条（选中批处理）+ 瀑布流。
 * 瀑布流用 JS 分列（按预估高度分给最矮列），Ctrl+滚轮缩放列数。
 */
export default function ImageArea({ onOpenViewer }) {
  const {
    items, columns, setColumns, hasMore, loading, loadMore, selection, actions,
    libraryId, libraries, folder, scanning, scanProgress,
  } = useStore();
  const scrollRef = useRef(null);
  const lastIdxRef = useRef(-1);

  /* Ctrl + 滚轮 = 缩放瀑布流列数（原生监听才能可靠 preventDefault） */
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const setColumnsRef = useRef(setColumns);
  setColumnsRef.current = setColumns;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = Math.min(8, Math.max(1, columnsRef.current + (e.deltaY > 0 ? 1 : -1)));
      if (next !== columnsRef.current) {
        columnsRef.current = next;
        setColumnsRef.current(next);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [libraryId]);

  /* 按「每格实际像素」选缩略图档位：高清屏/大格子用 1024，否则 600（与原版一致） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const pick = () => {
      const cell = (el.clientWidth - 16) / Math.max(1, columns);
      setSizePref(cell > 780 ? 'md' : 'sm');
    };
    pick();
    const ro = new ResizeObserver(pick);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 800) loadMore();
  }, [loadMore]);

  const clickItem = useCallback((item, e) => {
    if (e.shiftKey && lastIdxRef.current >= 0) {
      const a = items.findIndex((it) => it.id === lastIdxRef.current);
      const b = items.findIndex((it) => it.id === item.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        actions.selectRange(items.slice(lo, hi + 1).map((it) => it.id), true);
        return;
      }
    }
    actions.toggleSelect(item.id, e.ctrlKey || e.metaKey);
    lastIdxRef.current = item.id;
  }, [items, actions]);

  const library = libraries.find((l) => l.id === libraryId) || null;

  // 排障快照（--shot 时主进程会读取）
  if (typeof window !== 'undefined') {
    window.__yiziDebug = {
      items: items.length,
      hasMore,
      loading,
      libraryId,
      columns,
      selected: selection.size,
      pick: typeof window.yizi.library.pick,
      pref: getSizePref(),
      bus: getBusStats(),
      cellPx: Math.round(((document.querySelector(".canvas") || {}).clientWidth || 0) / Math.max(1, columns)),
    };
  }

  /* 真瀑布流：按预估高度把图分给当前最矮的一列 */
  const buckets = useMemo(() => {
    const cols = Array.from({ length: columns }, () => ({ items: [], h: 0 }));
    for (const item of items) {
      const aspect = item.width && item.height ? item.width / item.height : 0.72;
      const target = cols.reduce((min, cur) => (cur.h < min.h ? cur : min), cols[0]);
      target.items.push(item);
      target.h += 1 / Math.min(Math.max(aspect, 0.45), 2.4);
    }
    return cols;
  }, [items, columns]);

  const selectedIds = useMemo(() => [...selection], [selection]);

  /* 全部选中项都已标废 → 按钮变成「取消废」 */
  const allRejected = useMemo(() => {
    if (selectedIds.length === 0) return false;
    const map = new Map(items.map((it) => [it.id, it]));
    return selectedIds.every((id) => {
      const it = map.get(id);
      return it && it.rejected === 1;
    });
  }, [selectedIds, items]);

  /* Alt+1~5 → 分级 L0~L4（有选中才生效） */
  const hotRef = useRef({ ids: [], setAge: null });
  hotRef.current = { ids: selectedIds, setAge: actions.setAge };
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 5) return;
      const { ids, setAge } = hotRef.current;
      if (!ids.length) return;
      e.preventDefault();
      setAge(ids, n - 1); // 1→L0, 5→L4
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (libraryId == null) {
    return (
      <section className="content">
        <div className="empty-hint">
          <Icon name="folder-plus" size={34} />
          <p>还没有图库。点左上「添加文件夹」选一个目录（如 D:\ImageTags\output），会自动扫描入库。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="content">
      <div className="actionbar">
        {selectedIds.length === 0 ? (
          <span className="ab-muted">未选择</span>
        ) : (
          <>
            <span className="ab-count">已选 {selectedIds.length} 张</span>

            <Hearts
              value={0}
              className="ab-hearts"
              onChange={(n) => actions.setMarks(selectedIds, { heart: n })}
            />

            <button
              className={`ab-btn ${allRejected ? 'warn' : ''}`}
              title="点一下标废，再点一下取消废"
              onClick={() => actions.setMarks(selectedIds, { rejected: allRejected ? 0 : 1 })}
            >{allRejected ? '取消废' : '标废'}</button>

            <span className="ab-group">
              <span className="ab-label" title="Alt+1~5 快捷分级">分级</span>
              {[0, 1, 2, 3, 4].map((lv) => (
                <button
                  key={lv}
                  className="ab-btn tiny"
                  title={`Alt+${lv + 1}`}
                  onClick={() => actions.setAge(selectedIds, lv)}
                >L{lv}</button>
              ))}
              <button className="ab-btn tiny" onClick={() => actions.setAge(selectedIds, null)}>清除</button>
            </span>

            <button
              className="ab-btn danger"
              onClick={() => {
                if (confirm(`把 ${selectedIds.length} 张移入系统回收站？12 小时内可撤回。`)) {
                  actions.trash(selectedIds);
                }
              }}
            ><Icon name="trash" size={13} /> 删除</button>

            <button className="ab-btn" onClick={() => actions.clearSelection()}>取消</button>
          </>
        )}

        <span className="ab-right">
          {scanning && scanProgress && (
            <span className="ab-scan">
              {scanProgress.phase === 'walk' ? '扫描目录…' : `入库 ${scanProgress.done}/${scanProgress.total}`}
            </span>
          )}
          <span className="ab-sort" title={library ? library.root_path : ''}>
            {folder ? folder.split('/').pop() : (library ? library.name : '')}
          </span>
          <button className="icon-btn" title="刷新列表" onClick={() => actions.refresh()}>
            <Icon name="refresh" size={14} />
          </button>
        </span>
      </div>

      <div className="canvas" ref={scrollRef} onScroll={onScroll}>
        <div className="cols">
          {buckets.map((bucket, i) => (
            <div className="col" key={i}>
              {bucket.items.map((item) => (
                <Thumb
                  key={item.id}
                  item={item}
                  selected={selection.has(item.id)}
                  onClick={clickItem}
                  onDouble={() => onOpenViewer(item)}
                />
              ))}
            </div>
          ))}
        </div>

        {loading && <div className="feed-hint">加载中…</div>}
        {!hasMore && items.length > 0 && <div className="feed-hint">共 {items.length} 张</div>}
        {items.length === 0 && !loading && (
          <div className="empty-hint"><p>这里还没有图片，点右上 ⟳ 重新扫描。</p></div>
        )}
      </div>
    </section>
  );
}
