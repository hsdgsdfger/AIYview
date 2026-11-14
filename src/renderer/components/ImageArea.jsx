import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.jsx';
import Thumb from './Thumb.jsx';
import Hearts from './Hearts.jsx';
import Icon from './Icon.jsx';
import { setSizePref } from '../thumbBus.js';
import { actionForCombo, comboOf, isTypingTarget } from '../shortcuts.js';

/**
 * 主视图：顶部操作条（选中批处理）+ 瀑布流。
 * 瀑布流 JS 分列；Ctrl+滚轮 1~30 列；遮挡控制收进符号按钮的二级菜单。
 */
export default function ImageArea({ onOpenViewer }) {
  const {
    items, columns, setColumns, hasMore, loading, loadMore, selection, actions,
    libraryId, scanning, scanProgress, occlusion, setOcclusionWithReset, shortcuts,
  } = useStore();
  const scrollRef = useRef(null);
  const lastIdxRef = useRef(-1);
  const [heartVal, setHeartVal] = useState(0); // 本次选中后点击的心数（红心显示用）

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
      const next = Math.min(30, Math.max(1, columnsRef.current + (e.deltaY > 0 ? 1 : -1)));
      if (next !== columnsRef.current) {
        columnsRef.current = next;
        setColumnsRef.current(next);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [libraryId]);

  /* 按每格实际像素选缩略图档位：小格用 220 省内存，大格用 1024 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const pick = () => {
      const cell = (el.clientWidth - 16) / Math.max(1, columns);
      setSizePref(cell < 150 ? 'xs' : cell > 780 ? 'md' : 'sm');
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
  useEffect(() => { setHeartVal(0); }, [selectedIds]);

  const allRejected = useMemo(() => {
    if (selectedIds.length === 0) return false;
    const map = new Map(items.map((it) => [it.id, it]));
    return selectedIds.every((id) => {
      const it = map.get(id);
      return it && it.rejected === 1;
    });
  }, [selectedIds, items]);

  /* 全局快捷键：打分 / 评级 / 标废 / 删除（键位来自设置，有选中才生效；查看器打开时归查看器处理） */
  const hotRef = useRef({});
  hotRef.current = { ids: selectedIds, items, shortcuts, actions };
  useEffect(() => {
    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('.viewer')) return;
      const combo = comboOf(e);
      if (!combo) return;
      const { ids, items: rows, shortcuts: keys, actions: act } = hotRef.current;
      if (!ids || ids.length === 0) return;
      const action = actionForCombo(keys, combo);
      if (!action) return;

      if (action.startsWith('heart')) {
        e.preventDefault();
        act.setMarks(ids, { heart: Number(action.slice(5)) });
        return;
      }
      if (action.startsWith('age')) {
        e.preventDefault();
        act.setAge(ids, Number(action.slice(3)));
        return;
      }
      if (action === 'rejected') {
        e.preventDefault();
        const map = new Map(rows.map((r) => [r.id, r]));
        const allRejected = ids.every((id) => map.get(id) && map.get(id).rejected === 1);
        act.setMarks(ids, { rejected: allRejected ? 0 : 1 });
        return;
      }
      if (action === 'trash') {
        e.preventDefault();
        act.trash(ids);
      }
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
      <div className={`actionbar ${selectedIds.length === 0 ? 'no-sel' : ''}`}>
        {/* 常驻操作条：无选中时整排置灰，遮挡符号仍然可用 */}
        <span className={`ab-disabled-wrap`}>
          <Hearts
            value={heartVal}
            className="ab-hearts"
            onChange={(n) => {
              if (!selectedIds.length) return;
              setHeartVal(n);
              actions.setMarks(selectedIds, { heart: n });
            }}
          />

          <button
            className={`ab-btn ${allRejected ? 'warn' : ''}`}
            title="点一下标废，再点一下取消废"
            onClick={() => selectedIds.length && actions.setMarks(selectedIds, { rejected: allRejected ? 0 : 1 })}
          >{allRejected ? '取消废' : '标废'}</button>

          <span className="ab-group">
            <span className="ab-label" title="Alt+1~5 快捷分级">分级</span>
            {[0, 1, 2, 3, 4].map((lv) => (
              <button
                key={lv}
                className="ab-btn tiny"
                title={`Alt+${lv + 1}`}
                onClick={() => selectedIds.length && actions.setAge(selectedIds, lv)}
              >L{lv}</button>
            ))}
            <button className="ab-btn tiny broom" title="清除分级（🧹）" onClick={() => selectedIds.length && actions.setAge(selectedIds, null)}>🧹</button>
          </span>

          <button
            className="ab-btn danger icon-only"
            title="删除（移入系统回收站，12h 可撤回）"
            onClick={() => {
              if (!selectedIds.length) return;
              if (confirm(`把 ${selectedIds.length} 张移入系统回收站？12 小时内可撤回。`)) {
                actions.trash(selectedIds);
              }
            }}
          ><Icon name="trash" size={13} /></button>
        </span>

        {/* 遮挡二级菜单符号（全局设置，无选中也可用） */}
        <OcclusionMenu occlusion={occlusion} setOcclusion={setOcclusionWithReset} />

        {selectedIds.length > 0 && <span className="ab-count">已选 {selectedIds.length} 张</span>}

        <span className="ab-right">
          {scanning && scanProgress && (
            <span className="ab-scan">
              {scanProgress.phase === 'walk' ? '扫描目录…' : `入库 ${scanProgress.done}/${scanProgress.total}`}
            </span>
          )}
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

/** 遮挡控制二级界面：三态 + 阈值 + 排序 + 取消选择（取代原「取消」按钮的位置） */
function OcclusionMenu({ occlusion, setOcclusion }) {
  const { actions, selection, sort, setSort } = useStore();
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);

  const toggle = () => {
    if (pos) {
      setPos(null);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };

  useEffect(() => {
    if (!pos) return undefined;
    const onDown = (e) => {
      if (e.target.closest && (e.target.closest('.occl-menu') || e.target.closest('.ab-occl'))) return;
      setPos(null);
    };
    const onKey = (e) => e.key === 'Escape' && setPos(null);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);

  const modeIcon = occlusion.mode === 'mask' ? 'mask' : occlusion.mode === 'blur' ? 'blur' : 'eye';

  return (
    <>
      <button
        ref={btnRef}
        className={`ab-btn ab-occl ${occlusion.threshold != null ? 'on' : ''}`}
        title="遮挡：方式 / 阈值 / 取消选择"
        onClick={toggle}
      >
        <Icon name={modeIcon} size={14} />
        <span className="caret">⌄</span>
      </button>

      {pos && createPortal(
        <div className="occl-menu" style={{ top: pos.top, right: pos.right }}>
          <div className="occl-row">
            <span className="occl-label">方式</span>
            {[
              ['mask', 'mask', '遮罩'],
              ['blur', 'blur', '模糊'],
              ['hidden', 'eye', '隐藏'],
            ].map(([mode, icon, text]) => (
              <button
                key={mode}
                className={`occl-opt ${occlusion.mode === mode ? 'on' : ''}`}
                onClick={() => setOcclusion({ ...occlusion, mode })}
              >
                <Icon name={icon} size={13} /> {text}
              </button>
            ))}
          </div>

          <div className="occl-row">
            <span className="occl-label">阈值</span>
            <button
              className={`occl-opt ${occlusion.threshold == null ? 'on' : ''}`}
              onClick={() => setOcclusion({ ...occlusion, threshold: null })}
            >不挡</button>
            {[1, 2, 3, 4].map((lv) => (
              <button
                key={lv}
                className={`occl-opt ${occlusion.threshold === lv ? 'on' : ''}`}
                onClick={() => setOcclusion({ ...occlusion, threshold: lv })}
              >L{lv}</button>
            ))}
          </div>

          <div className="settings-sep" />

          <div className="occl-row">
            <span className="occl-label">时间</span>
            <button
              className={`occl-opt ${sort === 'mtime_desc' ? 'on' : ''}`}
              onClick={() => setSort('mtime_desc')}
              title="修改时间从新到旧"
            >新→旧</button>
            <button
              className={`occl-opt ${sort === 'mtime_asc' ? 'on' : ''}`}
              onClick={() => setSort('mtime_asc')}
              title="修改时间从旧到新"
            >旧→新</button>
          </div>

          <div className="occl-row">
            <span className="occl-label">名称</span>
            <button
              className={`occl-opt ${sort === 'name_asc' ? 'on' : ''}`}
              onClick={() => setSort('name_asc')}
              title="按文件名 A→Z"
            >A→Z</button>
            <button
              className={`occl-opt ${sort === 'name_desc' ? 'on' : ''}`}
              onClick={() => setSort('name_desc')}
              title="按文件名 Z→A"
            >Z→A</button>
          </div>

          {selection.size > 0 && (
            <>
              <div className="settings-sep" />
              <button className="occl-item" onClick={() => { actions.clearSelection(); setPos(null); }}>
                取消选择（{selection.size}）
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
