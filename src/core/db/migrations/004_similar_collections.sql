-- 004_similar_collections.sql
-- 相似图检测：phash 存 64 位感知哈希（16 位十六进制字符串），由 JS 端用 dHash 生成。
-- 虚拟收藏夹：只记「哪些图属于哪个集」，不复制、不移动任何文件。

ALTER TABLE images ADD COLUMN phash TEXT;

CREATE INDEX idx_images_phash ON images (library_id, phash);

CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (library_id, name)
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  image_id      INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (collection_id, image_id)
);

PRAGMA user_version = 4;
