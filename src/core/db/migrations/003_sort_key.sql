-- 003_sort_key.sql
-- 名称排序用「自然排序键」：把路径里的数字段左补零后再比较，
-- 使 img_2.png 排在 img_10.png 前面（原先 ORDER BY rel_path 是纯字典序）。
-- 键由 JS 生成（见 imageRepository.naturalKey），这里只加列与索引。

ALTER TABLE images ADD COLUMN sort_key TEXT;

CREATE INDEX idx_images_library_sort ON images (library_id, sort_key, id);

PRAGMA user_version = 3;
