/** 瀑布流分列：按预估高度把图分给当前最矮的一列（不插任何分组条） */
export function buildBuckets(items, columns) {
  const cols = Array.from({ length: columns }, () => ({ items: [], h: 0 }));
  for (const item of items) {
    const aspect = item.width && item.height ? item.width / item.height : 0.72;
    let idx = 0;
    for (let i = 1; i < cols.length; i += 1) if (cols[i].h < cols[idx].h) idx = i;
    cols[idx].items.push(item);
    cols[idx].h += 1 / Math.min(Math.max(aspect, 0.45), 2.4);
  }
  return cols;
}

export default buildBuckets;
