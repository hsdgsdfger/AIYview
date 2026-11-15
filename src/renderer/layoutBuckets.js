/** 瀑布流分列：按预估高度把图分给当前最矮的一列；按时间排序时每列跨天插一条日期条 */
export function buildBuckets(items, columns, sort) {
  const cols = Array.from({ length: columns }, () => ({ items: [], h: 0 }));
  const byTime = sort === 'mtime_desc' || sort === 'mtime_asc';
  const dayOf = (it) => {
    const d = new Date(it.mtime_ms || 0);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const dayCounts = new Map();
  if (byTime) {
    for (const item of items) {
      const key = dayOf(item);
      dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
    }
  }
  const lastDay = new Array(columns).fill('');
  for (const item of items) {
    const aspect = item.width && item.height ? item.width / item.height : 0.72;
    let idx = 0;
    for (let i = 1; i < cols.length; i += 1) if (cols[i].h < cols[idx].h) idx = i;
    const target = cols[idx];
    if (byTime) {
      const key = dayOf(item);
      if (key !== lastDay[idx]) {
        target.items.push({ day: key, count: dayCounts.get(key) || 0 });
        lastDay[idx] = key;
      }
    }
    target.items.push(item);
    target.h += 1 / Math.min(Math.max(aspect, 0.45), 2.4);
  }
  return cols;
}

export default buildBuckets;
