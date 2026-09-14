import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv.includes("--check") ? "check" : "write";
const dataDir = path.resolve(process.env.CLOVISSTAR_DATA_DIR || path.join(root, "data"));
const booksDir = path.join(dataDir, "books");
const reviewQueueFile = path.join(dataDir, "review-queue.json");
const cleanupReportFile = path.join(dataDir, "cleanup-report.json");
const statsFile = path.join(dataDir, "site-statistics.json");
const settingsFile = path.join(dataDir, "admin-settings.json");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function detectIssues(book) {
  const text = (book.paragraphs || []).join("\n\n");
  const lower = text.toLowerCase();
  const issues = [];
  const wordCount = sumWordCount(book);
  if (wordCount < 250) issues.push({ code: "short_or_incomplete", severity: "medium", summary: "Book appears short or incomplete." });
  if (/<\/?[a-z][\w:-]*(?:\s+[^<>]*?)?>/i.test(text) || /\|strong="/i.test(text)) issues.push({ code: "visible_markup", severity: "high", summary: "Visible markup or parser artifacts detected." });
  if (/Â|Ã|â[\u0080-\u00bf]/.test(text)) issues.push({ code: "encoding_artifacts", severity: "medium", summary: "Encoding artifacts detected in rendered text." });
  if (/\b(?:placeholder|lorem ipsum|text to be supplied|to be supplied later|content to be supplied)\b/i.test(lower)) issues.push({ code: "placeholder_text", severity: "medium", summary: "Placeholder text detected." });
  if (/\(\s*left\s*\)|\(\s*right\s*\)|see plate|see image|\bplate\s+[ivxlcdm0-9]+\b/i.test(lower) && !(book.media || []).length) {
    issues.push({ code: "missing_media_reference", severity: "low", summary: "Text references an image or plate without attached media." });
  }
  return issues;
}

function sumWordCount(book) {
  if (Number.isFinite(Number(book.wordCount)) && Number(book.wordCount) > 0) return Number(book.wordCount);
  const text = (book.paragraphs || []).join(" ");
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function hasSourceBacking(book) {
  return Boolean(
    (Array.isArray(book.sourceUrls) && book.sourceUrls.length) ||
    book.sourceFile ||
    book.sourceUrl ||
    book.source
  );
}

function qualityStatus(book) {
  return String(book?.quality?.status || "").toLowerCase();
}

function mediaCount(book) {
  return Array.isArray(book.media) ? book.media.length : 0;
}

const existingQueue = readJson(reviewQueueFile, []);
const existingById = new Map(existingQueue.map((item) => [item.id, item]));
const settings = readJson(settingsFile, {});
const maxFindingsPerBook = Math.max(1, Math.min(10, Number(settings.contentAudit?.maxFindingsPerBook || 3)));
const books = fs.readdirSync(booksDir).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(path.join(booksDir, name), null)).filter(Boolean);
const auditableBooks = books.filter((book) => String(book.visibility || "public") !== "private");
const generatedAt = new Date().toISOString();

const findings = [];
for (const book of auditableBooks) {
  for (const issue of detectIssues(book).slice(0, maxFindingsPerBook)) {
    const id = `audit-${book.slug}-${slugify(issue.code)}`;
    const existing = existingById.get(id) || {};
    findings.push({
      id,
      bookSlug: book.slug,
      title: book.title,
      collection: book.collection,
      severity: issue.severity,
      status: existing.status || "open",
      source: "content_integrity_audit",
      summary: issue.summary,
      issues: [issue.code],
      adminNotes: existing.adminNotes || "",
      assignedTo: existing.assignedTo || "",
      updatedAt: existing.updatedAt || generatedAt,
      generatedAt
    });
  }
}

const merged = [
  ...existingQueue.filter((item) => !String(item.id || "").startsWith("audit-")),
  ...findings
].sort((a, b) => String(a.id).localeCompare(String(b.id)));

if (mode === "write") {
  writeJson(reviewQueueFile, merged);

  const cleanup = readJson(cleanupReportFile, { generatedAt, total: books.length, parseErrors: [], needsReview: [] });
  cleanup.generatedAt = generatedAt;
  cleanup.needsReview = merged.map((item) => ({
    id: item.id,
    slug: item.bookSlug,
    title: item.title || item.bookSlug,
    severity: item.severity,
    status: item.status,
    issues: item.issues || [],
    sourceFile: item.sourceFile || "",
    sourceUrls: item.sourceUrls || []
  }));
  writeJson(cleanupReportFile, cleanup);

  const publicBooks = books.filter((book) => String(book.visibility || "public") !== "private");
  const collections = new Set(publicBooks.map((book) => book.collection || "Library"));
  const completedTexts = publicBooks.filter((book) => !detectIssues(book).length && !/review|placeholder|incomplete/.test(qualityStatus(book))).length;
  const indexedWords = publicBooks.reduce((total, book) => total + sumWordCount(book), 0);
  const sourceBackedBooks = publicBooks.filter(hasSourceBacking).length;
  const totalMediaItems = publicBooks.reduce((total, book) => total + mediaCount(book), 0);
  const stats = readJson(statsFile, {});
  stats.generatedAt = generatedAt;
  stats.publicBooks = publicBooks.length;
  stats.completedTexts = completedTexts;
  stats.collections = collections.size;
  stats.indexedWords = indexedWords;
  stats.openReviewItems = merged.filter((item) => item.status !== "resolved").length;
  stats.books = {
    totalRecords: books.length,
    publicBooks: publicBooks.length,
    completedTexts,
    needsReview: merged.filter((item) => item.status !== "resolved").length,
    totalWords: indexedWords,
    sourceBackedBooks
  };
  stats.media = {
    totalMediaItems
  };
  writeJson(statsFile, stats);
}

console.log(JSON.stringify({
  mode,
  auditedBooks: auditableBooks.length,
  findings: findings.length,
  reviewQueueItems: merged.length
}, null, 2));

