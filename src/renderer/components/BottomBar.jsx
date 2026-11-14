import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.jsx';

/**
 * 底部操作条：选中集的批量操作（B4/B5）+ 最近删除（F4）+ 提示词库入口。
 */
export default function BottomBar() {
  const { selection, actions, say } = useStore();
  const [panel, setPanel] = useState(null); // 'trash' | 'prompts' | null

  const selectedIds = useMemo(() => [...selection], [selection]);

  if (selectedIds.length === 0 && !panel) return null;

  return (
    <>
      {panel && <Panel name={panel} onClose={() => setPanel(null)} />}
      <div className="bottom-bar">
        {selectedIds.length > 0 ? (
          <>
            <span className="sel-count">已选 {selectedIds.length} 张</span>

            <span className="heart-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className="btn ghost" onClick={() => actions.setMarks(selectedIds, { heart: n })}>
                  ♥{n}
                </button>
              ))}
              <button className="btn ghost" onClick={() => actions.setMarks(selectedIds, { heart: 0 })}>♡清</button>
            </span>

            <button className="btn ghost" onClick={() => actions.setMarks(selectedIds, { rejected: 1 })}>标废</button>
            <button className="btn ghost" onClick={() => actions.setMarks(selectedIds, { rejected: 0 })}>取消废</button>

            <span className="tb-check">
              分级
              {[0, 1, 2, 3, 4].map((lv) => (
                <button key={lv} className="btn ghost" onClick={() => actions.setAge(selectedIds, lv)}>l{lv}</button>
              ))}
              <button className="btn ghost" onClick={() => actions.setAge(selectedIds, null)}>清除</button>
            </span>

            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm(`把 ${selectedIds.length} 张移入系统回收站？12 小时内可撤回。`)) return;
                const r = await window.yizi.delete.trash({ ids: selectedIds });
                if (r.ok) {
                  actions.clearSelection();
                  say(`已移入回收站 ${r.data.trashed} 张${r.data.failed.length ? `，失败 ${r.data.failed.length}` : ''}`);
                } else say(r.error);
              }}
            >删除到回收站</button>

            <button className="btn ghost" onClick={() => actions.clearSelection()}>取消选择</button>
          </>
        ) : (
          <span className="sel-count muted">无选中</span>
        )}

        <span className="grow" />
        <button className="btn ghost" onClick={() => setPanel(panel === 'trash' ? null : 'trash')}>最近删除</button>
        <button className="btn ghost" onClick={() => setPanel(panel === 'prompts' ? null : 'prompts')}>提示词库</button>
      </div>
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
    return () => {
      alive = false;
    };
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
        rows.length === 0 ? (
          <p className="muted">空。删除的图会出现在这里。</p>
        ) : (
          rows.map((r) => (
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
        )
      ) : list.length === 0 ? (
        <p className="muted">空。在查看器里点「存入提示词库」。</p>
      ) : (
        list.map((p) => (
          <div className="bp-row" key={p.id}>
            <span className="bp-path" title={p.positive}>{p.title || p.positive?.slice(0, 60)}</span>
            <span className="muted">{p.model}</span>
            <button
              className="btn ghost"
              onClick={() => {
                navigator.clipboard.writeText(p.positive || '');
                say('已复制正向提示词');
              }}
            >复制</button>
          </div>
        ))
      )}
    </div>
  );
}
