import { useEffect, useRef, useState } from 'react';
import { observe, retryFailed } from '../thumbBus.js';
import { useStore } from '../store.jsx';
import Hearts from './Hearts.jsx';

/**
 * 缩略图卡片：
 * - 可见才取图（共享 IntersectionObserver + 批量 IPC）
 * - 失败显示占位 + 重试，绝不回退原图
 * - 分级三态遮挡（遮罩/模糊/隐藏），点一下临时解除
 * - 瀑布流下按宽高比自然排版；网格下统一 1:1
 */
export default function Thumb({ item, selected, onClick, onContext, onDouble }) {
  const elRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(null); // 由 img 实际加载结果校正，避免高图被裁
  const { occlusion, revealed, actions } = useStore();

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    return observe(el, item.id, (u) => {
      if (u) {
        setUrl(u);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
  }, [item.id]);

  const fallbackAspect = item.width && item.height ? item.width / item.height : 0.72;
  const aspect = ratio || fallbackAspect;
  const blocked = item.ageLevel != null
    && occlusion.threshold != null
    && item.ageLevel >= occlusion.threshold
    && !revealed.has(item.id);

  return (
    <div
      ref={elRef}
      data-thumb-id={item.id}
      className={`thumb ${selected ? 'selected' : ''} ${blocked ? 'occluded' : ''}`}
      onClick={(e) => onClick(item, e)}
      onDoubleClick={() => onDouble?.(item)}
      onContextMenu={(e) => onContext?.(item, e)}
      title={item.file_name}
    >
      <div
        className={`thumb-box ${blocked && occlusion.mode === 'blur' ? 'occlude-blur' : ''}`}
        style={{ aspectRatio: `${Math.min(Math.max(aspect, 0.3), 3.2)}` }}
      >
        {url ? (
          <img
            src={url}
            alt={item.file_name}
            draggable={false}
            decoding="async"
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w && h) {
                const r = w / h;
                if (!ratio || Math.abs(r - ratio) > 0.02) setRatio(r);
              }
            }}
          />
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

        {blocked && occlusion.mode !== 'blur' && (
          <div
            className={`occlude-mask ${occlusion.mode === 'hidden' ? 'hidden-mode' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              actions.reveal(item.id);
            }}
          >
            <span>l{item.ageLevel} · 点击显示</span>
          </div>
        )}

        {item.rejected === 1 && <span className="badge reject">废</span>}
        {item.heart > 0 && (
          <span className="badge heart"><Hearts value={item.heart} size={9} readOnly /></span>
        )}
        {item.ageLevel != null && <span className={`badge age age-${item.ageLevel}`}>l{item.ageLevel}</span>}
        {selected && <span className="badge sel">✓</span>}
      </div>
    </div>
  );
}
