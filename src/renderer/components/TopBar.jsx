import { useStore } from '../store.jsx';

/**
 * 顶栏：品牌（点太极图标收起/展开侧边栏）+ 图片总数 + 窗口控制。
 * 添加文件夹、刷新、主题等都收进底栏设置里；刷新默认 F5。
 */
export default function TopBar() {
  const { maximized, total, sidebar, setSidebar, saveSidebar } = useStore();
  const collapsed = !!sidebar.collapsed;

  const toggle = () => {
    const next = { width: sidebar.width, collapsed: !collapsed };
    setSidebar(next);
    saveSidebar(next);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <button
          className="brand-mark"
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={toggle}
        ><Taiji collapsed={collapsed} /></button>
        <span className="brand-text">AIY<em>view</em></span>
      </div>

      <div className="topbar-center">
        {total > 0 && <span className="tb-total" title="当前筛选下的图片总数">共 {total} 张</span>}
      </div>

      <div className="topbar-right">
        <div className="win-controls">
          <button onClick={() => window.aiyview.window.minimize()} title="最小化">–</button>
          <button onClick={() => window.aiyview.window.maximize()} title={maximized ? '还原' : '最大化'}>
            {maximized ? '❐' : '□'}
          </button>
          <button className="close" onClick={() => window.aiyview.window.close()} title="关闭">✕</button>
        </div>
      </div>
    </header>
  );
}

/** 太极图标：侧边栏展开时左半白、收起时左半黑（点它切换） */
function Taiji({ collapsed }) {
  const left = collapsed ? '#0d0f13' : '#ffffff';
  const right = collapsed ? '#ffffff' : '#0d0f13';
  return (
    <svg className="taiji" viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill={left} stroke="currentColor" strokeWidth="1" opacity="0.95" />
      <path d="M10 1 A9 9 0 0 1 10 19 L10 1 Z" fill={right} />
      <circle cx="5.5" cy="10" r="1.7" fill={right} />
      <circle cx="14.5" cy="10" r="1.7" fill={left} />
    </svg>
  );
}
