/**
 * 缩略图总线：共享一个 IntersectionObserver + 批量请求（一次 20 张）。
 * 性能根因 2/5 的对策：不逐张 IPC、失败不回退原图。
 */

const subscribers = new Map(); // id -> Set<callback>
const visibleIds = new Set();
const inflight = new Set();
const failed = new Map(); // id -> failCount

let observer = null;
let flushTimer = null;
let sizePref = 'sm';

function ensureObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = Number(entry.target.dataset.thumbId);
        if (!Number.isFinite(id)) continue;
        if (entry.isIntersecting) visibleIds.add(id);
        else visibleIds.delete(id);
      }
      scheduleFlush();
    },
    { rootMargin: '400px 0px' }
  );
  return observer;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 40);
}

async function flush() {
  flushTimer = null;
  const batch = [];
  for (const id of visibleIds) {
    if (inflight.has(id)) continue;
    batch.push(id);
    inflight.add(id);
    if (batch.length >= 20) break;
  }
  if (batch.length === 0) return;

  const res = await window.yizi.thumb.get({ ids: batch, size: sizePref });
  if (!res.ok) {
    for (const id of batch) {
      inflight.delete(id);
      deliver(id, null);
      failed.set(id, (failed.get(id) || 0) + 1);
    }
    return;
  }
  for (const item of res.data) {
    inflight.delete(item.id);
    if (item.url) {
      failed.delete(item.id);
      deliver(item.id, item.url);
    } else {
      failed.set(item.id, (failed.get(item.id) || 0) + 1);
      deliver(item.id, null);
    }
  }
  // 还有可见未取的继续排
  if ([...visibleIds].some((id) => !inflight.has(id))) scheduleFlush();
}

function deliver(id, url) {
  const subs = subscribers.get(id);
  if (!subs) return;
  for (const cb of subs) cb(url);
}

export function setSizePref(size) {
  sizePref = size;
}

export function observe(el, id, callback) {
  const obs = ensureObserver();
  el.dataset.thumbId = String(id);
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(callback);
  obs.observe(el);
  return () => {
    obs.unobserve(el);
    const subs = subscribers.get(id);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) subscribers.delete(id);
    }
    visibleIds.delete(id);
  };
}

export function retryFailed(ids) {
  for (const id of ids) failed.delete(id);
  scheduleFlush();
}

export function isFailed(id) {
  return failed.has(id);
}
