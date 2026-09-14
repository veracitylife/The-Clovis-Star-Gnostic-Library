import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSearchService } from "./services/search-service.js";
import { createStorageService } from "./services/storage-service.js";
import { buildSystemHealth } from "./services/system-health.js";
import { answer as thothAnswer } from "./services/thoth-runtime-service.js";

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(root, ".env"));

const dataDir = path.resolve(process.env.CLOVISSTAR_DATA_DIR || path.join(root, "data"));
const booksDir = path.join(dataDir, "books");
const bookIndexFile = path.join(dataDir, "books-index.json");
const siteStatsFile = path.join(dataDir, "site-statistics.json");
const siteVersionFile = path.join(dataDir, "site-version.json");
const settingsDefaultsFile = path.join(dataDir, "admin-settings.json");
const reviewDefaultsFile = path.join(dataDir, "review-queue.json");

const dbDir = path.resolve(process.env.CLOVISSTAR_DB_DIR || path.join(root, "db"));
const usersFile = path.join(dbDir, "users.json");
const sessionsFile = path.join(dbDir, "sessions.json");
const highlightsFile = path.join(dbDir, "highlights.json");
const globalSettingsFile = path.join(dbDir, "global-settings.json");
const memberPreferencesFile = path.join(dbDir, "member-preferences.json");
const memberNotesFile = path.join(dbDir, "member-notes.json");
const bookOverridesFile = path.join(dbDir, "book-overrides.json");
const reviewQueueFile = path.join(dbDir, "review-queue.json");
const qaReportFile = path.join(dbDir, "qa-report.json");
const adminAuditFile = path.join(dbDir, "admin-audit-log.json");
const fileAssetsFile = path.join(dbDir, "file-assets.json");
const paypalPaymentsFile = path.join(dbDir, "paypal-payments.json");
const logsDir = path.resolve(process.env.CLOVISSTAR_LOG_DIR || path.join(root, "logs"));
const appEventsLog = path.join(logsDir, "app-events.jsonl");
const thothErrorLog = path.join(logsDir, "thoth-errors.jsonl");
const thothErrorLogMaxBytes = Math.max(100 * 1024, Number(process.env.THOTH_ERROR_LOG_MAX_BYTES || 5 * 1024 * 1024));
const thothErrorLogBackups = Math.max(1, Math.min(10, Number(process.env.THOTH_ERROR_LOG_BACKUPS || 5)));
const thothQuestionsDir = path.join(logsDir, "thoth-questions");
const thothQuestionsRotationFile = path.join(thothQuestionsDir, "rotation-state.json");
const thothQuestionsRotationMs = 14 * 24 * 60 * 60 * 1000;

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const storageMode = process.env.CLOVIS_STORAGE === "mysql" ? "mysql" : "json";
const isProduction = process.env.NODE_ENV === "production";
const sessionCookieName = process.env.CLOVIS_SESSION_COOKIE || "clovisstar_session";
const csrfCookieName = process.env.CLOVIS_CSRF_COOKIE || "clovisstar_csrf";
const sessionTtlHours = Number(process.env.CLOVIS_SESSION_TTL_HOURS || 24 * 30);
const sessionTtlMs = Math.max(1, sessionTtlHours) * 60 * 60 * 1000;

if (isProduction && storageMode !== "mysql") {
  throw new Error("Production mode requires CLOVIS_STORAGE=mysql.");
}

const allowedHighlightColors = new Set(["yellow", "green", "blue", "pink", "gold"]);
const allowedBookVisibility = new Set(["public", "private"]);
const allowedReviewStatus = new Set(["clean", "open", "in_progress", "resolved"]);
const allowedQueueStatus = new Set(["open", "in_progress", "resolved"]);
const allowedSourceConfidence = new Set(["verified", "source-linked", "local-source", "needs-citation"]);
const allowedMemberRoles = new Set(["member", "supporter", "scholar", "patron"]);

const mime = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const rateBuckets = new Map();
const audioProviders = new Set(["openai", "elevenlabs"]);
const transientCleanupIntervalMinutes = Number(process.env.CLOVIS_TRANSIENT_CLEANUP_MINUTES || 30);

function logEvent(level, event, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (level === "error") console.error(line.trim());
  else if (process.env.CLOVIS_LOG_TO_STDOUT === "1") console.log(line.trim());
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(appEventsLog, line);
  } catch (error) {
    if (process.env.CLOVIS_LOG_TO_STDOUT === "1") console.error(`log write failed: ${error.message}`);
  }
}

function rotateThothErrorLogIfNeeded() {
  try {
    if (!fs.existsSync(thothErrorLog) || fs.statSync(thothErrorLog).size < thothErrorLogMaxBytes) return;
    for (let index = thothErrorLogBackups - 1; index >= 1; index -= 1) {
      const source = `${thothErrorLog}.${index}`;
      const target = `${thothErrorLog}.${index + 1}`;
      if (fs.existsSync(source)) fs.renameSync(source, target);
    }
    fs.renameSync(thothErrorLog, `${thothErrorLog}.1`);
  } catch (error) {
    if (process.env.CLOVIS_LOG_TO_STDOUT === "1") console.error(`THOTH error-log rotation failed: ${error.message}`);
  }
}

function logThothError(event, payload = {}) {
  const safeKeys = ["stage", "provider", "model", "reason", "status", "code", "userId", "requestId"];
  const safePayload = Object.fromEntries(safeKeys.filter((key) => payload[key] != null).map((key) => [key, String(payload[key]).slice(0, 500)]));
  const entry = { ts: new Date().toISOString(), level: "error", event: String(event || "thoth.error").slice(0, 100), ...safePayload };
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    rotateThothErrorLogIfNeeded();
    fs.appendFileSync(thothErrorLog, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    if (process.env.CLOVIS_LOG_TO_STDOUT === "1") console.error(`THOTH error-log write failed: ${error.message}`);
  }
}

function readThothErrors(limit = 100) {
  const entries = [];
  for (let index = 0; index <= thothErrorLogBackups; index += 1) {
    const file = index === 0 ? thothErrorLog : `${thothErrorLog}.${index}`;
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && parsed.level === "error") entries.push(parsed);
      } catch {
        // Ignore partial lines from an interrupted write.
      }
    }
  }
  return entries.sort((left, right) => String(right.ts || "").localeCompare(String(left.ts || ""))).slice(0, limit);
}

function thothQuestionLogPath() {
  fs.mkdirSync(thothQuestionsDir, { recursive: true });
  const now = Date.now();
  let state = null;
  try { state = JSON.parse(fs.readFileSync(thothQuestionsRotationFile, "utf8")); } catch { state = null; }
  let sequence = Number(state?.sequence || 0);
  let startedAt = Date.parse(state?.startedAt || "");
  if (!Number.isInteger(sequence) || sequence < 1) {
    sequence = fs.readdirSync(thothQuestionsDir).reduce((max, name) => Math.max(max, Number(name.match(/^thoth-questions-(\d+)\.jsonl$/)?.[1] || 0)), 0) || 1;
    startedAt = now;
  }
  if (!Number.isFinite(startedAt) || startedAt <= 0) startedAt = now;
  if (now - startedAt >= thothQuestionsRotationMs) {
    sequence += 1;
    startedAt = now;
  }
  const nextState = { sequence, startedAt: new Date(startedAt).toISOString(), rotationDays: 14 };
  const tempState = `${thothQuestionsRotationFile}.tmp`;
  fs.writeFileSync(tempState, `${JSON.stringify(nextState)}\n`);
  fs.renameSync(tempState, thothQuestionsRotationFile);
  return path.join(thothQuestionsDir, `thoth-questions-${sequence}.jsonl`);
}

