import { useCallback, useMemo, useState } from 'react';
import { StoreProvider, useStore } from './store.jsx';
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
  const { items, status } = useStore();
  const [viewerId, setViewerId] = useState(null);

  const viewerItem = useMemo(
    () => (viewerId != null ? items.find((it) => it.id === viewerId) : null),
    [items, viewerId]
  );

  const nav = useCallback(
    (delta) => {
      if (viewerId == null) return;
      const pos = items.findIndex((it) => it.id === viewerId);
      const next = items[pos + delta];
      if (next) setViewerId(next.id);
    },
    [items, viewerId]
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
