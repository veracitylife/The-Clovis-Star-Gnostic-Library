import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clovisstar-architecture-"));

process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_PATH = path.join(tempRoot, "uploads");
process.env.PUBLIC_FILE_BASE_URL = "https://clovisstar.com/uploads";
process.env.MAX_UPLOAD_SIZE_MB = "1";
process.env.ALLOWED_UPLOAD_MIME_TYPES = "text/plain,image/png";
process.env.SEARCH_DRIVER = "meilisearch";
delete process.env.MEILISEARCH_HOST;
delete process.env.MEILISEARCH_API_KEY;
process.env.VECTOR_SEARCH_ENABLED = "false";
process.env.QUEUE_DRIVER = "redis";
delete process.env.REDIS_URL;

const { createStorageService } = await import("../services/storage-service.js");
const { createSearchService } = await import("../services/search-service.js");
const { createVectorService } = await import("../services/vector-service.js");
const { createQueueService } = await import("../services/queue-service.js");
const { buildSystemHealth } = await import("../services/system-health.js");

try {
  const storage = createStorageService();
  const saved = await storage.save(Buffer.from("sample document"), {
    contentType: "books",
    mimeType: "text/plain",
    originalFilename: "Unsafe Name.txt"
  });
  assert.equal(saved.storageDriver, "local");
  assert.equal(saved.mimeType, "text/plain");
  assert.match(saved.relativePath, /^\d{4}\/\d{2}\/books\//);
  assert.match(saved.publicUrl, /^https:\/\/clovisstar\.com\/uploads\//);
  assert.equal(await storage.exists(saved), true);

  const storageStatus = await storage.status();
  assert.equal(storageStatus.driver, "local");
  assert.equal(storageStatus.fileCount, 1);

  const search = createSearchService();
  const searchStatus = await search.status();
  assert.equal(searchStatus.driver, "postgres");
  assert.match(searchStatus.fallbackReason, /Meilisearch/);

  const vector = createVectorService();
  const vectorStatus = await vector.status();
  assert.equal(vectorStatus.enabled, false);
  assert.equal(vectorStatus.mode, "disabled");
  assert.equal(vector.chunkText("alpha beta gamma", 5).length, 4);

  const queue = createQueueService();
  const queueStatus = await queue.status();
  assert.equal(queueStatus.driver, "database");

  const health = await buildSystemHealth({
    storageMode: "json",
    runtimeState: { books: [{ slug: "x" }], stats: { publicBooks: 1, openReviewItems: 0 }, collections: [{ title: "Test" }] },
    store: { health: async () => ({ ok: true, driver: "json" }) }
  });
  assert.equal(health.ok, true);
  assert.equal(health.content.books, 1);

  console.log("architecture smoke ok");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

