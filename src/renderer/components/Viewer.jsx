import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import Hearts from './Hearts.jsx';
import { actionForCombo, comboOf, isTypingTarget } from '../shortcuts.js';

/**
 * 全屏查看器（A3）：缩放/平移、心数快捷键、废标、分级标记、两级提示词面板。
 * 一级 = 正负提示词；小箭头展开二级参数区（D3/D3b/D3c，默认收起）。
 */
export default function Viewer({ item, onClose, onNav }) {
  const { actions, shortcuts, promptWidth } = useStore();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState('fit');   // 'fit' 适应窗口 | 'actual' 1:1 原始像素
  const [peek, setPeek] = useState(false);   // 按住空格：临时按原图看（松开还原）
  const [info, setInfo] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [showParams, setShowParams] = useState(false);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setMode('fit');
    setPeek(false);
    setInfo(null);
    setPrompt(null);
    window.aiyview.image.get({ id: item.id }).then((r) => r.ok && setInfo(r.data));
    window.aiyview.image.prompt({ id: item.id }).then((r) => r.ok && setPrompt(r.data));
  }, [item.id]);

  /** fit ↔ 1:1 切换时归零缩放和位移，免得两种模式下滚轮/拖动状态互相污染 */
  const setViewMode = (next) => {
    setMode(next);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { onNav(-1); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { onNav(1); return; }
      if (e.key === '+' || e.key === '=') { setScale((s) => Math.min(8, s * 1.25)); return; }
      if (e.key === '-') { setScale((s) => Math.max(0.1, s / 1.25)); return; }

      if (isTypingTarget(e.target)) return;
      // 空格：按住看原图（1:1），松开回原来的模式
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setPeek(true);
        return;
      }
      // 0 = 适应窗口 / 1:1 切换（和修图软件的「实际像素」一致）
      if (e.key === '0') {
        e.preventDefault();
        setViewMode(mode === 'fit' ? 'actual' : 'fit');
        return;
      }
      const combo = comboOf(e);
      if (!combo) return;
      const action = actionForCombo(shortcuts, combo);
      if (!action) return;

      if (action.startsWith('heart')) {
        e.preventDefault();
        actions.setMarks([item.id], { heart: Number(action.slice(5)) });
        return;
      }
      if (action.startsWith('age')) {
        e.preventDefault();
        actions.setAge([item.id], Number(action.slice(3)));
        return;
      }
      if (action === 'rejected') {
        e.preventDefault();
        actions.setMarks([item.id], { rejected: item.rejected ? 0 : 1 });
        return;
      }
      if (action === 'trash') {
        e.preventDefault();
        actions.trash([item.id]);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose, onNav, actions, shortcuts, mode]);

  /* 空格松开 / 窗口失焦 → 收起原图预览 */
  useEffect(() => {
    const onUp = (e) => {
      if (e.code === 'Space' || e.key === ' ') setPeek(false);
    };
    const onBlur = () => setPeek(false);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /* 临时看原图时把平移清零，松开能回到原来的位置 */
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const peekSavedRef = useRef(null);
  useEffect(() => {
    if (peek) {
      peekSavedRef.current = offsetRef.current;
      setOffset({ x: 0, y: 0 });
    } else if (peekSavedRef.current) {
      setOffset(peekSavedRef.current);
      peekSavedRef.current = null;
    }
  }, [peek]);

  const onWheel = (e) => {
    e.preventDefault();
    setScale((s) => Math.min(8, Math.max(0.1, e.deltaY > 0 ? s / 1.1 : s * 1.1)));
  };

  const onDrag = (e) => {
    if (e.buttons !== 1) return;
    setOffset((o) => ({ x: o.x + e.movementX, y: o.y + e.movementY }));
  };

  const url = useMemo(() => {
    if (!info) return '';
    return 'media://local/' + info.absPath.split('\\').join('/');
  }, [info]);

  const actual = mode === 'actual' || peek;

  return (
    <div className="viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {/* 左右两条翻页热区：整条边（约占视图 1/24 宽）都能点，中间一个小方框箭头提示 */}
      <button className="viewer-nav" title="上一张（↑ / ←）" onClick={() => onNav(-1)}>
        <span className="vn-arrow">‹</span>
      </button>

      <div
        className={`viewer-stage ${actual ? 'actual' : ''}`}
        onWheel={onWheel}
        onMouseMove={onDrag}
        onDoubleClick={() => setViewMode(mode === 'fit' ? 'actual' : 'fit')}
        title={actual ? '1:1 原始像素（双击 / 空格 / 0 切换回适应窗口）' : '适应窗口（按住空格看原图，双击 / 0 切到 1:1）'}
      >
        {url ? (
          <img
            src={url}
            alt={item.file_name}
            draggable={false}
            className={actual ? 'actual' : ''}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              ...(actual && info ? { width: info.width || undefined, height: info.height || undefined } : {}),
            }}
          />
        ) : (
          <div className="thumb-placeholder" style={{ width: 320, height: 320 }}><span className="spin" /></div>
        )}
      </div>

      <button className="viewer-nav" title="下一张（↓ / →）" onClick={() => onNav(1)}>
        <span className="vn-arrow">›</span>
      </button>

      <div className="viewer-side" style={{ width: promptWidth, flex: `0 0 ${promptWidth}px` }}>
        <div className="viewer-head">
          <span className="viewer-name" title={item.rel_path}>{item.file_name}</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="viewer-actions">
          <span className="viewer-hearts">
            <Hearts
              value={item.heart || 0}
              size={17}
              onChange={(n) => actions.setMarks([item.id], { heart: n })}
            />
            <button
              className="btn ghost tiny"
              title="清除心数"
              onClick={() => actions.setMarks([item.id], { heart: 0 })}
            >清除</button>
          </span>
          <button
            className={`btn ${item.rejected ? 'danger' : 'ghost'}`}
            onClick={() => actions.setMarks([item.id], { rejected: item.rejected ? 0 : 1 })}
          >{item.rejected ? '取消废标' : '标废'}</button>
        </div>

        <div className="viewer-age">
          <span className="side-title">分级</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <button
              key={level}
              className={`btn ghost ${item.ageLevel === level ? 'primary' : ''}`}
              onClick={() => actions.setAge([item.id], item.ageLevel === level ? null : level)}
            >L{level}</button>
          ))}
          {item.ageLevel == null && <span className="muted">未判定</span>}
        </div>

        <PromptPanel prompt={prompt} showParams={showParams} setShowParams={setShowParams} />
        {info && <div className="viewer-meta muted">{info.ext} · {(info.size_bytes / 1024).toFixed(0)}KB · {info.width || '?'}×{info.height || '?'}</div>}
      </div>
    </div>
  );
}

