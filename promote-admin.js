import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnvFile(path.join(root, ".env"));

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/promote-admin.js user@example.com");
  process.exit(1);
}

if (process.env.CLOVIS_STORAGE === "mysql") {
  await promoteMysql(email);
} else {
  promoteJson(email);
}

console.log(`Promoted ${email} to admin.`);

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function promoteJson(targetEmail) {
  const dbDir = path.resolve(process.env.CLOVISSTAR_DB_DIR || path.join(root, "db"));
  const usersFile = path.join(dbDir, "users.json");
  const users = readJson(usersFile, []);
  const next = users.map((user) => (
    String(user.email || "").trim().toLowerCase() === targetEmail
      ? { ...user, role: "admin" }
      : user
  ));
  if (!next.some((user) => String(user.email || "").trim().toLowerCase() === targetEmail)) {
    throw new Error(`User not found: ${targetEmail}`);
  }
  writeJson(usersFile, next);
}

async function promoteMysql(targetEmail) {
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool({
    host: requiredEnv("CLOVIS_DB_HOST"),
    user: requiredEnv("CLOVIS_DB_USER"),
    password: requiredEnv("CLOVIS_DB_PASSWORD"),
    database: requiredEnv("CLOVIS_DB_NAME"),
    waitForConnections: true,
    connectionLimit: 5
  });
  const [result] = await pool.execute(
    "UPDATE clovisstar_users SET role = 'admin' WHERE LOWER(email) = ?",
    [targetEmail]
  );
  await pool.end();
  if (!result.affectedRows) {
    throw new Error(`User not found: ${targetEmail}`);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when CLOVIS_STORAGE=mysql`);
  return value;
}

