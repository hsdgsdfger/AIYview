import { useEffect, useRef } from 'react';

/**
 * 刷新时保住浏览位置：
 * 1) 收到 `aiyview:refresh-start`（列表即将重载）时，记下视口最上面那张图的 id 和它的相对高度；
 * 2) 重载后先把分页补回原来的深度，再把那张图拉回原来的屏幕位置；
 * 3) 缩略图陆续出图会把行高撑开，500ms 后再校一次。
 * 拆成 hook 是为了让 ImageArea 保持在 400 行以内。
 */
export function useScrollAnchor({ canvasRef, items, hasMore, loading, loadMore }) {
  const anchorRef = useRef(null);
  const lenRef = useRef(0);
  lenRef.current = items.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const snapshot = () => {
      const top = canvas.getBoundingClientRect().top;
      for (const node of canvas.querySelectorAll('[data-thumb-id]')) {
        const r = node.getBoundingClientRect();
        if (r.bottom > top + 2) {
          anchorRef.current = { id: node.dataset.thumbId, top: r.top - top, count: lenRef.current };
          return;
        }
      }
      anchorRef.current = null;
    };
    window.addEventListener('aiyview:refresh-start', snapshot);
    return () => window.removeEventListener('aiyview:refresh-start', snapshot);
  }, [canvasRef]);

  useEffect(() => {
    const a = anchorRef.current;
    const canvas = canvasRef.current;
    if (!a || !canvas) return undefined;
    // 还没补到刷新前的深度：继续翻页，别急着补偿
    if (items.length < a.count && hasMore && !loading) {
      loadMore();
      return undefined;
    }
    const find = () => canvas.querySelector(`[data-thumb-id="${a.id}"]`);
    if (!find()) {
      anchorRef.current = null; // 那张图没了（被删/被筛掉）
      return undefined;
    }
    const fix = () => {
      const node = find();
      if (!node) return false;
      const delta = (node.getBoundingClientRect().top - canvas.getBoundingClientRect().top) - a.top;
      if (Math.abs(delta) > 1) {
        canvas.scrollTop += delta;
        return true;
      }
      return false;
    };
    anchorRef.current = null;
    // 缩略图出图会分几批撑高行高，200ms 校正一轮，最多 6 轮（约 1 秒）
    let timer = null;
    let round = 0;
    const tick = () => {
      const moved = fix();
      round += 1;
      if (moved && round < 6) timer = setTimeout(tick, 200);
    };
    tick();
    return () => clearTimeout(timer);
  }, [items, hasMore, loading, loadMore, canvasRef]);
}
