/**
 * 同批图（相近版本）分组：指纹距离 ≤ 4 的图视为同一批，卡片上着色并标「同组 N」。
 * 只在已加载的那批里统计；组太大（>12 张）或只有自己就不标，避免整库连成一片。
 */
const MAX_GROUP = 12;

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

function hueOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export function makeGroupLookup(items) {
  const list = items.filter((it) => typeof it.phash === 'string' && it.phash.length === 16 && it.phash !== 'ERR');
  const parent = new Map();
  const find = (x) => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur)));
      cur = parent.get(cur);
    }
    return cur;
  };
  for (const it of list) parent.set(it.id, it.id);

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (hamming(list[i].phash, list[j].phash) <= 4) {
        const ra = find(list[i].id);
        const rb = find(list[j].id);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }

  const sizes = new Map(); // 组根 id → 组大小
  const roots = new Map(); // 图 id → 组根 id
  for (const it of list) {
    const root = find(it.id);
    roots.set(it.id, root);
    sizes.set(root, (sizes.get(root) || 0) + 1);
  }

  return (it) => {
    const root = roots.get(it.id);
    if (!root) return { count: 0, hue: 0 };
    const size = sizes.get(root) || 0;
    if (size < 2 || size > MAX_GROUP) return { count: 0, hue: 0 };
    return { count: size, hue: hueOf(String(root)) };
  };
}
