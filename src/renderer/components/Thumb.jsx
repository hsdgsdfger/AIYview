import { useEffect, useRef, useState } from 'react';
import { observe, retryFailed } from '../thumbBus.js';
import { useStore } from '../store.jsx';
import Hearts from './Hearts.jsx';

/**
 * 缩略图卡片：
 * - 挂载即批量取图，失败显示占位 + 重试，绝不回退原图
 * - 分级三态遮挡（遮罩/模糊/隐藏）：
 *     · 达到阈值的图盖遮挡层，点一下临时显示（同时按正常规则选中）
 *     · 再点一下恢复遮挡（遮挡层保持挂载，只是变透明）
 *     · 全局遮挡设置（方式/阈值）一变，所有临时显示全部复位
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

  // 是否命中全局遮挡阈值（与临时显示状态无关）
  const hitThreshold = item.ageLevel != null
    && occlusion.threshold != null
    && item.ageLevel >= occlusion.threshold;
  const isRevealed = revealed.has(item.id);
  const masked = hitThreshold && !isRevealed;

  const handleOverlayClick = (e) => {
    e.stopPropagation();
    // 切换显示/恢复遮挡，同时按正常规则选中
    if (isRevealed) actions.unreveal(item.id);
    else actions.reveal(item.id);
    onClick(item, e);
  };

  return (
    <div
      ref={elRef}
      data-thumb-id={item.id}
      className={`thumb ${selected ? 'selected' : ''} ${masked ? 'occluded' : ''}`}
      onClick={(e) => onClick(item, e)}
      onDoubleClick={() => onDouble?.(item)}
      onContextMenu={(e) => onContext?.(item, e)}
      title={item.file_name}
    >
      <div
        className={`thumb-box ${masked && occlusion.mode === 'blur' ? 'occlude-blur' : ''}`}
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

        {/* 遮挡层：命中阈值就常驻挂载；已显示时变透明，再点一下恢复遮挡 */}
        {hitThreshold && (
          <div
            className={`occlude-mask ${occlusion.mode === 'hidden' ? 'hidden-mode' : ''} ${isRevealed ? 'revealed' : ''}`}
            onClick={handleOverlayClick}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onDouble?.(item);
            }}
            title={isRevealed ? '点击恢复遮挡' : '点击显示'}
          />
        )}

        {item.rejected === 1 && <span className="badge reject">废</span>}
        {item.heart > 0 && (
          <span className="badge heart"><Hearts value={item.heart} size={9} readOnly /></span>
        )}
        {item.ageLevel != null && <span className={`badge age age-${item.ageLevel}`}>L{item.ageLevel}</span>}
        {selected && <span className="badge sel">✓</span>}
      </div>
    </div>
  );
}
