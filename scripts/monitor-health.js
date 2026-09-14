import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.CLOVIS_LIVE_BASE_URL || "https://clovisstar.com").replace(/\/$/, "");
const outputFile = path.join(root, "db", "monitoring-report.json");
const defaultPages = ["/api/health", "/", "/books/", "/members/", "/admin/"];
const pages = (process.env.CLOVIS_MONITOR_PATHS || defaultPages.join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const timeoutMs = Math.max(2000, Number(process.env.CLOVIS_MONITOR_TIMEOUT_MS || 12000));

function readMonitoringSettings() {
  const candidates = [
    path.join(root, "db", "global-settings.json"),
    path.join(root, "data", "admin-settings.json")
  ];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed.monitoring) return parsed.monitoring;
    } catch {}
  }
  return {};
}

async function check(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${base}${pathname}`, { signal: controller.signal, redirect: "manual" });
    return {
      path: pathname,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      ms: Date.now() - started,
      contentType: response.headers.get("content-type") || ""
    };
  } catch (error) {
    return { path: pathname, ok: false, status: 0, ms: Date.now() - started, error: error?.message || "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function commandExists(command) {
  if (command.includes("/") && fs.existsSync(command)) return true;
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command}`], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function sendAlert(report, alertEmail) {
  if (!alertEmail) return { sent: false, reason: "No alert email configured." };
  const sendmail = process.env.CLOVIS_SENDMAIL || "/usr/sbin/sendmail";
  if (!(await commandExists(sendmail))) return { sent: false, reason: "sendmail is not available." };
  const failed = report.checks.filter((item) => !item.ok);
  const message = [
    `To: ${alertEmail}`,
    "Subject: ClovisStar health check failed",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `ClovisStar health check failed on ${os.hostname()} at ${report.generatedAt}.`,
    `Base URL: ${base}`,
    "",
    ...failed.map((item) => `${item.path}: status ${item.status || "error"} ${item.error || ""}`.trim())
  ].join("\n");
  return new Promise((resolve) => {
    const child = spawn(sendmail, ["-t"], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ sent: false, reason: "sendmail timed out" });
    }, 10000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ sent: false, reason: error?.message || "sendmail failed" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { sent: true, to: alertEmail } : { sent: false, reason: stderr || `sendmail exited ${code}` });
    });
    child.stdin.end(message);
  });
}

const settings = readMonitoringSettings();
const alertEmail = process.env.CLOVIS_ALERT_EMAIL_TO || settings.alertEmail || "";
const checks = await Promise.all(pages.map(check));
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: base,
  ok: checks.every((item) => item.ok),
  checks,
  alert: null
};

if (!report.ok) report.alert = await sendAlert(report, alertEmail);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, failed: checks.filter((item) => !item.ok).length, outputFile, alert: report.alert }, null, 2));
process.exitCode = report.ok ? 0 : 2;

