import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logsDir = path.join(root, "logs");
const maxBytes = Number(process.env.CLOVIS_LOG_MAX_BYTES || 5 * 1024 * 1024);
const keep = Number(process.env.CLOVIS_LOG_KEEP || 5);
fs.mkdirSync(logsDir, { recursive: true });

function rotate(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size <= maxBytes) return false;
  for (let i = keep - 1; i >= 1; i -= 1) {
    const src = `${file}.${i}`;
    const dst = `${file}.${i + 1}`;
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  }
  fs.renameSync(file, `${file}.1`);
  fs.writeFileSync(file, "");
  return true;
}

const rotated = [];
for (const name of fs.readdirSync(logsDir)) {
  const file = path.join(logsDir, name);
  if (fs.statSync(file).isFile() && rotate(file)) rotated.push(name);
}

const eventsFile = path.join(logsDir, "app-events.jsonl");
const alerts = [];
if (fs.existsSync(eventsFile)) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const lines = fs.readFileSync(eventsFile, "utf8").trim().split(/\n/).filter(Boolean).slice(-5000);
  let errors = 0;
  let failedLogins = 0;
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (Date.parse(item.ts) < cutoff) continue;
      if (item.level === "error") errors += 1;
      if (item.event === "auth.login_failed") failedLogins += 1;
    } catch {}
  }
  if (errors > 0) alerts.push({ type: "runtime_errors", count: errors });
  if (failedLogins >= 20) alerts.push({ type: "login_failures", count: failedLogins });
}

if (alerts.length) fs.appendFileSync(path.join(logsDir, "alerts.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), alerts })}\n`);
console.log(JSON.stringify({ rotated, alerts }, null, 2));

