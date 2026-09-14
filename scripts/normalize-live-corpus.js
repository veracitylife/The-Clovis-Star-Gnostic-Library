import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countWords, decodeEntities, excerptFromParagraphs, uniqueParagraphs } from "./lib/content-pipeline.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.CLOVISSTAR_DATA_DIR || path.join(root, "data"));
const booksDir = path.join(dataDir, "books");
const mode = process.argv.includes("--check") ? "check" : "write";

const boilerplatePatterns = [
  /^clovis star gnostic library$/i,
  /^home\s*[>›»].*$/i,
  /^please buy the cd to support the site.*$/i,
  /^early christian writings is copyright.*$/i,
  /^follow @/i,
  /^recommended books for the study of early christian writings$/i,
  /^go to the chronological list of all early christian writings$/i,
  /^discuss this text on the early writings forum\.$/i,
  /^text american standard version king james version world english bible$/i,
  /^gospels matthew mark luke john acts letters of paul .*$/i,
  /^apostolic fathers didache epistle of barnabas .*$/i
];

function cleanupParagraph(paragraph, title) {
  let text = decodeEntities(String(paragraph || ""))
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (text === title) return "";
  if (text === `${title} — Clovis Star Gnostic Library`) return "";
  if (boilerplatePatterns.some((pattern) => pattern.test(text))) return "";
  if (/^home\s*&rsaquo;|^home\s*&raquo;/i.test(paragraph)) return "";
  if (/^home\s*>\s*/i.test(text)) return "";
  if (/^(fragments of dionysius of corinth|apocalypse of peter \(akhmim\))\s*[»›]$/i.test(text)) return "";
  if (text.includes("Please buy the CD to support the site")) return "";
  if (text.includes("Early Christian Writings is copyright")) return "";
  if (text.length > 900 && /Gospels Matthew Mark Luke John Acts Letters of Paul/i.test(text)) return "";

  return text;
}

function normalizeBook(book) {
  const title = String(book.title || "").trim();
  const cleanedParagraphs = uniqueParagraphs(
    (book.paragraphs || [])
      .map((paragraph) => cleanupParagraph(paragraph, title))
      .filter(Boolean)
  );

  const plain = cleanedParagraphs.join("\n\n");
  return {
    ...book,
    paragraphs: cleanedParagraphs,
    excerpt: excerptFromParagraphs(cleanedParagraphs),
    wordCount: countWords(plain)
  };
}

const files = fs.readdirSync(booksDir).filter((name) => name.endsWith(".json")).sort();
let changed = 0;

for (const name of files) {
  const file = path.join(booksDir, name);
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  const next = normalizeBook(current);
  if (JSON.stringify(current) === JSON.stringify(next)) continue;
  changed += 1;
  if (mode === "write") fs.writeFileSync(file, JSON.stringify(next, null, 2));
}

console.log(JSON.stringify({ mode, files: files.length, changed }, null, 2));

