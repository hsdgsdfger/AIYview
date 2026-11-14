import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';

/** 左侧栏：图库列表 + 目录树 + 注册/扫描入口 */
export default function Sidebar() {
  const {
    libraries, libraryId, folders, folder,
    setLibraryId, setFolder, actions,
  } = useStore();
  const [newPath, setNewPath] = useState('');
  const [showAdd, setShowAdd] = useState(libraries.length === 0);

  const tree = useMemo(() => buildTree(folders), [folders]);

  return (
    <aside className="sidebar">
      <div className="side-section">
        <div className="side-title">图库</div>
        <ul className="lib-list">
          {libraries.map((lib) => (
            <li
              key={lib.id}
              className={lib.id === libraryId ? 'active' : ''}
              onClick={() => setLibraryId(lib.id)}
              title={lib.root_path}
            >
              <span className="lib-name">{lib.name}</span>
              <span className="lib-count">{lib.image_count}</span>
              <button
                className="icon-btn"
                title="移除注册（不删文件）"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`移除图库「${lib.name}」的注册？磁盘文件不受影响。`)) {
                    actions.removeLibrary(lib.id);
                  }
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {showAdd ? (
          <div className="add-lib">
            <input
              className="input"
              placeholder="D:\\ImageTags\\output"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newPath.trim()) {
                  actions.registerLibrary('', newPath.trim());
                  setNewPath('');
                  setShowAdd(false);
                }
              }}
            />
            <button className="btn" onClick={() => setShowAdd(false)}>取消</button>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => setShowAdd(true)}>+ 注册图库目录</button>
        )}
      </div>

      <div className="side-section grow">
        <div className="side-title">目录</div>
        <div className="tree">
          <TreeRow label="(根目录)" dir="" active={folder === ''} onClick={() => setFolder('')} indent={0} />
          {tree.map((node) => (
            <TreeNode key={node.dir} node={node} active={folder} onPick={setFolder} indent={1} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function TreeNode({ node, active, onPick, indent }) {
  const [open, setOpen] = useState(indent < 1);
  const children = node.children || [];
  return (
    <>
      <TreeRow
        label={node.name}
        dir={node.dir}
        count={node.count}
        active={active === node.dir}
        onClick={() => onPick(node.dir)}
        indent={indent}
        hasChildren={children.length > 0}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />
      {open && children.map((c) => (
        <TreeNode key={c.dir} node={c} active={active} onPick={onPick} indent={indent + 1} />
      ))}
    </>
  );
}

function TreeRow({ label, dir, count, active, onClick, indent, hasChildren, open, onToggle }) {
  return (
    <div
      className={`tree-row ${active ? 'active' : ''}`}
      style={{ paddingLeft: 8 + indent * 14 }}
      onClick={onClick}
      title={dir || '(根目录)'}
    >
      <span
        className="tree-caret"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
      >
        {hasChildren ? (open ? '▾' : '▸') : ''}
      </span>
      <span className="tree-label">{label}</span>
      {count != null && <span className="tree-count">{count}</span>}
    </div>
  );
}

/** 把扁平 dir_path 列表变成树 */
function buildTree(folders) {
  const byDir = new Map();
  const roots = [];
  for (const f of folders) {
    if (!f.dir_path) continue;
    byDir.set(f.dir_path, { dir: f.dir_path, name: f.dir_path.split('/').pop(), count: f.file_count, children: [] });
  }
  for (const node of byDir.values()) {
    const parentDir = node.dir.includes('/') ? node.dir.slice(0, node.dir.lastIndexOf('/')) : '';
    const parent = byDir.get(parentDir);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
