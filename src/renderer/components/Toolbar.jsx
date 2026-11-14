import { useStore } from '../store.jsx';

/** 顶栏：视图切换 / 缩放 / 搜索 / 筛选 / 排序 / 扫描 / 状态 */
export default function Toolbar() {
  const {
    libraryId, view, setView, filters, setFilters, sort, setSort,
    scanning, scanProgress, status, actions,
    occlusion, setOcclusion, tagging, tagFilter, setTagFilter,
  } = useStore();

  return (
    <div className="toolbar">
      <div className="tb-group">
        <button
          className={`btn ${view.mode === 'grid' ? 'primary' : 'ghost'}`}
          onClick={() => setView({ ...view, mode: 'grid' })}
        >网格</button>
        <button
          className={`btn ${view.mode === 'waterfall' ? 'primary' : 'ghost'}`}
          onClick={() => setView({ ...view, mode: 'waterfall' })}
        >瀑布流</button>
        {view.mode === 'grid' && (
          <input
            type="range"
            min="120"
            max="420"
            value={view.gridSize}
            onChange={(e) => setView({ ...view, gridSize: Number(e.target.value) })}
            title="缩略图尺寸（Ctrl+滚轮也可调）"
            className="size-slider"
          />
        )}
      </div>

      <input
        className="input search"
        placeholder="文件名过滤…"
        value={filters.nameLike}
        onChange={(e) => setFilters({ ...filters, nameLike: e.target.value })}
      />

      <div className="tb-group">
        <label className="tb-check" title="只看收藏（≥1 心）">
          <input
            type="checkbox"
            checked={filters.heartMin != null}
            onChange={(e) => setFilters({ ...filters, heartMin: e.target.checked ? 1 : null })}
          />♥
        </label>
        <label className="tb-check" title="只看废标">
          <input
            type="checkbox"
            checked={filters.rejectedOnly}
            onChange={(e) => setFilters({ ...filters, rejectedOnly: e.target.checked })}
          />废
        </label>
        <label className="tb-check" title="分级阈值：隐藏 ≥ 该档（未判定不隐藏）">
          <select
            value={filters.ageMax ?? ''}
            onChange={(e) => setFilters({ ...filters, ageMax: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">分级不限</option>
            <option value="1">隐藏 ≥ l1</option>
            <option value="2">隐藏 ≥ l2</option>
            <option value="3">隐藏 ≥ l3</option>
            <option value="4">隐藏 ≥ l4</option>
          </select>
        </label>
        <select
          value={occlusion.mode}
          onChange={(e) => setOcclusion({ ...occlusion, mode: e.target.value })}
          title="分级遮挡方式"
        >
          <option value="mask">遮罩</option>
          <option value="blur">模糊</option>
          <option value="hidden">隐藏</option>
        </select>
        {tagFilter && (
          <button className="btn primary" onClick={() => setTagFilter(null)}>
            标签: {tagFilter.name} ✕
          </button>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="mtime">按时间</option>
          <option value="name">按名称</option>
        </select>
      </div>

      <div className="tb-group right">
        <button
          className="btn ghost"
          onClick={() => {
            const rootEl = document.documentElement;
            const light = rootEl.getAttribute('data-theme') === 'light';
            rootEl.setAttribute('data-theme', light ? 'dark' : 'light');
            window.yizi.settings.set({ key: 'theme', value: light ? 'dark' : 'light' });
          }}
        >主题</button>
        {scanning && scanProgress ? (
          <span className="scan-progress">
            {scanProgress.phase === 'walk' ? '扫描目录…' : `入库 ${scanProgress.done}/${scanProgress.total}`}
          </span>
        ) : null}
        <button
          className="btn"
          disabled={!libraryId || scanning}
          onClick={() => actions.scan()}
        >{scanning ? '扫描中…' : '扫描'}</button>
                <button
          className="btn"
          disabled={!libraryId || tagging != null}
          onClick={() => (tagging ? actions.stopTagging() : actions.startTagging())}
          title="只处理无元数据的图，可中断续跑"
        >{tagging ? '打标 ' + tagging.done + '/' + tagging.total + '（点击停止）' : '打标'}</button>
        {status && <span className="tb-status">{status}</span>}
      </div>
    </div>
  );
}
