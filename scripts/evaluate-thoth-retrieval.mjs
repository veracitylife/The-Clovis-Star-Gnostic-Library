import fs from 'node:fs/promises';

const catalogFile = process.env.THOTH_RAG_CATALOG_FILE || '/home/clovisstar/apps/clovisstar-static-rebuild/data/thoth-rag-catalog.json';
const queries = [
  'What is the relationship between Thoth and Hermes?',
  'Who is Hermes Trismegistus?',
  'What is the Poimandres or Divine Pymander?',
  'What are the twelve torments of the soul?',
  'What is Gnosis in Genshin Impact?',
  'What are the Nag Hammadi texts?',
  'How do Mead and Everard differ?',
  'What is Sophia in Gnostic traditions?',
  'Who is the Demiurge?',
  'What does Early Christian Writings cover?'
];
const stopwords = new Set('a an and are as at be by for from how in is of on or the to what who'.split(' '));
const terms = (value) => [...new Set(String(value).toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !stopwords.has(word)) || [])];
const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
const chunks = catalog.chunks || [];
const results = queries.map((query) => {
  const wanted = terms(query);
  const ranked = chunks.map((chunk) => {
    const text = `${chunk.title || ''} ${chunk.excerpt || ''}`.toLowerCase();
    return { id: chunk.id, score: wanted.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0) };
  }).sort((left, right) => right.score - left.score);
  return { query, topScore: ranked[0]?.score || 0, hitAt4: ranked.slice(0, 4).some((item) => item.score > 0) };
});
const report = { generatedAt: new Date().toISOString(), catalogChunks: chunks.length, queryCount: results.length, hitAt4: results.filter((item) => item.hitAt4).length, recallAt4: results.filter((item) => item.hitAt4).length / results.length, results };
console.log(JSON.stringify(report, null, 2));

