import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.env.ENKI_TRANSCRIPTS_ROOT || '/home/clovisstar/public_html/enki-transcripts';
const userAgent = 'ClovisStar-THOTH/1.0 (research indexer)';
const pages = [
  { slug: 'gnosis-org-archive-menu', title: 'Gnosis.org Archive Welcome and Menu', url: 'http://www.gnosis.org/welcome.html', menu: true },
  { slug: 'gnosis-org-library-menu', title: 'Gnosis.org Gnostic Society Library Menu', url: 'http://www.gnosis.org/library.html', menu: true },
  { slug: 'gnosis-org-nag-hammadi-library', title: 'Gnosis.org Nag Hammadi Library', url: 'http://www.gnosis.org/naghamm/nhl.html' },
  { slug: 'gnosis-org-hermetic-texts', title: 'Gnosis.org Hermetic Texts', url: 'http://www.gnosis.org/library/hermet.htm' },
  { slug: 'gnosis-org-grs-mead-collection', title: 'Gnosis.org G.R.S. Mead Collection', url: 'http://www.gnosis.org/library/grs-mead/mead_index.htm' }
];

function decode(value) {
  return String(value || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function textFromHtml(html) {
  return decode(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function menuFromHtml(html) {
  const links = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = decode(match[1]).trim();
    const label = textFromHtml(match[2]);
    if (!label || !href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
    let absolute;
    try { absolute = new URL(href, 'http://www.gnosis.org/').toString(); } catch { continue; }
    if (!absolute.startsWith('http://www.gnosis.org/')) continue;
    const key = `${label}|${absolute}`;
    if (seen.has(key)) continue;
    seen.add(key); links.push(`- ${label}: ${absolute}`);
  }
  return links;
}

async function fetchPage(page) {
  const response = await fetch(page.url, { headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(30000) });
  const html = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const retrieved = new Date().toISOString();
  const sections = [
    `SOURCE TITLE: ${page.title}`,
    `SOURCE URL: ${page.url}`,
    `RETRIEVED: ${retrieved}`,
    'SOURCE TYPE: external reference copy for THOTH retrieval; preserve historical uncertainty and attribution.',
    '',
    textFromHtml(html)
  ];
  if (page.menu) sections.push('', 'QUICK-REFERENCE MENU LINKS:', ...menuFromHtml(html));
  return sections.join('\n').slice(0, 500000);
}

for (const page of pages) {
  const destination = path.join(root, page.slug, 'transcript.txt');
  const directory = path.dirname(destination);
  await fs.mkdir(directory, { recursive: true });
  const text = await fetchPage(page);
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${text}\n`, 'utf8');
  await fs.rename(temporary, destination);
  console.log(JSON.stringify({ slug: page.slug, url: page.url, bytes: Buffer.byteLength(text), path: destination }));
}

