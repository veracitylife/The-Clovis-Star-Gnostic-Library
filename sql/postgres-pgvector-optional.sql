CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE embedding_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_embedding_chunks_embedding
  ON embedding_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

