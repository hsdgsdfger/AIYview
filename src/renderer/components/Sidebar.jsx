import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import Icon from './Icon.jsx';
import TreeNode from './FolderTree.jsx';

/** 左栏：搜索文件夹 / 文件夹树 / 收藏图片 / 标签区；宽度可拖拽，可收成图标条 */
export default function Sidebar() {
  const {
    libraries, libraryId, folders, folder,
    setFolder, heartOnly, setHeartOnly, untagged, setUntagged, rejectedOnly, setRejectedOnly,
    tagFilter, setTagFilter, tagList, actions, say,
    ageOnly, setAgeOnly, setAgeMax,
    sidebar, setSidebar, saveSidebar,
  } = useStore();
  const [tagQuery, setTagQuery] = useState('');
  const [tagHits, setTagHits] = useState(null); // 全库搜索结果（null 表示没在搜）
  /** 三个分组的折叠状态（默认全展开），写进 settings.sideGroups */
  const [openGroups, setOpenGroups] = useState({ folders: true, age: true, tags: true });
  const dragRef = useRef(null);

  useEffect(() => {
    window.aiyview.settings.get({ key: 'sideGroups' }).then((r) => {
      if (r.ok && r.data && typeof r.data === 'object') setOpenGroups((prev) => ({ ...prev, ...r.data }));
    });
  }, []);

  const toggleGroup = (key) => {
    const next = { ...openGroups, [key]: !openGroups[key] };
    setOpenGroups(next);
    window.aiyview.settings.set({ key: 'sideGroups', value: next });
  };

  /** 标签搜索走 tag:search（全字典），原先只在 tag:top 的前 40 个里本地过滤 */
  useEffect(() => {
    const q = tagQuery.trim();
    if (!q) {
      setTagHits(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      const r = await window.aiyview.tag.search({ q, limit: 30 });
      if (alive && r.ok) setTagHits(r.data);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tagQuery]);

  const library = libraries.find((l) => l.id === libraryId) || null;
  const tree = useMemo(() => buildTree(folders), [folders]);
  const shownTags = useMemo(() => {
    if (tagHits) {
      return tagHits.slice(0, 20).map((t) => ({ ...t, nameZh: t.name_zh, count: t.post_count }));
    }
    return tagList.slice(0, 20);
  }, [tagList, tagHits]);

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

  const pickAll = () => {
    setFolder('');
    setHeartOnly(false);
    setUntagged(false);
    setRejectedOnly(false);
    setTagFilter(null);
    setAgeOnly(null);
    setAgeMax(null);
  };

  /** 移除图库：图片文件不动，只从软件里摘掉索引 */
  const removeLibrary = (lib) => {
    if (libraries.length <= 1) {
      say('这是最后一个图库，不能移除（可先添加另一个图库）');
      return;
    }
    const ok = window.confirm(`从软件中移除「${lib.name}」？\n图片文件仍保留在原文件夹，可随时重新添加。`);
    if (ok) actions.removeLibrary(lib.id);
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} style={{ width, flex: `0 0 ${width}px` }}>
      {collapsed ? (
        <div className="side-rail">
          <button
            className={`rail-btn ${folder === '' && !heartOnly && !untagged && !rejectedOnly && !tagFilter ? 'on' : ''}`}
            title={library ? `${library.name}（全部）` : '全部图片'}
            onClick={pickAll}
          ><Icon name="folder" size={16} /></button>
          {/* 分组分隔线：浏览 / 筛选 / 管理 三段，收起成图标条时不至于糊成一片 */}
          <div className="rail-sep" />
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
          <div className="side-scroll">
        <div className="side-group">
          <div className="side-head">
            <button className="side-head-toggle" onClick={() => toggleGroup('folders')} title="折叠/展开文件夹">
              <span className="tree-caret">{openGroups.folders ? '▾' : '▸'}</span>
              <span>文件夹</span>
            </button>
            <button className="icon-btn" title="添加文件夹" onClick={() => actions.addFolder()}>
              <Icon name="folder-plus" size={15} />
            </button>
          </div>

          {openGroups.folders && (library ? (
            <>
              {libraries.length > 1 && (
                <div className="lib-switch">
                  {libraries.map((lib) => (
                    <button
                      key={lib.id}
                      className={`lib-chip ${lib.id === libraryId ? 'active' : ''}`}
                      title={lib.root_path}
                      onClick={() => actions.switchLibrary(lib.id)}
                    >{lib.name}</button>
                  ))}
                </div>
              )}
              <button
                className={`side-item root ${folder === '' && !heartOnly && !untagged && !rejectedOnly && !tagFilter && ageOnly === null ? 'active' : ''}`}
                onClick={pickAll}
                title={library.root_path}
              >
                <Icon name="folder" size={15} className="side-ico" />
                <span className="side-text">{library.name}</span>
                <span className="side-count">{library.image_count || ''}</span>
                {libraries.length > 1 && (
                  <span
                    className="side-x"
                    title="移除图库（不删文件）"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLibrary(library);
                    }}
                  >×</span>
                )}
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
            <div className="side-empty">还没有图库，点上方「文件夹」右侧的 ＋ 图标</div>
          ))}

          {openGroups.folders && (
            <>
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
            </>
          )}
        </div>

        <div className="side-group">
          <div className="side-head">
            <button className="side-head-toggle" onClick={() => toggleGroup('age')} title="折叠/展开分级">
              <span className="tree-caret">{openGroups.age ? '▾' : '▸'}</span>
              <span>分级</span>
            </button>
          </div>
          {openGroups.age && (
            <>
              <button
                className={`side-item ${ageOnly === null ? 'active' : ''}`}
                onClick={() => setAgeOnly(null)}
                title="不按分级过滤"
              >
                <span className="side-text">全部分级</span>
              </button>
              {[0, 1, 2, 3, 4].map((level) => (
                <button
                  key={level}
                  className={`side-item ${ageOnly === level ? 'active' : ''}`}
                  onClick={() => setAgeOnly(ageOnly === level ? null : level)}
                  title={`只看 L${level}`}
                >
                  <span className="side-text">L{level}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="side-group">
          <div className="side-head">
            <button className="side-head-toggle" onClick={() => toggleGroup('tags')} title="折叠/展开标签">
              <span className="tree-caret">{openGroups.tags ? '▾' : '▸'}</span>
              <span>标签</span>
            </button>
            <button
              className="icon-btn"
              title="打标（只处理无元数据的图，可中断续跑）"
              onClick={() => actions.startTagging()}
            ><Icon name="tag" size={15} /></button>
          </div>

          {openGroups.tags && (
            <>
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
            </>
          )}
        </div>
          </div>
        </>
      )}
      {!collapsed && <div className="sb-resizer" onMouseDown={onResizeDown} title="拖动调宽" />}
    </aside>
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
