-- 002_folders.sql
-- 目录缓存：目录树不靠每次扫 20 万行 rel_path 现算，
-- 扫描入库时把每个文件的父目录链写进 folders，树查询直接走索引。

CREATE TABLE folders (
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  dir_path   TEXT    NOT NULL,              -- 相对图库根，正斜杠，'' 表示根
  file_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (library_id, dir_path)
);

CREATE INDEX idx_folders_library ON folders (library_id, dir_path);

PRAGMA user_version = 2;
