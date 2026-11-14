import { useEffect, useRef, useState } from 'react';
import { observe, retryFailed } from '../thumbBus.js';

/**
 * 单张缩略图卡片：
 * - 可见才取图（共享 IntersectionObserver）
 * - 失败显示占位 + 手动重试，绝不回退原图
 * - 左上角「废」标记、右上角心数、未判定分级不标色
 */
export default function Thumb({ item, cellWidth, selected, onClick, onContext, onDouble }) {
  const elRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    return observe(el, item.id, (u) => {
      if (u) {
        setUrl(u);
        setFailed(false);
      } else {
        setFailed((f) => f || true);
      }
    });
  }, [item.id]);

  const aspect = item.width && item.height ? item.width / item.height : 1.4;
  const height = Math.round(cellWidth / Math.min(Math.max(aspect, 0.45), 2.2));

  return (
    <div
      ref={elRef}
      className={`thumb ${selected ? 'selected' : ''}`}
      style={{ width: cellWidth }}
      onClick={(e) => onClick(item, e)}
      onDoubleClick={() => onDouble?.(item)}
      onContextMenu={(e) => onContext?.(item, e)}
    >
      <div className="thumb-box" style={{ height }}>
        {url ? (
          <img src={url} alt={item.file_name} draggable={false} loading="lazy" />
        ) : (
          <div className={`thumb-placeholder ${failed ? 'failed' : ''}`}>
            {failed ? (
              <button
                className="retry"
                onClick={(e) => {
                  e.stopPropagation();
                  retryFailed([item.id]);
                  setFailed(false);
                }}
              >重试</button>
            ) : (
              <span className="spin" />
            )}
          </div>
        )}

        {item.rejected === 1 && <span className="badge reject">废</span>}
        {item.heart > 0 && <span className="badge heart">{'♥'.repeat(Math.min(item.heart, 5))}</span>}
        {item.ageLevel != null && (
          <span className={`badge age age-${item.ageLevel}`}>l{item.ageLevel}</span>
        )}
      </div>
      <div className="thumb-name" title={item.rel_path}>{item.file_name}</div>
    </div>
  );
}
