import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import Thumb from './Thumb.jsx';
import Icon from './Icon.jsx';
import { setSizePref } from '../thumbBus.js';

/**
 * 主视图：路径条 + 瀑布流/网格。
 * 瀑布流用 CSS 多栏（视觉与原版一致）；分页每次 400 张，DOM 有上限。
 */
export default function ImageArea({ onOpenViewer }) {
  const {
    items, preset, columns, hasMore, loading, loadMore, selection, actions,
    libraryId, libraries, folder, sort, setSort, nameLike, setNameLike, scanning, scanProgress,
  } = useStore();
  const scrollRef = useRef(null);
  const lastIdxRef = useRef(-1);
  const [asc, setAsc] = useState(false);

  const library = libraries.find((l) => l.id === libraryId) || null;
  if (typeof window !== "undefined") window.__yiziDebug = { items: items.length, hasMore, loading, libraryId, preset, columns, pick: typeof window.yizi.library.pick };

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 800) loadMore();
  }, [loadMore]);

  /* 按「每格实际像素」选缩略图档位：高清屏/大格子用 1024，否则 600（与原版一致） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const pick = () => {
      const dpr = window.devicePixelRatio || 1;
      const cell = (el.clientWidth - 16) / Math.max(1, columns) * dpr;
      setSizePref(cell > 760 ? 'md' : 'sm');
    };
    pick();
    const ro = new ResizeObserver(pick);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns]);

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

  const pathLabel = useMemo(() => {
    if (!library) return '';
    const root = library.root_path.replace(/\//g, '\\');
    return folder ? `${root}\\${folder.replace(/\//g, '\\')}` : root;
  }, [library, folder]);

  /* 真瀑布流：按预估高度把图分给当前最矮的一列 */
  const buckets = useMemo(() => {
    const cols = Array.from({ length: columns }, () => ({ items: [], h: 0 }));
    for (const item of items) {
      const aspect = preset === 'grid'
        ? 1
        : (item.width && item.height ? item.width / item.height : 0.72);
      const target = cols.reduce((min, cur) => (cur.h < min.h ? cur : min), cols[0]);
      target.items.push(item);
      target.h += 1 / Math.min(Math.max(aspect, 0.45), 2.4);
    }
    return cols;
  }, [items, columns, preset]);

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
      <div className="pathbar">
        <button className="icon-btn" title="返回上一层" disabled>
          <Icon name="back" size={16} />
        </button>
        <Icon name="folder" size={15} className="path-ico" />
        <span className="path-text" title={pathLabel}>{pathLabel}</span>

        {scanning && scanProgress && (
          <span className="path-scan">
            {scanProgress.phase === 'walk' ? '扫描目录…' : `入库 ${scanProgress.done}/${scanProgress.total}`}
          </span>
        )}

        <span className="path-right">
          <input
            className="path-search"
            placeholder="文件名过滤…"
            value={nameLike}
            onChange={(e) => setNameLike(e.target.value)}
          />
          <button
            className="icon-btn"
            title={sort === 'name' ? '按名称' : '按时间'}
            onClick={() => setSort(sort === 'name' ? 'mtime' : 'name')}
          ><Icon name="sort" size={15} /></button>
          <span className="path-sort-label">{sort === 'name' ? 'A-Z' : '时间'}</span>
          <button
            className="icon-btn"
            title={asc ? '升序' : '降序'}
            onClick={() => setAsc((v) => !v)}
          >{asc ? '↑' : '↓'}</button>
        </span>
      </div>

      <div className={`canvas ${preset}`} ref={scrollRef} onScroll={onScroll}>
        <div className="cols">
          {buckets.map((bucket, i) => (
            <div className="col" key={i}>
              {bucket.items.map((item) => (
                <Thumb
                  key={item.id}
                  item={item}
                  uniform={preset === 'grid'}
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
