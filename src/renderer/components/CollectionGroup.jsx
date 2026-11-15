import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * 左栏「收藏夹」分组：只记「哪张图属于哪个集」，不复制、不移动任何文件。
 * 新建 / 删除都在这里，加入收藏夹走图片右键菜单。
 */
export default function CollectionGroup({
  open, onToggle, collections, collectionId, setCollectionId, libraryId, refreshCollections, say,
}) {
  const [draft, setDraft] = useState(null); // null = 收起输入框

  return (
    <div className="side-group">
      <div className="side-head">
        <button className="side-head-toggle" onClick={onToggle} title="折叠/展开收藏夹">
          <span className="tree-caret">{open ? '▾' : '▸'}</span>
          <span>收藏夹</span>
        </button>
        <button
          className="icon-btn"
          title="新建收藏夹（只记归属，不复制任何文件）"
          onClick={() => setDraft(draft === null ? '' : null)}
        ><Icon name="folder-plus" size={15} /></button>
      </div>

      {open && (
        <>
          {draft !== null && (
            <div className="side-search inner">
              <input
                className="side-search-input"
                autoFocus
                placeholder="收藏夹名字，回车创建"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter') return;
                  const name = draft.trim();
                  if (!name) return;
                  const r = await window.aiyview.collection.create({ libraryId, name });
                  if (r.ok) {
                    setDraft(null);
                    refreshCollections();
                    setCollectionId(r.data.id);
                  } else say(r.error);
                }}
              />
            </div>
          )}

          {collections.length === 0 && draft === null && (
            <div className="side-empty">右键图片可加入收藏夹</div>
          )}

          {collections.map((c) => (
            <button
              key={c.id}
              className={`side-item ${collectionId === c.id ? 'active' : ''}`}
              onClick={() => setCollectionId(collectionId === c.id ? null : c.id)}
              title={`${c.name}（${c.count} 张）· 右键删除这个收藏夹`}
              onContextMenu={async (e) => {
                e.preventDefault();
                if (!window.confirm(`删除收藏夹「${c.name}」？（图片文件不动，只是取消这个分组）`)) return;
                const r = await window.aiyview.collection.remove({ id: c.id, libraryId });
                if (r.ok) {
                  if (collectionId === c.id) setCollectionId(null);
                  refreshCollections();
                } else say(r.error);
              }}
            >
              <span className="side-text">{c.name}</span>
              <span className="side-count">{c.count}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
