import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/** 顶部搜索框：输入防抖 300ms 再落到筛选状态（每敲一个字都查库太浪费） */
export default function SearchBox({ nameLike, setNameLike }) {
  const [text, setText] = useState(nameLike || '');
  const timerRef = useRef(null);

  useEffect(() => {
    setText(nameLike || '');
  }, [nameLike]);

  const change = (value) => {
    setText(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNameLike(value.trim()), 300);
  };

  return (
    <span className="ab-search">
      <Icon name="search" size={13} className="ab-search-ico" />
      <input
        className="ab-search-input"
        placeholder="搜文件名 / 标签 / 提示词…"
        value={text}
        onChange={(e) => change(e.target.value)}
        title="文件名、标签、提示词一起匹配（不区分大小写）；前缀 tag: 只搜标签；清空即恢复"
      />
      {text && (
        <button className="ab-search-clear" title="清空搜索" onClick={() => change('')}>×</button>
      )}
    </span>
  );
}
