import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import Thumb from './Thumb.jsx';
import Hearts from './Hearts.jsx';
import Icon from './Icon.jsx';
import OcclusionMenu from './OcclusionMenu.jsx';
import { setSizePref } from '../thumbBus.js';
import { useScrollAnchor } from '../useScrollAnchor.js';
import { actionForCombo, comboOf, isTypingTarget } from '../shortcuts.js';

/**
 * 主视图：顶部操作条（选中批处理）+ 瀑布流。
 * 瀑布流 JS 分列；Ctrl+滚轮 1~30 列；遮挡控制收进符号按钮的二级菜单。
 */
export default function ImageArea({ onOpenViewer }) {
  const {
    items, columns, setColumns, hasMore, loading, loadMore, selection, actions,
    libraryId, scanning, scanProgress, occlusion, setOcclusionWithReset, shortcuts,
    restore, rememberScroll, total, nameLike, setNameLike, hoverEdit,
  } = useStore();
  const scrollRef = useRef(null);
  const lastIdxRef = useRef(-1);
  const [heartVal, setHeartVal] = useState(0); // 本次选中后点击的心数（红心显示用）
  const [nameInput, setNameInput] = useState(nameLike || '');
  const [menu, setMenu] = useState(null);      // 右键菜单 { x, y, item }
  const [hoverId, setHoverId] = useState(null); // 悬停即编辑：当前鼠标下的那张
  const nameTimerRef = useRef(null);

  /* 文件名搜索：输入防抖 300ms 再落到筛选状态（每敲一个字都查库太浪费） */
  useEffect(() => {
    setNameInput(nameLike || '');
  }, [nameLike]);

  const onNameChange = (value) => {
    setNameInput(value);
    clearTimeout(nameTimerRef.current);
    nameTimerRef.current = setTimeout(() => setNameLike(value.trim()), 300);
  };

  /* 右键菜单：点空白/滚动就关掉 */
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

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
    rememberScroll(el.scrollTop);
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 800) loadMore();
  }, [loadMore, rememberScroll]);

  /* 启动续上上次位置：先补足上次的加载深度，再回到那个滚动位置（只做一次） */
  const restoreDoneRef = useRef(false);
  useEffect(() => {
    if (!restore || restoreDoneRef.current) return;
    const el = scrollRef.current;
    if (!el || items.length === 0) return;
    // 还没补到上次的深度：继续翻页（翻页中也要 return，别提前套用位置）
    if (items.length < restore.itemCount) {
      if (hasMore) {
        if (!loading) loadMore();
        return;
      }
    }
    restoreDoneRef.current = true;
    const apply = () => {
      el.scrollTop = restore.scrollTop || 0;
      rememberScroll(el.scrollTop);
    };
    apply();
    // 缩略图陆续出图会把行高撑开，稍后再校一次，避免位置被顶偏
    const t = setTimeout(apply, 600);
    return () => clearTimeout(t);
  }, [restore, items.length, hasMore, loading, loadMore, rememberScroll]);

  /* 刷新锚定：刷新前记住视口最上面那张图，重载后把它拉回原来的位置（浏览位置不动） */
  /* 刷新时保住浏览位置（实现见 useScrollAnchor） */
  useScrollAnchor({ canvasRef: scrollRef, items, hasMore, loading, loadMore });

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
    window.__aiyviewDebug = {
      items: items.length,
      hasMore,
      loading,
      libraryId,
      columns,
      selected: selection.size,
      pick: typeof window.aiyview.library.pick,
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
  /** 悬停即编辑：没选中任何图时，操作条/快捷键作用在鼠标停留的那张上 */
  const targetIds = useMemo(
    () => (selectedIds.length > 0 ? selectedIds : (hoverEdit && hoverId != null ? [hoverId] : [])),
    [selectedIds, hoverEdit, hoverId]
  );

  /* 目标变了（换选中或换悬停图）→ 心数跟着这张图的实际值走 */
  const targetItem = useMemo(() => (targetIds.length ? items.find((it) => it.id === targetIds[0]) || null : null), [targetIds, items]);
  useEffect(() => { setHeartVal(targetItem ? Number(targetItem.heart) || 0 : 0); }, [targetItem]);

  const allRejected = useMemo(() => {
    if (targetIds.length === 0) return false;
    const map = new Map(items.map((it) => [it.id, it]));
    return targetIds.every((id) => {
      const it = map.get(id);
      return it && it.rejected === 1;
    });
  }, [targetIds, items]);

  /* 全局快捷键：打分 / 评级 / 标废 / 删除（有选中或悬停目标时生效；查看器打开时归查看器处理） */
  const hotRef = useRef({});
  hotRef.current = { ids: targetIds, items, shortcuts, actions };
  useEffect(() => {
    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('.viewer')) return;
      const combo = comboOf(e);
      if (!combo) return;
      const { ids, items: rows, shortcuts: keys, actions: act } = hotRef.current;
      const action = actionForCombo(keys, combo);
      if (!action) return;

      // F5 等图库动作不需要选中目标，先处理掉
      if (action === 'refresh') {
        e.preventDefault();
        act.scanCurrent();
        return;
      }
      if (!ids || ids.length === 0) return;

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
          <p>还没有图库。点左栏「文件夹」右边的 ＋ 图标选一个目录（如 D:\ImageTags\output），会自动扫描入库。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="content">
      <div className={`actionbar ${targetIds.length === 0 ? 'no-sel' : ''}`}>
        {/* 常驻操作条：没有选中也没有悬停目标时整排置灰，遮挡符号仍然可用 */}
        <span className={`ab-disabled-wrap`}>
          <Hearts
            value={heartVal}
            className="ab-hearts"
            onChange={(n) => {
              if (!targetIds.length) return;
              setHeartVal(n);
              actions.setMarks(targetIds, { heart: n });
            }}
          />

          <button
            className={`ab-btn ${allRejected ? 'warn' : ''}`}
            title="点一下标废，再点一下取消废"
            onClick={() => targetIds.length && actions.setMarks(targetIds, { rejected: allRejected ? 0 : 1 })}
          >{allRejected ? '取消废' : '标废'}</button>

          <span className="ab-group">
            <span className="ab-label" title="Alt+1~5 快捷分级">分级</span>
            {[0, 1, 2, 3, 4].map((lv) => (
              <button
                key={lv}
                className="ab-btn tiny"
                title={`Alt+${lv + 1}`}
                onClick={() => targetIds.length && actions.setAge(targetIds, lv)}
              >L{lv}</button>
            ))}
            <button className="ab-btn tiny broom" title="清除分级" onClick={() => targetIds.length && actions.setAge(targetIds, null)}>
              <Icon name="broom" size={13} />
            </button>
          </span>

          <button
            className="ab-btn danger icon-only"
            title="删除（移入系统回收站，12h 可撤回）"
            onClick={() => {
              if (!targetIds.length) return;
              if (confirm(`把 ${targetIds.length} 张移入系统回收站？12 小时内可撤回。`)) {
                actions.trash(targetIds);
              }
            }}
          ><Icon name="trash" size={13} /></button>
        </span>

        {/* 遮挡二级菜单符号（全局设置，无选中也可用） */}
        <OcclusionMenu occlusion={occlusion} setOcclusion={setOcclusionWithReset} />

        {/* 搜索框放最右边；「已选 N 张」移到左下角 */}
        <span className="ab-right">
          {scanning && scanProgress && (
            <span className="ab-scan">
              {scanProgress.phase === 'walk' ? '扫描目录…' : `入库 ${scanProgress.done}/${scanProgress.total}`}
            </span>
          )}
        </span>

        <span className="ab-search">
          <Icon name="search" size={13} className="ab-search-ico" />
          <input
            className="ab-search-input"
            placeholder="按文件名搜索…"
            value={nameInput}
            onChange={(e) => onNameChange(e.target.value)}
            title="只匹配文件名（不区分大小写），清空即恢复"
          />
          {nameInput && (
            <button className="ab-search-clear" title="清空搜索" onClick={() => onNameChange('')}>×</button>
          )}
        </span>
      </div>

      <div
        className="canvas"
        ref={scrollRef}
        onScroll={onScroll}
        onMouseEnter={() => {
          // 鼠标一进图区就把搜索框的焦点收走，否则 1~5 / x / Alt+数字 这些快捷键会被输入框吞掉
          const active = document.activeElement;
          if (active && active.classList && active.classList.contains('ab-search-input')) active.blur();
        }}
      >
        <div className="cols">
          {buckets.map((bucket, i) => (
            <div className="col" key={i}>
              {bucket.items.map((item) => (
                <Thumb
                  key={item.id}
                  item={item}
                  selected={selection.has(item.id)}
                  hovered={hoverEdit && hoverId === item.id}
                  onHover={setHoverId}
                  onClick={clickItem}
                  onDouble={() => onOpenViewer(item)}
                  onContext={(it, e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, item: it });
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        {loading && <div className="feed-hint">加载中…</div>}
        {!hasMore && items.length > 0 && (
          <div className="feed-hint">
            {total > items.length ? `共 ${total} 张 · 已显示 ${items.length}` : `共 ${total || items.length} 张`}
          </div>
        )}
        {hasMore && items.length > 0 && <div className="feed-hint">已显示 {items.length} / {total || '…'} 张</div>}
        {items.length === 0 && !loading && (
          <div className="empty-hint"><p>这里还没有图片，点右上 ⟳ 重新扫描。</p></div>
        )}
      </div>

      {menu && (
        <div
          className="ctx-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 300) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { onOpenViewer(menu.item); setMenu(null); }}>打开大图</button>
          <button
            onClick={() => {
              actions.setMarks([menu.item.id], { heart: Math.min(5, (menu.item.heart || 0) + 1) });
              setMenu(null);
            }}
          >加一颗心（当前 {(menu.item.heart || 0)}）</button>
          <button
            onClick={() => {
              actions.setMarks([menu.item.id], { rejected: menu.item.rejected === 1 ? 0 : 1 });
              setMenu(null);
            }}
          >{menu.item.rejected === 1 ? '取消废标' : '标为废片'}</button>
          <div className="ctx-sep" />
          {[0, 1, 2, 3, 4].map((lv) => (
            <button key={lv} onClick={() => { actions.setAge([menu.item.id], lv); setMenu(null); }}>分级 L{lv}</button>
          ))}
          <div className="ctx-sep" />
          <button className="danger" onClick={() => { actions.trash([menu.item.id]); setMenu(null); }}>移入回收站</button>
        </div>
      )}
    </section>
  );
}
