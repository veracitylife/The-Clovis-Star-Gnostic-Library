import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "front-facing-export");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const sitemapUrl = "https://clovisstar.com/sitemap.xml";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "ClovisStarStaticCrawler/1.0" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) return resolve(fetchText(new URL(res.headers.location, url).toString()));
      if (res.statusCode !== 200) return reject(new Error(`${url} returned ${res.statusCode}`));
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.setTimeout(30000, () => request.destroy(new Error(`Timeout fetching ${url}`)));
  });
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\u00a0/g, " ");
}

function textFromHtml(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function parsePage(url, html) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const h1 = decodeEntities(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "") || "");
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || url;
  const text = textFromHtml(html);
  return {
    url,
    canonical,
    title,
    h1,
    slug: new URL(url).pathname.replace(/^\/|\/$/g, "") || "home",
    wordCount: text.split(/\s+/).filter(Boolean).length,
    excerpt: text.slice(0, 300),
    text
  };
}

function sitemapUrls(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((match) => match[1].trim());
  return locs.filter((url) => /^https:\/\/clovisstar\.com\//i.test(url));
}

fs.mkdirSync(outDir, { recursive: true });
const sitemap = await fetchText(sitemapUrl);
let urls = sitemapUrls(sitemap);
const nestedSitemaps = urls.filter((url) => url.endsWith(".xml"));
for (const nested of nestedSitemaps) {
  try {
    urls.push(...sitemapUrls(await fetchText(nested)));
  } catch (error) {
    console.warn(`nested sitemap failed: ${nested}: ${error.message}`);
  }
}
urls = [...new Set(urls)].filter((url) => !url.endsWith(".xml")).slice(0, limit);

const pages = [];
const failures = [];
for (const [index, url] of urls.entries()) {
  try {
    const page = parsePage(url, await fetchText(url));
    pages.push(page);
    console.log(`${index + 1}/${urls.length} ${page.wordCount} ${url}`);
  } catch (error) {
    failures.push({ url, error: error.message });
    console.warn(`failed ${url}: ${error.message}`);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  sitemapUrl,
  urlCount: urls.length,
  fetchedCount: pages.length,
  failureCount: failures.length,
  failures,
  pages: pages.map(({ url, canonical, title, h1, slug, wordCount, excerpt }) => ({ url, canonical, title, h1, slug, wordCount, excerpt }))
};

fs.writeFileSync(path.join(outDir, "front-facing-pages.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, "front-facing-pages-full.json"), JSON.stringify({ ...summary, pages }, null, 2));
console.log(JSON.stringify({ fetched: pages.length, failures: failures.length, output: outDir }, null, 2));

