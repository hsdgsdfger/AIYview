import Icon from './Icon.jsx';

/**
 * 五颗心评分：永远是 5 格，前 value 颗点亮（不是「N 颗心」拼接）。
 * 只读模式（无 onChange）用于缩略图角标。
 */
export default function Hearts({ value = 0, max = 5, onChange, size = 16, className = '', readOnly = false }) {
  const v = Math.max(0, Math.min(max, Number(value) || 0));
  return (
    <span className={`hearts ${className}`} role={readOnly ? undefined : 'group'} aria-label={`${v} 心`}>
      {Array.from({ length: max }, (_, i) => {
        const on = i < v;
        if (readOnly) {
          return (
            <span key={i} className={`heart-dot ${on ? 'on' : ''}`}>
              <Icon name="heart" size={size} />
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className={`heart-dot ${on ? 'on' : ''}`}
            title={`${i + 1} 心`}
            onClick={(e) => {
              e.stopPropagation();
              onChange?.(i + 1);
            }}
          >
            <Icon name="heart" size={size} />
          </button>
        );
      })}
    </span>
  );
}
