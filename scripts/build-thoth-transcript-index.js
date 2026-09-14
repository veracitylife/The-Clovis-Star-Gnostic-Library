import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sourceRoot = process.env.ENKI_TRANSCRIPTS_ROOT || '/home/clovisstar/public_html/enki-transcripts';
const outputFile = process.env.THOTH_INDEX_FILE || '/home/clovisstar/apps/clovisstar-static-rebuild/data/thoth-transcript-index.json';
const workingFile = `${outputFile}.next`;
const ollamaUrl = process.env.THOTH_OLLAMA_URL || 'http://127.0.0.1:11434';
const model = process.env.THOTH_EMBED_MODEL || 'nomic-embed-text:latest';

async function transcriptFiles(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await transcriptFiles(full, out);
    else if (entry.name === 'transcript.txt') out.push(full);
  }
  return out;
}

async function embed(input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let response;
  try {
    response = await fetch(`${ollamaUrl}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input }), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.embeddings)) throw new Error(`embedding_provider_http_${response.status}`);
  return body.embeddings;
}

async function embedWithRetry(input) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await embed(input);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw lastError;
}

const previous = JSON.parse(await fs.readFile(workingFile, 'utf8').catch(() => fs.readFile(outputFile, 'utf8')).catch(() => '{}'));
const previousEmbeddings = new Map((previous.chunks || [])
  .filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length && chunk.hash)
  .map((chunk) => [`${chunk.file}:${chunk.start}:${chunk.hash}`, chunk.embedding]));
const chunks = [];
for (const file of await transcriptFiles(sourceRoot)) {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const slug = path.basename(path.dirname(file));
  for (let start = 0; start < text.length; start += 7000) {
    const excerpt = text.slice(start, start + 8000).trim();
    if (excerpt.length < 80) continue;
    const hash = createHash('sha256').update(excerpt).digest('hex');
    chunks.push({ file, start, hash, excerpt: excerpt.slice(0, 1800), text: `${slug}\n${excerpt}`, embedding: previous.version === 3 ? previousEmbeddings.get(`${file}:${start}:${hash}`) : undefined });
  }
}
async function checkpoint() {
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(workingFile, JSON.stringify({ version: 3, builtAt: new Date().toISOString(), sourceRoot, model, chunks: chunks.map(({ text, ...chunk }) => chunk) }));
}
for (let offset = 0; offset < chunks.length; offset += 1) {
  const batch = chunks.slice(offset, offset + 1);
  if (batch[0].embedding) continue;
  const embeddings = await embedWithRetry(batch.map((chunk) => chunk.text));
  embeddings.forEach((embedding, index) => { batch[index].embedding = embedding; });
  await checkpoint();
  process.stdout.write(`indexed ${Math.min(offset + batch.length, chunks.length)}/${chunks.length}\n`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}
await checkpoint();
await fs.rename(workingFile, outputFile);
console.log(`wrote ${chunks.length} chunks to ${outputFile}`);

