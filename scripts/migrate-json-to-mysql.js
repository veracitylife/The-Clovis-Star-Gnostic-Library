import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbDir = path.resolve(process.env.CLOVISSTAR_DB_DIR || path.join(root, "db"));

loadEnvFile(path.join(root, ".env"));

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(name, fallback) {
  const file = path.join(dbDir, name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureString(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function stableId(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 36);
}

const connection = await mysql.createConnection({
  host: required("CLOVIS_DB_HOST"),
  user: required("CLOVIS_DB_USER"),
  password: required("CLOVIS_DB_PASSWORD"),
  database: required("CLOVIS_DB_NAME"),
  multipleStatements: true
});

const schema = fs.readFileSync(path.join(root, "sql", "clovisstar-app-schema.sql"), "utf8");
await connection.query(schema);

const users = readJson("users.json", []);
const sessions = readJson("sessions.json", []);
const highlights = readJson("highlights.json", []);
const globalSettings = readJson("global-settings.json", {});
const memberPreferences = readJson("member-preferences.json", {});
const bookOverrides = readJson("book-overrides.json", {});
const reviewQueue = readJson("review-queue.json", []);
const auditLog = readJson("admin-audit-log.json", []);

await connection.beginTransaction();
try {
  for (const user of users) {
    await connection.execute(
      `INSERT INTO clovisstar_users (id, email, display_name, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         email = VALUES(email),
         display_name = VALUES(display_name),
         role = VALUES(role),
         password_hash = VALUES(password_hash)`,
      [
        ensureString(user.id),
        ensureString(user.email).toLowerCase(),
        ensureString(user.displayName || user.display_name || user.email),
        ensureString(user.role || "member"),
        ensureString(user.passwordHash || user.password_hash),
        ensureString(user.createdAt || user.created_at || new Date().toISOString()).slice(0, 19).replace("T", " ")
      ]
    );
  }

  await connection.execute("DELETE FROM clovisstar_sessions");
  for (const session of sessions) {
    await connection.execute(
      `INSERT INTO clovisstar_sessions
        (id, user_id, token_hash, csrf_token, user_agent, ip_address, last_seen_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ensureString(session.id),
        ensureString(session.userId),
        ensureString(session.tokenHash),
        ensureString(session.csrfToken || stableId(session.id)),
        ensureString(session.userAgent),
        ensureString(session.ipAddress),
        ensureString(session.lastSeenAt || new Date().toISOString()).slice(0, 19).replace("T", " "),
        ensureString(session.expiresAt || new Date().toISOString()).slice(0, 19).replace("T", " "),
        ensureString(session.createdAt || new Date().toISOString()).slice(0, 19).replace("T", " ")
      ]
    );
  }

  for (const item of highlights) {
    await connection.execute(
      `INSERT INTO clovisstar_highlights (id, user_id, book_slug, book_title, color, selected_text, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         note = VALUES(note),
         color = VALUES(color),
         selected_text = VALUES(selected_text)`,
      [
        ensureString(item.id),
        ensureString(item.userId),
        ensureString(item.bookSlug),
        ensureString(item.bookTitle),
        ensureString(item.color || "yellow"),
        ensureString(item.text),
        ensureString(item.note),
        ensureString(item.createdAt || new Date().toISOString()).slice(0, 19).replace("T", " ")
      ]
    );
  }

  for (const [key, value] of Object.entries(globalSettings)) {
    await connection.execute(
      `INSERT INTO clovisstar_settings (setting_key, setting_value_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value_json = VALUES(setting_value_json)`,
      [key, JSON.stringify(value)]
    );
  }

  for (const [userId, prefs] of Object.entries(memberPreferences)) {
    await connection.execute(
      `INSERT INTO clovisstar_member_preferences (user_id, show_bookmarks_in_sidebar)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE show_bookmarks_in_sidebar = VALUES(show_bookmarks_in_sidebar)`,
      [userId, prefs.showBookmarksInSidebar ? 1 : 0]
    );
  }

  for (const [slug, override] of Object.entries(bookOverrides)) {
    await connection.execute(
      `INSERT INTO clovisstar_book_overrides
        (book_slug, visibility, title_override, collection_override, excerpt_override, review_status, admin_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         visibility = VALUES(visibility),
         title_override = VALUES(title_override),
         collection_override = VALUES(collection_override),
         excerpt_override = VALUES(excerpt_override),
         review_status = VALUES(review_status),
         admin_notes = VALUES(admin_notes)`,
      [
        slug,
        override.visibility || null,
        override.titleOverride || null,
        override.collectionOverride || null,
        override.excerptOverride || null,
        override.reviewStatus || null,
        override.adminNotes || null
      ]
    );
  }

  for (const item of reviewQueue) {
    await connection.execute(
      `INSERT INTO clovisstar_review_queue
        (id, book_slug, severity, status, source_label, summary, details_json, admin_notes, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         severity = VALUES(severity),
         status = VALUES(status),
         source_label = VALUES(source_label),
         summary = VALUES(summary),
         details_json = VALUES(details_json),
         admin_notes = VALUES(admin_notes),
         assigned_to = VALUES(assigned_to)`,
      [
        ensureString(item.id),
        ensureString(item.bookSlug),
        ensureString(item.severity || "medium"),
        ensureString(item.status || "open"),
        ensureString(item.source || item.sourceFile || ""),
        ensureString(item.summary),
        JSON.stringify({ issues: item.issues || [] }),
        ensureString(item.adminNotes),
        ensureString(item.assignedTo)
      ]
    );
  }

  for (const item of auditLog) {
    await connection.execute(
      `INSERT INTO clovisstar_admin_audit_log (id, user_id, action, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json)`,
      [
        ensureString(item.id),
        ensureString(item.userId),
        ensureString(item.action),
        JSON.stringify(item.payload || {}),
        ensureString(item.createdAt || new Date().toISOString()).slice(0, 19).replace("T", " ")
      ]
    );
  }

  await connection.commit();
  console.log(JSON.stringify({
    migrated: {
      users: users.length,
      sessions: sessions.length,
      highlights: highlights.length,
      settings: Object.keys(globalSettings).length,
      memberPreferences: Object.keys(memberPreferences).length,
      bookOverrides: Object.keys(bookOverrides).length,
      reviewQueue: reviewQueue.length,
      auditLog: auditLog.length
    }
  }, null, 2));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}

