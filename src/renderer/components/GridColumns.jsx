import Thumb from './Thumb.jsx';

/** 瀑布流分列渲染：buckets 里既有图，也有按时间排序时插入的日期条 */
export default function GridColumns({
  buckets, selection, hoverEdit, hoverId, groupOf, setHoverId, clickItem, onOpenViewer, onContextMenu,
}) {
  return (
    <div className="cols">
      {buckets.map((bucket, i) => (
        <div className="col" key={i}>
          {bucket.items.map((entry) => (entry.day ? (
            <div className="day-sep" key={`day-${entry.day}`}>
              <span>{entry.day}</span>
              <span className="day-count">{entry.count} 张</span>
            </div>
          ) : (
            <Thumb
              key={entry.id}
              item={entry}
              selected={selection.has(entry.id)}
              hovered={hoverEdit && hoverId === entry.id}
              groupHue={groupOf(entry).hue}
              groupCount={groupOf(entry).count}
              onHover={setHoverId}
              onClick={clickItem}
              onDouble={() => onOpenViewer(entry)}
              onContext={(it, e) => {
                e.preventDefault();
                onContextMenu(it, e);
              }}
            />
          )))}
        </div>
      ))}
    </div>
  );
}
