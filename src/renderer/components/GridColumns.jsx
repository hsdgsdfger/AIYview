import Thumb from './Thumb.jsx';

/** 瀑布流分列渲染 */
export default function GridColumns({
  buckets, selection, hoverEdit, hoverId, groupOf, setHoverId, clickItem, onOpenViewer, onContextMenu,
}) {
  return (
    <div className="cols">
      {buckets.map((bucket, i) => (
        <div className="col" key={i}>
          {bucket.items.map((entry) => (
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
          ))}
        </div>
      ))}
    </div>
  );
}
