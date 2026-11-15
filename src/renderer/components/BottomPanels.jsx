import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import BackupButtons from './BackupButtons.jsx';

/** 底部浮层（最近删除 / 提示词库 / 缓存 / 缩放 / 批量重命名）共用的外壳 */
export function PanelShell({ title, onClose, extra, children }) {
  return (
    <div className="bottom-panel">
      <div className="bp-head">
        <span className="side-title">{title}</span>
        {extra}
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      {children}
    </div>
  );
}

export function TrashPanel({ onClose }) {
  const { say } = useStore();
  const [rows, setRows] = useState([]);

  const load = async () => {
    const r = await window.aiyview.delete.list();
    if (r.ok) setRows(r.data);
  };

  useEffect(() => { load(); }, []);

  return (
    <PanelShell title="最近删除（12 小时内可撤回）" onClose={onClose}>
      {rows.length === 0 ? <p className="muted">空。删除的图会出现在这里。</p> : rows.map((r) => (
        <div className="bp-row" key={r.id}>
          <span className="bp-path" title={r.abs_path}>{r.rel_path}</span>
          <button
            className="btn"
            onClick={async () => {
              const res = await window.aiyview.delete.restore({ id: r.id });
              say(res.ok ? `已还原 ${r.rel_path}` : `还原失败: ${res.error}`);
              load();
            }}
          >撤回</button>
        </div>
      ))}
    </PanelShell>
  );
}

/** 提示词库：列表 + 编辑（标题/正向/负向）+ 删除 + 手动新增 */
export function PromptsPanel({ onClose }) {
  const { say } = useStore();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // {id, title, positive, negative}

  const load = async (q) => {
    const r = await window.aiyview.prompt.list({ limit: 100, search: q || undefined });
    if (r.ok) setItems(r.data.items);
  };

  useEffect(() => { load(search); }, [search]);

  const startNew = () => setEditing({ id: null, title: '', positive: '', negative: '' });

  const save = async () => {
    if (!editing) return;
    if (editing.id) {
      const r = await window.aiyview.prompt.update({
        id: editing.id, title: editing.title, positive: editing.positive, negative: editing.negative,
      });
      if (r.ok) {
        say('已保存修改');
        setEditing(null);
        load(search);
      } else {
        say(`保存失败: ${r.error}`);
      }
    } else {
      const r = await window.aiyview.prompt['save-manual']({
        title: editing.title, positive: editing.positive, negative: editing.negative,
      });
      if (r.ok) {
        say('已新增到提示词库');
        setEditing(null);
        load(search);
      } else {
        say(`新增失败: ${r.error}`);
      }
    }
  };

  const remove = async (id) => {
    if (!window.confirm('从提示词库删除这条？')) return;
    const r = await window.aiyview.prompt.remove({ id });
    if (r.ok) {
      say('已删除');
      load(search);
    } else {
      say(`删除失败: ${r.error}`);
    }
  };

  return (
    <PanelShell
      title="提示词库"
      onClose={onClose}
      extra={(
        <>
          <input className="input" placeholder="搜提示词/标题/模型…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn ghost" onClick={startNew}>+ 新增</button>
        </>
      )}
    >
      {editing && (
        <div className="bp-edit">
          <input
            className="input"
            placeholder="标题（可空）"
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          />
          <textarea
            className="bp-textarea"
            placeholder="正向提示词"
            value={editing.positive}
            onChange={(e) => setEditing({ ...editing, positive: e.target.value })}
          />
          <textarea
            className="bp-textarea"
            placeholder="负向提示词（可空）"
            value={editing.negative}
            onChange={(e) => setEditing({ ...editing, negative: e.target.value })}
          />
          <div className="bp-actions">
            <button className="btn" onClick={save}>{editing.id ? '保存修改' : '保存新增'}</button>
            <button className="btn ghost" onClick={() => setEditing(null)}>取消</button>
          </div>
        </div>
      )}

      {items.length === 0 && !editing ? (
        <p className="muted">空。在查看器里点「存入提示词库」，或点「+ 新增」手写一条。</p>
      ) : items.map((p) => (
        <div className="bp-row" key={p.id}>
          <span className="bp-path" title={p.positive}>{p.title || (p.positive || '').slice(0, 60) || '（无标题）'}</span>
          <span className="muted">{p.model}</span>
          <button
            className="btn ghost"
            onClick={() => {
              navigator.clipboard.writeText(p.positive || '');
              say('已复制正向提示词');
            }}
          >复制</button>
          <button
            className="btn ghost"
            onClick={() => setEditing({ id: p.id, title: p.title || '', positive: p.positive || '', negative: p.negative || '' })}
          >编辑</button>
          <button className="btn ghost danger" onClick={() => remove(p.id)}>删除</button>
        </div>
      ))}
    </PanelShell>
  );
}

