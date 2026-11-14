import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import Thumb from './Thumb.jsx';
import { setSizePref } from '../thumbBus.js';

/**
 * 主视图：虚拟化网格 / 瀑布流（同一套窗口化渲染，瀑布流只是可变行高）。
 * Ctrl+滚轮调缩略图尺寸；滚到底部自动续页；滚动翻页目标 ≤120ms。
 */
export default function ImageArea({ onOpenViewer }) {
  const { items, view, setView, hasMore, loading, loadMore, selection, actions, libraryId, folder } = useStore();
  const scrollRef = useRef(null);
  const [width, setWidth] = useState(1200);
  const lastIdxRef = useRef(-1);

  const cols = Math.max(2, Math.floor((width - 8) / (view.gridSize + 8)));
  const cell = Math.floor((width - 8) / cols) - 8;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setSizePref(view.gridSize > 260 ? 'md' : 'sm');
  }, [view.gridSize]);

  /* 行切分：固定列数顺序切，行高按行内最大项 */
  const rows = useMemo(() => {
    const out = [];
    for (let i = 0; i < items.length; i += cols) {
      out.push(items.slice(i, i + cols));
    }
    return out;
  }, [items, cols]);

  /* 窗口化：只渲染可视 ±6 行 */
  const [range, setRange] = useState({ start: 0, end: 40 });
  const rowEstimate = view.mode === 'grid' ? cell + 26 : cell * 1.1 + 26;

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const viewport = el.clientHeight;
    const start = Math.max(0, Math.floor(top / rowEstimate) - 6);
    const end = Math.min(rows.length, Math.ceil((top + viewport) / rowEstimate) + 6);
    setRange({ start, end });
  }, [rows.length, rowEstimate]);

  useEffect(() => {
    recompute();
  }, [recompute, view.mode, view.gridSize]);

  const onScroll = useCallback(() => {
    recompute();
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) loadMore();
  }, [recompute, loadMore]);

  const onWheel = useCallback((e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -20 : 20;
    const next = Math.min(420, Math.max(120, view.gridSize + delta));
    setView({ ...view, gridSize: next });
  }, [view, setView]);

  const clickItem = useCallback((item, e) => {
    if (e.shiftKey && lastIdxRef.current >= 0) {
      // 区间选择：按当前列表顺序
      const lastPos = items.findIndex((it) => it.id === lastIdxRef.current);
      const curPos = items.findIndex((it) => it.id === item.id);
      if (lastPos >= 0 && curPos >= 0) {
        const [lo, hi] = lastPos < curPos ? [lastPos, curPos] : [curPos, lastPos];
        actions.selectRange(items.slice(lo, hi + 1).map((it) => it.id), true);
        return;
      }
    }
    actions.toggleSelect(item.id, e.ctrlKey || e.metaKey);
    lastIdxRef.current = item.id;
  }, [items, actions]);

  const padTop = range.start * rowEstimate;
  const padBottom = Math.max(0, (rows.length - range.end) * rowEstimate);
  const visibleRows = rows.slice(range.start, range.end);

  if (libraryId == null) {
    return (
      <div className="empty-hint">
        <p>还没有图库。左侧注册一个目录（如 D:\\ImageTags\\output），然后点「扫描」。</p>
      </div>
    );
  }

  return (
    <div className="image-area" ref={scrollRef} onScroll={onScroll} onWheel={onWheel}>
      <div style={{ height: padTop }} />
      <div className={view.mode === 'grid' ? 'grid' : 'waterfall'}>
        {visibleRows.map((row, ri) => (
          <div className="row" key={row[0] ? `${row[0].id}` : ri}>
            {row.map((item) => (
              <Thumb
                key={item.id}
                item={item}
                cellWidth={cell}
                selected={selection.has(item.id)}
                onClick={clickItem}
                onDouble={() => onOpenViewer(item)}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ height: padBottom }} />
      {loading && <div className="loading-hint">加载中…</div>}
      {!hasMore && items.length > 0 && <div className="loading-hint muted">到底了，共 {items.length} 张{folder ? '（当前目录）' : ''}</div>}
      {items.length === 0 && !loading && <div className="empty-hint">这里还没有图片。点「扫描」入库。</div>}
    </div>
  );
}
