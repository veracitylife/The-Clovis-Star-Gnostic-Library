function chunkText(text, maxChars = 1800) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks = [];
  for (let offset = 0; offset < clean.length; offset += maxChars) {
    chunks.push(clean.slice(offset, offset + maxChars));
  }
  return chunks;
}

export function createVectorService(options = {}) {
  const enabled = String(options.enabled ?? process.env.VECTOR_SEARCH_ENABLED ?? "false").toLowerCase() === "true";
  const provider = process.env.EMBEDDING_PROVIDER || "";
  const model = process.env.EMBEDDING_MODEL || "";
  const hasProvider = Boolean(provider && model && process.env.EMBEDDING_API_KEY);

  return {
    enabled,
    driver: process.env.VECTOR_DRIVER || "pgvector",
    provider,
    model,
    chunkText,
    async status() {
      return {
        ok: true,
        enabled,
        driver: process.env.VECTOR_DRIVER || "pgvector",
        providerConfigured: hasProvider,
        mode: enabled ? (hasProvider ? "ready" : "chunks-only") : "disabled"
      };
    },
    async indexContent(contentItem = {}) {
      const chunks = chunkText(contentItem.body || contentItem.cleanedText || "");
      return {
        status: enabled && hasProvider ? "pending" : "skipped",
        reason: enabled && !hasProvider ? "Embedding provider is not configured." : "",
        chunkCount: chunks.length
      };
    },
    async searchSimilar() {
      return { results: [], status: enabled ? "not_indexed" : "disabled" };
    },
    async getRelevantChunks() {
      return { chunks: [], status: enabled ? "not_indexed" : "disabled" };
    }
  };
}

