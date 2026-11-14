/** 内联 SVG 图标（统一 1.6 描边，随文字色） */
const PATHS = {
  'folder-plus': 'M3 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm9 3v6m-3-3h6',
  folder: 'M3 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  heart: 'M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 4.65-7 9-7 9Z',
  tag: 'M4 5h7l8 8-7 7-8-8V5Zm3 3h.01',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm9 15-4.2-4.2',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  waterfall: 'M4 4h4v13H4V4Zm6-1h4v18h-4V3Zm6 5h4v9h-4V8Z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3-1.8-.5-.5-1.3.9-1.7-1.4-1.4-1.6.9-1.3-.5L13 5h-2l-.5 1.8-1.3.5-1.7-.9L6 7.8l.9 1.6-.5 1.3L5 11v2l1.8.5.5 1.3-.9 1.7 1.4 1.4 1.6-.9 1.3.5L11 19h2l.5-1.8 1.3-.5 1.7.9 1.4-1.4-.9-1.6.5-1.3L19 13v-2Z',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  back: 'M15 5l-7 7 7 7',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  mask: 'M4 5h16v14H4V5Zm0 7h16',
  blur: 'M12 3c4 5 6 7.5 6 10a6 6 0 1 1-12 0c0-2.5 2-5 6-10Z',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  sort: 'M4 7h12M4 12h8M4 17h4m9-9 3-3 3 3m-3-3v12',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
};

export default function Icon({ name, size = 16, className = '', strokeWidth = 1.6 }) {
  const d = PATHS[name];
  if (!d) return null;
  const filled = name === 'heart' || name === 'blur';
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} fill={filled ? 'currentColor' : 'none'} />
    </svg>
  );
}
