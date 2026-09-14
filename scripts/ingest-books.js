import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalOutputs,
  createCanonicalBook,
  decodeEntities,
  inferCollection,
  readJson,
  slugify,
  writeCanonicalOutputs
} from "./lib/content-pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceRoot = "C:\\Users\\disru\\Documents\\wordpress plugins\\HTML Projects\\newJSON\\all books combined";
const jsonDir = path.join(sourceRoot, "json");
const outDir = path.join(root, "data");
const mode = process.argv.includes("--audit") ? "audit" : "write";

const collectionHints = [
  ["new testament", "New Testament"],
  ["apocrypha", "Apocrypha"],
  ["gnostic", "Gnostic Writings"],
  ["nag hammadi", "Gnostic Writings"],
  ["church", "Church Fathers"],
  ["father", "Church Fathers"],
  ["apocalypse", "Apocalyptic Literature"],
  ["acts", "Apocryphal Acts"],
  ["ethiopian", "Ethiopian Orthodox Canon"],
  ["enoch", "Apocalyptic Literature"]
];

function htmlToParagraphs(html) {
  let text = decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote|br|center|dir)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]{0,120}\}/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  const boilerplate = [
    /Home > .*? At a Glance/gi,
    /Please buy the CD to support the site.*$/gi,
    /Follow @mrpeterkirby.*$/gi,
    /Gospels Matthew Mark Luke John Acts.*$/gi,
    /Sacred Texts Bible Apocrypha Index Previous Next/gi,
    /Buy this Book on Kindle/gi,
    /Terms of Service Privacy Policy.*$/gi
  ];
  for (const pattern of boilerplate) text = text.replace(pattern, " ");

  return text
    .split(/\n{1,}|\s{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20)
    .filter((line) => !/^(home|index|previous|next|copyright|terms of service|privacy policy)$/i.test(line))
    .slice(0, 1200);
}

function normalizeRecord(record, sourceFile) {
  const title = decodeEntities(record.title || record.name || path.basename(sourceFile, ".json")).trim();
  const slug = slugify(record.slug || record.name || title);
  const paragraphs = htmlToParagraphs(record.content || record.html || record.text || "");
  const plain = paragraphs.join("\n\n");
  const wordCount = plain.split(/\s+/).filter(Boolean).length;
  const issues = [];

  if (wordCount < 250) issues.push("short_or_incomplete");
  if (/[<>][a-z][\s\S]*?>/i.test(plain)) issues.push("html_visible");
  if (/Redirecting|404|not found|Access denied/i.test(plain)) issues.push("bad_source_page");
  if (/[\u00c3\u00c2]|\u00e2[\u0080-\u00bf]/.test(plain)) issues.push("encoding_artifacts");
  if (/terms of service|privacy policy|cookie policy|copyrights|faq|contact|credits|donate|downloads|standards|abuse/i.test(title)) issues.push("not_a_book");

  return createCanonicalBook({
    slug,
    title,
    collection: inferCollection(title, slug, plain.slice(0, 500), collectionHints),
    visibility: issues.includes("not_a_book") || issues.includes("bad_source_page") ? "private" : "public",
    paragraphs,
    quality: { status: issues.length ? "needs review" : "cleaned", issues },
    sourceFile: path.relative(sourceRoot, sourceFile).replaceAll("\\", "/")
  });
}

function collectRecords() {
  const records = new Map();
  const parseErrors = [];
  for (const name of fs.readdirSync(jsonDir).filter((file) => file.endsWith(".json")).sort()) {
    const file = path.join(jsonDir, name);
    try {
      const parsed = readJson(file);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.posts) ? parsed.posts : [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const book = normalizeRecord(item, file);
        if (!book.paragraphs.length) continue;
        const existing = records.get(book.slug);
        if (!existing || book.wordCount > existing.wordCount) records.set(book.slug, book);
      }
    } catch (error) {
      parseErrors.push({ file: `json/${name}`, error: error.message });
    }
  }
  return { books: [...records.values()].sort((a, b) => a.title.localeCompare(b.title)), parseErrors };
}

const { books, parseErrors } = collectRecords();
const outputs = buildCanonicalOutputs({
  books,
  sourceRoot,
  outDir,
  parseErrors,
  note: "The importer cleans syntax and flags incomplete or suspect texts. It does not fabricate missing source material; flagged books require verified source completion."
});

if (mode === "write") {
  writeCanonicalOutputs(outDir, outputs);
}

console.log(JSON.stringify({
  mode,
  imported: books.length,
  clean: books.length - outputs.cleanupReport.needsReview.length,
  needsReview: outputs.cleanupReport.needsReview.length,
  parseErrors: parseErrors.length,
  output: mode === "write" ? outDir : null
}, null, 2));