/** 两级提示词面板：一级只显示正负提示词，箭头展开二级参数 */
function PromptPanel({ prompt, showParams, setShowParams }) {
  if (!prompt) {
    return <div className="prompt-panel"><div className="muted">没有嵌入的提示词元数据。</div></div>;
  }
  return (
    <div className="prompt-panel">
      <div className="prompt-block">
        <div className="side-title">正向</div>
        <p className="prompt-text">{prompt.positive || '—'}</p>
      </div>
      <div className="prompt-block">
        <div className="side-title">负向</div>
        <p className="prompt-text neg">{prompt.negative || '—'}</p>
      </div>

      <button className="btn ghost expand" onClick={() => setShowParams((v) => !v)}>
        {showParams ? '▾ 收起参数' : '▸ 生成参数'}
      </button>
      {showParams && (
        <div className="prompt-params">
          <Param label="模型" value={prompt.model} />
          <Param label="采样器" value={prompt.sampler} />
          <Param label="步数" value={prompt.steps} />
          <Param label="CFG" value={prompt.cfg} />
          <Param label="种子" value={prompt.seed} />
        </div>
      )}

      <button
        className="btn ghost"
        onClick={async () => {
          const r = await window.aiyview.prompt.save({ imageId: prompt.image_id });
          if (r.ok) alert('已存入提示词库');
        }}
      >存入提示词库</button>
    </div>
  );
}

function Param({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="param-row">
      <span className="param-key">{label}</span>
      <span className="param-val">{String(value)}</span>
    </div>
  );
}
