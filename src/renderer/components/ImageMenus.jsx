import Thumb from './Thumb.jsx';

/**
 * 瀑布流上的两个浮层：
 * - CtxMenu：右键菜单（打开大图 / 找相似 / 导出侧车 / 打标 / 删除）
 * - SimilarPanel：相似图结果面板（缩略图 + 指纹距离）
 */
export function CtxMenu({
  menu, onClose, onOpenViewer, onFindSimilar, hashProg,
  libraryId, actions, say,
}) {
  if (!menu) return null;
  const item = menu.item;
  return (
    <div
      className="ctx-menu"
      style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 380) }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => { onOpenViewer(item); onClose(); }}>打开大图</button>
      <button onClick={() => onFindSimilar(item)}>
        找相似图{hashProg && hashProg.total ? `（指纹 ${hashProg.done}/${hashProg.total}）` : ''}
      </button>
      <div className="ctx-sep" />
      <button
        onClick={async () => {
          const r = await window.aiyview.image['export-sidecar']({ libraryId, ids: [item.id] });
          onClose();
          say(r && r.ok ? '已写出侧车文件（图旁边的 .aiyview.json）' : (r && r.error) || '导出失败');
        }}
      >导出这张的标记（侧车文件）</button>
      <button
        onClick={() => {
          actions.setMarks([item.id], { heart: Math.min(5, (item.heart || 0) + 1) });
          onClose();
        }}
      >加一颗心（当前 {(item.heart || 0)}）</button>
      <button
        onClick={() => {
          actions.setMarks([item.id], { rejected: item.rejected === 1 ? 0 : 1 });
          onClose();
        }}
      >{item.rejected === 1 ? '取消废标' : '标为废片'}</button>
      <div className="ctx-sep" />
      {[0, 1, 2, 3, 4].map((lv) => (
        <button key={lv} onClick={() => { actions.setAge([item.id], lv); onClose(); }}>分级 L{lv}</button>
      ))}
      <div className="ctx-sep" />
      <button className="danger" onClick={() => { actions.trash([item.id]); onClose(); }}>移入回收站</button>
    </div>
  );
}

export function SimilarPanel({ similar, hashProg, busy, onClose, onOpenViewer }) {
  if (!similar) return null;
  return (
    <div className="similar-mask" onClick={onClose}>
      <div className="similar-panel" onClick={(e) => e.stopPropagation()}>
        <div className="similar-head">
          <span className="similar-title">与「{similar.source.file_name}」相似 {similar.items.length} 张</span>
          <span className="similar-sub">指纹距离 ≤ {similar.threshold} / 64</span>
          <button className="similar-close" title="关闭" onClick={onClose}>×</button>
        </div>
        {similar.error && <div className="similar-empty">{similar.error}</div>}
        {!similar.error && similar.items.length === 0 && (
          <div className="similar-empty">
            {hashProg && hashProg.total ? `没找到相似图（指纹 ${hashProg.done}/${hashProg.total}，算完再试）` : '没找到相似图'}
          </div>
        )}
        <div className="similar-grid">
          {similar.items.map((it) => (
            <div className="similar-cell" key={it.id}>
              <Thumb
                item={it}
                selected={false}
                hovered={false}
                onHover={() => {}}
                onClick={() => {}}
                onDouble={() => onOpenViewer(it)}
                onContext={() => {}}
              />
              <span className="similar-dist">{it.distance}</span>
            </div>
          ))}
        </div>
        {hashProg && hashProg.total > 0 && (
          <div className="similar-foot">指纹计算中 {hashProg.done}/{hashProg.total}</div>
        )}
        {busy && <div className="similar-foot">查询中…</div>}
      </div>
    </div>
  );
}
