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

const cp1252Reverse = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
]);

function toWindows1252Bytes(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0xff) {
      bytes.push(code);
    } else if (cp1252Reverse.has(code)) {
      bytes.push(cp1252Reverse.get(code));
    } else {
      return null;
    }
  }
  return Buffer.from(bytes);
}

function decodeWindows1252Utf8Mojibake(chunk) {
  const bytes = toWindows1252Bytes(chunk);
  if (!bytes) return chunk;
  const decoded = bytes.toString("utf8");
  if (decoded.includes("\ufffd")) return chunk;
  if (!/[\u0370-\u03ff\u1f00-\u1fff\u00c0-\u017f]/.test(decoded)) return chunk;
  return decoded;
}

function repairMojibake(text) {
  return cleanEncoding(text).replace(
    /[\u00c0-\u00ff\u0192\u201a\u201e\u2026\u2030\u0178][\u0080-\u00ff\u0192\u201a\u201e\u2026\u2030\u0178\sA-Za-z0-9.,;:'"()/-]*[\u0080-\u00ff\u0192\u201a\u201e\u2026\u2030\u0178]/g,
    decodeWindows1252Utf8Mojibake
  );
}

function repairKnownGreekPhrases(text) {
  return repairMojibake(text)
    .replace(/'fellow-presbyter' \([^)]*\)/g, "'fellow-presbyter' (του συμπρεσβυτερου ημων Zωτικου Οτρηνου)")
    .replace(/general \([^)]*\), and even the Christians had enjoyed continuous peace \([^)]*\)/g, "general (ουτε μερικος ουτε καθολικος κοσμω γεγονε πολεμος), and even the Christians had enjoyed continuous peace (αλλα και ξριστιανοις μαλλον ειρηνη διαμονος)")
    .replace(/very long time ago \([^)]*\) to write/g, "very long time ago (εκ πλειστου οσου και ικανωτατου ξρονου) to write")
    .replace(/Concerning Abstinence or Eunuchry,[\s\S]*?\. Two passages/g, "Concerning Abstinence or Eunuchry, Περι εγκρατειασ η περι ευνουχιας. Two passages")
    .replace(/το�\.\.\. σ�\.\.\.μπρεσβ�\.\.\.τερο�\.\.\. ημων Zωτικο�\.\.\. Οτρηνο�\.\.\./g, "του συμπρεσβυτερου ημων Zωτικου Οτρηνου")
    .replace(/Î¿Ï\.\.\.Ï„Îµ Î¼ÎµÏÎ¹ÎºÎ¿Ï‚ Î¿Ï\.\.\.Ï„Îµ ÎºÎ±Î¸Î¿Î»Î¹ÎºÎ¿Ï‚ ÎºÎ¿ÏƒÎ¼Ï‰ Î³ÎµÎ³Î¿Î½Îµ Ï€Î¿Î»ÎµÎ¼Î¿Ï‚/g, "ουτε μερικος ουτε καθολικος κοσμω γεγονε πολεμος")
    .replace(/Î±Î»Î»Î± ÎºÎ±Î¹ Î¾ÏÎ¹ÏƒÏ„Î¹Î±Î½Î¿Î¹Ï‚ Î¼Î±Î»Î»Î¿Î½ ÎµÎ¹ÏÎ·Î½Î· Î´Î¹Î±Î¼Î¿Î½Î¿Ï‚/g, "αλλα και ξριστιανοις μαλλον ειρηνη διαμονος")
    .replace(/ÎµÎº Ï€Î»ÎµÎ¹ÏƒÏ„Î¿Ï\.\.\. Î¿ÏƒÎ¿Ï\.\.\. ÎºÎ±Î¹ Î¹ÎºÎ±Î½Ï‰Ï„Î±Ï„Î¿Ï\.\.\. Î¾ÏÎ¿Î½Î¿Ï\.\.\./g, "εκ πλειστου οσου και ικανωτατου ξρονου");
}

function bookHasEncodingArtifacts(book) {
  return JSON.stringify(book).match(/[ÎÏÃÂÐ]\S|[\u0080-\u009f]|\ufffd|ï¿½/);
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

for (const file of fs.readdirSync(booksDir).filter((name) => name.endsWith(".json"))) {
  const slug = path.basename(file, ".json");
  const book = readBook(slug);
  if (!book || !bookHasEncodingArtifacts(book)) continue;
  const next = JSON.parse(JSON.stringify(book));
  if (typeof next.title === "string") next.title = repairKnownGreekPhrases(next.title);
  if (typeof next.excerpt === "string") next.excerpt = repairKnownGreekPhrases(next.excerpt);
  if (Array.isArray(next.paragraphs)) next.paragraphs = next.paragraphs.map(repairKnownGreekPhrases);
  if (JSON.stringify(next) !== JSON.stringify(book)) {
    changes.push({ slug, action: "repaired_character_encoding" });
    if (mode === "write") writeBook(slug, next);
  }
}

console.log(JSON.stringify({ mode, changes }, null, 2));

