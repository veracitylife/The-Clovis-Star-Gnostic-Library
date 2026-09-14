import fs from 'node:fs/promises';
import path from 'node:path';

const api = 'https://en.wikisource.org/w/api.php';
const root = process.argv[2] || '/home/clovisstar/public_html/enki-transcripts/corpus-hermeticum-everard-1650';
const query = new URLSearchParams({ action: 'query', list: 'allpages', apprefix: 'The Divine Pymander/', aplimit: '500', format: 'json', origin: '*' });
const pages = await fetch(`${api}?${query}`).then((response) => response.json()).then((body) => body.query.allpages.map((page) => page.title).filter((title) => /Book/i.test(title)));
const text = [];
for (const title of pages) {
  const params = new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', origin: '*' });
  const html = await fetch(`${api}?${params}`).then((response) => response.json()).then((body) => body.parse?.text?.['*'] || '');
  const normalized = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (normalized) text.push(`\n\n## ${title.replace('The Divine Pymander/', '')}\n${normalized}`);
}
await fs.mkdir(root, { recursive: true });
await fs.writeFile(path.join(root, 'transcript.txt'), `Title: The Divine Pymander\nCanonical corpus: Corpus Hermeticum\nTranslation: John Everard, 1650\nSource transcription: https://en.wikisource.org/wiki/The_Divine_Pymander\nArchival master: https://wellcomecollection.org/works/grdmykaz\nRights classification: public-domain historical translation; normalized machine transcription.\nUse policy: Compare as an early English translation, not as a separate ancient witness.\n${text.join('')}\n`);
console.log(`INGESTED_PAGES=${pages.length}`);

