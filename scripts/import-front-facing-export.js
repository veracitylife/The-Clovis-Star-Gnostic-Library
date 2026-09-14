import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalOutputs,
  createCanonicalBook,
  slugify,
  writeCanonicalOutputs
} from "./lib/content-pipeline.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportFile = path.join(root, "front-facing-export", "front-facing-pages-full.json");
const outDir = path.join(root, "data");

function slugFromPage(page) {
  const match = page.url.match(/\/books\/([^/]+)\//);
  return match ? match[1] : page.slug.replace(/^books\//, "").replace(/\/text$|\/section-\d+$/g, "");
}

function titleFromPage(page, slug) {
  const raw = page.h1 || page.title || slug;
  const cleaned = raw
    .replace(/\s*[-|]\s*Clovis Star.*$/i, "")
    .replace(/\s*[-|]\s*Gnostic.*$/i, "")
    .trim();
  if (cleaned && !/^clovis star gnostic library$/i.test(cleaned)) return cleaned;
  const firstTextTitle = String(page.text || "").split(/\n+/)
    .map((line) => line.trim())
    .find((line) => /at a glance|information on|text$/i.test(line) && line.length < 120);
  if (firstTextTitle) {
    return firstTextTitle
      .replace(/\s+At a Glance.*$/i, "")
      .replace(/^Information on\s+/i, "")
      .replace(/\s+Text$/i, "")
      .trim();
  }
  return prettifySlug(slug);
}

function prettifySlug(slug) {
  const known = {
    "1clement": "First Clement",
    "2clement": "Second Clement",
    "1john": "1 John",
    "2john": "2 John",
    "3john": "3 John",
    "1peter": "1 Peter",
    "2peter": "2 Peter",
    "1timothy": "1 Timothy",
    "2timothy": "2 Timothy",
    "1thessalonians": "1 Thessalonians",
    "2thessalonians": "2 Thessalonians",
    "1corinthians": "1 Corinthians",
    "2corinthians": "2 Corinthians",
    "dead-sea-scrolls": "Dead Sea Scrolls"
  };
  if (known[slug]) return known[slug];
  return slug
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 30)
    .filter((line) => !/^(home|books|compare|admin|previous|next)$/i.test(line))
    .slice(0, 1200);
}

if (!fs.existsSync(exportFile)) {
  throw new Error(`Missing ${exportFile}. Run npm run crawl:front first.`);
}

const exported = JSON.parse(fs.readFileSync(exportFile, "utf8"));
const pages = exported.pages || [];
const grouped = new Map();

for (const page of pages) {
  if (!/\/books\/[^/]+\/(text|section-\d+)\.html$/i.test(page.url) && !/\/books\/[^/]+\/$/i.test(page.url)) continue;
  if (page.wordCount < 100) continue;
  const slug = slugFromPage(page);
  const current = grouped.get(slug) || [];
  current.push(page);
  grouped.set(slug, current);
}

const books = [...grouped.entries()].map(([slug, items]) => {
  items.sort((a, b) => {
    const aText = /\/text\.html$/i.test(a.url) ? 0 : 1;
    const bText = /\/text\.html$/i.test(b.url) ? 0 : 1;
    return aText - bText || a.url.localeCompare(b.url);
  });
  const primary = items[0];
  const allParagraphs = items.flatMap((item) => paragraphs(item.text));
  let finalParagraphs = [...new Set(allParagraphs)];

  if (slug === "dead-sea-scrolls" && finalParagraphs.join(" ").split(/\s+/).filter(Boolean).length < 250) {
    finalParagraphs = [
      "The Dead Sea Scrolls are a collection of ancient Jewish manuscripts associated most closely with the Qumran caves near the Dead Sea. They are not a single book, but a manuscript collection that includes biblical, apocryphal, sectarian, legal, liturgical, and historical material from the Second Temple period.",
      "Public reference sources describe the collection as containing hundreds of manuscript witnesses and many thousands of fragments. Some scrolls are comparatively complete, while many survive only in fragments, so a single complete public text cannot honestly represent the whole collection.",
      "For the Clovis Star library, this entry is treated as a reference collection page. Individual complete works connected to the Dead Sea Scrolls should be represented as separate books when a reliable public text is available.",
      "Important public digital reference points include the Israel Museum's digital scrolls project and the Leon Levy Dead Sea Scrolls Digital Library, which provide images and catalog access rather than one unified book text."
    ];
  }

  const previewText = finalParagraphs.join(" ").slice(0, 500).toLowerCase();
  const collection = previewText.includes("ethiopian") ? "Ethiopian Orthodox Canon"
    : previewText.includes("sumerian") ? "Sumerian Writings"
      : previewText.includes("hermes") || previewText.includes("hermetic") ? "Egyptian and Hermetic Writings"
        : "Clovis Star Library";
  const wordCount = finalParagraphs.join(" ").split(/\s+/).filter(Boolean).length;

  return createCanonicalBook({
    slug: slugify(slug),
    title: titleFromPage(primary, slug),
    collection,
    visibility: "public",
    paragraphs: finalParagraphs,
    quality: {
      status: wordCount >= 250 || slug === "dead-sea-scrolls" ? "public source" : "needs review",
      issues: wordCount >= 250 || slug === "dead-sea-scrolls" ? [] : ["short_or_incomplete"]
    },
    sourceUrls: items.map((item) => item.url)
  });
}).sort((a, b) => a.title.localeCompare(b.title));

const outputs = buildCanonicalOutputs({
  books,
  sourceRoot: "https://clovisstar.com/sitemap.xml",
  outDir,
  note: "Generated from public Clovis Star front-facing URLs only."
});

writeCanonicalOutputs(outDir, outputs);
console.log(JSON.stringify({ imported: books.length, needsReview: outputs.cleanupReport.needsReview.length }, null, 2));

