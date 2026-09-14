CREATE TABLE IF NOT EXISTS clovisstar_file_assets (
  id VARCHAR(64) PRIMARY KEY,
  content_item_id VARCHAR(64) NULL,
  storage_driver VARCHAR(40) NOT NULL DEFAULT 'local',
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  relative_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_hash VARCHAR(128) NOT NULL,
  public_url VARCHAR(800) NOT NULL,
  visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  created_by VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_file_assets_content_item (content_item_id),
  KEY idx_file_assets_visibility (visibility),
  KEY idx_file_assets_hash (file_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

