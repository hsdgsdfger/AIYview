import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.jsx';
import Icon from './Icon.jsx';

/** 遮挡控制二级界面：三态 + 阈值 + 强度 + 排序 + 取消选择 */
export default function OcclusionMenu({ occlusion, setOcclusion }) {
  const { actions, selection, sort, setSort } = useStore();
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);

  const toggle = () => {
    if (pos) {
      setPos(null);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };

  useEffect(() => {
    if (!pos) return undefined;
    const onDown = (e) => {
      if (e.target.closest && (e.target.closest('.occl-menu') || e.target.closest('.ab-occl'))) return;
      setPos(null);
    };
    const onKey = (e) => e.key === 'Escape' && setPos(null);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);

  const modeIcon = occlusion.mode === 'mask' ? 'mask' : occlusion.mode === 'blur' ? 'blur' : 'eye';

  return (
    <>
      <button
        ref={btnRef}
        className={`ab-btn ab-occl ${occlusion.threshold != null ? 'on' : ''}`}
        title="遮挡：方式 / 阈值 / 排序 / 取消选择"
        onClick={toggle}
      >
        <Icon name={modeIcon} size={14} />
        <span className="caret">⌄</span>
      </button>

      {pos && createPortal(
        <div className="occl-menu" style={{ top: pos.top, right: pos.right }}>
          <div className="occl-row">
            <span className="occl-label">方式</span>
            {[
              ['mask', 'mask', '遮罩'],
              ['blur', 'blur', '模糊'],
              ['hidden', 'eye', '隐藏'],
            ].map(([mode, icon, text]) => (
              <button
                key={mode}
                className={`occl-opt ${occlusion.mode === mode ? 'on' : ''}`}
                onClick={() => setOcclusion({ ...occlusion, mode })}
              >
                <Icon name={icon} size={13} /> {text}
              </button>
            ))}
          </div>

          <div className="occl-row">
            <span className="occl-label">阈值</span>
            <button
              className={`occl-opt ${occlusion.threshold == null ? 'on' : ''}`}
              onClick={() => setOcclusion({ ...occlusion, threshold: null })}
            >不挡</button>
            {[1, 2, 3, 4].map((lv) => (
              <button
                key={lv}
                className={`occl-opt ${occlusion.threshold === lv ? 'on' : ''}`}
                onClick={() => setOcclusion({ ...occlusion, threshold: lv })}
              >L{lv}</button>
            ))}
          </div>

          <div className="occl-row">
            <span className="occl-label">强度</span>
            <input
              type="range"
              className="occl-range"
              min={20}
              max={100}
              step={10}
              value={occlusion.strength ?? 100}
              onChange={(e) => setOcclusion({ ...occlusion, strength: Number(e.target.value) })}
              disabled={occlusion.mode === 'hidden'}
              title={occlusion.mode === 'hidden' ? '隐藏方式不用调节强度' : '模糊度 / 遮罩浓度'}
            />
            <span className="occl-val">{occlusion.strength ?? 100}%</span>
          </div>

          <div className="settings-sep" />

          <div className="occl-row">
            <span className="occl-label">时间</span>
            <button
              className={`occl-opt ${sort === 'mtime_desc' ? 'on' : ''}`}
              onClick={() => setSort('mtime_desc')}
              title="修改时间从新到旧"
            >新→旧</button>
            <button
              className={`occl-opt ${sort === 'mtime_asc' ? 'on' : ''}`}
              onClick={() => setSort('mtime_asc')}
              title="修改时间从旧到新"
            >旧→新</button>
          </div>

          <div className="occl-row">
            <span className="occl-label">名称</span>
            <button
              className={`occl-opt ${sort === 'name_asc' ? 'on' : ''}`}
              onClick={() => setSort('name_asc')}
              title="按文件名 A→Z"
            >A→Z</button>
            <button
              className={`occl-opt ${sort === 'name_desc' ? 'on' : ''}`}
              onClick={() => setSort('name_desc')}
              title="按文件名 Z→A"
            >Z→A</button>
          </div>

          {selection.size > 0 && (
            <>
              <div className="settings-sep" />
              <button className="occl-item" onClick={() => { actions.clearSelection(); setPos(null); }}>
                取消选择（{selection.size}）
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
