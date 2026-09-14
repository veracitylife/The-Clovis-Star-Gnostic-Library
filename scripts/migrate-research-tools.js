import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  if (!process.env[name]) throw new Error(`${name} is required.`);
  return process.env[name];
}

async function ignoreDuplicate(connection, sql) {
  try {
    await connection.query(sql);
    return true;
  } catch (error) {
    if (["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME"].includes(error.code)) return false;
    throw error;
  }
}

const connection = await mysql.createConnection({
  host: required("CLOVIS_DB_HOST"),
  user: required("CLOVIS_DB_USER"),
  password: required("CLOVIS_DB_PASSWORD"),
  database: required("CLOVIS_DB_NAME")
});

const changed = [];
try {
  if (await ignoreDuplicate(connection, "ALTER TABLE clovisstar_highlights ADD COLUMN folder VARCHAR(120) NOT NULL DEFAULT 'General'")) changed.push("highlights.folder");
  if (await ignoreDuplicate(connection, "ALTER TABLE clovisstar_highlights ADD COLUMN tags_json LONGTEXT NULL")) changed.push("highlights.tags_json");
  if (await ignoreDuplicate(connection, "ALTER TABLE clovisstar_highlights ADD INDEX idx_clovisstar_highlights_user_folder (user_id, folder)")) changed.push("highlights.user_folder_index");
  if (await ignoreDuplicate(connection, "ALTER TABLE clovisstar_book_overrides ADD COLUMN source_metadata_json LONGTEXT NULL")) changed.push("book_overrides.source_metadata_json");
} finally {
  await connection.end();
}

console.log(JSON.stringify({ ok: true, changed }, null, 2));

