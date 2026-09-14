import fs from "node:fs";
import path from "node:path";

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

export function readJsonIfExists(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return readJson(file);
}

export function decodeEntities(value) {
  let text = String(value || "");
  for (let i = 0; i < 3; i += 1) {
    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }
  return text
    .replace(/\u00c2/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2026/g, "...");
}

export function slugify(value) {
  return String(value || "book")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "book";
}

export function uniqueParagraphs(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const normalized = String(line || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

export function excerptFromParagraphs(paragraphs) {
  return paragraphs.join(" ").slice(0, 220);
}

export function classifyReviewSeverity(issues) {
  if (issues.some((issue) => /bad_source_page|not_a_book|invalid_json/i.test(issue))) return "high";
  if (issues.some((issue) => /html_visible|encoding_artifacts|short_or_incomplete/i.test(issue))) return "medium";
  return "low";
}

export function reviewSummaryFromIssues(issues) {
  const labels = {
    short_or_incomplete: "Short or incomplete text",
    html_visible: "Visible HTML or markup artifacts",
    bad_source_page: "Bad source page or redirect content",
    encoding_artifacts: "Encoding artifacts detected",
    not_a_book: "Record appears to be site boilerplate or non-book content"
  };
  return issues.map((issue) => labels[issue] || issue).join("; ");
}

export function inferCollection(title, slug, previewText, collectionHints = []) {
  const haystack = `${title} ${slug} ${previewText}`.toLowerCase();
  const match = collectionHints.find(([needle]) => haystack.includes(needle));
  return match ? match[1] : "Other Early Christian Writings";
}

export function createCanonicalBook({
  slug,
  title,
  collection,
  visibility = "public",
  paragraphs,
  sourceFile = "",
  sourceUrls = [],
  quality = {}
}) {
  const cleanedParagraphs = uniqueParagraphs(paragraphs);
  const plain = cleanedParagraphs.join("\n\n");
  const wordCount = countWords(plain);
  const issues = [...new Set(quality.issues || [])];
  const qualityStatus = quality.status || (issues.length ? "needs review" : "cleaned");
  return {
    slug,
    title,
    collection,
    visibility,
    excerpt: excerptFromParagraphs(cleanedParagraphs),
    wordCount,
    paragraphs: cleanedParagraphs,
    quality: {
      status: qualityStatus,
      issues
    },
    sourceFile,
    sourceUrls
  };
}

export function buildCanonicalOutputs({
  books,
  sourceRoot,
  outDir,
  parseErrors = [],
  note = "Canonical content pipeline output."
}) {
  const generatedAt = new Date().toISOString();
  const publicBooks = books.filter((book) => book.visibility !== "private");
  const collections = [...new Set(publicBooks.map((book) => book.collection || "Library"))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      slug: slugify(name),
      title: name,
      bookCount: publicBooks.filter((book) => (book.collection || "Library") === name).length
    }));

  const persistedReviewQueue = readJsonIfExists(path.join(outDir, "review-queue.json"), []);
  const persistedReviewById = new Map((persistedReviewQueue || []).map((item) => [item.id, item]));
  const generatedReview = books
    .filter((book) => book.quality?.issues?.length)
    .map((book) => {
      const id = `review-${book.slug}`;
      const existing = persistedReviewById.get(id) || {};
      return {
        id,
        bookSlug: book.slug,
        title: book.title,
        collection: book.collection,
        severity: classifyReviewSeverity(book.quality.issues),
        status: existing.status || "open",
        summary: reviewSummaryFromIssues(book.quality.issues),
        issues: book.quality.issues,
        adminNotes: existing.adminNotes || "",
        assignedTo: existing.assignedTo || "",
        sourceFile: book.sourceFile || "",
        sourceUrls: book.sourceUrls || [],
        updatedAt: existing.updatedAt || generatedAt,
        generatedAt
      };
    });

  const index = {
    generatedAt,
    sourceRoot,
    count: books.length,
    publicCount: publicBooks.length,
    collections,
    books: books.map(({ slug, title, collection, visibility, excerpt, wordCount, quality }) => ({
      slug,
      title,
      collection,
      visibility,
      excerpt,
      wordCount,
      quality
    }))
  };

  const stats = {
    generatedAt,
    publicBooks: publicBooks.length,
    completedTexts: books.filter((book) => countWords(book.paragraphs.join(" ")) >= 150 && !(book.quality?.issues || []).length).length,
    collections: collections.length,
    indexedWords: books.reduce((sum, book) => sum + Number(book.wordCount || 0), 0),
    openReviewItems: generatedReview.filter((item) => item.status !== "resolved").length
  };

  const cleanupReport = {
    generatedAt,
    total: books.length,
    parseErrors,
    needsReview: generatedReview.map(({ id, bookSlug, title, severity, issues, sourceFile, sourceUrls, status }) => ({
      id,
      slug: bookSlug,
      title,
      severity,
      status,
      issues,
      sourceFile,
      sourceUrls
    })),
    note
  };

  const adminSettings = {
    generatedAt,
    visibility: Object.fromEntries(books.map((book) => [book.slug, book.visibility])),
    reviewDefaults: Object.fromEntries(generatedReview.map((item) => [item.bookSlug, item.status])),
    runtime: {
      dryRun: true,
      approvalRequired: true
    },
    members: {
      allowRegistration: true,
      showBookmarksInSidebarDefault: false
    },
    library: {
      collectionCardLimit: 12,
      shuffleCollections: true,
      copyAttributionEnabled: true
    },
    audio: {
      enabled: false,
      exposePlayerUi: false,
      defaultProvider: "openai",
      providers: {
        openai: {
          enabled: false,
          model: "gpt-4o-mini-tts",
          voice: "alloy"
        },
        elevenlabs: {
          enabled: false,
          model: "eleven_multilingual_v2",
          voiceId: ""
        }
      }
    },
    contentAudit: {
      enabled: true,
      autoReviewQueue: true,
      maxFindingsPerBook: 3
    },
    dry_run: true,
    approval_required: true
  };

  return {
    generatedAt,
    books,
    index,
    collections,
    stats,
    cleanupReport,
    reviewQueue: generatedReview,
    adminSettings
  };
}

export function writeCanonicalOutputs(outDir, outputs) {
  const bookOutDir = path.join(outDir, "books");
  fs.mkdirSync(bookOutDir, { recursive: true });
  for (const book of outputs.books) {
    safeWriteJson(path.join(bookOutDir, `${book.slug}.json`), book);
  }
  safeWriteJson(path.join(outDir, "books-index.json"), outputs.index);
  safeWriteJson(path.join(outDir, "collections.json"), outputs.collections);
  safeWriteJson(path.join(outDir, "site-statistics.json"), outputs.stats);
  safeWriteJson(path.join(outDir, "cleanup-report.json"), outputs.cleanupReport);
  safeWriteJson(path.join(outDir, "review-queue.json"), outputs.reviewQueue);
  safeWriteJson(path.join(outDir, "admin-settings.json"), outputs.adminSettings);
}

function safeWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

