import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(path.join(root, ".env"));

const shouldOptimize = process.argv.includes("--optimize");

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

const connection = await mysql.createConnection({
  host: required("CLOVIS_DB_HOST"),
  user: required("CLOVIS_DB_USER"),
  password: required("CLOVIS_DB_PASSWORD"),
  database: required("CLOVIS_DB_NAME"),
  multipleStatements: true
});

await connection.query(fs.readFileSync(path.join(root, "sql", "clovisstar-app-schema.sql"), "utf8"));

async function indexExists(tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function ensureIndex(tableName, indexName, definition) {
  if (await indexExists(tableName, indexName)) return false;
  await connection.query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} ${definition}`);
  return true;
}

const addedIndexes = [];
for (const [tableName, indexName, definition] of [
  ["clovisstar_users", "idx_clovisstar_users_api_lookup", "(api_enabled, api_token_hash)"],
  ["clovisstar_sessions", "idx_clovisstar_sessions_token_expiry", "(token_hash, expires_at)"],
  ["clovisstar_highlights", "idx_clovisstar_highlights_user_created", "(user_id, created_at)"],
  ["clovisstar_review_queue", "idx_clovisstar_review_queue_status_severity", "(status, severity)"],
  ["clovisstar_admin_audit_log", "idx_clovisstar_admin_audit_log_created", "(created_at)"],
  ["clovisstar_transients", "idx_clovisstar_transients_expires_at", "(expires_at)"],
  ["clovisstar_transients", "idx_clovisstar_transients_updated_at", "(updated_at)"]
]) {
  if (await ensureIndex(tableName, indexName, definition)) addedIndexes.push(`${tableName}.${indexName}`);
}

const [sessionCleanup] = await connection.execute("DELETE FROM clovisstar_sessions WHERE expires_at <= UTC_TIMESTAMP()");
const [transientCleanup] = await connection.execute("DELETE FROM clovisstar_transients WHERE expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP()");

const optimizedTables = [];
if (shouldOptimize) {
  for (const tableName of [
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
    await connection.query(`OPTIMIZE TABLE ${tableName}`);
    optimizedTables.push(tableName);
  }
}

await connection.end();

console.log(JSON.stringify({
  addedIndexes,
  expiredSessionsRemoved: sessionCleanup.affectedRows || 0,
  expiredTransientsRemoved: transientCleanup.affectedRows || 0,
  optimizedTables
}, null, 2));

