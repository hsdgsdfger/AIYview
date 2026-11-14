import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import TagPanel from './TagPanel.jsx';
import Icon from './Icon.jsx';

/**
 * 底栏：左侧状态文字 + 中间分级遮挡三态 + 右侧面板开关（批量操作已上移到顶部操作条）。
 */
export default function BottomBar() {
  const { selection, actions, occlusion, setOcclusion, tagging, status } = useStore();
  const [panel, setPanel] = useState(null); // 'trash' | 'prompts' | 'tags' | null

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
              <option value="1">l1</option>
              <option value="2">l2</option>
              <option value="3">l3</option>
              <option value="4">l4</option>
            </select>
          </span>
        </div>

        <div className="sb-right">
          {tagging && <span className="sb-muted">打标 {tagging.done}/{tagging.total}</span>}
          <button className={panel === 'trash' ? 'sb-toggle on' : 'sb-toggle'} onClick={() => setPanel(panel === 'trash' ? null : 'trash')} title="最近删除（12h 可撤回）">
            <Icon name="trash" size={14} />
          </button>
          <button className={panel === 'prompts' ? 'sb-toggle on' : 'sb-toggle'} onClick={() => setPanel(panel === 'prompts' ? null : 'prompts')} title="提示词库">
            <Icon name="tag" size={14} />
          </button>
          <button className={panel === 'tags' ? 'sb-toggle on' : 'sb-toggle'} onClick={() => setPanel(panel === 'tags' ? null : 'tags')} title="标签面板">
            <span style={{ fontSize: 12 }}>标签</span>
          </button>
          <button
            className="sb-toggle"
            onClick={() => (tagging ? actions.stopTagging() : actions.startTagging())}
            title="打标（只处理无元数据的图）"
          ><Icon name="refresh" size={14} className={tagging ? 'spin-icon' : ''} /></button>
          <button
            className="sb-toggle"
            title="打开日志所在文件夹（排障用）"
            onClick={async () => {
              const r = await window.yizi.app['log-open']();
              if (!r || !r.ok) window.yizi.app['log-path']();
            }}
          ><span style={{ fontSize: 11 }}>日志</span></button>
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
