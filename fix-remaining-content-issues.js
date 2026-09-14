import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.CLOVISSTAR_DATA_DIR || path.join(root, "data"));
const booksDir = path.join(dataDir, "books");
const mode = process.argv.includes("--check") ? "check" : "write";

const shortPublicStubs = new Set([
  "1-john",
  "actspeter",
  "ammonius",
  "apocryphon-of-john",
  "dead-sea-scrolls",
  "dialoguejohnjesus",
  "freerlogion",
  "lucian",
  "newtestament",
  "petertophilip"
]);

const mediaBySlug = {
  "comparative-egyptian-amduat": [
    {
      title: "Book of Am-Tuat Illustrations",
      type: "source-gallery",
      url: "https://www.sacred-texts.com/egy/bat/index.htm",
      alt: "Source index for the Book of Am-Tuat illustrations",
      description: "Public-domain source index for Budge's Book of Am-Tuat, including the illustrated divisions of the Tuat."
    }
  ],
  "comparative-egyptian-book-of-gates": [
    {
      title: "Book of Gates Illustrations",
      type: "source-gallery",
      url: "https://www.sacred-texts.com/egy/gate/index.htm",
      alt: "Source index for the Book of Gates illustrations",
      description: "Public-domain source index for Budge's Book of Gates, including the gates and illustrated divisions of the Tuat."
    }
  ],
  "comparative-tibetan-bardo-thodol": [
    {
      title: "Tibetan Book of the Dead Scans",
      type: "source-scan",
      url: "https://archive.org/details/the-tibetan-book-of-the-dead_202401",
      alt: "Internet Archive scan record for The Tibetan Book of the Dead",
      description: "Internet Archive scan record for the 1927 Evans-Wentz edition used as the source text."
    }
  ],
  "sumerian-epic-of-gilgamesh-tradition": [
    {
      title: "Old Babylonian Gilgamesh Source",
      type: "source-record",
      url: "https://www.gutenberg.org/ebooks/11000",
      alt: "Project Gutenberg record for An Old Babylonian Version of the Gilgamesh Epic",
      description: "Project Gutenberg record for the public-domain Jastrow and Clay edition used as the source text."
    }
  ]
};

function readBook(slug) {
  const file = path.join(booksDir, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeBook(slug, book) {
  fs.writeFileSync(path.join(booksDir, `${slug}.json`), JSON.stringify(book, null, 2));
}

function cleanEncoding(text) {
  return String(text || "")
    .replaceAll("\u00c3\u201a", "")
    .replaceAll("\u00c3\u0192", "")
    .replaceAll("\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u201e\u00a2", "'")
    .replaceAll("\u00c3\u00a2\u00e2\u201a\u00ac\u00c5\u201c", "\"")
    .replaceAll("\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u009d", "\"")
    .replaceAll("\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u0153", "-")
    .replaceAll("\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u009d", "-")
    .replaceAll("\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u00a6", "...");
}

const changes = [];

for (const slug of shortPublicStubs) {
  const book = readBook(slug);
  if (!book) continue;
  if (book.visibility !== "private") {
    const next = {
      ...book,
      visibility: "private",
      quality: {
        ...(book.quality || {}),
        status: "needs_source_completion",
        issues: [...new Set([...(book.quality?.issues || []), "short_or_incomplete"])]
      }
    };
    changes.push({ slug, action: "made_private_until_source_complete" });
    if (mode === "write") writeBook(slug, next);
  }
}

for (const [slug, mediaItems] of Object.entries(mediaBySlug)) {
  const book = readBook(slug);
  if (!book) continue;
  const existing = Array.isArray(book.media) ? book.media : [];
  const nextMedia = [...existing];
  for (const item of mediaItems) {
    if (!nextMedia.some((media) => media.url === item.url)) nextMedia.push(item);
  }
  if (nextMedia.length !== existing.length) {
    changes.push({ slug, action: "attached_media_source", count: nextMedia.length - existing.length });
    if (mode === "write") writeBook(slug, { ...book, media: nextMedia });
  }
}

{
  const slug = "thomas";
  const book = readBook(slug);
  if (book) {
  const paragraphs = (book.paragraphs || []).map(cleanEncoding);
  const changed = paragraphs.some((paragraph, index) => paragraph !== book.paragraphs[index]);
  if (changed || book.quality?.issues?.includes("encoding_artifacts")) {
    changes.push({ slug, action: "cleaned_encoding_artifacts" });
    if (mode === "write") {
      writeBook(slug, {
        ...book,
        paragraphs,
        quality: {
          ...(book.quality || {}),
          issues: (book.quality?.issues || []).filter((issue) => issue !== "encoding_artifacts")
        }
      });
    }
  }
  }
}

console.log(JSON.stringify({ mode, changes }, null, 2));

