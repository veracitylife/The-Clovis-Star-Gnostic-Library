import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.CLOVISSTAR_DATA_DIR || path.join(root, "data"));
const booksDir = path.join(dataDir, "books");
const mode = process.argv.includes("--check") ? "check" : "write";

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function wordCount(book) {
  const text = (book.paragraphs || []).join(" ").trim();
  return text ? text.split(/\s+/).length : 0;
}

function isQuarantineCandidate(book) {
  if (String(book.visibility || "public") === "private") return false;
  if (wordCount(book) >= 250) return false;
  const text = (book.paragraphs || []).join(" ").toLowerCase();
  if (/prepared for side-by-side study|saved while signed in|clovis star gnostic library\s*$/.test(text)) return true;
  if ((book.paragraphs || []).length <= 3) return true;
  return false;
}

const changed = [];
for (const name of fs.readdirSync(booksDir).filter((item) => item.endsWith(".json")).sort()) {
  const file = path.join(booksDir, name);
  const book = readJson(file, null);
  if (!book || !isQuarantineCandidate(book)) continue;
  const next = {
    ...book,
    visibility: "private",
    quality: {
      ...(book.quality || {}),
      status: "needs_source_completion",
      issues: [...new Set([...(book.quality?.issues || []), "short_or_incomplete"])]
    }
  };
  changed.push({ slug: book.slug, title: book.title, wordCount: wordCount(book) });
  if (mode === "write") writeJson(file, next);
}

console.log(JSON.stringify({ mode, changed: changed.length, books: changed }, null, 2));

