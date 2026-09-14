import { createQueueService } from "./queue-service.js";
import { createSearchService } from "./search-service.js";
import { createStorageService } from "./storage-service.js";
import { createVectorService } from "./vector-service.js";

export async function buildSystemHealth({ storageMode, runtimeState, store, siteVersion } = {}) {
  const storage = createStorageService();
  const search = createSearchService();
  const vector = createVectorService();
  const queue = createQueueService();

  const [storageStatus, searchStatus, vectorStatus, queueStatus, databaseStatus] = await Promise.all([
    storage.status().catch((error) => ({ ok: false, error: error.message })),
    search.status().catch((error) => ({ ok: false, error: error.message })),
    vector.status().catch((error) => ({ ok: false, error: error.message })),
    queue.status().catch((error) => ({ ok: false, error: error.message })),
    store?.health ? store.health().catch((error) => ({ ok: false, error: error.message })) : Promise.resolve({ ok: true, driver: storageMode || "unknown" })
  ]);

  return {
    ok: Boolean(databaseStatus.ok && storageStatus.ok && searchStatus.ok && vectorStatus.ok && queueStatus.ok),
    app: {
      name: "clovisstar-static",
      version: siteVersion?.version || "unknown",
      releaseName: siteVersion?.releaseName || "",
      status: "ok",
      generatedAt: new Date().toISOString()
    },
    database: databaseStatus,
    storage: storageStatus,
    search: searchStatus,
    vector: vectorStatus,
    redis: queueStatus,
    content: {
      books: runtimeState?.books?.length || 0,
      publicBooks: runtimeState?.stats?.publicBooks || 0,
      collections: runtimeState?.collections?.length || 0,
      openReviewItems: runtimeState?.stats?.openReviewItems || 0
    }
  };
}

