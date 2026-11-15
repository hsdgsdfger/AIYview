import { useState } from 'react';
import Icon from './Icon.jsx';

/** 文件夹树的一行（可折叠）；数据由 Sidebar 的 buildTree 产出 */
export default function TreeNode({ node, active, onPick, depth = 0 }) {
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
