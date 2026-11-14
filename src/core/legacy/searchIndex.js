/**
 * src/utils/searchIndex.js
 * ---------------------------------------------------------------------------
 * 网格内即时过滤：自然排序 + 分数阈值模糊匹配。
 *
 * upstream 缺口：
 *   - 网格内没有任何过滤入口，找一张图只能滚；
 *   - 按名称排序用 `localeCompare`，`img_2.png` 会排在 `img_10.png` 后面。
 *
 * 适配来源：
 *   - overset/javascript-natural-sort (MIT) : 自然排序分段比较
 *   - krisk/Fuse (Apache-2.0)               : 按 pattern 长度决定容错阈值的评分思路
 *     （此处为独立实现，未引入其源码，规避 Apache-2.0 与本项目 EULA 的混用）
 */

/** 统一小写 + Unicode 归一，避免全角/组合字符漏匹配 */
export function normalize(str) {
  return String(str || '').normalize('NFC').toLowerCase();
}

/**
 * 自然排序比较器。
 * naturalCompare('img_2.png', 'img_10.png') < 0
 */
export function naturalCompare(a, b) {
  if (a === b) return 0;
  const sa = String(a ?? '');
  const sb = String(b ?? '');

  const chunk = /(\d+|\D+)/g;
  const ax = sa.match(chunk) || [];
  const bx = sb.match(chunk) || [];
  const len = Math.min(ax.length, bx.length);

  for (let i = 0; i < len; i++) {
    const av = ax[i];
    const bv = bx[i];
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);

    if (an && bn) {
      const diff = parseInt(av, 10) - parseInt(bv, 10);
      if (diff !== 0) return diff;
      // 2 vs 02：位数多者靠后，保证稳定
      if (av.length !== bv.length) return av.length - bv.length;
    } else {
      const al = av.toLowerCase();
      const bl = bv.toLowerCase();
      if (al !== bl) return al < bl ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

/**
 * 带早停的受限编辑距离。超过 maxDistance 立刻返回 maxDistance + 1。
 */
export function boundedLevenshtein(text, pattern, maxDistance) {
  const n = text.length;
  const m = pattern.length;
  if (Math.abs(n - m) > maxDistance) return maxDistance + 1;

  // 数组必须用哨兵值填满：带状窗口外的格子不会被写入，
  // 留 undefined 会让 prev[j]/curr[j-1] 参与 Math.min 时变成 NaN，整行作废。
  const sentinel = maxDistance + 1;
  let prev = new Array(m + 1).fill(sentinel);
  let curr = new Array(m + 1).fill(sentinel);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    // rowMin 只统计本行真正参与计算（带状窗口内）的格子。
    // 把 curr[0] 无条件计入会让 i > maxDistance 后每行都误判超标，模糊匹配直接失效。
    let rowMin = i <= maxDistance ? i : maxDistance + 1;
    const from = Math.max(1, i - maxDistance);
    const to = Math.min(m, i + maxDistance);

    if (from > 1) curr[from - 1] = maxDistance + 1;

    for (let j = from; j <= to; j++) {
      const cost = text.charCodeAt(i - 1) === pattern.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (v > maxDistance) v = maxDistance + 1;
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDistance) return maxDistance + 1;

    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[m];
}

/**
 * 容错阈值：短词零容错，避免 2 个字符就 fuzzy 出一屏无关结果。
 * 对应 Fuse.js 按 pattern 长度分档的评分策略。
 */
function maxDistanceFor(patternLength) {
  // 3 字符查询若允许 1 次编辑，"cot" 会把 "cat" 全捞出来 —— 噪音大于收益。
  if (patternLength < 4) return 0;
  if (patternLength < 6) return 1;
  return 2;
}

/**
 * 单个 token 是否命中一个文本字段。
 * 顺序：子串（最快）→ 词首前缀 → 受限编辑距离。
 */
function tokenMatches(text, token) {
  const haystack = normalize(text);
  if (!haystack) return false;
  if (haystack.indexOf(token) !== -1) return true;

  // 词首前缀："red" 命中 "red_dress_final"
  const parts = haystack.split(/[\s_\-./\\]+/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] && parts[i].startsWith(token)) return true;
  }

  const k = maxDistanceFor(token.length);
  if (k === 0) return false;

  // 只在长度接近的字段上跑编辑距离，避免长提示词拖慢
  if (Math.abs(haystack.length - token.length) <= k) {
    return boundedLevenshtein(haystack, token, k) <= k;
  }
  // 字段更长时，按词块比较
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] && Math.abs(parts[i].length - token.length) <= k) {
      if (boundedLevenshtein(parts[i], token, k) <= k) return true;
    }
  }
  return false;
}

/**
 * 判断单张图片是否命中查询（多 token 为 AND，与主流图库搜索一致）。
 */
export function matchImage(image, queryTokens) {
  if (!queryTokens || queryTokens.length === 0) return true;
  const fields = [image.name, image.subDir];
  for (let t = 0; t < queryTokens.length; t++) {
    const token = queryTokens[t];
    let hit = false;
    for (let f = 0; f < fields.length; f++) {
      if (fields[f] && tokenMatches(fields[f], token)) { hit = true; break; }
    }
    if (!hit) return false;
  }
  return true;
}

export function tokenize(query) {
  return normalize(query).trim().split(/\s+/).filter(Boolean);
}

/**
 * 过滤图片列表；返回保持原顺序的新数组（不修改入参）。
 */
export function filterImages(images, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return images;
  const out = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (img.isHeaderCard || img.isSpacer) continue;
    if (matchImage(img, tokens)) out.push(img);
  }
  return out;
}
