import { useEffect, useRef, useState } from 'react';
import { observe, retryFailed } from '../thumbBus.js';
import { useStore } from '../store.jsx';

/**
 * 单张缩略图卡片：
 * - 可见才取图（共享 IntersectionObserver）
 * - 失败显示占位 + 手动重试，绝不回退原图
 * - 左上角「废」标记、右上角心数、分级遮挡三态（隐藏/遮罩/模糊），单图点击可临时解除
 */
export default function Thumb({ item, cellWidth, selected, onClick, onContext, onDouble }) {
  const elRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const { occlusion, revealed, actions } = useStore();

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

  // M3 遮挡判定：有分级且 ≥ 阈值 且未被单图解除
  const blocked = item.ageLevel != null
    && occlusion.threshold != null
    && item.ageLevel >= occlusion.threshold
    && !revealed.has(item.id);

  return (
    <div
      ref={elRef}
      className={`thumb ${selected ? 'selected' : ''} ${blocked ? 'occluded' : ''}`}
      style={{ width: cellWidth }}
      onClick={(e) => onClick(item, e)}
      onDoubleClick={() => onDouble?.(item)}
      onContextMenu={(e) => onContext?.(item, e)}
    >
      <div
        className={`thumb-box ${blocked && occlusion.mode === 'blur' ? 'occlude-blur' : ''}`}
        style={{ height }}
        onClick={blocked ? () => actions.reveal(item.id) : undefined}
        title={blocked ? '点击临时解除遮挡' : undefined}
      >
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

        {blocked && occlusion.mode === 'mask' && (
          <div className="occlude-mask" onClick={() => actions.reveal(item.id)}>
            <span>l{item.ageLevel} · 已遮挡</span>
          </div>
        )}
        {blocked && occlusion.mode === 'hidden' && (
          <div className="occlude-mask hidden-mode" onClick={() => actions.reveal(item.id)}>
            <span>l{item.ageLevel} · 隐藏</span>
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
