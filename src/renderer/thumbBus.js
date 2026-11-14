/**
 * 缩略图总线：批量请求（一次 20 张）+ 去重 + 失败不自动重试。
 *
 * 设计取舍：
 *   - 不用 IntersectionObserver —— UI 用 CSS zoom 缩放后 IO 的视口判定不可靠，
 *     会出现「全部判定不可见 → 一张都不请求」或「反复误判 → 死循环请求」。
 *   - 分页每页 120 张，挂载即请求，代价可控；缓存命中后重复滚动无成本。
 *   - 失败进入 failed 集合，不再自动重试，避免坏图把队列打满。
 */

const subscribers = new Map(); // id -> Set<callback>
const pending = new Set();     // 待请求的 id
const inflight = new Set();
const failed = new Set();
const delivered = new Map();   // id -> url（已取到的直接复用）

let flushTimer = null;
let sizePref = 'sm';

const counters = { observe: 0, cleanup: 0, batch: 0, req: 0, ok: 0, fail: 0, deliverOk: 0, deliverNull: 0 };

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 30);
}

async function flush() {
  flushTimer = null;
  const batch = [];
  for (const id of pending) {
    if (batch.length >= 20) break;
    pending.delete(id);
    if (inflight.has(id) || failed.has(id)) continue;
    batch.push(id);
    inflight.add(id);
  }
  if (batch.length === 0) {
    if (pending.size > 0) scheduleFlush();
    return;
  }

  counters.batch++;
  counters.req += batch.length;

  const res = await window.yizi.thumb.get({ ids: batch, size: sizePref });
  if (!res || !res.ok) {
    for (const id of batch) {
      inflight.delete(id);
      failed.add(id);
      counters.fail++;
      deliver(id, null);
    }
  } else {
    const seen = new Set();
    for (const item of res.data) {
      seen.add(item.id);
      inflight.delete(item.id);
      if (item.url) {
        delivered.set(item.id, item.url);
        counters.ok++;
        counters.deliverOk++;
        deliver(item.id, item.url);
      } else {
        failed.add(item.id);
        counters.fail++;
        counters.deliverNull++;
        deliver(item.id, null);
      }
    }
    // 主进程没返回的 id（数据缺失）也标记失败，避免一直转圈
    for (const id of batch) {
      if (seen.has(id)) continue;
      inflight.delete(id);
      failed.add(id);
      deliver(id, null);
    }
  }

  if (pending.size > 0) scheduleFlush();
}

function deliver(id, url) {
  const subs = subscribers.get(id);
  if (!subs) return;
  for (const cb of subs) cb(url);
}

export function setSizePref(size) {
  if (sizePref === size) return;
  sizePref = size;
  // 档位变了：已交付的旧档不再复用，重新取一次
  for (const [id, url] of delivered) {
    if (!url) continue;
    delivered.delete(id);
    pending.add(id);
  }
  scheduleFlush();
}

export function getSizePref() {
  return sizePref;
}

export function observe(_el, id, callback) {
  counters.observe++;
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(callback);

  const ready = delivered.get(id);
  if (ready) {
    callback(ready);
    return () => removeSub(id, callback);
  }
  if (!failed.has(id) && !inflight.has(id)) {
    pending.add(id);
    scheduleFlush();
  }
  return () => removeSub(id, callback);
}

function removeSub(id, callback) {
  counters.cleanup++;
  const subs = subscribers.get(id);
  if (!subs) return;
  subs.delete(callback);
  if (subs.size === 0) subscribers.delete(id);
}

export function retryFailed(ids) {
  for (const id of ids) {
    failed.delete(id);
    pending.add(id);
  }
  scheduleFlush();
}

export function getBusStats() {
  return {
    pending: pending.size,
    inflight: inflight.size,
    failed: failed.size,
    subs: subscribers.size,
    delivered: delivered.size,
    counters,
  };
}
