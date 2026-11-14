import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.jsx';
import TagPanel from './TagPanel.jsx';
import Icon from './Icon.jsx';

/**
 * 底栏：左状态 / 中遮挡三态 / 右打标 + 设置。
 * 「最近删除、标签、提示词库、日志」都收进右下角设置里。
 */
export default function BottomBar() {
  const { selection, actions, occlusion, setOcclusion, tagging, status } = useStore();
  const [panel, setPanel] = useState(null); // 'trash' | 'prompts' | 'tags' | null
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  /* 点空白处关设置 */
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('.settings-menu')) return;
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  const open = (name) => {
    setSettingsOpen(false);
    setPanel(name);
  };

  return (
    <>
      {panel === 'tags' && <TagPanel onClose={() => setPanel(null)} />}
      {panel && panel !== 'tags' && <Panel name={panel} onClose={() => setPanel(null)} />}

      <footer className="statusbar">
        <div className="sb-left">
          <span className="sb-muted">{status || (selection.size > 0 ? '' : '未选择')}</span>
        </div>

        <div className="sb-center">
          <button
            className={occlusion.mode === 'mask' ? 'sb-toggle on' : 'sb-toggle'}
            onClick={() => setOcclusion({ ...occlusion, mode: 'mask' })}
            title="遮罩：分级达阈值的图盖遮罩"
          ><Icon name="mask" size={14} /></button>
          <button
            className={occlusion.mode === 'blur' ? 'sb-toggle on' : 'sb-toggle'}
            onClick={() => setOcclusion({ ...occlusion, mode: 'blur' })}
            title="模糊"
          ><Icon name="blur" size={14} /></button>
          <button
            className={occlusion.mode === 'hidden' ? 'sb-toggle on' : 'sb-toggle'}
            onClick={() => setOcclusion({ ...occlusion, mode: 'hidden' })}
            title="隐藏"
          ><Icon name="eye" size={14} /></button>
          <span className="sb-threshold">
            ≥
            <select
              value={occlusion.threshold ?? ''}
              onChange={(e) => setOcclusion({ ...occlusion, threshold: e.target.value === '' ? null : Number(e.target.value) })}
              title="遮挡阈值：达到该分级才遮挡"
            >
              <option value="">不挡</option>
              <option value="1">L1</option>
              <option value="2">L2</option>
              <option value="3">L3</option>
              <option value="4">L4</option>
            </select>
          </span>
        </div>

        <div className="sb-right">
          {tagging && <span className="sb-muted">打标 {tagging.done}/{tagging.total}</span>}

          <button
            className="sb-toggle"
            onClick={() => (tagging ? actions.stopTagging() : actions.startTagging())}
            title="打标（只处理无元数据的图）"
          ><Icon name="refresh" size={14} className={tagging ? 'spin-icon' : ''} /></button>

          <div className="settings-anchor" ref={settingsRef}>
            <button
              className={settingsOpen ? 'sb-toggle on' : 'sb-toggle'}
              onClick={() => setSettingsOpen((v) => !v)}
              title="设置"
            ><Icon name="gear" size={14} /></button>

            {settingsOpen && createPortal(
              <div className="settings-menu">
                <button onClick={() => open('trash')}>
                  <Icon name="trash" size={14} />
                  <span>最近删除</span>
                  <em>12h 可撤回</em>
                </button>
                <button onClick={() => open('tags')}>
                  <Icon name="tag" size={14} />
                  <span>标签</span>
                </button>
                <button onClick={() => open('prompts')}>
                  <Icon name="tag" size={14} />
                  <span>提示词库</span>
                </button>
                <div className="settings-sep" />
                <button
                  onClick={async () => {
                    const r = await window.yizi.app['log-open']();
                    if (!r || !r.ok) window.yizi.app['log-path']();
                    setSettingsOpen(false);
                  }}
                >
                  <Icon name="search" size={14} />
                  <span>日志</span>
                  <em>排障</em>
                </button>
                <button
                  onClick={() => {
                    const el = document.documentElement;
                    const light = el.getAttribute('data-theme') === 'light';
                    el.setAttribute('data-theme', light ? 'dark' : 'light');
                    window.yizi.settings.set({ key: 'theme', value: light ? 'dark' : 'light' });
                    setSettingsOpen(false);
                  }}
                >
                  <Icon name="gear" size={14} />
                  <span>亮/暗主题</span>
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

function Panel({ name, onClose }) {
  const { say } = useStore();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (name === 'trash') {
        const r = await window.yizi.delete.list();
        if (alive && r.ok) setRows(r.data);
      } else {
        const r = await window.yizi.prompt.list({ limit: 100, search: search || undefined });
        if (alive && r.ok) setList(r.data.items);
      }
    })();
    return () => { alive = false; };
  }, [name, search]);

  return (
    <div className="bottom-panel">
      <div className="bp-head">
        <span className="side-title">{name === 'trash' ? '最近删除（12 小时内可撤回）' : '提示词库'}</span>
        {name === 'prompts' && (
          <input className="input" placeholder="搜提示词/标题/模型…" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      {name === 'trash' ? (
        rows.length === 0 ? <p className="muted">空。删除的图会出现在这里。</p> : rows.map((r) => (
          <div className="bp-row" key={r.id}>
            <span className="bp-path" title={r.abs_path}>{r.rel_path}</span>
            <button
              className="btn"
              onClick={async () => {
                const res = await window.yizi.delete.restore({ id: r.id });
                say(res.ok ? `已还原 ${r.rel_path}` : `还原失败: ${res.error}`);
                const refreshed = await window.yizi.delete.list();
                if (refreshed.ok) setRows(refreshed.data);
              }}
            >撤回</button>
          </div>
        ))
      ) : list.length === 0 ? <p className="muted">空。在查看器里点「存入提示词库」。</p> : list.map((p) => (
        <div className="bp-row" key={p.id}>
          <span className="bp-path" title={p.positive}>{p.title || (p.positive || '').slice(0, 60)}</span>
          <span className="muted">{p.model}</span>
          <button
            className="btn ghost"
            onClick={() => {
              navigator.clipboard.writeText(p.positive || '');
              say('已复制正向提示词');
            }}
          >复制</button>
        </div>
      ))}
    </div>
  );
}
