CREATE TABLE IF NOT EXISTS clovisstar_users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  display_name VARCHAR(190) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  password_hash VARCHAR(255) NOT NULL,
  api_enabled TINYINT(1) NOT NULL DEFAULT 0,
  api_token_hash CHAR(64) NULL,
  api_token_prefix VARCHAR(16) NULL,
  api_token_created_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_users_role (role),
  INDEX idx_clovisstar_users_api_enabled (api_enabled),
  INDEX idx_clovisstar_users_api_lookup (api_enabled, api_token_hash),
  UNIQUE KEY uq_clovisstar_users_api_token_hash (api_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clovisstar_users
  ADD COLUMN IF NOT EXISTS api_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS api_token_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS api_token_prefix VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS api_token_created_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS clovisstar_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token CHAR(64) NOT NULL,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(120) NULL,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_sessions_user_id (user_id),
  INDEX idx_clovisstar_sessions_expires_at (expires_at),
  INDEX idx_clovisstar_sessions_token_expiry (token_hash, expires_at),
  CONSTRAINT fk_clovisstar_sessions_user
    FOREIGN KEY (user_id) REFERENCES clovisstar_users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clovisstar_highlights (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  book_slug VARCHAR(190) NOT NULL,
  book_title VARCHAR(255) NOT NULL,
  color VARCHAR(32) NOT NULL DEFAULT 'yellow',
  selected_text TEXT NOT NULL,
  note TEXT NULL,
  folder VARCHAR(120) NOT NULL DEFAULT 'General',
  tags_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_highlights_user_book (user_id, book_slug),
  INDEX idx_clovisstar_highlights_user_created (user_id, created_at),
  INDEX idx_clovisstar_highlights_user_folder (user_id, folder),
  CONSTRAINT fk_clovisstar_highlights_user
    FOREIGN KEY (user_id) REFERENCES clovisstar_users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clovisstar_highlights
  ADD COLUMN IF NOT EXISTS folder VARCHAR(120) NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS tags_json LONGTEXT NULL,
  ADD INDEX IF NOT EXISTS idx_clovisstar_highlights_user_folder (user_id, folder);

CREATE TABLE IF NOT EXISTS clovisstar_settings (
  setting_key VARCHAR(128) PRIMARY KEY,
  setting_value_json LONGTEXT NOT NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_settings_updated_by (updated_by),
  CONSTRAINT fk_clovisstar_settings_user
    FOREIGN KEY (updated_by) REFERENCES clovisstar_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clovisstar_member_preferences (
  user_id CHAR(36) PRIMARY KEY,
  show_bookmarks_in_sidebar TINYINT(1) NOT NULL DEFAULT 0,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_clovisstar_member_preferences_user
    FOREIGN KEY (user_id) REFERENCES clovisstar_users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_clovisstar_member_preferences_updated_by
    FOREIGN KEY (updated_by) REFERENCES clovisstar_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clovisstar_member_notes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  source VARCHAR(80) NOT NULL DEFAULT 'THOTH',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_member_notes_user_created (user_id, created_at),
  CONSTRAINT fk_clovisstar_member_notes_user FOREIGN KEY (user_id) REFERENCES clovisstar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clovisstar_book_overrides (
  book_slug VARCHAR(190) PRIMARY KEY,
  visibility VARCHAR(32) NULL,
  title_override VARCHAR(255) NULL,
  collection_override VARCHAR(190) NULL,
  excerpt_override TEXT NULL,
  review_status VARCHAR(32) NULL,
  admin_notes TEXT NULL,
  source_metadata_json LONGTEXT NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_book_overrides_updated_by (updated_by),
  CONSTRAINT fk_clovisstar_book_overrides_user
    FOREIGN KEY (updated_by) REFERENCES clovisstar_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clovisstar_book_overrides
  ADD COLUMN IF NOT EXISTS source_metadata_json LONGTEXT NULL;

CREATE TABLE IF NOT EXISTS clovisstar_review_queue (
  id VARCHAR(255) PRIMARY KEY,
  book_slug VARCHAR(190) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  source_label VARCHAR(190) NULL,
  summary TEXT NOT NULL,
  details_json LONGTEXT NULL,
  admin_notes TEXT NULL,
  assigned_to VARCHAR(190) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_review_queue_book_slug (book_slug),
  INDEX idx_clovisstar_review_queue_status (status),
  INDEX idx_clovisstar_review_queue_status_severity (status, severity),
  INDEX idx_clovisstar_review_queue_updated_by (updated_by),
  CONSTRAINT fk_clovisstar_review_queue_user
    FOREIGN KEY (updated_by) REFERENCES clovisstar_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clovisstar_admin_audit_log (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  action VARCHAR(120) NOT NULL,
  payload_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_admin_audit_log_user_created (user_id, created_at),
  INDEX idx_clovisstar_admin_audit_log_created (created_at),
  CONSTRAINT fk_clovisstar_admin_audit_log_user
    FOREIGN KEY (user_id) REFERENCES clovisstar_users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clovisstar_transients (
  transient_key VARCHAR(190) PRIMARY KEY,
  transient_value_json LONGTEXT NOT NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clovisstar_transients_expires_at (expires_at),
  INDEX idx_clovisstar_transients_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

