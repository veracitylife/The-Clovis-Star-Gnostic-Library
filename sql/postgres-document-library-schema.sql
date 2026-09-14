CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  bio text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('article','book','tablet','manuscript','transcript','source_text','image','audio','video','pdf','other')),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  summary text DEFAULT '',
  body text DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  author_id uuid REFERENCES authors(id) ON DELETE SET NULL,
  source_date text DEFAULT '',
  publication_date date,
  language text DEFAULT '',
  origin_location text DEFAULT '',
  historical_period text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_item_topics (
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (content_item_id, topic_id)
);

CREATE TABLE IF NOT EXISTS content_item_tags (
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (content_item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  citation_text text NOT NULL,
  source_url text DEFAULT '',
  source_title text DEFAULT '',
  page_number text DEFAULT '',
  line_reference text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  storage_driver text NOT NULL DEFAULT 'local',
  original_filename text NOT NULL,
  stored_filename text NOT NULL,
  relative_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  file_hash text NOT NULL,
  public_url text NOT NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_asset_id uuid REFERENCES file_assets(id) ON DELETE CASCADE,
  content_item_id uuid REFERENCES content_items(id) ON DELETE CASCADE,
  raw_text text DEFAULT '',
  cleaned_text text DEFAULT '',
  ocr_status text NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','processing','completed','failed','skipped')),
  extraction_method text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_index_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid REFERENCES content_items(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  error_message text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embedding_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid REFERENCES content_items(id) ON DELETE CASCADE,
  file_asset_id uuid REFERENCES file_assets(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  token_count integer NOT NULL DEFAULT 0,
  embedding_model text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_items_type_status ON content_items(type, status);
CREATE INDEX IF NOT EXISTS idx_content_items_slug ON content_items(slug);
CREATE INDEX IF NOT EXISTS idx_content_items_search ON content_items USING gin ((coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_document_texts_search ON document_texts USING gin ((coalesce(cleaned_text,'') || ' ' || coalesce(raw_text,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_file_assets_content_item ON file_assets(content_item_id);
CREATE INDEX IF NOT EXISTS idx_embedding_chunks_content_item ON embedding_chunks(content_item_id, chunk_index);

