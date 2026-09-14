export function createSearchService(options = {}) {
  const requestedDriver = String(options.driver || process.env.SEARCH_DRIVER || "postgres").toLowerCase();
  const meiliConfigured = Boolean(process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_API_KEY);
  const driver = requestedDriver === "meilisearch" && meiliConfigured ? "meilisearch" : "postgres";
  const fallbackReason = requestedDriver === "meilisearch" && !meiliConfigured ? "Meilisearch credentials are not configured; using PostgreSQL search fallback." : "";

  return {
    driver,
    requestedDriver,
    fallbackReason,
    async status() {
      return {
        ok: true,
        driver,
        requestedDriver,
        index: process.env.MEILISEARCH_INDEX || "clovisstar_content",
        fallbackReason
      };
    },
    async search(query, filters = {}) {
      return {
        driver,
        query: String(query || "").trim(),
        filters,
        results: [],
        message: driver === "postgres"
          ? "PostgreSQL search interface is ready; wire this to the content_item/document_text tables after PostgreSQL migration."
          : "Meilisearch interface is configured; add indexing worker before enabling production search."
      };
    }
  };
}

