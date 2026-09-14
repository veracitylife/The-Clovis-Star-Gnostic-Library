import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnvFile(path.join(root, ".env"));

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function requiredEnv(name) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
  return process.env[name];
}

async function main() {
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: requiredEnv("CLOVIS_DB_HOST"),
    user: requiredEnv("CLOVIS_DB_USER"),
    password: requiredEnv("CLOVIS_DB_PASSWORD"),
    database: requiredEnv("CLOVIS_DB_NAME"),
    multipleStatements: true
  });
  try {
    await connection.query(fs.readFileSync(path.join(root, "sql", "clovisstar-library-mysql-schema.sql"), "utf8"));
    console.log("mysql file asset schema ok");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

