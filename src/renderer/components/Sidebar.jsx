import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import Icon from './Icon.jsx';

/** 左栏：搜索文件夹 / 文件夹树 / 收藏图片 / 标签区；宽度可拖拽，可收成图标条 */
export default function Sidebar() {
  const {
    libraries, libraryId, folders, folder, folderSearch, setFolderSearch,
    setFolder, heartOnly, setHeartOnly, untagged, setUntagged, rejectedOnly, setRejectedOnly,
    tagFilter, setTagFilter, tagList, actions, say,
    sidebar, setSidebar, saveSidebar,
  } = useStore();
  const [tagQuery, setTagQuery] = useState('');
  const dragRef = useRef(null);

  const library = libraries.find((l) => l.id === libraryId) || null;
  const tree = useMemo(() => buildTree(folders, folderSearch.trim()), [folders, folderSearch]);
  const shownTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return tagList.slice(0, 20);
    return tagList.filter((t) => t.name.toLowerCase().includes(q) || (t.nameZh || '').includes(q)).slice(0, 20);
  }, [tagList, tagQuery]);

  const collapsed = !!sidebar.collapsed;
  const width = collapsed ? 46 : sidebar.width;

  /* 拖右边缘调宽度（松手才写 settings） */
  const onResizeDown = (e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidebar.width };
    document.body.classList.add('resizing');
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const w = Math.round(Math.min(460, Math.max(150, dragRef.current.startW + ev.clientX - dragRef.current.startX)));
      dragRef.current.width = w;
      setSidebar((prev) => ({ ...prev, width: w }));
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragRef.current) saveSidebar({ width: dragRef.current.width || sidebar.width, collapsed: false });
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const toggleCollapsed = () => {
    const next = { width: sidebar.width, collapsed: !collapsed };
    setSidebar(next);
    saveSidebar(next);
  };

  const pickAll = () => {
    setFolder('');
    setHeartOnly(false);
    setUntagged(false);
    setRejectedOnly(false);
    setTagFilter(null);
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} style={{ width, flex: `0 0 ${width}px` }}>
      <div className="sb-top">
        <button
          className="icon-btn sb-collapse"
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={toggleCollapsed}
        ><Icon name={collapsed ? 'panel-expand' : 'panel-collapse'} size={15} /></button>
        {!collapsed && <span className="sb-top-title">图库</span>}
      </div>

      {collapsed ? (
        <div className="side-rail">
          <button
            className={`rail-btn ${folder === '' && !heartOnly && !untagged && !rejectedOnly && !tagFilter ? 'on' : ''}`}
            title={library ? `${library.name}（全部）` : '全部图片'}
            onClick={pickAll}
          ><Icon name="folder" size={16} /></button>
          <button
            className={`rail-btn ${heartOnly ? 'on' : ''}`}
            title="收藏图片"
            onClick={() => {
              setHeartOnly(!heartOnly);
              if (!heartOnly) { setUntagged(false); setRejectedOnly(false); }
            }}
          ><Icon name="heart" size={16} /></button>
          <button
            className={`rail-btn ${rejectedOnly ? 'on' : ''}`}
            title="废标"
            onClick={() => {
              setRejectedOnly(!rejectedOnly);
              if (!rejectedOnly) { setHeartOnly(false); setUntagged(false); }
            }}
          ><Icon name="x" size={16} /></button>
          <button
            className={`rail-btn ${untagged ? 'on' : ''}`}
            title="无标签"
            onClick={() => setUntagged(!untagged)}
          ><Icon name="tag" size={16} /></button>
          <div className="rail-sep" />
          <button className="rail-btn" title="添加文件夹" onClick={() => actions.addFolder()}>
            <Icon name="folder-plus" size={16} />
          </button>
          <button className="rail-btn" title="打标（只处理无元数据的图）" onClick={() => actions.startTagging()}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
      ) : (
        <>
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
                className={`side-item root ${folder === '' && !heartOnly && !untagged && !rejectedOnly && !tagFilter ? 'active' : ''}`}
                onClick={pickAll}
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
              if (!heartOnly) { setUntagged(false); setRejectedOnly(false); }
            }}
          >
            <Icon name="heart" size={15} className="side-ico heart" />
            <span className="side-text">收藏图片</span>
          </button>

          <button
            className={`side-item ${rejectedOnly ? 'active' : ''}`}
            onClick={() => {
              setRejectedOnly(!rejectedOnly);
              if (!rejectedOnly) { setHeartOnly(false); setUntagged(false); }
            }}
            title="只看标废的图（取消废标后自动离开此列表）"
          >
            <Icon name="x" size={15} className="side-ico" />
            <span className="side-text">废标</span>
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
                const r = await window.aiyview.tag['get-or-create']({ name });
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
        </>
      )}
      {!collapsed && <div className="sb-resizer" onMouseDown={onResizeDown} title="拖动调宽" />}
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
