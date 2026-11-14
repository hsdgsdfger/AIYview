import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { SHORTCUT_ACTIONS, comboOf, duplicateCombos, prettyCombo } from '../shortcuts.js';

/**
 * 快捷键设置面板：点按键框 → 按下新键即生效，写回 settings。
 * 键位作用范围：选中图片后的批量操作 / 查看器里对当前图生效；输入框内不触发。
 */
export default function ShortcutPanel({ onClose }) {
  const { shortcuts, setShortcut, resetShortcuts } = useStore();
  const [capturing, setCapturing] = useState(null);

  useEffect(() => {
    if (!capturing) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = comboOf(e);
      if (!combo) return; // 只按修饰键：继续等主键
      setShortcut(capturing, combo);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, setShortcut]);

  const dupes = new Set(duplicateCombos(shortcuts));
  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))];

  return (
    <div className="bottom-panel">
      <div className="bp-head">
        <span className="side-title">快捷键</span>
        <span className="muted sc-hint">选中图片后生效；查看器里对当前图生效；输入框内不触发</span>
        <button className="btn ghost" onClick={resetShortcuts}>全部恢复默认</button>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>

      {groups.map((group) => (
        <div className="sc-group" key={group}>
          <div className="sc-group-title">{group}</div>
          <div className="sc-grid">
            {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a) => {
              const combo = shortcuts[a.id];
              const conflict = combo && dupes.has(combo);
              return (
                <div className="sc-row" key={a.id}>
                  <span className="sc-label">{a.label}</span>
                  <button
                    className={`sc-key ${capturing === a.id ? 'capturing' : ''} ${conflict ? 'conflict' : ''}`}
                    onClick={() => setCapturing(capturing === a.id ? null : a.id)}
                    title={conflict ? '这个键和别的动作重复了' : '点击后按下新键'}
                  >
                    {capturing === a.id ? '按下新键…' : prettyCombo(combo)}
                  </button>
                  <button
                    className="sc-reset"
                    onClick={() => setShortcut(a.id, a.def)}
                    title={`恢复默认（${prettyCombo(a.def)}）`}
                  >默认</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
