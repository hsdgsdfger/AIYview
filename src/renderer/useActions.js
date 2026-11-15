import { useMemo } from 'react';

/**
 * 全局动作集合（加库 / 扫描 / 标记 / 分级 / 删除 / 选择 / 打标 / 切库）。
 * 从 store.jsx 拆出来，便于单文件行数达标；依赖通过参数注入，不直接 import store。
 */
export function useActions({
  libraryId, run, say, itemsRef,
  setItems, setSelection, setLibraries, setLibraryId,
  setScanning, setScanProgress, setTagging, setRevealed,
  refreshList,
}) {
  /** 撤销栈：只记「标记类」改动（心数 / 废标 / 分级），删除不进栈 */
  const undoStack = [];
  const MAX_UNDO = 30;

  /** 快照只取本次真正会改的字段，避免「撤销心数」顺手把分级也覆盖掉 */
  const snapshot = (ids, fields) => {
    const list = (itemsRef && itemsRef.current && itemsRef.current.items) || [];
    return ids
      .map((id) => list.find((it) => it.id === id))
      .filter(Boolean)
      .map((it) => {
        const row = { id: it.id };
        for (const f of fields) row[f] = it[f];
        return row;
      });
  };

  const pushUndo = (label, ids, fields) => {
    const before = snapshot(ids, fields);
    if (before.length === 0) return;
    undoStack.push({ label, before, fields });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  };

  return useMemo(() => ({
    /** 添加文件夹：系统目录选择框 → 注册（同路径幂等）→ 自动扫描 */
    async addFolder() {
      const data = await run(window.aiyview.library.pick(), '添加文件夹');
      if (!data || data.canceled || !data.libraries || data.libraries.length === 0) return;
      setLibraries((prev) => {
        const map = new Map(prev.map((l) => [l.id, l]));
        for (const lib of data.libraries) map.set(lib.id, lib);
        return [...map.values()];
      });
      const target = data.libraries[data.libraries.length - 1];
      setLibraryId(target.id);
      say(`已添加「${target.name}」，开始扫描…`);
      setScanning(true);
      const summary = await run(window.aiyview.scan.run({ libraryId: target.id }), '扫描');
      setScanning(false);
      setScanProgress(null);
      if (summary) {
        say(`扫描完成：${summary.total} 张（新增 ${summary.inserted}，${(summary.elapsedMs / 1000).toFixed(1)}s）`);
      }
    },
    async scanCurrent() {
      if (libraryId == null) return;
      setScanning(true);
      const summary = await run(window.aiyview.scan.run({ libraryId }), '扫描');
      setScanning(false);
      setScanProgress(null);
      if (summary) {
        say(`扫描完成：${summary.total} 张，新增 ${summary.inserted}，耗时 ${(summary.elapsedMs / 1000).toFixed(1)}s`);
      }
      // 扫完立刻重载列表：新图直接出现，当前浏览位置由栅格锚定不变
      await refreshList();
    },
    /** 显式刷新列表（默认排序下只把新图插到最前，不重排、不跳位置） */
    refresh() {
      refreshList();
    },
    /** 切换图库（多图库入口） */
    switchLibrary(id) {
      if (id === libraryId) return;
      setLibraryId(id);
    },
    async removeLibrary(id) {
      const res = await run(window.aiyview.library.remove({ id }), '移除图库');
      if (!res) return;
      setLibraries((prev) => {
        const next = prev.filter((l) => l.id !== id);
        setLibraryId((cur) => (cur === id ? (next[0] ? next[0].id : null) : cur));
        return next;
      });
      say('已移除图库（图片文件仍在原文件夹）');
    },
    async setMarks(ids, patch) {
      pushUndo('标记', ids, Object.keys(patch));
      const res = await run(window.aiyview.image.marks({ ids, ...patch }), '标记');
      if (res) {
        setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, ...patch } : it)));
        // 任何标记都不重排列表（用户硬要求：只有主动改排序才变）
      }
    },
    async setAge(ids, level) {
      pushUndo('分级', ids, ['ageLevel', 'ageSource']);
      await run(window.aiyview.image.age({ ids, level, source: 'manual' }), '分级');
      setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, ageLevel: level, ageSource: 'manual' } : it)));
      // 分级也不重排
    },
    /** Ctrl+Z：把最近一次标记 / 分级改回原值（删图不在此列，回收站那头管） */
    async undo() {
      const entry = undoStack.pop();
      if (!entry) {
        say('没有可撤销的操作');
        return false;
      }
      const fields = entry.fields || [];
      for (const b of entry.before) {
        if (fields.includes('heart') || fields.includes('rejected')) {
          const marks = { ids: [b.id] };
          if (fields.includes('heart')) marks.heart = b.heart;
          if (fields.includes('rejected')) marks.rejected = b.rejected;
          await window.aiyview.image.marks(marks).catch(() => {});
        }
        if (fields.includes('ageLevel')) {
          await window.aiyview.image
            .age({ ids: [b.id], level: b.ageLevel, source: b.ageLevel == null ? 'none' : (b.ageSource || 'manual') })
            .catch(() => {});
        }
      }
      setItems((prev) => prev.map((it) => {
        const b = entry.before.find((x) => x.id === it.id);
        if (!b) return it;
        const next = { ...it };
        if (fields.includes('heart')) next.heart = b.heart;
        if (fields.includes('rejected')) next.rejected = b.rejected;
        if (fields.includes('ageLevel')) {
          next.ageLevel = b.ageLevel;
          next.ageSource = b.ageLevel == null ? 'none' : (b.ageSource || 'manual');
        }
        return next;
      }));
      say(`已撤销「${entry.label}」${entry.before.length > 1 ? `（${entry.before.length} 张）` : ''}`);
      return true;
    },
    async trash(ids) {
      const res = await run(window.aiyview.delete.trash({ ids }), '删除');
      if (res) {
        const gone = new Set(ids);
        setItems((prev) => prev.filter((it) => !gone.has(it.id)));
        setSelection(new Set());
        say(`已移入回收站 ${res.trashed} 张${res.failed.length ? `，失败 ${res.failed.length}` : ''}`);
      }
    },
    toggleSelect(id, additive) {
      setSelection((prev) => {
        const next = additive ? new Set(prev) : new Set();
        if (additive && prev.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    selectRange(ids, additive) {
      setSelection((prev) => {
        const next = additive ? new Set(prev) : new Set();
        for (const id of ids) next.add(id);
        return next;
      });
    },
    clearSelection() {
      setSelection(new Set());
    },
    reveal(id) {
      setRevealed((prev) => new Set(prev).add(id));
    },
    /** 点已显示的遮挡图 → 恢复遮挡 */
    unreveal(id) {
      setRevealed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    async startTagging() {
      if (libraryId == null) return;
      setTagging({ done: 0, total: 0 });
      const r = await run(window.aiyview.tag.run({ libraryId }), '打标');
      setTagging(null);
      if (r) {
        const failed = r.failed ? `，${r.failed} 张失败${r.firstError ? `（${r.firstError}）` : ''}` : '';
        say(r.cancelled ? `打标中断 ${r.done}/${r.total}（可续跑）` : `打标完成：${r.tagged} 张${failed}`);
      }
    },
    async stopTagging() {
      await run(window.aiyview.tag.stop(), '停止打标');
    },
  }), [libraryId, run, say, setItems, setSelection, setLibraries, setLibraryId,
    setScanning, setScanProgress, setTagging, setRevealed, refreshList]);
}
