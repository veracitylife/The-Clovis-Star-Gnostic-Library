# THOTH RAG efficiency plan

## Objective

Reduce answer latency and model-token consumption while preserving source coverage, provenance, and the existing THOTH provider fallback chain.

## Design decisions

1. Keep the existing Node.js deployment contract and JSON artifacts for now. Do not introduce PostgreSQL/pgvector until the live corpus size and database connection are measured to justify the operational cost.
2. Build one versioned catalog containing document metadata, compact document summaries, section-like passage groups, normalized terms, and source hashes.
3. Use a lexical-first retrieval path. It is local, deterministic, and free at query time.
4. Use local Ollama embeddings only when lexical confidence is weak or the query is explicitly conceptual. Embeddings supplement lexical candidates; they do not replace them.
5. Cache query routing, retrieval, and semantic vectors by corpus version and retrieval version. A catalog rebuild invalidates the cache automatically.
6. Send a compact evidence packet to the model: at most six diverse passages and a hard character/token budget. Internal source identifiers remain available for auditing but are never rendered to members.
7. Preserve atomic publication and checksum reuse so unchanged documents do not cause re-embedding or unnecessary downstream work.
8. Add an offline benchmark for corpus size, cache hits, retrieval latency, evidence size, and provider latency.

## Implementation order

### Phase A: safe baseline

- Capture the current retrieval and index behavior.
- Add a versioned efficiency plan and benchmark command.
- Preserve existing output filenames and provider order.

### Phase B: indexing efficiency

- Add document fingerprints and catalog version metadata.
- Reuse unchanged document and passage records.
- Add compact document-level metadata for routing.
- Keep atomic `.next` publication.

### Phase C: query efficiency

- Normalize and classify queries locally.
- Score document metadata before passage scoring.
- Use lexical retrieval first, with diversity and a strict evidence budget.
- Run semantic retrieval only below the lexical confidence threshold.
- Add bounded in-process LRU caches.

### Phase D: verification

- Run syntax and unit-level retrieval checks.
- Run the benchmark against representative THOTH questions.
- Confirm that no source paths or internal identifiers are emitted in model prompts or responses.
- Deploy only after the local artifact and live health checks agree.

## Acceptance targets

- No provider call for a confident lexical cache hit.
- Retrieval work completes locally in the normal path.
- Evidence is capped at six passages and a fixed character budget.
- Rebuilding an unchanged corpus performs zero embedding work.
- Catalog publication remains atomic and recoverable.
- Existing Ollama/OpenRouter fallback behavior remains available.

## Rollback

Each existing production-bound file must be copied to its sibling `backup-files` directory before replacement. Rollback is a file restore followed by the existing service restart/health-check procedure.

