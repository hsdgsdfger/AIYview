/**
 * 快捷键配置：动作表 + 组合键解析
 *
 * 约定：combo 统一存小写串，形如 '1' / 'alt+1' / 'x' / 'delete'；
 * 修饰键顺序固定 ctrl+alt+shift+meta+主键，便于比较与持久化。
 */

export const SHORTCUT_ACTIONS = [
  { id: 'heart1', group: '打分', label: '打分 1', def: '1' },
  { id: 'heart2', group: '打分', label: '打分 2', def: '2' },
  { id: 'heart3', group: '打分', label: '打分 3', def: '3' },
  { id: 'heart4', group: '打分', label: '打分 4', def: '4' },
  { id: 'heart5', group: '打分', label: '打分 5', def: '5' },
  { id: 'heart0', group: '打分', label: '打分清零', def: '0' },
  { id: 'age0', group: '评级', label: '评级 L0', def: 'alt+1' },
  { id: 'age1', group: '评级', label: '评级 L1', def: 'alt+2' },
  { id: 'age2', group: '评级', label: '评级 L2', def: 'alt+3' },
  { id: 'age3', group: '评级', label: '评级 L3', def: 'alt+4' },
  { id: 'age4', group: '评级', label: '评级 L4', def: 'alt+5' },
  { id: 'rejected', group: '标记', label: '标废 / 取消标废', def: 'x' },
  { id: 'trash', group: '标记', label: '删除（移入回收站）', def: 'delete' },
];

export const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.def]));

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta', 'os', 'altgraph', 'capslock']);

/** 键盘事件 → combo；只按修饰键时返回 null */
export function comboOf(e) {
  const raw = String(e.key || '');
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

const KEY_LABELS = {
  delete: 'Del',
  backspace: 'Backspace',
  space: 'Space',
  escape: 'Esc',
  enter: 'Enter',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

const MOD_LABELS = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

/** combo → 展示文案 */
export function prettyCombo(combo) {
  if (!combo) return '未设置';
  return combo
    .split('+')
    .map((p) => {
      if (MOD_LABELS[p]) return MOD_LABELS[p];
      if (KEY_LABELS[p]) return KEY_LABELS[p];
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' + ');
}

/** 焦点在输入框里时不触发快捷键 */
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

/** 找出 combo 对应的动作 id（同一键被重复绑定时取列表里靠前的那个） */
export function actionForCombo(shortcuts, combo) {
  for (const a of SHORTCUT_ACTIONS) {
    if (shortcuts[a.id] === combo) return a.id;
  }
  return null;
}

/** 哪个键被重复绑定了 */
export function duplicateCombos(shortcuts) {
  const seen = new Map();
  for (const a of SHORTCUT_ACTIONS) {
    const c = shortcuts[a.id];
    if (!c) continue;
    if (!seen.has(c)) seen.set(c, []);
    seen.get(c).push(a.id);
  }
  return [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([c]) => c);
}
