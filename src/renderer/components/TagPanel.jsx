import { useState } from 'react';
import { useStore } from '../store.jsx';

/** 标签面板：按标签筛图（E4）+ 给选中图打标签（含中文联想） */
export default function TagPanel({ onClose }) {
  const { selection, tagFilter, setTagFilter, say } = useStore();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [pending, setPending] = useState([]); // 待批量写入的标签名

  const suggest = async (text) => {
    setQuery(text);
    if (!text.trim()) {
      setSuggestions([]);
      return;
    }
    const r = await window.aiyview.tag.suggest({ prefix: text.trim(), limit: 10 });
    if (r.ok) setSuggestions(r.data);
  };

  const applyFilter = async (tag) => {
    let id = tag.id;
    if (tag.custom || id < 0) {
      const r = await window.aiyview.tag['get-or-create']({ name: tag.name });
      if (!r.ok) {
        say(r.error);
        return;
      }
      id = r.data.id;
    }
    setTagFilter({ id, name: tag.name });
    say(`按标签筛选: ${tag.name}`);
    onClose();
  };

  const attachToSelection = async () => {
    if (pending.length === 0 || selection.size === 0) return;
    const ids = [...selection];
    let written = 0;
    for (const name of pending) {
      const r = await window.aiyview.tag['get-or-create']({ name });
      if (!r.ok) {
        say(r.error);
        continue;
      }
      for (const id of ids) {
        const a = await window.aiyview.tag.attach({ imageId: id, names: [name], origin: 'manual' });
        if (a.ok) written += 1;
      }
    }
    say(`已写入 ${written} 处标签关联`);
    setPending([]);
    onClose();
  };

  return (
    <div className="bottom-panel">
      <div className="bp-head">
        <span className="side-title">标签</span>
        <input
          className="input"
          placeholder="搜标签（支持中文名联想）…"
          value={query}
          onChange={(e) => suggest(e.target.value)}
        />
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      {suggestions.length > 0 && (
        <div className="tag-suggestions">
          {suggestions.map((t) => (
            <button key={t.id} className="btn ghost tag-chip" onClick={() => applyFilter(t)}>
              {t.name}{t.nameZh ? ` · ${t.nameZh}` : ''}
            </button>
          ))}
          {query.trim() && (
            <button
              className="btn tag-chip"
              onClick={() => applyFilter({ id: -1, name: query.trim(), custom: true })}
            >用「{query.trim()}」筛选/新建</button>
          )}
        </div>
      )}

      {selection.size > 0 && (
        <div className="tag-attach">
          <span className="muted">给已选 {selection.size} 张打标签：</span>
          {pending.map((name) => (
            <span key={name} className="tag-chip on">
              {name}
              <button className="icon-btn" onClick={() => setPending(pending.filter((n) => n !== name))}>×</button>
            </span>
          ))}
          <input
            className="input"
            placeholder="输入标签后回车"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) {
                setPending([...new Set(pending.concat(query.trim()))]);
                setQuery('');
                setSuggestions([]);
              }
            }}
          />
          <button className="btn" disabled={pending.length === 0} onClick={attachToSelection}>写入</button>
        </div>
      )}

      {tagFilter && (
        <div className="bp-row">
          <span className="muted">当前按标签筛选：</span>
          <span>{tagFilter.name}</span>
          <button className="btn ghost" onClick={() => { setTagFilter(null); onClose(); }}>清除</button>
        </div>
      )}
    </div>
  );
}
