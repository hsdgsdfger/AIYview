import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import Icon from './Icon.jsx';

/** 左栏：搜索文件夹 / 文件夹树 / 收藏图片 / 标签区（对应原版左栏结构） */
export default function Sidebar() {
  const {
    libraries, libraryId, folders, folder, folderSearch, setFolderSearch,
    setFolder, heartOnly, setHeartOnly, untagged, setUntagged,
    tagFilter, setTagFilter, tagList, actions, say,
  } = useStore();
  const [tagQuery, setTagQuery] = useState('');

  const library = libraries.find((l) => l.id === libraryId) || null;
  const tree = useMemo(() => buildTree(folders, folderSearch.trim()), [folders, folderSearch]);
  const shownTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return tagList.slice(0, 20);
    return tagList.filter((t) => t.name.toLowerCase().includes(q) || (t.nameZh || '').includes(q)).slice(0, 20);
  }, [tagList, tagQuery]);

  return (
    <aside className="sidebar">
      <div className="side-search">
        <Icon name="search" size={14} className="side-search-icon" />
        <input
          className="side-search-input"
          placeholder="搜索文件夹..."
          value={folderSearch}
          onChange={(e) => setFolderSearch(e.target.value)}
        />
      </div>

      <div className="side-scroll">
        <div className="side-group">
          <div className="side-head">
            <span>文件夹</span>
            <button className="icon-btn" title="添加文件夹" onClick={() => actions.addFolder()}>
              <Icon name="folder-plus" size={15} />
            </button>
          </div>

          {library ? (
            <>
              <button
                className={`side-item root ${folder === '' && !heartOnly && !untagged && !tagFilter ? 'active' : ''}`}
                onClick={() => { setFolder(''); setHeartOnly(false); setUntagged(false); setTagFilter(null); }}
                title={library.root_path}
              >
                <Icon name="folder" size={15} className="side-ico" />
                <span className="side-text">{library.name}</span>
                <span className="side-count">{library.image_count || ''}</span>
              </button>

              {tree.map((node) => (
                <TreeNode
                  key={node.dir}
                  node={node}
                  active={folder}
                  onPick={(dir) => {
                    setFolder(dir);
                    setHeartOnly(false);
                    setUntagged(false);
                    setTagFilter(null);
                  }}
                />
              ))}
            </>
          ) : (
            <div className="side-empty">还没有图库，点上方「添加文件夹」</div>
          )}

          <button
            className={`side-item ${heartOnly ? 'active' : ''}`}
            onClick={() => {
              setHeartOnly(!heartOnly);
              if (!heartOnly) setUntagged(false);
            }}
          >
            <Icon name="heart" size={15} className="side-ico heart" />
            <span className="side-text">收藏图片</span>
          </button>
        </div>

        <div className="side-group">
          <div className="side-head">
            <span>标签</span>
            <button
              className="icon-btn"
              title="打标（只处理无元数据的图，可中断续跑）"
              onClick={() => actions.startTagging()}
            ><Icon name="tag" size={15} /></button>
          </div>

          <div className="side-search inner">
            <Icon name="search" size={13} className="side-search-icon" />
            <input
              className="side-search-input"
              placeholder="搜索或创建标签"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
            />
          </div>

          <button className={`side-item ${untagged ? 'active' : ''}`} onClick={() => setUntagged(!untagged)}>
            <span className="side-text">无标签</span>
          </button>

          {shownTags.map((t) => (
            <button
              key={t.id}
              className={`side-item tag ${tagFilter && tagFilter.id === t.id ? 'active' : ''}`}
              onClick={() => setTagFilter(tagFilter && tagFilter.id === t.id ? null : { id: t.id, name: t.name })}
              title={t.nameZh || t.name}
            >
              <span className="side-text">{t.nameZh || t.name}</span>
              <span className="side-count">{t.count}</span>
            </button>
          ))}

          {tagQuery.trim() && shownTags.length === 0 && (
            <button
              className="side-item"
              onClick={async () => {
                const name = tagQuery.trim();
                const r = await window.yizi.tag['get-or-create']({ name });
                if (r.ok) {
                  setTagFilter({ id: r.data.id, name });
                  setTagQuery('');
                  say(`已创建标签「${name}」并筛选`);
                }
              }}
            >
              <span className="side-text">+ 创建「{tagQuery.trim()}」</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function TreeNode({ node, active, onPick, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const children = node.children || [];
  return (
    <>
      <button
        className={`side-item ${active === node.dir ? 'active' : ''}`}
        style={{ paddingLeft: 14 + depth * 13 }}
        onClick={() => onPick(node.dir)}
        title={node.dir}
      >
        <span
          className="tree-caret"
          onClick={(e) => {
            e.stopPropagation();
            if (children.length) setOpen((o) => !o);
          }}
        >
          {children.length ? (open ? '▾' : '▸') : ''}
        </span>
        <Icon name="folder" size={14} className="side-ico" />
        <span className="side-text">{node.name}</span>
        <span className="side-count">{node.count}</span>
      </button>
      {open && children.map((c) => (
        <TreeNode key={c.dir} node={c} active={active} onPick={onPick} depth={depth + 1} />
      ))}
    </>
  );
}

/** 扁平 dir_path 列表 → 树；搜索时命中项平铺 */
function buildTree(folders, query) {
  const byDir = new Map();
  const roots = [];
  for (const f of folders) {
    if (!f.dir_path) continue;
    if (query && !f.dir_path.toLowerCase().includes(query.toLowerCase())) continue;
    byDir.set(f.dir_path, {
      dir: f.dir_path,
      name: f.dir_path.split('/').pop(),
      count: f.file_count,
      children: [],
    });
  }
  for (const node of byDir.values()) {
    const parentDir = node.dir.includes('/') ? node.dir.slice(0, node.dir.lastIndexOf('/')) : '';
    const parent = byDir.get(parentDir);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