/** 缩略图缓存：占用查看 + 一键清空 */
export function CachePanel({ onClose }) {
  const { say, actions } = useStore();
  const [stats, setStats] = useState(null);

  const load = async () => {
    const r = await window.aiyview.thumb['cache-stats']();
    if (r.ok) setStats(r.data);
  };

  useEffect(() => { load(); }, []);

  const mb = stats && stats.cache ? (stats.cache.bytes / 1048576).toFixed(1) : '0';
  const pct = stats && stats.cache ? Math.round((stats.cache.usageRatio || 0) * 100) : 0;

  return (
    <PanelShell title="缩略图缓存" onClose={onClose}>
      {!stats ? <p className="muted">读取中…</p> : (
        <>
          <div className="bp-row">
            <span className="bp-path">
              缓存 {stats.cache.entries} 张，占用 {mb} MB（配额 {Math.round((stats.cache.quotaBytes || 0) / 1048576)} MB，已用 {pct}%）
            </span>
          </div>
          <div className="bp-row">
            <span className="bp-path muted">命中 {stats.cache.hits} · 未命中 {stats.cache.misses} · 淘汰 {stats.cache.evicted}</span>
          </div>
          <div className="bp-actions">
            <button
              className="btn danger"
              onClick={async () => {
                if (!window.confirm('清空缩略图缓存？图片不会受影响，下次浏览会重新生成。')) return;
                const r = await window.aiyview.thumb['cache-clear']();
                if (r.ok) {
                  say(`已清理 ${r.data.removed} 张缩略图`);
                  load();
                  actions.refresh();
                } else {
                  say(`清理失败: ${r.error}`);
                }
              }}
            >清空缓存</button>
            <button className="btn ghost" onClick={load}>刷新数字</button>
          </div>
        </>
      )}
    </PanelShell>
  );
}

/** 界面布局：左栏宽度、查看器提示词栏宽度，都用滑块调，松手写盘 */
export function LayoutPanel({ onClose }) {
  const { sidebar, setSidebar, saveSidebar, promptWidth, setPromptWidth, libraryId, say, actions } = useStore();
  const [sideW, setSideW] = useState(sidebar.width);
  const [promptW, setPromptWLocal] = useState(promptWidth);

  const liveSide = (w) => {
    setSideW(w);
    setSidebar((prev) => ({ ...prev, width: w, collapsed: false }));
  };
  const livePrompt = (w) => {
    setPromptWLocal(w);
    setPromptWidth(w);
  };

  return (
    <PanelShell title="界面布局" onClose={onClose}>
      <p className="muted">拖动滑块调整位置，松手即保存。</p>

      <div className="bp-row">
        <span className="bp-path">侧边栏宽度（主界面可视区域）</span>
        <span className="bp-path muted">{sideW}px</span>
      </div>
      <input
        className="layout-range"
        type="range"
        min="150"
        max="460"
        step="2"
        value={sideW}
        onChange={(e) => liveSide(Number(e.target.value))}
        onMouseUp={() => saveSidebar({ width: sideW, collapsed: false })}
        onKeyUp={() => saveSidebar({ width: sideW, collapsed: false })}
      />

      <div className="bp-row">
        <span className="bp-path">查看器提示词栏宽度</span>
        <span className="bp-path muted">{promptW}px</span>
      </div>
      <input
        className="layout-range"
        type="range"
        min="240"
        max="620"
        step="2"
        value={promptW}
        onChange={(e) => livePrompt(Number(e.target.value))}
      />

      <div className="bp-actions">
        <button
          className="btn ghost"
          onClick={() => {
            liveSide(208);
            saveSidebar({ width: 208, collapsed: false });
            livePrompt(310);
          }}
        >恢复默认</button>
        <BackupButtons libraryId={libraryId} say={say} actions={actions} />
      </div>
    </PanelShell>
  );
}

