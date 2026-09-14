import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const appRoot = process.env.CLOVIS_APP_ROOT || '/home/clovisstar/apps/clovisstar-static-rebuild';
const transcriptRoot = process.env.ENKI_TRANSCRIPTS_ROOT || '/home/clovisstar/public_html/enki-transcripts';
const dataRoot = path.join(appRoot, 'data');
const booksRoot = path.join(dataRoot, 'books');
const docsRoot = path.join(appRoot, 'docs');
const outputFile = process.env.THOTH_RAG_CATALOG_FILE || path.join(dataRoot, 'thoth-rag-catalog.json');
const CATALOG_VERSION = 2;
const STOPWORDS = new Set('about after again against also an and any are as at be because been before being between both but by can could did do does each for from had has have he her here him his how i if in into is it its itself just me more most my no not of on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who why will with would you your'.split(' '));

function terms(value) { return [...new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.filter((word) => word.length > 2 && !STOPWORDS.has(word)) || [])].slice(0, 80); }
async function walk(dir, match, output = []) { for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await walk(full, match, output); else if (match(entry.name)) output.push(full); } return output; }
function flattenJson(value, output = []) { if (typeof value === 'string') output.push(value); else if (Array.isArray(value)) value.forEach((item) => flattenJson(item, output)); else if (value && typeof value === 'object') Object.values(value).forEach((item) => flattenJson(item, output)); return output; }

async function documents() {
  const docs = [];
  for (const file of await walk(transcriptRoot, (name) => name === 'transcript.txt')) { const text = await fs.readFile(file, 'utf8').catch(() => ''); if (text.trim()) docs.push({ id: `transcript:${path.relative(transcriptRoot, file)}`, type: 'transcript', title: path.basename(path.dirname(file)).replace(/[-_]+/g, ' '), text }); }
  for (const file of await walk(booksRoot, (name) => name.endsWith('.json'))) { const value = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}')); const title = String(value.title || value.name || path.basename(file, '.json')).replace(/[-_]+/g, ' '); const text = flattenJson(value).join('\n'); if (text.trim()) docs.push({ id: `book:${path.basename(file)}`, type: 'book', title, text }); }
  for (const name of ['bardo-media.json', 'collections.json', 'egyptian-underworld-media.json', 'related-media.json', 'sumerian-tablets.json', 'sumerian-tablet-sources.json']) { const value = JSON.parse(await fs.readFile(path.join(dataRoot, name), 'utf8').catch(() => '{}')); const text = flattenJson(value).join('\n'); if (text.trim()) docs.push({ id: `dataset:${name}`, type: 'curated_dataset', title: name.replace(/[-_.]+/g, ' '), text }); }
  for (const file of await walk(docsRoot, (name) => name === 'THOTH_HERMES_SOURCE_CATALOG.md')) { const text = await fs.readFile(file, 'utf8').catch(() => ''); if (text.trim()) docs.push({ id: `catalog:${path.basename(file)}`, type: 'source_catalog', title: 'THOTH Hermes source catalog', text }); }
  return docs;
}

const sourceDocuments = await documents();
const chunks = [];
for (const doc of sourceDocuments) {
  const text = doc.text.replace(/\s+/g, ' ').trim();
  doc.hash = createHash('sha256').update(text).digest('hex');
  doc.summary = text.slice(0, 900).trim();
  doc.keywords = terms(`${doc.title} ${text}`).slice(0, 32);
  for (let start = 0; start < text.length; start += 1100) { const excerpt = text.slice(start, start + 1400).trim(); if (excerpt.length < 100) continue; const id = createHash('sha256').update(`${doc.id}:${start}:${excerpt}`).digest('hex').slice(0, 20); chunks.push({ id, documentId: doc.id, type: doc.type, title: doc.title.slice(0, 240), start, excerpt, terms: terms(`${doc.title} ${excerpt}`) }); }
}
const documentsForRouting = sourceDocuments.map(({ text, ...doc }) => doc);
const corpusVersion = createHash('sha256').update(sourceDocuments.map((doc) => `${doc.id}:${doc.hash}`).sort().join('|')).digest('hex').slice(0, 24);
await fs.mkdir(path.dirname(outputFile), { recursive: true });
const temporary = `${outputFile}.next`;
await fs.writeFile(temporary, JSON.stringify({ version: CATALOG_VERSION, builtAt: new Date().toISOString(), corpusVersion, chunkCount: chunks.length, documentCount: documentsForRouting.length, documents: documentsForRouting, chunks }));
await fs.rename(temporary, outputFile);
console.log(`catalogued ${chunks.length} passages from ${documentsForRouting.length} documents (corpus ${corpusVersion})`);

