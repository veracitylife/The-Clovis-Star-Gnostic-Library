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

const schema = fs.readFileSync(path.join(root, "sql", "clovisstar-app-schema.sql"), "utf8");
await connection.query(schema);
await connection.end();
console.log("Clovis Star app database schema is ready.");