/** 界面缩放：即时生效并写进 settings.uiScale */
export function ScalePanel({ onClose }) {
  const { say } = useStore();
  const [value, setValue] = useState(null);
  const [current, setCurrent] = useState(1.5);

  useEffect(() => {
    window.aiyview.settings.get({ key: 'uiScale' }).then((r) => {
      const n = r.ok && Number(r.data) ? Number(r.data) : 1.5;
      setCurrent(n);
      setValue(String(n));
    });
  }, []);

  const apply = async (factor) => {
    setValue(String(factor));
    const r = await window.aiyview.window['set-zoom']({ factor });
    if (r.ok) {
      setCurrent(r.data);
      say(`界面缩放已设为 ${r.data}×`);
    } else {
      say(`缩放失败: ${r.error}`);
    }
  };

  return (
    <PanelShell title="界面缩放" onClose={onClose}>
      <p className="muted">默认 1.5×（当前 {current}×）。改完立即生效，下次启动沿用。</p>
      <div className="bp-actions">
        {[1.0, 1.25, 1.5, 1.75, 2.0].map((f) => (
          <button
            key={f}
            className={`btn ${Number(value) === f ? '' : 'ghost'}`}
            onClick={() => apply(f)}
          >{f}×</button>
        ))}
      </div>
    </PanelShell>
  );
}

/** 批量重命名：模板 → 预览 → 应用（作用于当前选中的图） */
export function RenamePanel({ onClose }) {
  const { selection, actions, say } = useStore();
  const [template, setTemplate] = useState('{name}_{index:2}');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const ids = [...selection];

  const doPreview = async () => {
    if (ids.length === 0) {
      say('先在图里选中要重命名的图');
      return;
    }
    setBusy(true);
    const r = await window.aiyview.image['rename-preview']({ ids, template });
    setBusy(false);
    if (r.ok) setPreview(r.data);
    else say(`预览失败: ${r.error}`);
  };

  const doApply = async () => {
    if (!preview || !preview.plan.some((p) => !p.skip)) return;
    if (!window.confirm(`确认重命名 ${preview.plan.filter((p) => !p.skip).length} 个文件？`)) return;
    setBusy(true);
    const r = await window.aiyview.image['rename-apply']({ ids, template });
    setBusy(false);
    if (r.ok) {
      const failed = r.data.failed.length ? `，失败 ${r.data.failed.length}` : '';
      say(`已重命名 ${r.data.renamed} 个${failed}`);
      setPreview(r.data);
      actions.refresh();
    } else {
      say(`重命名失败: ${r.error}`);
    }
  };

  return (
    <PanelShell title="批量重命名" onClose={onClose} extra={<span className="muted">已选 {ids.length} 张</span>}>
      <div className="bp-row">
        <input
          className="input"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="模板，如 {name}_{index:3}"
          title="占位符：{name} 原名 {index} 序号 {index:3} 补零到3位 {date} 修改日期 {parent} 上级目录名 {ext} 扩展名"
        />
        <button className="btn ghost" onClick={doPreview} disabled={busy}>预览</button>
        <button className="btn" onClick={doApply} disabled={busy || !preview}>应用</button>
      </div>
      <p className="muted">占位符：{'{name} {ext} {index} {index:3} {date} {parent}'}。同名会自动加 (2)(3)，不会覆盖。</p>

      {preview && preview.plan.map((p) => (
        <div className="bp-row" key={p.id || p.from}>
          <span className="bp-path" title={p.from}>{p.renamedFrom || p.from.split(/[\\/]/).pop()}</span>
          <span className="muted">→</span>
          <span className="bp-path">{p.skip ? `跳过（${p.reason === 'unchanged' ? '文件名没变' : p.reason}）` : p.name}</span>
        </div>
      ))}
      {preview && preview.plan.length === 0 && <p className="muted">没有可重命名的项。</p>}
    </PanelShell>
  );
}
