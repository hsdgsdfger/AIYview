/**
 * 用户偏好读写：把 settings 的六个键一次读回，并统一视图快照格式。
 * 拆出来是为了让 store.jsx 保持在项目约定的 400 行以内。
 */

/** 启动时读回偏好；读不到的项返回 null，调用方保留默认值 */
export async function loadPrefs() {
  const get = (key) => window.aiyview.settings.get({ key }).then((r) => (r.ok ? r.data : null)).catch(() => null);
  const [theme, sort, shortcuts, occlusion, sidebar, view, win] = await Promise.all([
    get('theme'),
    get('sort'),
    get('shortcuts'),
    get('occlusion'),
    get('sidebar'),
    get('view'),
    window.aiyview.window.state().then((r) => (r.ok ? r.data : null)).catch(() => null),
  ]);
  return { theme, sort, shortcuts, occlusion, sidebar, view, win };
}

/** 视图状态 → settings.view 的落盘结构（键名保持向后兼容） */
export function viewPayload(s, scrollTop) {
  return {
    columns: s.columns,
    heartOnly: s.heartOnly,
    untagged: s.untagged,
    rejectedOnly: s.rejectedOnly,
    ageMax: s.ageMax,
    ageOnly: s.ageOnly ?? null,
    nameLike: s.nameLike,
    itemCount: (s.items || []).length,
    scrollTop: Math.round(scrollTop || 0),
  };
}
