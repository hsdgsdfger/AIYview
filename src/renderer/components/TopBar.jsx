import { useStore } from '../store.jsx';
import Icon from './Icon.jsx';

/** 顶栏：品牌 + 添加文件夹 + 布局/面板 + 设置 + 窗口控制（对应原版 YiZi view 头部） */
export default function TopBar() {
  const {
    columns, setColumns, scanning, actions, maximized, say,
  } = useStore();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">☯</span>
        <span className="brand-text">YiZi<em>view</em></span>
      </div>

      <button className="add-folder" onClick={() => actions.addFolder()} title="选择文件夹并加入图库">
        <Icon name="folder-plus" size={15} />
        <span>添加文件夹</span>
      </button>

      <div className="topbar-center">
        <span className="tb-label sr-only" title="Ctrl+滚轮缩放列数">列数</span>
        <div className="stepper">
          <button className="stepper-btn" onClick={() => setColumns(Math.max(1, columns - 1))} title="减少分栏">−</button>
          <span className="stepper-val">{columns}</span>
          <button className="stepper-btn" onClick={() => setColumns(Math.min(30, columns + 1))} title="增加分栏">+</button>
        </div>
      </div>

      <div className="topbar-right">
        <button
          className="round-btn"
          title="亮/暗主题"
          onClick={() => {
            const el = document.documentElement;
            const light = el.getAttribute('data-theme') === 'light';
            el.setAttribute('data-theme', light ? 'dark' : 'light');
            window.yizi.settings.set({ key: 'theme', value: light ? 'dark' : 'light' });
          }}
        ><Icon name="gear" size={15} /></button>
        <button
          className="round-btn"
          title={scanning ? '扫描中…' : '重新扫描当前图库'}
          onClick={() => actions.scanCurrent()}
        ><Icon name="refresh" size={15} className={scanning ? 'spin-icon' : ''} /></button>

        <div className="win-controls">
          <button onClick={() => window.yizi.window.minimize()} title="最小化">–</button>
          <button onClick={() => window.yizi.window.maximize()} title={maximized ? '还原' : '最大化'}>
            {maximized ? '❐' : '□'}
          </button>
          <button className="close" onClick={() => window.yizi.window.close()} title="关闭">✕</button>
        </div>
      </div>
      {scanning && <span className="sr-status" onClick={() => say('扫描进行中')}>扫描中…</span>}
    </header>
  );
}
