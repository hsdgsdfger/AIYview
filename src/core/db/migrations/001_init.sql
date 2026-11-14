-- 001_init.sql
-- M0 基础表结构。规模假设：单库 20 万张图。
-- 约定：
--   * 时间统一存 INTEGER（epoch 毫秒），便于索引与排序，不存字符串。
--   * rel_path 为相对图库根的正斜杠路径，唯一键是 (library_id, rel_path)。
--   * age_level 允许 NULL，NULL 表示「未判定」，不等于 l0（需求 3.3）。
--   * 本文件只建结构，不写业务数据。

-- 图库：一个根目录一条记录（H1 图片留在原文件夹）
CREATE TABLE libraries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  root_path     TEXT    NOT NULL UNIQUE,
  image_count   INTEGER NOT NULL DEFAULT 0,
  last_scan_at  INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- 图片主表：只存元信息，文件本身留在原地
CREATE TABLE images (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id     INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  rel_path       TEXT    NOT NULL,
  file_name      TEXT    NOT NULL,
  ext            TEXT    NOT NULL,
  size_bytes     INTEGER NOT NULL,
  mtime_ms       INTEGER NOT NULL,
  width          INTEGER,
  height         INTEGER,
  heart          INTEGER NOT NULL DEFAULT 0 CHECK (heart BETWEEN 0 AND 5),
  rejected       INTEGER NOT NULL DEFAULT 0 CHECK (rejected IN (0, 1)),
  age_level      INTEGER CHECK (age_level IS NULL OR age_level BETWEEN 0 AND 4),
  age_source     TEXT    NOT NULL DEFAULT 'none' CHECK (age_source IN ('none', 'meta', 'manual')),
  age_confidence REAL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (library_id, rel_path)
);

-- 提示词：1:1 懒加载写入（20 万张全量存正文太占空间，按需落库）
CREATE TABLE image_prompts (
  image_id   INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  positive   TEXT,
  negative   TEXT,
  model      TEXT,
  sampler    TEXT,
  steps      INTEGER,
  cfg        REAL,
  seed       INTEGER,
  source     TEXT    NOT NULL DEFAULT 'meta' CHECK (source IN ('meta', 'comfy', 'manual')),
  raw_json   TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- 提示词库（需求 D2 / 4.1）：存进软件自己的库，不往原图目录写文件
CREATE TABLE prompt_library (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT,
  positive        TEXT,
  negative        TEXT,
  model           TEXT,
  sampler         TEXT,
  steps           INTEGER,
  cfg             REAL,
  seed            INTEGER,
  note            TEXT,
  source_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  source_rel_path TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- 标签字典（illuTag / WD tagger 的 selected_tags.csv 可直接导入）
CREATE TABLE tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  name_zh    TEXT,
  category   INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  source     TEXT    NOT NULL DEFAULT 'wd' CHECK (source IN ('wd', 'illutag', 'manual'))
);

-- 图片 ↔ 标签
CREATE TABLE image_tags (
  image_id   INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  confidence REAL    NOT NULL DEFAULT 1.0,
  origin     TEXT    NOT NULL DEFAULT 'meta' CHECK (origin IN ('meta', 'model', 'manual')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (image_id, tag_id)
);

-- 删除记录：系统回收站 + 12 小时内可撤回（F1 / F2 / F3）
CREATE TABLE deletions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id  INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  image_id    INTEGER REFERENCES images(id) ON DELETE SET NULL,
  rel_path    TEXT    NOT NULL,
  abs_path    TEXT    NOT NULL,
  size_bytes  INTEGER,
  deleted_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  restored_at INTEGER,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'restored', 'expired'))
);

-- 应用设置（主题、遮挡阈值等）
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- 列表页按目录 + 时间倒序（首屏 ≤300ms 的主查询路径）
CREATE INDEX idx_images_library_mtime ON images (library_id, mtime_ms DESC, id DESC);
CREATE INDEX idx_images_library_name  ON images (library_id, file_name);
CREATE INDEX idx_images_heart         ON images (library_id, heart);
CREATE INDEX idx_images_age           ON images (library_id, age_level);
CREATE INDEX idx_images_rejected      ON images (library_id) WHERE rejected = 1;

CREATE INDEX idx_image_tags_tag       ON image_tags (tag_id, image_id);
CREATE INDEX idx_tags_name_zh         ON tags (name_zh);

CREATE INDEX idx_prompt_library_time  ON prompt_library (created_at DESC);
CREATE INDEX idx_prompt_library_image ON prompt_library (source_image_id);

CREATE INDEX idx_deletions_sweep      ON deletions (status, expires_at);
CREATE INDEX idx_deletions_path       ON deletions (abs_path);

PRAGMA user_version = 1;