function writeThothQuestionLog({ userId, provider, model, question, answer }) {
  try {
    const entry = { ts: new Date().toISOString(), userId: String(userId || ""), provider: String(provider || ""), model: String(model || ""), question: String(question || ""), answer: String(answer || "") };
    fs.appendFileSync(thothQuestionLogPath(), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    logThothError("thoth.question_log_error", { stage: "question-log", reason: error.message, userId });
  }
}

function readThothQuestions(limit = 100) {
  if (!fs.existsSync(thothQuestionsDir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(thothQuestionsDir).filter((item) => /^thoth-questions-\d+\.jsonl$/.test(item))) {
    for (const line of fs.readFileSync(path.join(thothQuestionsDir, name), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { const parsed = JSON.parse(line); if (parsed && parsed.question != null && parsed.answer != null) entries.push(parsed); } catch { /* ignore partial writes */ }
    }
  }
  return entries.sort((left, right) => String(right.ts || "").localeCompare(String(left.ts || ""))).slice(0, limit);
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function securityHeaders(contentType) {
  return {
    "content-type": contentType,
    "cache-control": contentType.includes("text/html") || contentType.includes("application/json") ? "no-store" : "public, max-age=3600",
    "content-security-policy": "default-src 'self'; img-src 'self' data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; base-uri 'self'; form-action 'self' https://www.paypal.com; frame-ancestors 'none'",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
}

function publicApiCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders("application/json; charset=utf-8"), ...extraHeaders });
  res.end(JSON.stringify(body));
}

function publicApiJson(res, status, body, extraHeaders = {}) {
  return json(res, status, body, { ...publicApiCorsHeaders(), ...extraHeaders });
}

function text(res, status, body) {
  res.writeHead(status, securityHeaders("text/plain; charset=utf-8"));
  res.end(body);
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function ensureJsonDb() {
  fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(usersFile)) writeJson(usersFile, []);
  if (!fs.existsSync(sessionsFile)) writeJson(sessionsFile, []);
  if (!fs.existsSync(highlightsFile)) writeJson(highlightsFile, []);
  if (!fs.existsSync(globalSettingsFile)) writeJson(globalSettingsFile, {});
  if (!fs.existsSync(memberPreferencesFile)) writeJson(memberPreferencesFile, {});
  if (!fs.existsSync(bookOverridesFile)) writeJson(bookOverridesFile, {});
  if (!fs.existsSync(reviewQueueFile)) writeJson(reviewQueueFile, []);
  if (!fs.existsSync(qaReportFile)) writeJson(qaReportFile, {});
  if (!fs.existsSync(adminAuditFile)) writeJson(adminAuditFile, []);
  if (!fs.existsSync(fileAssetsFile)) writeJson(fileAssetsFile, []);
  if (!fs.existsSync(paypalPaymentsFile)) writeJson(paypalPaymentsFile, {});
}

function paypalReferenceFromEvent(event = {}) {
  const resource = event.resource || {};
  return String(resource.custom_id || resource.purchase_units?.[0]?.custom_id || resource.supplementary_data?.related_ids?.custom_id || "").trim();
}

function bodyBuffer(req, maxBytes = 110 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Request too large");
        error.status = 413;
        reject(error);
        req.destroy(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        const error = new Error("Request too large");
        error.status = 413;
        reject(error);
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("Invalid JSON");
        error.status = 400;
        reject(error);
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

function createSecretToken() {
  return crypto.randomBytes(32).toString("hex");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sendPasswordResetEmail(email, token) {
  const resetUrl = `https://clovisstar.com/members/reset-password/?token=${encodeURIComponent(token)}`;
  const message = [
    `To: ${email}`,
    "Subject: Reset your Clovis Star password",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "A password reset was requested for your Clovis Star account.",
    `Reset your password: ${resetUrl}`,
    "This link expires in 30 minutes. If you did not request it, you can ignore this message."
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/sbin/sendmail", ["-t", "-oi"], { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error("mail_delivery_failed")));
    child.stdin.end(message);
  });
}

function createApiToken() {
  return `cs_${crypto.randomBytes(32).toString("base64url")}`;
}

function apiTokenFromRequest(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(/;\s*/).reduce((out, part) => {
    const eq = part.indexOf("=");
    if (eq === -1) return out;
    const key = decodeURIComponent(part.slice(0, eq));
    const value = decodeURIComponent(part.slice(eq + 1));
    out[key] = value;
    return out;
  }, {});
}

function sessionTokenFromRequest(req) {
  return parseCookies(req)[sessionCookieName] || "";
}

function sessionCookie(token, expiresAt) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

function clearedSessionCookie() {
  const parts = [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

function csrfCookie(token, expiresAt) {
  const parts = [
    `${csrfCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

function clearedCsrfCookie() {
  const parts = [
    `${csrfCookieName}=`,
    "Path=/",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

function authCookies(sessionToken, csrfToken, expiresAt) {
  return [
    sessionCookie(sessionToken, expiresAt),
    csrfCookie(csrfToken, expiresAt)
  ];
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName || user.display_name,
    role: user.role || "member",
    apiEnabled: Boolean(user.apiEnabled ?? user.api_enabled)
  };
}

function adminUser(user) {
  return {
    ...publicUser(user),
    apiTokenPrefix: user.apiTokenPrefix || user.api_token_prefix || "",
    apiTokenCreatedAt: user.apiTokenCreatedAt || user.api_token_created_at || "",
    createdAt: user.createdAt || user.created_at || ""
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when CLOVIS_STORAGE=mysql`);
  return value;
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== "object" || !base || typeof override !== "object" || !override) return override ?? base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result;
}

function resetRateLimits() {
  rateBuckets.clear();
}

function pruneRateLimitBuckets() {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of rateBuckets.entries()) {
    if (!entry || now > entry.resetAt) {
      rateBuckets.delete(key);
      removed += 1;
    }
  }
  return removed;
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function rateLimit(req, scope, limit, windowMs, subject = "") {
  const now = Date.now();
  const key = `${scope}:${clientIp(req)}:${subject}`;
  const entry = rateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    const isThoth = scope.startsWith("thoth-chat");
    const retryAfterMs = Math.max(1000, entry.resetAt - now);
    const error = new Error(isThoth ? "Your THOTH question limit has been reached." : "Too many requests. Please try again later.");
    error.status = 429;
    error.headers = { "retry-after": String(Math.ceil(retryAfterMs / 1000)) };
    if (isThoth) {
      error.code = "thoth_limit_reached";
      error.upgradeUrl = "/members/membership/";
      error.limit = limit;
      error.retryAfterMs = retryAfterMs;
    }
    throw error;
  }
}

function validateEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const error = new Error("A valid email address is required.");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 10) {
    const error = new Error("Password must be at least 10 characters.");
    error.status = 400;
    throw error;
  }
  return value;
}

function sanitizeText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function sanitizeInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function configuredAdminEmails() {
  return new Set(
    String(process.env.CLOVIS_ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveNewUserRole(email) {
  return configuredAdminEmails().has(String(email || "").trim().toLowerCase()) ? "admin" : "member";
}

function adminSettingsDefaults() {
  return {
    runtime: {
      dryRun: true,
      approvalRequired: true
    },
    members: {
      allowRegistration: true,
      showBookmarksInSidebarDefault: false,
      plans: [
        { id: "free", role: "member", name: "Free Member", price: 0, thothHourlyLimit: 5, features: ["Full library access", "5 THOTH questions per hour", "Saved highlights and notes"] },
        { id: "explorer", role: "supporter", name: "Explorer", price: 9, thothHourlyLimit: 15, features: ["Everything in Free", "15 THOTH questions per hour", "Supporter access"] },
        { id: "scholar", role: "scholar", name: "Scholar", price: 15, thothHourlyLimit: 35, features: ["Everything in Explorer", "35 THOTH questions per hour", "Higher research limits"] },
        { id: "patron", role: "patron", name: "Patron", price: 24, thothHourlyLimit: 75, features: ["Everything in Scholar", "75 THOTH questions per hour", "Highest standard THOTH limit", "Patron support badge"] }
      ]
    },
    thoth: {
      enabled: true,
      providerOrder: ["ollama", "openrouter-auto-relay", "openrouter-auto"],
      model: "qwen3:0.6b",
      hourlyLimit: 30,
      dailyLimit: 20,
      monthlyLimit: 300,
      sourceRoot: "/home/clovisstar/public_html/enki-transcripts"
    },
    payments: {
      paypalEnabled: true,
      paypalRecipientEmail: "techpronow@gmail.com",
      stripeEnabled: false,
      stripePublishableKey: ""
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
    monitoring: {
      enabled: false,
      alertEmail: "",
      checkIntervalMinutes: 15
    }
  };
}

function normalizeAdminSettings(input = {}, base = {}) {
  const defaults = adminSettingsDefaults();
  const runtime = {
    dryRun: Boolean(input.runtime?.dryRun ?? input.dry_run ?? base.runtime?.dryRun ?? base.dry_run ?? defaults.runtime.dryRun),
    approvalRequired: Boolean(input.runtime?.approvalRequired ?? input.approval_required ?? base.runtime?.approvalRequired ?? base.approval_required ?? defaults.runtime.approvalRequired)
  };
  const provider = sanitizeText(input.audio?.defaultProvider ?? base.audio?.defaultProvider ?? defaults.audio.defaultProvider, 32).toLowerCase();
  const defaultProvider = audioProviders.has(provider) ? provider : defaults.audio.defaultProvider;
  const configuredPlans = Array.isArray(input.members?.plans ?? base.members?.plans) ? (input.members?.plans ?? base.members.plans) : [];
  const normalizedPlans = configuredPlans.slice(0, 10).map((plan, index) => {
    const rawId = sanitizeText(plan?.id || `plan-${index + 1}`, 40);
    const id = rawId === "supporter" ? "explorer" : rawId;
    const defaultPlan = defaults.members.plans.find((item) => item.id === id) || defaults.members.plans[index] || defaults.members.plans[0];
    const inferredRole = id === "free" ? "member" : id === "explorer" ? "supporter" : id;
    return {
      id,
      role: allowedMemberRoles.has(String(plan?.role || inferredRole)) ? String(plan?.role || inferredRole) : inferredRole,
      name: sanitizeText(plan?.name || defaultPlan.name, 100),
      price: Math.max(0, Math.min(10000, Number(plan?.price ?? defaultPlan.price ?? 0))),
      thothHourlyLimit: sanitizeInteger(plan?.thothHourlyLimit, defaultPlan.thothHourlyLimit || defaults.thoth.hourlyLimit, 1, 1000),
      features: Array.isArray(plan?.features) ? plan.features.slice(0, 20).map((feature) => sanitizeText(feature, 200)).filter(Boolean) : defaultPlan.features
    };
  });
  const planById = new Map(normalizedPlans.map((plan) => [plan.id, plan]));
  for (const defaultPlan of defaults.members.plans) {
    if (!planById.has(defaultPlan.id)) planById.set(defaultPlan.id, defaultPlan);
  }
  const normalizedMemberPlans = Array.from(planById.values()).slice(0, 10);
  return {
    generatedAt: input.generatedAt ?? base.generatedAt ?? null,
    visibility: typeof (input.visibility ?? base.visibility) === "object" && (input.visibility ?? base.visibility) ? (input.visibility ?? base.visibility) : {},
    reviewDefaults: typeof (input.reviewDefaults ?? base.reviewDefaults) === "object" && (input.reviewDefaults ?? base.reviewDefaults) ? (input.reviewDefaults ?? base.reviewDefaults) : {},
    runtime,
    members: {
      allowRegistration: Boolean(input.members?.allowRegistration ?? base.members?.allowRegistration ?? defaults.members.allowRegistration),
      showBookmarksInSidebarDefault: Boolean(input.members?.showBookmarksInSidebarDefault ?? base.members?.showBookmarksInSidebarDefault ?? defaults.members.showBookmarksInSidebarDefault),
      plans: normalizedMemberPlans
    },
    thoth: {
      enabled: Boolean(input.thoth?.enabled ?? base.thoth?.enabled ?? defaults.thoth.enabled),
      providerOrder: Array.isArray(input.thoth?.providerOrder ?? base.thoth?.providerOrder) ? (input.thoth?.providerOrder ?? base.thoth.providerOrder).slice(0, 5).map((provider) => sanitizeText(provider, 80)).filter(Boolean) : defaults.thoth.providerOrder,
      model: sanitizeText(input.thoth?.model ?? base.thoth?.model ?? defaults.thoth.model, 120),
      hourlyLimit: sanitizeInteger(input.thoth?.hourlyLimit ?? base.thoth?.hourlyLimit ?? defaults.thoth.hourlyLimit, defaults.thoth.hourlyLimit, 1, 1000),
      dailyLimit: sanitizeInteger(input.thoth?.dailyLimit ?? base.thoth?.dailyLimit ?? defaults.thoth.dailyLimit, defaults.thoth.dailyLimit, 1, 10000),
      monthlyLimit: sanitizeInteger(input.thoth?.monthlyLimit ?? base.thoth?.monthlyLimit ?? defaults.thoth.monthlyLimit, defaults.thoth.monthlyLimit, 1, 100000),
      sourceRoot: sanitizeText(input.thoth?.sourceRoot ?? base.thoth?.sourceRoot ?? defaults.thoth.sourceRoot, 255)
    },
    payments: {
      paypalEnabled: Boolean(input.payments?.paypalEnabled ?? base.payments?.paypalEnabled ?? defaults.payments.paypalEnabled),
      paypalRecipientEmail: sanitizeText(input.payments?.paypalRecipientEmail ?? base.payments?.paypalRecipientEmail ?? defaults.payments.paypalRecipientEmail, 190),
      stripeEnabled: Boolean(input.payments?.stripeEnabled ?? base.payments?.stripeEnabled ?? defaults.payments.stripeEnabled),
      stripePublishableKey: sanitizeText(input.payments?.stripePublishableKey ?? base.payments?.stripePublishableKey ?? defaults.payments.stripePublishableKey, 255)
    },
    library: {
      collectionCardLimit: sanitizeInteger(input.library?.collectionCardLimit ?? base.library?.collectionCardLimit ?? defaults.library.collectionCardLimit, defaults.library.collectionCardLimit, 1, 12),
      shuffleCollections: Boolean(input.library?.shuffleCollections ?? base.library?.shuffleCollections ?? defaults.library.shuffleCollections),
      copyAttributionEnabled: Boolean(input.library?.copyAttributionEnabled ?? base.library?.copyAttributionEnabled ?? defaults.library.copyAttributionEnabled)
    },
    audio: {
      enabled: Boolean(input.audio?.enabled ?? base.audio?.enabled ?? defaults.audio.enabled),
      exposePlayerUi: Boolean(input.audio?.exposePlayerUi ?? base.audio?.exposePlayerUi ?? defaults.audio.exposePlayerUi),
      defaultProvider,
      providers: {
        openai: {
          enabled: Boolean(input.audio?.providers?.openai?.enabled ?? base.audio?.providers?.openai?.enabled ?? defaults.audio.providers.openai.enabled),
          model: sanitizeText(input.audio?.providers?.openai?.model ?? base.audio?.providers?.openai?.model ?? defaults.audio.providers.openai.model, 120) || defaults.audio.providers.openai.model,
          voice: sanitizeText(input.audio?.providers?.openai?.voice ?? base.audio?.providers?.openai?.voice ?? defaults.audio.providers.openai.voice, 120) || defaults.audio.providers.openai.voice
        },
        elevenlabs: {
          enabled: Boolean(input.audio?.providers?.elevenlabs?.enabled ?? base.audio?.providers?.elevenlabs?.enabled ?? defaults.audio.providers.elevenlabs.enabled),
          model: sanitizeText(input.audio?.providers?.elevenlabs?.model ?? base.audio?.providers?.elevenlabs?.model ?? defaults.audio.providers.elevenlabs.model, 120) || defaults.audio.providers.elevenlabs.model,
          voiceId: sanitizeText(input.audio?.providers?.elevenlabs?.voiceId ?? base.audio?.providers?.elevenlabs?.voiceId ?? defaults.audio.providers.elevenlabs.voiceId, 190)
        }
      }
    },
    contentAudit: {
      enabled: Boolean(input.contentAudit?.enabled ?? base.contentAudit?.enabled ?? defaults.contentAudit.enabled),
      autoReviewQueue: Boolean(input.contentAudit?.autoReviewQueue ?? base.contentAudit?.autoReviewQueue ?? defaults.contentAudit.autoReviewQueue),
      maxFindingsPerBook: sanitizeInteger(input.contentAudit?.maxFindingsPerBook ?? base.contentAudit?.maxFindingsPerBook ?? defaults.contentAudit.maxFindingsPerBook, defaults.contentAudit.maxFindingsPerBook, 1, 10)
    },
    monitoring: {
      enabled: Boolean(input.monitoring?.enabled ?? base.monitoring?.enabled ?? defaults.monitoring.enabled),
      alertEmail: sanitizeText(input.monitoring?.alertEmail ?? base.monitoring?.alertEmail ?? defaults.monitoring.alertEmail, 190),
      checkIntervalMinutes: sanitizeInteger(input.monitoring?.checkIntervalMinutes ?? base.monitoring?.checkIntervalMinutes ?? defaults.monitoring.checkIntervalMinutes, defaults.monitoring.checkIntervalMinutes, 5, 1440)
    },
    dry_run: runtime.dryRun,
    approval_required: runtime.approvalRequired
  };
}

function publicSiteSettings(settings = {}) {
  const normalized = normalizeAdminSettings(settings, settings);
  return {
    members: {
      allowRegistration: normalized.members.allowRegistration,
      plans: normalized.members.plans
    },
    thoth: {
      enabled: normalized.thoth.enabled,
      hourlyLimit: normalized.thoth.hourlyLimit
    },
    payments: {
      paypalEnabled: normalized.payments.paypalEnabled,
      paypalRecipientEmail: normalized.payments.paypalRecipientEmail,
      stripeEnabled: normalized.payments.stripeEnabled
    },
    library: normalized.library,
    audio: {
      enabled: normalized.audio.enabled,
      exposePlayerUi: normalized.audio.exposePlayerUi,
      defaultProvider: normalized.audio.defaultProvider
    }
  };
}

function sanitizeMemberPreferences(input = {}) {
  return {
    showBookmarksInSidebar: Boolean(input.showBookmarksInSidebar)
  };
}

function normalizeResearchTags(input) {
  if (Array.isArray(input)) return input.map((tag) => sanitizeText(tag, 80)).filter(Boolean).slice(0, 20);
  return String(input || "")
    .split(",")
    .map((tag) => sanitizeText(tag.trim(), 80))
    .filter(Boolean)
    .slice(0, 20);
}

function validateHighlightInput(input = {}) {
  const color = sanitizeText(input.color || "yellow", 32).toLowerCase();
  if (!allowedHighlightColors.has(color)) {
    const error = new Error("Invalid highlight color.");
    error.status = 400;
    throw error;
  }
  return {
    bookSlug: sanitizeText(input.bookSlug, 190),
    bookTitle: sanitizeText(input.bookTitle || "Untitled", 255),
    color,
    text: String(input.text || "").slice(0, 5000),
    note: String(input.note || "").slice(0, 1000),
    folder: sanitizeText(input.folder || "General", 120) || "General",
    tags: normalizeResearchTags(input.tags)
  };
}

function validateHighlightUpdateInput(input = {}) {
  const output = {};
  if (input.note != null) output.note = String(input.note || "").slice(0, 1000);
  if (input.folder != null) output.folder = sanitizeText(input.folder || "General", 120) || "General";
  if (input.tags != null) output.tags = normalizeResearchTags(input.tags);
  return output;
}

function normalizeMemberNote(userId, input = {}) {
  const content = String(input.content || input.text || "").trim().slice(0, 20000);
  if (!content) {
    const error = new Error("Note content is required.");
    error.status = 400;
    throw error;
  }
  return {
    id: crypto.randomUUID(),
    userId,
    title: sanitizeText(input.title || "THOTH research note", 255) || "THOTH research note",
    content,
    source: sanitizeText(input.source || "THOTH", 80) || "THOTH",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeSourceMetadata(input = {}) {
  return {
    sourceUrl: sanitizeText(input.sourceUrl || input.source_url || "", 800),
    archiveUrl: sanitizeText(input.archiveUrl || input.archive_url || "", 800),
    translator: sanitizeText(input.translator || "", 255),
    editor: sanitizeText(input.editor || "", 255),
    publicationDate: sanitizeText(input.publicationDate || input.publication_date || "", 80),
    license: sanitizeText(input.license || "", 190),
    publicDomain: Boolean(input.publicDomain ?? input.public_domain ?? false),
    reviewedAt: sanitizeText(input.reviewedAt || input.reviewed_at || "", 80),
    sourceType: sanitizeText(input.sourceType || input.source_type || "", 80),
    confidence: sanitizeText(input.confidence || "", 80),
    citation: sanitizeText(input.citation || "", 1000),
    notes: sanitizeText(input.notes || "", 1000)
  };
}

function hasExternalSource(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function sourceConfidenceForBook(book = {}, source = {}) {
  if (allowedSourceConfidence.has(source.confidence)) return source.confidence;
  if (source.reviewedAt || (source.publicDomain && (source.sourceUrl || source.archiveUrl)) || (source.license && (source.sourceUrl || source.archiveUrl))) {
    return "verified";
  }
  if (hasExternalSource(source.sourceUrl) || hasExternalSource(source.archiveUrl) || (Array.isArray(book.sourceUrls) && book.sourceUrls.some(hasExternalSource))) {
    return "source-linked";
  }
  if (source.sourceUrl || source.archiveUrl || book.sourceFile) return "local-source";
  return "needs-citation";
}

function sourceTypeForBook(book = {}, source = {}) {
  if (source.sourceType) return source.sourceType;
  if (hasExternalSource(source.sourceUrl) || hasExternalSource(source.archiveUrl) || (Array.isArray(book.sourceUrls) && book.sourceUrls.some(hasExternalSource))) return "external source";
  if (book.sourceFile) return "local imported source";
  return "citation needed";
}

function citationForBook(book = {}, source = {}) {
  if (source.citation) return source.citation;
  const parts = [
    source.translator ? `Translator: ${source.translator}` : "",
    source.editor ? `Editor: ${source.editor}` : "",
    source.publicationDate ? `Published: ${source.publicationDate}` : "",
    source.license || source.publicDomain ? `Rights: ${source.publicDomain ? "Public domain" : source.license}` : "",
    source.sourceUrl || source.archiveUrl || book.sourceFile ? `Source: ${source.sourceUrl || source.archiveUrl || book.sourceFile}` : ""
  ].filter(Boolean);
  return parts.join("; ");
}

function finalizeSourceMetadata(book = {}, input = {}) {
  const source = normalizeSourceMetadata(input);
  const confidence = sourceConfidenceForBook(book, source);
  return {
    ...source,
    confidence,
    sourceType: sourceTypeForBook(book, source),
    citation: citationForBook(book, { ...source, confidence })
  };
}

function sourceMetadataForBook(book = {}) {
  const sourceUrls = Array.isArray(book.sourceUrls) ? book.sourceUrls.filter(Boolean) : [];
  const explicit = book.sourceMetadata || {};
  return finalizeSourceMetadata(book, {
    sourceUrl: explicit.sourceUrl || book.sourceUrl || sourceUrls[0] || "",
    archiveUrl: explicit.archiveUrl || book.archiveUrl || "",
    translator: explicit.translator || book.translator || book.source?.translator || "",
    editor: explicit.editor || book.editor || book.source?.editor || "",
    publicationDate: explicit.publicationDate || book.publicationDate || book.source?.publicationDate || "",
    license: explicit.license || book.license || book.source?.license || "",
    publicDomain: Boolean(explicit.publicDomain || book.publicDomain || book.source?.publicDomain),
    reviewedAt: explicit.reviewedAt || book.reviewedAt || "",
    sourceType: explicit.sourceType || book.source?.sourceType || "",
    confidence: explicit.confidence || book.source?.confidence || "",
    citation: explicit.citation || book.source?.citation || "",
    notes: explicit.notes || (book.sourceFile ? `Source file: ${book.sourceFile}` : "")
  });
}

function validateBookOverrideInput(input = {}) {
  const output = {};
  if (input.visibility != null) {
    const visibility = sanitizeText(input.visibility, 32);
    if (!allowedBookVisibility.has(visibility)) {
      const error = new Error("Invalid visibility value.");
      error.status = 400;
      throw error;
    }
    output.visibility = visibility;
  }
  if (input.reviewStatus != null) {
    const reviewStatus = sanitizeText(input.reviewStatus, 32);
    if (!allowedReviewStatus.has(reviewStatus)) {
      const error = new Error("Invalid review status.");
      error.status = 400;
      throw error;
    }
    output.reviewStatus = reviewStatus;
  }
  if (input.titleOverride != null) output.titleOverride = sanitizeText(input.titleOverride, 255);
  if (input.collectionOverride != null) output.collectionOverride = sanitizeText(input.collectionOverride, 190);
  if (input.excerptOverride != null) output.excerptOverride = String(input.excerptOverride || "").slice(0, 4000);
  if (input.adminNotes != null) output.adminNotes = String(input.adminNotes || "").slice(0, 2000);
  if (input.sourceMetadata != null) output.sourceMetadata = normalizeSourceMetadata(input.sourceMetadata);
  return output;
}

function validateReviewQueueInput(input = {}) {
  const output = {};
  if (input.status != null) {
    const status = sanitizeText(input.status, 32);
    if (!allowedQueueStatus.has(status)) {
      const error = new Error("Invalid review queue status.");
      error.status = 400;
      throw error;
    }
    output.status = status;
  }
  if (input.assignedTo != null) output.assignedTo = sanitizeText(input.assignedTo, 190);
  if (input.adminNotes != null) output.adminNotes = String(input.adminNotes || "").slice(0, 2000);
  return output;
}

function loadCanonicalIndex() {
  return readJson(bookIndexFile, { generatedAt: null, books: [], collections: [] });
}

function loadCanonicalStats() {
  return readJson(siteStatsFile, {
    publicBooks: 0,
    completedTexts: 0,
    collections: 0,
    indexedWords: 0,
    openReviewItems: 0
  });
}

function countMediaCatalog(fileName) {
  const file = path.join(dataDir, fileName);
  if (!fs.existsSync(file)) return 0;
  const value = readJson(file, []);
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value.items)) return value.items.length;
  if (Array.isArray(value.media)) return value.media.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function countStandaloneMediaItems() {
  return [
    "sumerian-tablets.json",
    "related-media.json",
    "egyptian-underworld-media.json",
    "bardo-media.json"
  ].reduce((total, fileName) => total + countMediaCatalog(fileName), 0);
}

function loadSiteVersion() {
  return readJson(siteVersionFile, {
    version: "1.1.1",
    releaseName: "Clovis Star",
    bumpStep: "0.0.1",
    updatedAt: null,
    notes: []
  });
}

function loadCanonicalBook(slug) {
  return readJson(path.join(booksDir, `${slug}.json`), null);
}

function loadAllBookRecords() {
  try {
    return fs.readdirSync(booksDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson(path.join(booksDir, name), null))
      .filter(Boolean);
  } catch {
    return loadCanonicalIndex().books || [];
  }
}

function loadDefaultSettings() {
  return normalizeAdminSettings(readJson(settingsDefaultsFile, {}));
}

function loadDefaultReviewQueue() {
  return readJson(reviewDefaultsFile, []);
}

function applyBookOverride(book, override = {}) {
  if (!book) return null;
  const sourceMetadata = finalizeSourceMetadata(book, {
    ...sourceMetadataForBook(book),
    ...(override.sourceMetadata || {})
  });
  return {
    ...book,
    title: override.titleOverride || book.title,
    collection: override.collectionOverride || book.collection,
    excerpt: override.excerptOverride || book.excerpt,
    visibility: override.visibility || book.visibility,
    reviewStatus: override.reviewStatus || book.reviewStatus || (book.quality?.issues?.length ? "open" : "clean"),
    adminNotes: override.adminNotes || "",
    sourceMetadata
  };
}

function mergeReviewQueue(defaultQueue, storedQueue) {
  const storedById = new Map((storedQueue || []).map((item) => [item.id, item]));
  const merged = defaultQueue.map((item) => ({ ...item, ...(storedById.get(item.id) || {}) }));
  for (const item of storedQueue || []) {
    if (!merged.some((entry) => entry.id === item.id)) merged.push(item);
  }
  return merged.sort((a, b) => {
    const severity = { high: 0, medium: 1, low: 2 };
    return (severity[a.severity] ?? 9) - (severity[b.severity] ?? 9) || String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function publicApiBookSummary(book) {
  const source = book.sourceMetadata || sourceMetadataForBook(book);
  return {
    slug: book.slug,
    title: book.title,
    collection: book.collection || "Library",
    excerpt: book.excerpt || "",
    wordCount: book.wordCount || 0,
    quality: book.quality || {},
    mediaCount: Array.isArray(book.media) ? book.media.length : 0,
    source: {
      confidence: source.confidence || "needs-citation",
      sourceType: source.sourceType || "",
      sourceUrl: source.sourceUrl || "",
      archiveUrl: source.archiveUrl || "",
      citation: source.citation || "",
      publicDomain: Boolean(source.publicDomain),
      license: source.license || ""
    },
    updatedAt: book.updatedAt || ""
  };
}

function sourceCompletionItem(book) {
  const source = book.sourceMetadata || sourceMetadataForBook(book);
  return {
    slug: book.slug,
    title: book.title,
    collection: book.collection || "Library",
    wordCount: book.wordCount || 0,
    visibility: book.visibility || "public",
    status: book.quality?.status || "",
    issues: book.quality?.issues || [],
    sourceFile: book.sourceFile || "",
    sourceUrls: book.sourceUrls || [],
    mediaCount: Array.isArray(book.media) ? book.media.length : 0,
    sourceMetadata: source,
    provenanceStatus: source.confidence || "needs-citation"
  };
}

function hasVisibleMarkup(book = {}) {
  const text = [...(book.paragraphs || []), book.excerpt || ""].join(" ");
  return /(&lt;|&gt;|<\/?[a-z][^>]*>|\|strong=|\[\/?[a-z]+\])/i.test(text);
}

function buildContentOperations(state) {
  const books = state.books || [];
  const unresolvedReview = (state.reviewQueue || []).filter((item) => item.status !== "resolved");
  const incomplete = books.filter((book) => !["completed", "ready", "reviewed"].includes(book.quality?.status || "") || Number(book.wordCount || 0) < 100);
  const sourceGaps = books.filter((book) => {
    const source = book.sourceMetadata || {};
    return !source.sourceUrl && !source.archiveUrl && !book.sourceFile && !(Array.isArray(book.sourceUrls) && book.sourceUrls.length);
  });
  const markupIssues = books.filter(hasVisibleMarkup);
  const brokenMedia = books.filter((book) => (book.media || []).some((item) => !item.src && !item.url && !item.publicUrl));
  const missingCitations = books.filter((book) => {
    const source = book.sourceMetadata || {};
    return !source.translator && !source.editor && !source.license && !source.publicDomain;
  });
  const provenanceNeedsReview = books.filter((book) => (book.sourceMetadata?.confidence || "needs-citation") === "needs-citation");
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      incomplete: incomplete.length,
      sourceGaps: sourceGaps.length,
      visibleMarkup: markupIssues.length,
      brokenMedia: brokenMedia.length,
      missingCitations: missingCitations.length,
      provenanceNeedsReview: provenanceNeedsReview.length,
      unresolvedReview: unresolvedReview.length
    },
    incomplete: incomplete.slice(0, 250).map(sourceCompletionItem),
    sourceGaps: sourceGaps.slice(0, 250).map(sourceCompletionItem),
    visibleMarkup: markupIssues.slice(0, 250).map(sourceCompletionItem),
    brokenMedia: brokenMedia.slice(0, 250).map(sourceCompletionItem),
    missingCitations: missingCitations.slice(0, 250).map(sourceCompletionItem),
    provenanceNeedsReview: provenanceNeedsReview.slice(0, 250).map(sourceCompletionItem),
    unresolvedReview: unresolvedReview.slice(0, 250)
  };
}

function validateContentBatchInput(input = {}) {
  const allowedBuckets = new Set(["incomplete", "sourceGaps", "visibleMarkup", "brokenMedia", "missingCitations", "provenanceNeedsReview"]);
  const allowedActions = new Set(["mark_in_progress", "mark_verified", "hide_public"]);
  const bucket = sanitizeText(input.bucket || "", 80);
  const action = sanitizeText(input.action || "", 80);
  if (!allowedBuckets.has(bucket)) {
    const error = new Error("Invalid content-operation bucket.");
    error.status = 400;
    throw error;
  }
  if (!allowedActions.has(action)) {
    const error = new Error("Invalid content-operation action.");
    error.status = 400;
    throw error;
  }
  return { bucket, action };
}

async function applyContentBatchOperation({ state, store, userId, bucket, action }) {
  const operations = buildContentOperations(state);
  const items = (operations[bucket] || []).slice(0, 100);
  const now = new Date().toISOString();
  let updated = 0;
  for (const item of items) {
    const book = state.books.find((candidate) => candidate.slug === item.slug);
    if (!book) continue;
    const sourceMetadata = { ...(book.sourceMetadata || {}) };
    const patch = {
      adminNotes: `Batch action ${action} from ${bucket} at ${now}.`
    };
    if (action === "mark_in_progress") {
      patch.reviewStatus = "in_progress";
    }
    if (action === "hide_public") {
      patch.visibility = "private";
      patch.reviewStatus = "in_progress";
    }
    if (action === "mark_verified") {
      patch.reviewStatus = "resolved";
      patch.sourceMetadata = {
        ...sourceMetadata,
        confidence: "verified",
        reviewedAt: now,
        notes: sourceMetadata.notes || "Source reviewed by admin batch action."
      };
    }
    await store.saveBookOverride(userId, item.slug, patch);
    updated += 1;
  }
  return { bucket, action, updated, limitedTo: items.length };
}

function buildQaReport(state) {
  const operations = buildContentOperations(state);
  const pages = [
    "/",
    "/books/",
    "/compare/",
    "/members/",
    "/members/instructions/",
    "/about/",
    "/admin/",
    "/api/",
    "/api/health"
  ];
  return {
    generatedAt: new Date().toISOString(),
    version: state.siteVersion?.version || "",
    releaseName: state.siteVersion?.releaseName || "",
    stats: state.stats,
    checks: {
      pages,
      pageCount: pages.length,
      contentOperations: operations.summary,
      publicBooks: state.stats.publicBooks,
      collections: state.collections.length,
      openReviewItems: state.stats.openReviewItems,
      searchReady: true,
      sourceMetadataReady: true,
      memberResearchToolsReady: true
    },
    operations
  };
}

function saveQaReport(report) {
  writeJson(qaReportFile, report);
  return report;
}

function loadQaReport() {
  return readJson(qaReportFile, {});
}

function searchRuntimeBooks(state, query, filters = {}) {
  const q = String(query || "").trim().toLowerCase();
  const collection = String(filters.collection || "").toLowerCase();
  const quality = String(filters.quality || "").toLowerCase();
  const sourceConfidence = String(filters.sourceConfidence || "").toLowerCase();
  const mediaCategory = String(filters.mediaCategory || "").toLowerCase();
  const minWords = Number(filters.minWords || 0);
  const maxWords = Number(filters.maxWords || 0);
  const hasMedia = filters.hasMedia === "1" || filters.hasMedia === "true";
  const hasSource = filters.hasSource === "1" || filters.hasSource === "true";
  const books = (state.books || []).filter((book) => book.visibility !== "private");
  const results = books
    .map((book) => {
      const source = book.sourceMetadata || sourceMetadataForBook(book);
      const media = Array.isArray(book.media) ? book.media : [];
      const wordCount = Number(book.wordCount || 0);
      const haystack = [
        book.title,
        book.collection,
        book.excerpt,
        book.quality?.status,
        source.translator,
        source.editor,
        source.license,
        source.sourceUrl,
        source.archiveUrl,
        source.confidence,
        book.sourceFile,
        ...(book.sourceUrls || []),
        ...media.flatMap((item) => [item.title, item.name, item.caption, item.description, item.category, item.sourceUrl, item.publicUrl, item.url, item.src]),
        ...(book.paragraphs || []).slice(0, 8)
      ].join(" ").toLowerCase();
      let score = 0;
      if (!q || haystack.includes(q)) score += q ? 5 : 1;
      if (q && String(book.title || "").toLowerCase().includes(q)) score += 8;
      if (collection && String(book.collection || "").toLowerCase() !== collection) return null;
      if (quality && String(book.quality?.status || book.reviewStatus || "").toLowerCase() !== quality) return null;
      if (sourceConfidence && source.confidence !== sourceConfidence) return null;
      if (mediaCategory && !media.some((item) => String(item.category || item.type || "").toLowerCase() === mediaCategory)) return null;
      if (minWords && wordCount < minWords) return null;
      if (maxWords && wordCount > maxWords) return null;
      if (hasMedia && !media.length) return null;
      if (hasSource && !source.sourceUrl && !source.archiveUrl && !book.sourceFile && !(Array.isArray(book.sourceUrls) && book.sourceUrls.length)) return null;
      if (q && score === 0) return null;
      return {
        slug: book.slug,
        title: book.title,
        collection: book.collection || "Library",
        excerpt: book.excerpt || "",
        wordCount,
        qualityStatus: book.quality?.status || book.reviewStatus || "",
        hasMedia: Boolean(media.length),
        mediaCount: media.length,
        hasSource: Boolean(source.sourceUrl || source.archiveUrl || book.sourceFile || (Array.isArray(book.sourceUrls) && book.sourceUrls.length)),
        sourceConfidence: source.confidence || "needs-citation",
        sourceType: source.sourceType || "",
        sourceLabel: source.sourceUrl || source.archiveUrl || book.sourceFile || "",
        score
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 100);
  return { query: q, filters, count: results.length, results };
}

function publicApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Clovis Star Catalog API",
      version: "1.0.0",
      description: "Token-protected access to public Clovis Star books, collections, and catalog metadata."
    },
    servers: [{ url: "https://clovisstar.com" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" }
      }
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/catalog": {
        get: {
          summary: "List public books, collections, and catalog statistics.",
          responses: {
            "200": { description: "Catalog response." },
            "401": { description: "Valid API token required." }
          }
        }
      },
      "/api/v1/collections": {
        get: {
          summary: "List public collections.",
          responses: {
            "200": { description: "Collections response." },
            "401": { description: "Valid API token required." }
          }
        }
      },
      "/api/v1/books/{slug}": {
        get: {
          summary: "Read one public book by slug.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Book response." },
            "401": { description: "Valid API token required." },
            "404": { description: "Book not found or not public." }
          }
        }
      }
    }
  };
}

async function requireApiUser(req, store) {
  const apiUser = await store.authenticateApiToken(apiTokenFromRequest(req));
  if (!apiUser) {
    const error = new Error("Valid API token required.");
    error.status = 401;
    error.headers = { "www-authenticate": 'Bearer realm="Clovis Star API"' };
    throw error;
  }
  return apiUser;
}

function requireSignedIn(user) {
  if (!user) {
    const error = new Error("Sign in required.");
    error.status = 401;
    throw error;
  }
}

function requireAdmin(user) {
  requireSignedIn(user);
  if ((user.role || "member") !== "admin") {
    const error = new Error("Admin access required.");
    error.status = 403;
    throw error;
  }
}

function isUnsafeMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());
}

function sameOriginRequest(req) {
  const hostCandidates = new Set(
    [
      req.headers.host,
      req.headers["x-forwarded-host"],
      req.headers["x-original-host"],
      "clovisstar.com",
      "www.clovisstar.com"
    ]
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  try {
    if (origin) return hostCandidates.has(new URL(origin).host.toLowerCase());
    if (referer) return hostCandidates.has(new URL(referer).host.toLowerCase());
  } catch {
    return false;
  }
  return true;
}

function requireSameOrigin(req) {
  if (!sameOriginRequest(req)) {
    const error = new Error("Cross-site request blocked.");
    error.status = 403;
    throw error;
  }
}

function requireCsrf(req, session) {
  if (!session?.csrfToken) {
    const error = new Error("Session validation failed.");
    error.status = 403;
    throw error;
  }
  const headerToken = sanitizeText(req.headers["x-csrf-token"] || "", 128);
  if (!headerToken || headerToken !== session.csrfToken) {
    const error = new Error("CSRF validation failed.");
    error.status = 403;
    throw error;
  }
}

function createSessionRecord(userId, req) {
  const token = createSecretToken();
  const csrfToken = createSecretToken();
  return {
    session: {
      id: crypto.randomUUID(),
      userId,
      tokenHash: tokenHash(token),
      csrfToken,
      userAgent: sanitizeText(req.headers["user-agent"] || "", 255),
      ipAddress: sanitizeText(clientIp(req), 120),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + sessionTtlMs).toISOString()
    },
    token,
    csrfToken
  };
}

function mysqlDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function pruneExpiredSessions(items = []) {
  const now = new Date().toISOString();
  return items.filter((item) => item.expiresAt > now);
}

async function createMysqlStore() {
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool({
    host: requiredEnv("CLOVIS_DB_HOST"),
    user: requiredEnv("CLOVIS_DB_USER"),
    password: requiredEnv("CLOVIS_DB_PASSWORD"),
    database: requiredEnv("CLOVIS_DB_NAME"),
    waitForConnections: true,
    connectionLimit: 10
  });
  await pool.execute(`CREATE TABLE IF NOT EXISTS clovisstar_member_notes (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT NOT NULL,
    source VARCHAR(80) NOT NULL DEFAULT 'THOTH',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_clovisstar_member_notes_user_created (user_id, created_at),
    CONSTRAINT fk_clovisstar_member_notes_user FOREIGN KEY (user_id) REFERENCES clovisstar_users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  return {
    async register({ email, password, displayName }, req) {
      const normalizedEmail = validateEmail(email);
      const secret = validatePassword(password);
      const role = resolveNewUserRole(normalizedEmail);
      const id = crypto.randomUUID();
      const { session, token, csrfToken } = createSessionRecord(id, req);
      await pool.execute(
        "INSERT INTO clovisstar_users (id, email, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
        [id, normalizedEmail, sanitizeText(displayName || normalizedEmail.split("@")[0], 190), role, hashPassword(secret)]
      );
      await pool.execute(
        "INSERT INTO clovisstar_sessions (id, user_id, token_hash, csrf_token, user_agent, ip_address, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [session.id, id, session.tokenHash, session.csrfToken, session.userAgent, session.ipAddress, mysqlDateTime(session.lastSeenAt), mysqlDateTime(session.expiresAt)]
      );
      return { user: { id, email: normalizedEmail, displayName: sanitizeText(displayName || normalizedEmail.split("@")[0], 190), role }, sessionToken: token, csrfToken, expiresAt: session.expiresAt };
    },
    async login({ email, password }, req) {
      const normalizedEmail = validateEmail(email);
      const secret = String(password || "");
      const [rows] = await pool.execute("SELECT * FROM clovisstar_users WHERE email = ? LIMIT 1", [normalizedEmail]);
      const user = rows[0];
      if (!user || !verifyPassword(secret, user.password_hash)) return null;
      const { session, token, csrfToken } = createSessionRecord(user.id, req);
      await pool.execute(
        "INSERT INTO clovisstar_sessions (id, user_id, token_hash, csrf_token, user_agent, ip_address, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [session.id, user.id, session.tokenHash, session.csrfToken, session.userAgent, session.ipAddress, mysqlDateTime(session.lastSeenAt), mysqlDateTime(session.expiresAt)]
      );
      return { user: publicUser(user), sessionToken: token, csrfToken, expiresAt: session.expiresAt };
    },
    async auth(sessionToken) {
      if (!sessionToken) return null;
      const now = mysqlDateTime();
      const [rows] = await pool.execute(
        `SELECT u.id, u.email, u.display_name, u.role, s.id AS session_id, s.csrf_token, s.expires_at
         FROM clovisstar_sessions s
         JOIN clovisstar_users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`,
        [tokenHash(sessionToken), now]
      );
      const user = rows[0];
      if (!user) return null;
      await pool.execute("UPDATE clovisstar_sessions SET last_seen_at = ? WHERE id = ?", [now, user.session_id]);
      return {
        user: publicUser(user),
        session: {
          id: user.session_id,
          csrfToken: user.csrf_token,
          expiresAt: user.expires_at
        }
      };
    },
    async logout(sessionToken) {
      if (!sessionToken) return;
      await pool.execute("DELETE FROM clovisstar_sessions WHERE token_hash = ?", [tokenHash(sessionToken)]);
    },
    async createPasswordReset(email) {
      const normalizedEmail = validateEmail(email);
      const [rows] = await pool.execute("SELECT id, email FROM clovisstar_users WHERE email = ? LIMIT 1", [normalizedEmail]);
      const user = rows[0];
      if (!user) return null;
      const token = createSecretToken();
      const key = `password_reset:${tokenHash(token)}`;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await pool.execute("INSERT INTO clovisstar_transients (transient_key, transient_value_json, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE transient_value_json = VALUES(transient_value_json), expires_at = VALUES(expires_at)", [key, JSON.stringify({ userId: user.id }), mysqlDateTime(expiresAt)]);
      return { email: user.email, token };
    },
    async resetPassword(token, password) {
      const key = `password_reset:${tokenHash(String(token || ""))}`;
      const [rows] = await pool.execute("SELECT transient_value_json FROM clovisstar_transients WHERE transient_key = ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1", [key, mysqlDateTime()]);
      if (!rows[0]) return false;
      const payload = JSON.parse(rows[0].transient_value_json || "{}");
      const secret = validatePassword(password);
      await pool.execute("UPDATE clovisstar_users SET password_hash = ? WHERE id = ?", [hashPassword(secret), payload.userId]);
      await pool.execute("DELETE FROM clovisstar_sessions WHERE user_id = ?", [payload.userId]);
      await pool.execute("DELETE FROM clovisstar_transients WHERE transient_key = ?", [key]);
      return true;
    },
    async listHighlights(userId) {
      const [rows] = await pool.execute(
        "SELECT id, book_slug AS bookSlug, book_title AS bookTitle, color, selected_text AS text, note, folder, tags_json AS tagsJson, created_at AS createdAt FROM clovisstar_highlights WHERE user_id = ? ORDER BY created_at DESC",
        [userId]
      );
      return rows.map((row) => ({ ...row, tags: row.tagsJson ? JSON.parse(row.tagsJson) : [] }));
    },
    async addHighlight(userId, input) {
      const item = normalizeHighlight(userId, input);
      await pool.execute(
        "INSERT INTO clovisstar_highlights (id, user_id, book_slug, book_title, color, selected_text, note, folder, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [item.id, userId, item.bookSlug, item.bookTitle, item.color, item.text, item.note, item.folder, JSON.stringify(item.tags || [])]
      );
      return item;
    },
    async updateHighlightNote(userId, id, input) {
      const changes = typeof input === "object" ? validateHighlightUpdateInput(input) : { note: String(input || "").slice(0, 1000) };
      const current = (await this.listHighlights(userId)).find((item) => item.id === id) || {};
      const next = {
        note: changes.note ?? current.note ?? "",
        folder: changes.folder ?? current.folder ?? "General",
        tags: changes.tags ?? current.tags ?? []
      };
      await pool.execute("UPDATE clovisstar_highlights SET note = ?, folder = ?, tags_json = ? WHERE id = ? AND user_id = ?", [next.note, next.folder, JSON.stringify(next.tags), id, userId]);
      const [rows] = await pool.execute(
        "SELECT id, book_slug AS bookSlug, book_title AS bookTitle, color, selected_text AS text, note, folder, tags_json AS tagsJson, created_at AS createdAt FROM clovisstar_highlights WHERE id = ? AND user_id = ? LIMIT 1",
        [id, userId]
      );
      return rows[0] ? { ...rows[0], tags: rows[0].tagsJson ? JSON.parse(rows[0].tagsJson) : [] } : null;
    },
    async deleteHighlight(userId, id) {
      await pool.execute("DELETE FROM clovisstar_highlights WHERE id = ? AND user_id = ?", [id, userId]);
    },
    async listMemberNotes(userId) {
      const [rows] = await pool.execute("SELECT id, title, content, source, created_at AS createdAt, updated_at AS updatedAt FROM clovisstar_member_notes WHERE user_id = ? ORDER BY created_at DESC", [userId]);
      return rows;
    },
    async addMemberNote(userId, input) {
      const note = normalizeMemberNote(userId, input);
      await pool.execute("INSERT INTO clovisstar_member_notes (id, user_id, title, content, source) VALUES (?, ?, ?, ?, ?)", [note.id, userId, note.title, note.content, note.source]);
      return note;
    },
    async deleteMemberNote(userId, id) {
      await pool.execute("DELETE FROM clovisstar_member_notes WHERE id = ? AND user_id = ?", [id, userId]);
    },
    async getGlobalSettings() {
      const [rows] = await pool.execute("SELECT setting_key, setting_value_json FROM clovisstar_settings");
      const settings = rows.reduce((settings, row) => {
        settings[row.setting_key] = JSON.parse(row.setting_value_json);
        return settings;
      }, {});
      return normalizeAdminSettings(settings, settings);
    },
    async saveGlobalSettings(userId, settings) {
      for (const [key, value] of Object.entries(settings)) {
        await pool.execute(
          "INSERT INTO clovisstar_settings (setting_key, setting_value_json, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value_json = VALUES(setting_value_json), updated_by = VALUES(updated_by)",
          [key, JSON.stringify(value), userId]
        );
      }
      return this.getGlobalSettings();
    },
    async getMemberPreferences(userId) {
      const [rows] = await pool.execute("SELECT show_bookmarks_in_sidebar AS showBookmarksInSidebar FROM clovisstar_member_preferences WHERE user_id = ? LIMIT 1", [userId]);
      return rows[0] ? sanitizeMemberPreferences(rows[0]) : {};
    },
    async saveMemberPreferences(userId, preferences, updatedBy = userId) {
      const next = sanitizeMemberPreferences(preferences);
      await pool.execute(
        `INSERT INTO clovisstar_member_preferences (user_id, show_bookmarks_in_sidebar, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           show_bookmarks_in_sidebar = VALUES(show_bookmarks_in_sidebar),
           updated_by = VALUES(updated_by)`,
        [userId, next.showBookmarksInSidebar ? 1 : 0, updatedBy]
      );
      return next;
    },
    async listBookOverrides() {
      const [rows] = await pool.execute("SELECT * FROM clovisstar_book_overrides");
      return rows.reduce((map, row) => {
        map[row.book_slug] = {
          visibility: row.visibility,
          titleOverride: row.title_override,
          collectionOverride: row.collection_override,
          excerptOverride: row.excerpt_override,
          reviewStatus: row.review_status,
          adminNotes: row.admin_notes,
          sourceMetadata: row.source_metadata_json ? JSON.parse(row.source_metadata_json) : {}
        };
        return map;
      }, {});
    },
    async saveBookOverride(userId, slug, changes) {
      const existing = (await this.listBookOverrides())[slug] || {};
      const next = { ...existing, ...changes };
      await pool.execute(
        `INSERT INTO clovisstar_book_overrides
          (book_slug, visibility, title_override, collection_override, excerpt_override, review_status, admin_notes, source_metadata_json, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          visibility = VALUES(visibility),
          title_override = VALUES(title_override),
          collection_override = VALUES(collection_override),
          excerpt_override = VALUES(excerpt_override),
          review_status = VALUES(review_status),
          admin_notes = VALUES(admin_notes),
          source_metadata_json = VALUES(source_metadata_json),
          updated_by = VALUES(updated_by)`,
        [slug, next.visibility || null, next.titleOverride || null, next.collectionOverride || null, next.excerptOverride || null, next.reviewStatus || null, next.adminNotes || null, JSON.stringify(next.sourceMetadata || {}), userId]
      );
      return next;
    },
    async listStoredReviewQueue() {
      const [rows] = await pool.execute("SELECT * FROM clovisstar_review_queue");
      return rows.map((row) => ({
        id: row.id,
        bookSlug: row.book_slug,
        severity: row.severity,
        status: row.status,
        source: row.source_label || "",
        summary: row.summary,
        issues: row.details_json ? JSON.parse(row.details_json).issues || [] : [],
        adminNotes: row.admin_notes || "",
        assignedTo: row.assigned_to || "",
        updatedAt: row.updated_at
      }));
    },
    async saveReviewItem(userId, id, changes) {
      const existing = (await this.listStoredReviewQueue()).find((item) => item.id === id) || {};
      const next = { ...existing, ...changes, id };
      await pool.execute(
        `INSERT INTO clovisstar_review_queue
          (id, book_slug, severity, status, source_label, summary, details_json, admin_notes, assigned_to, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          severity = VALUES(severity),
          status = VALUES(status),
          source_label = VALUES(source_label),
          summary = VALUES(summary),
          details_json = VALUES(details_json),
          admin_notes = VALUES(admin_notes),
          assigned_to = VALUES(assigned_to),
          updated_by = VALUES(updated_by)`,
        [
          next.id,
          next.bookSlug || "",
          next.severity || "medium",
          next.status || "open",
          next.source || "",
          next.summary || "",
          JSON.stringify({ issues: next.issues || [] }),
          next.adminNotes || "",
          next.assignedTo || "",
          userId
        ]
      );
      return next;
    },
    async listUsers() {
      const [rows] = await pool.execute(
        "SELECT id, email, display_name, role, api_enabled, api_token_prefix, api_token_created_at, created_at FROM clovisstar_users ORDER BY created_at DESC"
      );
      return rows.map(adminUser);
    },
    async createPayPalCheckoutReference(userId, planId) {
      const reference = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await pool.execute(
        "INSERT INTO clovisstar_transients (transient_key, transient_value_json, expires_at) VALUES (?, ?, ?)",
        [`paypal_ref:${reference}`, JSON.stringify({ userId, planId }), mysqlDateTime(expiresAt)]
      );
      return { reference, expiresAt };
    },
    async applyPayPalEntitlement(event) {
      const eventId = sanitizeText(event.id || "", 190);
      const reference = paypalReferenceFromEvent(event);
      if (!eventId || !reference) return { applied: false, reason: "missing_event_reference" };
      const [refs] = await pool.execute("SELECT transient_value_json FROM clovisstar_transients WHERE transient_key = ? AND expires_at > ? LIMIT 1", [`paypal_ref:${reference}`, mysqlDateTime()]);
      if (!refs[0]) return { applied: false, reason: "unknown_or_expired_reference" };
      const [duplicate] = await pool.execute("SELECT 1 FROM clovisstar_transients WHERE transient_key = ? LIMIT 1", [`paypal_event:${eventId}`]);
      if (duplicate[0]) return { applied: false, duplicate: true };
      const payload = JSON.parse(refs[0].transient_value_json || "{}");
      if (!["explorer", "scholar", "patron"].includes(payload.planId) || !payload.userId) return { applied: false, reason: "unsupported_plan" };
      await pool.execute("INSERT INTO clovisstar_transients (transient_key, transient_value_json, expires_at) VALUES (?, ?, ?)", [`paypal_event:${eventId}`, JSON.stringify({ reference, userId: payload.userId }), mysqlDateTime(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))]);
      const role = { explorer: "supporter", scholar: "scholar", patron: "patron" }[payload.planId];
      await pool.execute("UPDATE clovisstar_users SET role = CASE WHEN role IN ('member','supporter','scholar','patron') THEN ? ELSE role END WHERE id = ?", [role, payload.userId]);
      await pool.execute("DELETE FROM clovisstar_transients WHERE transient_key = ?", [`paypal_ref:${reference}`]);
      return { applied: true, userId: payload.userId, planId: payload.planId };
    },
    async updateUserApiAccess(adminId, userId, apiEnabled) {
      await pool.execute("UPDATE clovisstar_users SET api_enabled = ? WHERE id = ?", [apiEnabled ? 1 : 0, userId]);
      if (!apiEnabled) {
        await pool.execute("UPDATE clovisstar_users SET api_token_hash = NULL, api_token_prefix = NULL, api_token_created_at = NULL WHERE id = ?", [userId]);
      }
      await this.logAdminAction(adminId, "update_user_api_access", { userId, apiEnabled: Boolean(apiEnabled) });
      const [rows] = await pool.execute(
        "SELECT id, email, display_name, role, api_enabled, api_token_prefix, api_token_created_at, created_at FROM clovisstar_users WHERE id = ? LIMIT 1",
        [userId]
      );
      return rows[0] ? adminUser(rows[0]) : null;
    },
    async getApiProfile(userId) {
      const [rows] = await pool.execute(
        "SELECT api_enabled, api_token_prefix, api_token_created_at FROM clovisstar_users WHERE id = ? LIMIT 1",
        [userId]
      );
      const row = rows[0] || {};
      return {
        apiEnabled: Boolean(row.api_enabled),
        hasToken: Boolean(row.api_token_prefix),
        tokenPrefix: row.api_token_prefix || "",
        tokenCreatedAt: row.api_token_created_at || ""
      };
    },
    async rotateApiToken(userId) {
      const token = createApiToken();
      const tokenPrefix = token.slice(0, 10);
      const createdAt = new Date().toISOString();
      const [result] = await pool.execute(
        "UPDATE clovisstar_users SET api_token_hash = ?, api_token_prefix = ?, api_token_created_at = ? WHERE id = ? AND api_enabled = 1",
        [tokenHash(token), tokenPrefix, mysqlDateTime(createdAt), userId]
      );
      if (!result.affectedRows) return null;
      return { token, apiEnabled: true, hasToken: true, tokenPrefix, tokenCreatedAt: createdAt };
    },
    async authenticateApiToken(token) {
      if (!token) return null;
      const [rows] = await pool.execute(
        "SELECT id, email, display_name, role, api_enabled FROM clovisstar_users WHERE api_enabled = 1 AND api_token_hash = ? LIMIT 1",
        [tokenHash(token)]
      );
      return rows[0] ? publicUser(rows[0]) : null;
    },
    async logAdminAction(userId, action, payload) {
      await pool.execute(
        "INSERT INTO clovisstar_admin_audit_log (id, user_id, action, payload_json) VALUES (?, ?, ?, ?)",
        [crypto.randomUUID(), userId, sanitizeText(action, 120), JSON.stringify(payload || {})]
      );
    },
    async health() {
      await pool.query("SELECT 1");
      return { ok: true, driver: "mysql", mode: "active" };
    },
    async listFileAssets() {
      try {
        const [rows] = await pool.execute("SELECT * FROM clovisstar_file_assets ORDER BY created_at DESC LIMIT 500");
        return rows.map(fileAssetFromRow);
      } catch (error) {
        if (error.code === "ER_NO_SUCH_TABLE") return [];
        throw error;
      }
    },
    async saveFileAsset(userId, input) {
      const item = normalizeFileAsset(input);
      await pool.execute(
        `INSERT INTO clovisstar_file_assets
          (id, content_item_id, storage_driver, original_filename, stored_filename, relative_path, mime_type, file_size, file_hash, public_url, visibility, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.contentItemId || null,
          item.storageDriver,
          item.originalFilename,
          item.storedFilename,
          item.relativePath,
          item.mimeType,
          item.fileSize,
          item.fileHash,
          item.publicUrl,
          item.visibility,
          userId
        ]
      );
      return item;
    },
    async cleanupTransients(options = {}) {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const auditRetentionDays = Math.max(1, Number(options.auditRetentionDays || process.env.CLOVIS_AUDIT_RETENTION_DAYS || 180));
      const optimize = Boolean(options.optimize);
      const [expiredSessions] = await pool.execute("DELETE FROM clovisstar_sessions WHERE expires_at <= ?", [now]);
      const [expiredTransients] = await pool.execute("DELETE FROM clovisstar_transients WHERE expires_at IS NOT NULL AND expires_at <= ?", [now]);
      const [oldAuditRows] = await pool.execute("DELETE FROM clovisstar_admin_audit_log WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)", [auditRetentionDays]);
      const optimizedTables = [];
      if (optimize) {
        for (const table of [
          "clovisstar_users",
          "clovisstar_sessions",
          "clovisstar_highlights",
          "clovisstar_settings",
          "clovisstar_member_preferences",
          "clovisstar_book_overrides",
          "clovisstar_review_queue",
          "clovisstar_admin_audit_log",
          "clovisstar_transients"
        ]) {
          await pool.query(`OPTIMIZE TABLE ${table}`);
          optimizedTables.push(table);
        }
      }
      return {
        expiredSessions: expiredSessions.affectedRows || 0,
        expiredTransients: expiredTransients.affectedRows || 0,
        oldAuditRows: oldAuditRows.affectedRows || 0,
        optimizedTables
      };
    }
  };
}

function createJsonStore() {
  ensureJsonDb();
  return {
    async register({ email, password, displayName }, req) {
      const users = readJson(usersFile, []);
      const normalizedEmail = validateEmail(email);
      const secret = validatePassword(password);
      if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
        const error = new Error("Account already exists.");
        error.status = 409;
        throw error;
      }
      const user = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        displayName: sanitizeText(displayName || normalizedEmail.split("@")[0], 190),
        role: resolveNewUserRole(normalizedEmail),
        passwordHash: hashPassword(secret),
        createdAt: new Date().toISOString()
      };
      users.push(user);
      writeJson(usersFile, users);
      const { session, token, csrfToken } = createSessionRecord(user.id, req);
      const sessions = pruneExpiredSessions(readJson(sessionsFile, []));
      sessions.push(session);
      writeJson(sessionsFile, sessions);
      return { user: publicUser(user), sessionToken: token, csrfToken, expiresAt: session.expiresAt };
    },
    async login({ email, password }, req) {
      const users = readJson(usersFile, []);
      const normalizedEmail = validateEmail(email);
      const user = users.find((item) => item.email.toLowerCase() === normalizedEmail);
      if (!user || !verifyPassword(String(password || ""), user.passwordHash)) return null;
      const { session, token, csrfToken } = createSessionRecord(user.id, req);
      const sessions = readJson(sessionsFile, []).filter((item) => item.expiresAt > new Date().toISOString());
      sessions.push(session);
      writeJson(sessionsFile, sessions);
      return { user: publicUser(user), sessionToken: token, csrfToken, expiresAt: session.expiresAt };
    },
    async auth(sessionToken) {
      if (!sessionToken) return null;
      const sessions = pruneExpiredSessions(readJson(sessionsFile, []));
      const session = sessions.find((item) => item.tokenHash === tokenHash(sessionToken) && item.expiresAt > new Date().toISOString());
      writeJson(sessionsFile, sessions);
      if (!session) return null;
      session.lastSeenAt = new Date().toISOString();
      writeJson(sessionsFile, sessions);
      const user = readJson(usersFile, []).find((entry) => entry.id === session.userId);
      return user ? { user: publicUser(user), session } : null;
    },
    async logout(sessionToken) {
      if (!sessionToken) return;
      writeJson(sessionsFile, pruneExpiredSessions(readJson(sessionsFile, [])).filter((item) => item.tokenHash !== tokenHash(sessionToken)));
    },
    async listHighlights(userId) {
      return readJson(highlightsFile, []).filter((item) => item.userId === userId);
    },
    async addHighlight(userId, input) {
      const highlights = readJson(highlightsFile, []);
      const item = normalizeHighlight(userId, input);
      highlights.unshift(item);
      writeJson(highlightsFile, highlights);
      return item;
    },
    async updateHighlightNote(userId, id, input) {
      const highlights = readJson(highlightsFile, []);
      let updated = null;
      const changes = typeof input === "object" ? validateHighlightUpdateInput(input) : { note: String(input || "").slice(0, 1000) };
      const next = highlights.map((item) => {
        if (item.id !== id || item.userId !== userId) return item;
        updated = {
          ...item,
          note: changes.note ?? item.note ?? "",
          folder: changes.folder ?? item.folder ?? "General",
          tags: changes.tags ?? item.tags ?? []
        };
        return updated;
      });
      writeJson(highlightsFile, next);
      return updated;
    },
    async deleteHighlight(userId, id) {
      writeJson(highlightsFile, readJson(highlightsFile, []).filter((item) => !(item.id === id && item.userId === userId)));
    },
    async listMemberNotes(userId) {
      return readJson(memberNotesFile, []).filter((item) => item.userId === userId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    async addMemberNote(userId, input) {
      const notes = readJson(memberNotesFile, []);
      const note = normalizeMemberNote(userId, input);
      notes.unshift(note);
      writeJson(memberNotesFile, notes);
      return note;
    },
    async deleteMemberNote(userId, id) {
      writeJson(memberNotesFile, readJson(memberNotesFile, []).filter((item) => !(item.id === id && item.userId === userId)));
    },
    async getGlobalSettings() {
      const settings = readJson(globalSettingsFile, {});
      return normalizeAdminSettings(settings, settings);
    },
    async saveGlobalSettings(_userId, settings) {
      writeJson(globalSettingsFile, settings);
      return normalizeAdminSettings(settings, settings);
    },
    async getMemberPreferences(userId) {
      const stored = readJson(memberPreferencesFile, {})[userId];
      return stored ? sanitizeMemberPreferences(stored) : {};
    },
    async saveMemberPreferences(userId, preferences) {
      const next = readJson(memberPreferencesFile, {});
      next[userId] = sanitizeMemberPreferences(preferences);
      writeJson(memberPreferencesFile, next);
      return next[userId];
    },
    async listBookOverrides() {
      return readJson(bookOverridesFile, {});
    },
    async saveBookOverride(_userId, slug, changes) {
      const overrides = readJson(bookOverridesFile, {});
      overrides[slug] = { ...(overrides[slug] || {}), ...changes };
      writeJson(bookOverridesFile, overrides);
      return overrides[slug];
    },
    async listStoredReviewQueue() {
      return readJson(reviewQueueFile, []);
    },
    async saveReviewItem(_userId, id, changes) {
      const queue = readJson(reviewQueueFile, []);
      const existing = queue.find((item) => item.id === id) || { id };
      const next = { ...existing, ...changes, id, updatedAt: new Date().toISOString() };
      const filtered = queue.filter((item) => item.id !== id);
      filtered.push(next);
      writeJson(reviewQueueFile, filtered);
      return next;
    },
    async listUsers() {
      return readJson(usersFile, []).map(adminUser).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    },
    async createPayPalCheckoutReference(userId, planId) {
      const records = readJson(paypalPaymentsFile, {});
      const reference = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      records[`ref:${reference}`] = { userId, planId, expiresAt };
      writeJson(paypalPaymentsFile, records);
      return { reference, expiresAt };
    },
    async applyPayPalEntitlement(event) {
      const eventId = sanitizeText(event.id || "", 190);
      const reference = paypalReferenceFromEvent(event);
      const records = readJson(paypalPaymentsFile, {});
      if (!eventId || !reference) return { applied: false, reason: "missing_event_reference" };
      if (records[`event:${eventId}`]) return { applied: false, duplicate: true };
      const pending = records[`ref:${reference}`];
      if (!pending || pending.expiresAt <= new Date().toISOString()) return { applied: false, reason: "unknown_or_expired_reference" };
      if (!["explorer", "scholar", "patron"].includes(pending.planId)) return { applied: false, reason: "unsupported_plan" };
      const role = { explorer: "supporter", scholar: "scholar", patron: "patron" }[pending.planId];
      const users = readJson(usersFile, []).map((user) => user.id === pending.userId && ["member", "supporter", "scholar", "patron"].includes(user.role) ? { ...user, role } : user);
      writeJson(usersFile, users);
      records[`event:${eventId}`] = { reference, userId: pending.userId, processedAt: new Date().toISOString() };
      delete records[`ref:${reference}`];
      writeJson(paypalPaymentsFile, records);
      return { applied: true, userId: pending.userId, planId: pending.planId };
    },
    async updateUserApiAccess(adminId, userId, apiEnabled) {
      let updated = null;
      const users = readJson(usersFile, []).map((user) => {
        if (user.id !== userId) return user;
        updated = {
          ...user,
          apiEnabled: Boolean(apiEnabled),
          apiTokenHash: apiEnabled ? user.apiTokenHash || "" : "",
          apiTokenPrefix: apiEnabled ? user.apiTokenPrefix || "" : "",
          apiTokenCreatedAt: apiEnabled ? user.apiTokenCreatedAt || "" : ""
        };
        return updated;
      });
      writeJson(usersFile, users);
      await this.logAdminAction(adminId, "update_user_api_access", { userId, apiEnabled: Boolean(apiEnabled) });
      return updated ? adminUser(updated) : null;
    },
    async getApiProfile(userId) {
      const user = readJson(usersFile, []).find((item) => item.id === userId) || {};
      return {
        apiEnabled: Boolean(user.apiEnabled),
        hasToken: Boolean(user.apiTokenHash),
        tokenPrefix: user.apiTokenPrefix || "",
        tokenCreatedAt: user.apiTokenCreatedAt || ""
      };
    },
    async rotateApiToken(userId) {
      const token = createApiToken();
      const tokenPrefix = token.slice(0, 10);
      const createdAt = new Date().toISOString();
      let profile = null;
      const users = readJson(usersFile, []).map((user) => {
        if (user.id !== userId || !user.apiEnabled) return user;
        const updated = {
          ...user,
          apiTokenHash: tokenHash(token),
          apiTokenPrefix: tokenPrefix,
          apiTokenCreatedAt: createdAt
        };
        profile = { token, apiEnabled: true, hasToken: true, tokenPrefix, tokenCreatedAt: createdAt };
        return updated;
      });
      writeJson(usersFile, users);
      return profile;
    },
    async authenticateApiToken(token) {
      if (!token) return null;
      const hash = tokenHash(token);
      const user = readJson(usersFile, []).find((item) => item.apiEnabled && item.apiTokenHash === hash);
      return user ? publicUser(user) : null;
    },
    async logAdminAction(userId, action, payload) {
      const items = readJson(adminAuditFile, []);
      items.unshift({
        id: crypto.randomUUID(),
        userId,
        action: sanitizeText(action, 120),
        payload,
        createdAt: new Date().toISOString()
      });
      writeJson(adminAuditFile, items.slice(0, 5000));
    },
    async health() {
      return { ok: true, driver: "json", mode: "test-fallback" };
    },
    async listFileAssets() {
      return readJson(fileAssetsFile, []);
    },
    async saveFileAsset(userId, input) {
      const item = normalizeFileAsset({ ...input, createdBy: userId });
      const items = readJson(fileAssetsFile, []);
      items.unshift(item);
      writeJson(fileAssetsFile, items);
      return item;
    },
    async cleanupTransients(options = {}) {
      const beforeSessions = readJson(sessionsFile, []);
      const afterSessions = pruneExpiredSessions(beforeSessions);
      writeJson(sessionsFile, afterSessions);
      const auditRetention = Math.max(100, Number(options.auditLimit || 5000));
      const auditRows = readJson(adminAuditFile, []);
      writeJson(adminAuditFile, auditRows.slice(0, auditRetention));
      return {
        expiredSessions: beforeSessions.length - afterSessions.length,
        expiredTransients: 0,
        oldAuditRows: Math.max(0, auditRows.length - auditRetention),
        optimizedTables: []
      };
    }
  };
}

async function runTransientCleanup(store, options = {}) {
  const rateLimitBuckets = pruneRateLimitBuckets();
  const storeResult = typeof store.cleanupTransients === "function" ? await store.cleanupTransients(options) : {};
  return { rateLimitBuckets, ...storeResult };
}

function installTransientCleanup(store) {
  const intervalMs = Math.max(0, transientCleanupIntervalMinutes) * 60 * 1000;
  if (!intervalMs) return null;
  const timer = setInterval(() => {
    runTransientCleanup(store).catch((error) => {
      console.error(`Transient cleanup failed: ${error.message}`);
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function normalizeHighlight(userId, input) {
  const payload = validateHighlightInput(input);
  if (!payload.text.trim()) {
    const error = new Error("Highlight text is required.");
    error.status = 400;
    throw error;
  }
  return {
    id: crypto.randomUUID(),
    userId,
    ...payload,
    createdAt: new Date().toISOString()
  };
}

function normalizeFileAsset(input = {}) {
  return {
    id: input.id || crypto.randomUUID(),
    contentItemId: sanitizeText(input.contentItemId || input.content_item_id || "", 80),
    storageDriver: sanitizeText(input.storageDriver || input.storage_driver || "local", 40),
    originalFilename: sanitizeText(input.originalFilename || input.original_filename || "upload", 255),
    storedFilename: sanitizeText(input.storedFilename || input.stored_filename || "", 255),
    relativePath: sanitizeText(input.relativePath || input.relative_path || "", 500),
    mimeType: sanitizeText(input.mimeType || input.mime_type || "application/octet-stream", 120),
    fileSize: Number(input.fileSize || input.file_size || 0),
    fileHash: sanitizeText(input.fileHash || input.file_hash || "", 128),
    publicUrl: sanitizeText(input.publicUrl || input.public_url || "", 800),
    sourceUrl: sanitizeText(input.sourceUrl || input.source_url || "", 800),
    license: sanitizeText(input.license || "", 190),
    attribution: sanitizeText(input.attribution || "", 500),
    description: sanitizeText(input.description || "", 1000),
    category: sanitizeText(input.category || "", 120),
    visibility: input.visibility === "private" ? "private" : "public",
    createdBy: sanitizeText(input.createdBy || input.created_by || "", 80),
    createdAt: input.createdAt || input.created_at || new Date().toISOString(),
    updatedAt: input.updatedAt || input.updated_at || new Date().toISOString()
  };
}

function fileAssetFromRow(row) {
  return normalizeFileAsset(row);
}

async function buildRuntimeState(store) {
  const canonicalIndex = loadCanonicalIndex();
  const siteVersion = loadSiteVersion();
  const overrides = await store.listBookOverrides();
  const mergedBooks = canonicalIndex.books.map((book) => applyBookOverride(book, overrides[book.slug]));
  const allBookRecords = loadAllBookRecords();
  const publicBookRecords = allBookRecords.filter((book) => book.visibility !== "private");
  const allCollectionCount = new Set(publicBookRecords.map((book) => book.collection || "Library")).size;
  const allMediaItems = allBookRecords.reduce((total, book) => total + (Array.isArray(book.media) ? book.media.length : 0), 0);
  const standaloneMediaItems = countStandaloneMediaItems();
  const allIndexedWords = allBookRecords.reduce((total, book) => total + Number(book.wordCount || 0), 0);
  const collectionsMap = new Map();
  for (const book of mergedBooks.filter((item) => item.visibility !== "private")) {
    const key = book.collection || "Library";
    collectionsMap.set(key, (collectionsMap.get(key) || 0) + 1);
  }
  const collections = [...collectionsMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([title, bookCount]) => ({
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    title,
    bookCount
  }));
  const defaultSettings = loadDefaultSettings();
  const storedSettings = await store.getGlobalSettings();
  const settings = deepMerge(defaultSettings, storedSettings);
  const defaultReviewQueue = loadDefaultReviewQueue();
  const storedReviewQueue = await store.listStoredReviewQueue();
  const reviewQueue = mergeReviewQueue(defaultReviewQueue, storedReviewQueue);
  const baseStats = loadCanonicalStats();
  const stats = {
    ...baseStats,
    publicBooks: mergedBooks.filter((book) => book.visibility !== "private").length,
    collections: collections.length,
    allCollections: Math.max(Number(baseStats.collections || 0), allCollectionCount),
    mediaItems: Math.max(Number(baseStats.media?.totalMediaItems || baseStats.mediaItems || 0), allMediaItems + standaloneMediaItems),
    totalRecords: Math.max(Number(baseStats.books?.totalRecords || 0), allBookRecords.length, mergedBooks.length),
    totalIndexedWords: Math.max(Number(baseStats.books?.totalWords || 0), Number(baseStats.indexedWords || 0), allIndexedWords),
    openReviewItems: reviewQueue.filter((item) => item.status !== "resolved").length
  };
  return { books: mergedBooks, collections, settings, reviewQueue, stats, overrides, generatedAt: canonicalIndex.generatedAt, siteVersion };
}

async function handleApi(req, res, url, store) {
  const pathname = url.pathname;
  const sessionToken = sessionTokenFromRequest(req);
  try {
    if (req.method === "POST" && pathname === "/api/payments/paypal/webhook") {
      const event = await bodyJson(req);
      const headers = Object.fromEntries(["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"].map((name) => [name, String(req.headers[name] || "")]));
      if (Object.values(headers).some((value) => !value)) return json(res, 400, { error: "missing_paypal_verification_headers" });
      const relay = await fetch("http://100.116.72.58:19312/verify-webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ headers, event }) });
      const verified = await relay.json().catch(() => ({}));
      if (!relay.ok || verified.verification_status !== "SUCCESS") return json(res, 400, { error: "paypal_signature_not_verified" });
      const eventType = sanitizeText(event.event_type || "", 120);
      const eligible = new Set(["CHECKOUT.ORDER.COMPLETED", "PAYMENT.CAPTURE.COMPLETED"]);
      const result = eligible.has(eventType) ? await store.applyPayPalEntitlement(event) : { applied: false, reason: "event_not_entitlement_eligible" };
      logEvent("info", "paypal.webhook_verified", { eventType, eventId: sanitizeText(event.id || "", 190), applied: Boolean(result.applied), duplicate: Boolean(result.duplicate), reason: result.reason || "" });
      return json(res, 202, { accepted: true, applied: Boolean(result.applied), duplicate: Boolean(result.duplicate) });
    }
    if (pathname.startsWith("/api/v1/") && req.method === "OPTIONS") {
      res.writeHead(204, { ...securityHeaders("text/plain; charset=utf-8"), ...publicApiCorsHeaders() });
      return res.end();
    }

    if (isUnsafeMethod(req.method)) requireSameOrigin(req);

    if (req.method === "POST" && pathname === "/api/auth/register") {
      rateLimit(req, "register", 8, 15 * 60 * 1000);
      const registrationSettings = normalizeAdminSettings(await store.getGlobalSettings(), loadDefaultSettings());
      if (!registrationSettings.members.allowRegistration) {
        return json(res, 403, { error: "Registration is currently disabled." });
      }
      const input = await bodyJson(req);
      const result = await store.register(input, req);
      logEvent("info", "auth.register", { userId: result.user.id, role: result.user.role, ip: clientIp(req) });
      return json(res, 201, { user: result.user }, { "set-cookie": authCookies(result.sessionToken, result.csrfToken, result.expiresAt) });
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const input = await bodyJson(req);
      rateLimit(req, "login", 12, 15 * 60 * 1000, String(input.email || "").toLowerCase());
      const result = await store.login(input, req);
      if (!result) {
        logEvent("warn", "auth.login_failed", { emailHash: tokenHash(String(input.email || "").toLowerCase()).slice(0, 16), ip: clientIp(req) });
        return json(res, 401, { error: "Invalid email or password." });
      }
      logEvent("info", "auth.login", { userId: result.user.id, role: result.user.role, ip: clientIp(req) });
      return json(res, 200, { user: result.user }, { "set-cookie": authCookies(result.sessionToken, result.csrfToken, result.expiresAt) });
    }

    if (req.method === "POST" && pathname === "/api/auth/password-reset/request") {
      const input = await bodyJson(req);
      rateLimit(req, "password-reset", 5, 60 * 60 * 1000, String(input.email || "").toLowerCase());
      const result = await store.createPasswordReset(input.email);
      if (result) {
        try {
          await sendPasswordResetEmail(result.email, result.token);
        } catch (error) {
          logEvent("error", "auth.password_reset_delivery_failed", { reason: error.message });
        }
      }
      return json(res, 202, { ok: true, message: "If an account exists for that email, a reset link has been sent." });
    }

    if (req.method === "POST" && pathname === "/api/auth/password-reset/confirm") {
      const input = await bodyJson(req);
      rateLimit(req, "password-reset-confirm", 8, 60 * 60 * 1000);
      const success = await store.resetPassword(input.token, input.password);
      if (!success) return json(res, 400, { error: "This reset link is invalid or has expired." });
      return json(res, 200, { ok: true, message: "Password updated. You can now sign in." });
    }

    const authState = await store.auth(sessionToken);
    const user = authState?.user || null;
    const session = authState?.session || null;

    if (req.method === "GET" && pathname === "/api/payments/paypal/checkout-reference") {
      if (!user || !session) throw Object.assign(new Error("Authentication required."), { status: 401 });
      const settings = normalizeAdminSettings(await store.getGlobalSettings(), loadDefaultSettings());
      const planId = sanitizeText(url.searchParams.get("plan") || "", 80);
      const plan = settings.members.plans.find((item) => item.id === planId && Number(item.price || 0) > 0 && ["explorer", "scholar", "patron"].includes(item.id));
      if (!settings.payments.paypalEnabled || !plan) return json(res, 400, { error: "invalid_payment_plan" });
      rateLimit(req, "paypal-checkout-reference", 12, 60 * 60 * 1000, user.id);
      const reference = await store.createPayPalCheckoutReference(user.id, plan.id);
      return json(res, 200, { reference: reference.reference, expiresAt: reference.expiresAt, planId: plan.id });
    }

    if (pathname === "/api/thoth") {
      if (!user || !session) throw Object.assign(new Error("Authentication required."), { status: 401 });
      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
      requireCsrf(req, session);
      const settings = normalizeAdminSettings(await store.getGlobalSettings(), loadDefaultSettings());
      const thothSettings = settings.thoth;
      const userPlan = settings.members.plans.find((plan) => plan.role === user.role) || null;
      const userHourlyLimit = user.role === "admin" ? thothSettings.hourlyLimit : Number(userPlan?.thothHourlyLimit || (user.role === "member" ? 5 : thothSettings.hourlyLimit));
      rateLimit(req, "thoth-chat", userHourlyLimit, 60 * 60 * 1000, user.id);
      if (user.role === "member") {
        rateLimit(req, "thoth-chat-daily", thothSettings.dailyLimit, 24 * 60 * 60 * 1000, user.id);
        rateLimit(req, "thoth-chat-monthly", thothSettings.monthlyLimit, 30 * 24 * 60 * 60 * 1000, user.id);
      }
      if (!thothSettings.enabled || String(process.env.THOTH_ENABLED || "false").toLowerCase() !== "true") {
        return json(res, 503, { service: "thoth", state: "disabled", message: "THOTH is not enabled yet." });
      }
      const input = await bodyJson(req);
      const prompt = String(input.prompt || "").trim();
      if (!prompt || prompt.length > 4000) return json(res, 400, { error: "invalid_prompt" });
      logEvent("info", "thoth.request", { userId: user.id, promptLength: prompt.length, ip: clientIp(req) });
      try {
        const result = await thothAnswer(prompt, {
          ...thothSettings,
          onError: (details = {}) => logThothError(details.event || "thoth.runtime_error", { ...details, userId: user.id })
        });
        if (!String(result.text || "").trim()) logThothError("thoth.empty_response", { stage: "generation", userId: user.id });
        writeThothQuestionLog({ userId: user.id, provider: result.provider, model: result.model, question: prompt, answer: result.text });
        return json(res, 200, { service: "thoth", state: "ready", provider: result.provider, model: result.model, answer: result.text });
      } catch (error) {
        logThothError("thoth.request_failed", { stage: "request", reason: error.message, userId: user.id });
        throw error;
      }
    }

    if (pathname === "/api/thoth/stream") {
      if (!user || !session) throw Object.assign(new Error("Authentication required."), { status: 401 });
      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
      requireCsrf(req, session);
      const settings = normalizeAdminSettings(await store.getGlobalSettings(), loadDefaultSettings());
      const thothSettings = settings.thoth;
      const userPlan = settings.members.plans.find((plan) => plan.role === user.role) || null;
      const userHourlyLimit = user.role === "admin" ? thothSettings.hourlyLimit : Number(userPlan?.thothHourlyLimit || (user.role === "member" ? 5 : thothSettings.hourlyLimit));
      rateLimit(req, "thoth-chat", userHourlyLimit, 60 * 60 * 1000, user.id);
      if (user.role === "member") {
        rateLimit(req, "thoth-chat-daily", thothSettings.dailyLimit, 24 * 60 * 60 * 1000, user.id);
        rateLimit(req, "thoth-chat-monthly", thothSettings.monthlyLimit, 30 * 24 * 60 * 60 * 1000, user.id);
      }
      if (!thothSettings.enabled || String(process.env.THOTH_ENABLED || "false").toLowerCase() !== "true") return json(res, 503, { service: "thoth", state: "disabled", message: "THOTH is not enabled yet." });
      const input = await bodyJson(req);
      const prompt = String(input.prompt || "").trim();
      if (!prompt || prompt.length > 4000) return json(res, 400, { error: "invalid_prompt" });
      res.writeHead(200, { ...securityHeaders("text/event-stream; charset=utf-8"), "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: status\ndata: ${JSON.stringify({ state: "searching" })}\n\n`);
      try {
        const result = await thothAnswer(prompt, { ...thothSettings, onError: (details = {}) => logThothError(details.event || "thoth.runtime_error", { ...details, userId: user.id }) });
        writeThothQuestionLog({ userId: user.id, provider: result.provider, model: result.model, question: prompt, answer: result.text });
        res.write(`event: answer\ndata: ${JSON.stringify({ service: "thoth", state: "ready", provider: result.provider, model: result.model, answer: result.text })}\n\n`);
      } catch (error) {
        logThothError("thoth.request_failed", { stage: "stream", reason: error.message, userId: user.id });
        res.write(`event: error\ndata: ${JSON.stringify({ error: "THOTH could not complete that request." })}\n\n`);
      }
      return res.end();
    }

    if (req.method === "GET" && pathname === "/api/health") {
      const state = await buildRuntimeState(store);
      const system = await buildSystemHealth({ storageMode, runtimeState: state, store, siteVersion: state.siteVersion });
      return json(res, 200, {
        ok: system.ok,
        version: state.siteVersion.version,
        releaseName: state.siteVersion.releaseName,
        storageMode,
        books: state.books.length,
        publicBooks: state.stats.publicBooks,
        collections: state.collections.length,
        openReviewItems: state.stats.openReviewItems,
        generatedAt: state.generatedAt,
        system
      });
    }

    if (req.method === "GET" && (pathname === "/api" || pathname === "/api/")) {
      const state = await buildRuntimeState(store);
      return json(res, 200, {
        name: "Clovis Star API",
        version: state.siteVersion.version,
        releaseName: state.siteVersion.releaseName,
        docs: "/api/v1/openapi.json",
        authentication: "Bearer token",
        tokenManagement: "/members/",
        endpoints: [
          { method: "GET", path: "/api/v1/catalog", description: "Public catalog, collections, and statistics." },
          { method: "GET", path: "/api/v1/collections", description: "Public collection list." },
          { method: "GET", path: "/api/v1/books/{slug}", description: "Single public book record." },
          { method: "GET", path: "/api/library/search", description: "Site search used by the public reading interface." },
          { method: "GET", path: "/api/health", description: "Runtime health check." }
        ]
      });
    }

    if (req.method === "GET" && pathname === "/api/library/search") {
      const state = await buildRuntimeState(store);
      return json(res, 200, searchRuntimeBooks(state, url.searchParams.get("q") || "", {
        collection: url.searchParams.get("collection") || "",
        quality: url.searchParams.get("quality") || "",
        hasMedia: url.searchParams.get("hasMedia") || "",
        hasSource: url.searchParams.get("hasSource") || "",
        sourceConfidence: url.searchParams.get("sourceConfidence") || "",
        mediaCategory: url.searchParams.get("mediaCategory") || "",
        minWords: url.searchParams.get("minWords") || "",
        maxWords: url.searchParams.get("maxWords") || ""
      }));
    }

    if (req.method === "GET" && pathname === "/api/v1/openapi.json") {
      return publicApiJson(res, 200, publicApiSpec());
    }

    if (req.method === "GET" && pathname === "/api/v1/catalog") {
      const apiUser = await requireApiUser(req, store);
      rateLimit(req, "public-api-catalog", 240, 60 * 1000, apiUser.id);
      logEvent("info", "api.catalog", { userId: apiUser.id, ip: clientIp(req) });
      const state = await buildRuntimeState(store);
      const books = state.books.filter((book) => book.visibility !== "private").map(publicApiBookSummary);
      return publicApiJson(res, 200, {
        version: state.siteVersion.version,
        generatedAt: state.generatedAt,
        stats: state.stats,
        collections: state.collections,
        books
      });
    }

    if (req.method === "GET" && pathname === "/api/v1/collections") {
      const apiUser = await requireApiUser(req, store);
      rateLimit(req, "public-api-collections", 240, 60 * 1000, apiUser.id);
      const state = await buildRuntimeState(store);
      return publicApiJson(res, 200, { version: state.siteVersion.version, generatedAt: state.generatedAt, collections: state.collections });
    }

    if (req.method === "GET" && pathname.startsWith("/api/v1/books/")) {
      const apiUser = await requireApiUser(req, store);
      rateLimit(req, "public-api-books", 360, 60 * 1000, apiUser.id);
      const slug = decodeURIComponent(pathname.split("/").pop());
      const canonical = loadCanonicalBook(slug);
      if (!canonical) return publicApiJson(res, 404, { error: "Book not found." });
      const state = await buildRuntimeState(store);
      const merged = applyBookOverride(canonical, state.overrides[slug]);
      if (merged.visibility === "private") return publicApiJson(res, 404, { error: "Book not found." });
      return publicApiJson(res, 200, {
        ...publicApiBookSummary(merged),
        paragraphs: merged.paragraphs || []
      });
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      if (session) requireCsrf(req, session);
      await store.logout(sessionToken);
      if (user) logEvent("info", "auth.logout", { userId: user.id, ip: clientIp(req) });
      return json(res, 200, { ok: true }, { "set-cookie": [clearedSessionCookie(), clearedCsrfCookie()] });
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      if (!user) return json(res, 401, { error: "Not signed in." });
      return json(
        res,
        200,
        { user: publicUser(user), siteSettings: publicSiteSettings(await store.getGlobalSettings()) },
        session ? { "set-cookie": csrfCookie(session.csrfToken, session.expiresAt) } : {}
      );
    }

    if (pathname === "/api/highlights") {
      requireSignedIn(user);
      if (req.method !== "GET") requireCsrf(req, session);
      rateLimit(req, "highlights", 180, 60 * 1000, user.id);
      if (req.method === "GET") return json(res, 200, { highlights: await store.listHighlights(user.id) });
      if (req.method === "POST") return json(res, 201, { highlight: await store.addHighlight(user.id, await bodyJson(req)) });
    }

    if (pathname.startsWith("/api/highlights/")) {
      requireSignedIn(user);
      requireCsrf(req, session);
      rateLimit(req, "highlight-write", 180, 60 * 1000, user.id);
      const id = pathname.split("/").pop();
      if (req.method === "PUT") {
        const updated = await store.updateHighlightNote(user.id, id, await bodyJson(req));
        if (!updated) return json(res, 404, { error: "Highlight not found." });
        return json(res, 200, { highlight: updated });
      }
      if (req.method === "DELETE") {
        await store.deleteHighlight(user.id, id);
        return json(res, 200, { ok: true });
      }
    }

    if (pathname === "/api/member/notes") {
      requireSignedIn(user);
      if (req.method === "GET") return json(res, 200, { notes: await store.listMemberNotes(user.id) });
      if (req.method === "POST") {
        requireCsrf(req, session);
        rateLimit(req, "member-notes", 120, 60 * 60 * 1000, user.id);
        return json(res, 201, { note: await store.addMemberNote(user.id, await bodyJson(req)) });
      }
      return json(res, 405, { error: "method_not_allowed" }, { allow: "GET, POST" });
    }

    if (pathname.startsWith("/api/member/notes/")) {
      requireSignedIn(user);
      requireCsrf(req, session);
      const noteId = pathname.split("/").pop();
      if (req.method === "DELETE") {
        await store.deleteMemberNote(user.id, noteId);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: "method_not_allowed" }, { allow: "DELETE" });
    }

    if (pathname === "/api/member/preferences") {
      requireSignedIn(user);
      const state = await buildRuntimeState(store);
      if (req.method === "GET") {
        const saved = await store.getMemberPreferences(user.id);
        return json(res, 200, {
          preferences: {
            showBookmarksInSidebar: saved.showBookmarksInSidebar ?? Boolean(state.settings.members?.showBookmarksInSidebarDefault)
          }
        });
      }
      if (req.method === "PUT") {
        requireCsrf(req, session);
        rateLimit(req, "member-preferences", 60, 60 * 1000, user.id);
        const input = sanitizeMemberPreferences(await bodyJson(req));
        const preferences = await store.saveMemberPreferences(user.id, input, user.id);
        return json(res, 200, { preferences });
      }
    }

    if (pathname === "/api/member/api-token") {
      requireSignedIn(user);
      if (req.method === "GET") {
        return json(res, 200, { api: await store.getApiProfile(user.id) });
      }
      if (req.method === "POST") {
        requireCsrf(req, session);
        rateLimit(req, "member-api-token", 12, 60 * 60 * 1000, user.id);
        const api = await store.rotateApiToken(user.id);
        if (!api) return json(res, 403, { error: "API access has not been enabled for this account." });
        logEvent("info", "member.api_token_rotated", { userId: user.id, tokenPrefix: api.tokenPrefix, ip: clientIp(req) });
        return json(res, 201, { api });
      }
    }

    if (req.method === "GET" && pathname === "/api/books") {
      const state = await buildRuntimeState(store);
      const includeAll = url.searchParams.get("include") === "all" && user?.role === "admin";
      const books = includeAll ? state.books : state.books.filter((book) => book.visibility !== "private");
      return json(res, 200, { version: state.siteVersion.version, generatedAt: state.generatedAt, collections: state.collections, stats: state.stats, siteSettings: publicSiteSettings(state.settings), books });
    }

    if (req.method === "GET" && pathname === "/api/site/bootstrap") {
      const state = await buildRuntimeState(store);
      return json(res, 200, {
        version: state.siteVersion.version,
        releaseName: state.siteVersion.releaseName,
        generatedAt: state.generatedAt,
        stats: state.stats,
        collections: state.collections,
        siteSettings: publicSiteSettings(state.settings)
      });
    }

    if (req.method === "GET" && pathname.startsWith("/api/books/")) {
      const slug = decodeURIComponent(pathname.split("/").pop());
      const canonical = loadCanonicalBook(slug);
      if (!canonical) return json(res, 404, { error: "Book not found." });
      const state = await buildRuntimeState(store);
      const merged = applyBookOverride(canonical, state.overrides[slug]);
      if (merged.visibility === "private" && user?.role !== "admin") return json(res, 404, { error: "Book not found." });
      const reviewItems = state.reviewQueue.filter((item) => item.bookSlug === slug);
      return json(res, 200, { ...merged, reviewItems });
    }

    if (pathname.startsWith("/api/admin/")) {
      requireAdmin(user);
      const state = await buildRuntimeState(store);

      if (req.method === "GET" && pathname === "/api/admin/bootstrap") {
        const systemHealth = await buildSystemHealth({ storageMode, runtimeState: state, store, siteVersion: state.siteVersion });
        return json(res, 200, {
          version: state.siteVersion.version,
          releaseName: state.siteVersion.releaseName,
          user: publicUser(user),
          settings: state.settings,
          stats: state.stats,
          books: state.books,
          reviewQueue: state.reviewQueue,
          collections: state.collections,
          users: await store.listUsers(),
          systemHealth,
          fileAssets: await store.listFileAssets(),
          sourceCompletionQueue: state.books.filter((book) => book.visibility === "private" && book.quality?.status === "needs_source_completion").map(sourceCompletionItem)
        });
      }

      if (req.method === "GET" && pathname === "/api/admin/system-health") {
        return json(res, 200, { systemHealth: await buildSystemHealth({ storageMode, runtimeState: state, store, siteVersion: state.siteVersion }) });
      }

      if (req.method === "GET" && pathname === "/api/admin/thoth-errors") {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));
        return json(res, 200, { errors: readThothErrors(limit), log: "thoth-errors.jsonl", rotating: true });
      }

      if (req.method === "GET" && pathname === "/api/admin/thoth-questions") {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));
        return json(res, 200, { questions: readThothQuestions(limit), folder: "logs/thoth-questions", rotationDays: 14 });
      }

      if (req.method === "GET" && pathname === "/api/admin/content-operations") {
        return json(res, 200, { operations: buildContentOperations(state) });
      }

      if (req.method === "POST" && pathname === "/api/admin/content-operations/batch") {
        requireCsrf(req, session);
        rateLimit(req, "admin-content-batch", 12, 60 * 1000, user.id);
        const input = validateContentBatchInput(await bodyJson(req));
        const result = await applyContentBatchOperation({ state, store, userId: user.id, ...input });
        await store.logAdminAction(user.id, "content_batch_operation", result);
        logEvent("info", "admin.content_batch_operation", { userId: user.id, ...result, ip: clientIp(req) });
        return json(res, 200, { result });
      }

      if (pathname === "/api/admin/qa-report") {
        if (req.method === "GET") {
          const existing = loadQaReport();
          const report = url.searchParams.get("refresh") === "1" || !existing.generatedAt
            ? saveQaReport(buildQaReport(state))
            : existing;
          return json(res, 200, { report });
        }
        if (req.method === "POST") {
          requireCsrf(req, session);
          const report = saveQaReport(buildQaReport(state));
          await store.logAdminAction(user.id, "generate_qa_report", { generatedAt: report.generatedAt });
          return json(res, 201, { report });
        }
      }

      if (req.method === "GET" && pathname === "/api/admin/file-assets") {
        return json(res, 200, { fileAssets: await store.listFileAssets() });
      }

      if (req.method === "POST" && pathname === "/api/admin/uploads") {
        requireCsrf(req, session);
        rateLimit(req, "admin-uploads", 20, 60 * 60 * 1000, user.id);
        const storage = createStorageService();
        const contentType = sanitizeText(url.searchParams.get("contentType") || "files", 80);
        const visibility = url.searchParams.get("visibility") === "private" ? "private" : "public";
        const mimeType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        const originalFilename = sanitizeText(req.headers["x-filename"] || "upload", 255);
        const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_SIZE_MB || 100)) * 1024 * 1024;
        const stored = await storage.save(await bodyBuffer(req, maxBytes + 1024), { contentType, visibility, mimeType, originalFilename });
        const fileAsset = await store.saveFileAsset(user.id, stored);
        logEvent("info", "admin.file_uploaded", { userId: user.id, fileAssetId: fileAsset.id, mimeType: fileAsset.mimeType, fileSize: fileAsset.fileSize, ip: clientIp(req) });
        return json(res, 201, { fileAsset });
      }

      if (pathname === "/api/admin/settings") {
        if (req.method === "GET") return json(res, 200, { settings: state.settings });
        if (req.method === "PUT") {
          requireCsrf(req, session);
          rateLimit(req, "admin-settings", 40, 60 * 1000, user.id);
        const next = await store.saveGlobalSettings(user.id, normalizeAdminSettings(await bodyJson(req), state.settings));
        await store.logAdminAction(user.id, "save_global_settings", { keys: Object.keys(next) });
        logEvent("info", "admin.settings_saved", { userId: user.id, keys: Object.keys(next), ip: clientIp(req) });
          return json(res, 200, { settings: deepMerge(loadDefaultSettings(), normalizeAdminSettings(next, next)) });
        }
      }

      if (req.method === "GET" && pathname === "/api/admin/review-queue") {
        return json(res, 200, { reviewQueue: state.reviewQueue });
      }

      if (req.method === "PATCH" && pathname.startsWith("/api/admin/review-queue/")) {
        requireCsrf(req, session);
        rateLimit(req, "admin-review", 60, 60 * 1000, user.id);
        const id = decodeURIComponent(pathname.split("/").pop());
        const current = state.reviewQueue.find((item) => item.id === id);
        if (!current) return json(res, 404, { error: "Review item not found." });
        const input = validateReviewQueueInput(await bodyJson(req));
        const saved = await store.saveReviewItem(user.id, id, {
          ...current,
          ...input
        });
        await store.logAdminAction(user.id, "save_review_item", { id, status: saved.status });
        logEvent("info", "admin.review_item_saved", { userId: user.id, id, status: saved.status, ip: clientIp(req) });
        return json(res, 200, { reviewItem: saved });
      }

      if (req.method === "PATCH" && pathname.startsWith("/api/admin/books/")) {
        requireCsrf(req, session);
        rateLimit(req, "admin-books", 60, 60 * 1000, user.id);
        const slug = decodeURIComponent(pathname.split("/").pop());
        if (!state.books.find((book) => book.slug === slug)) return json(res, 404, { error: "Book not found." });
        const input = validateBookOverrideInput(await bodyJson(req));
        const next = await store.saveBookOverride(user.id, slug, input);
        await store.logAdminAction(user.id, "save_book_override", { slug, changes: Object.keys(input) });
        logEvent("info", "admin.book_override_saved", { userId: user.id, slug, changes: Object.keys(input), ip: clientIp(req) });
        return json(res, 200, { override: next });
      }

      if (req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
        requireCsrf(req, session);
        rateLimit(req, "admin-users", 60, 60 * 1000, user.id);
        const userId = decodeURIComponent(pathname.split("/").pop());
        const input = await bodyJson(req);
        const updated = await store.updateUserApiAccess(user.id, userId, Boolean(input.apiEnabled));
        if (!updated) return json(res, 404, { error: "User not found." });
        logEvent("info", "admin.user_api_access_saved", { userId: user.id, targetUserId: userId, apiEnabled: Boolean(input.apiEnabled), ip: clientIp(req) });
        return json(res, 200, { user: updated });
      }
    }

    return json(res, 404, { error: "Not found." });
  } catch (error) {
    const headers = pathname.startsWith("/api/v1/") ? { ...publicApiCorsHeaders(), ...(error.headers || {}) } : (error.headers || {});
    if ((error.status || 500) >= 500) {
      logEvent("error", "api.error", { pathname, method: req.method, status: error.status || 500, message: error.message, ip: clientIp(req) });
      if (pathname === "/api/thoth") logThothError("thoth.api_error", { stage: "api", status: error.status || 500, reason: error.message });
    }
    const payload = { error: error.message || "Server error." };
    if (error.code) payload.code = error.code;
    if (error.upgradeUrl) payload.upgradeUrl = error.upgradeUrl;
    if (error.limit) payload.limit = error.limit;
    if (error.retryAfterMs) payload.retryAfterMs = error.retryAfterMs;
    return json(res, error.status || 500, payload, { ...headers, ...(error.headers || {}) });
  }
}

function serveStatic(_req, res, pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  let file = path.join(root, clean || "index.html");
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) && pathname.startsWith("/library/")) file = path.join(root, "library", "item.html");
  if (!file.startsWith(root)) return json(res, 403, { error: "Forbidden." });
  if (!fs.existsSync(file)) return text(res, 404, "Not found.");
  res.writeHead(200, securityHeaders(mime[path.extname(file)] || "application/octet-stream"));
  fs.createReadStream(file).pipe(res);
}

function serveUpload(_req, res, pathname) {
  const uploadRoot = path.resolve(process.env.LOCAL_STORAGE_PATH || path.join(root, "storage", "uploads"));
  const clean = decodeURIComponent(pathname.replace(/^\/uploads\/?/, "")).replace(/^\/+/, "");
  const file = path.join(uploadRoot, ...clean.split("/"));
  if (!file.startsWith(uploadRoot)) return json(res, 403, { error: "Forbidden." });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return text(res, 404, "Not found.");
  res.writeHead(200, securityHeaders(mime[path.extname(file)] || "application/octet-stream"));
  fs.createReadStream(file).pipe(res);
}

export async function startServer(options = {}) {
  resetRateLimits();
  const listenHost = options.host || host;
  const listenPort = Number(options.port ?? port);
  const store = options.store || (storageMode === "mysql" ? await createMysqlStore() : createJsonStore());
  const transientCleanupTimer = installTransientCleanup(store);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/health") {
      return buildRuntimeState(store)
        .then((state) => buildSystemHealth({ storageMode, runtimeState: state, store, siteVersion: state.siteVersion }))
        .then((health) => json(res, health.ok ? 200 : 503, health))
        .catch((error) => json(res, 500, { ok: false, error: error.message }));
    }
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url, store);
    if (url.pathname.startsWith("/uploads/")) return serveUpload(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  });
  server.on("close", () => {
    if (transientCleanupTimer) clearInterval(transientCleanupTimer);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : listenPort;
  return { server, store, host: listenHost, port: actualPort, storageMode, cleanupTransients: (options) => runTransientCleanup(store, options) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startServer();
  console.log(`Clovis Star running at http://${runtime.host}:${runtime.port} using ${runtime.storageMode} storage`);
}

