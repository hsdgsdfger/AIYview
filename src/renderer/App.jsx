import { useCallback, useEffect, useMemo, useState } from 'react';
import { StoreProvider, useStore } from './store.jsx';
import { isTypingTarget } from './shortcuts.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ImageArea from './components/ImageArea.jsx';
import BottomBar from './components/BottomBar.jsx';
import Viewer from './components/Viewer.jsx';

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { items, status, occlusion, revealed, actions } = useStore();
  const [viewerId, setViewerId] = useState(null);

  /* Ctrl+Z 撤销最近一次标记 / 分级（输入框里不抢键） */
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      if (String(e.key).toLowerCase() !== 'z') return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      actions.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  const viewerItem = useMemo(
    () => (viewerId != null ? items.find((it) => it.id === viewerId) : null),
    [items, viewerId]
  );

  /** 是否处在「评级屏蔽」状态：达到阈值且没被临时显示过 */
  const isMasked = useCallback(
    (it) =>
      it.ageLevel != null
      && occlusion.threshold != null
      && it.ageLevel >= occlusion.threshold
      && !revealed.has(it.id),
    [occlusion.threshold, revealed]
  );

  const nav = useCallback(
    (delta) => {
      if (viewerId == null) return;
      const pos = items.findIndex((it) => it.id === viewerId);
      if (pos < 0) return;
      // 大图翻页跟着评级屏蔽走：被屏蔽的整张跳过，直接落到下一个没被屏蔽的
      for (let i = pos + delta; i >= 0 && i < items.length; i += delta) {
        if (!isMasked(items[i])) {
          setViewerId(items[i].id);
          return;
        }
      }
    },
    [items, viewerId, isMasked]
  );

  return (
    <div className="app">
      <TopBar />
      <div className="main-row">
        <Sidebar />
        <ImageArea onOpenViewer={(item) => setViewerId(item.id)} />
      </div>
      <BottomBar />
      {status && <div className="toast">{status}</div>}
      {viewerItem && <Viewer item={viewerItem} onClose={() => setViewerId(null)} onNav={nav} />}
    </div>
  );
}
