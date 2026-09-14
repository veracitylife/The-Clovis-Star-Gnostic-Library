import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.CLOVIS_LIVE_BASE_URL || "http://127.0.0.1:4173";
const outputFile = path.join(root, "db", "qa-report.json");

const pages = ["/", "/books/", "/compare/", "/members/", "/members/instructions/", "/about/", "/admin/", "/api/", "/api/health"];

async function checkPage(pathname) {
  const response = await fetch(`${base}${pathname}`, { redirect: "manual" });
  return {
    path: pathname,
    status: response.status,
    ok: response.status >= 200 && response.status < 400,
    contentType: response.headers.get("content-type") || ""
  };
}

const [health, bootstrap, ...pageChecks] = await Promise.all([
  fetch(`${base}/api/health`).then((res) => res.json()),
  fetch(`${base}/api/site/bootstrap`).then((res) => res.json()),
  ...pages.map(checkPage)
]);

const report = {
  generatedAt: new Date().toISOString(),
  version: health.version || bootstrap.version || "",
  releaseName: health.releaseName || bootstrap.releaseName || "",
  stats: bootstrap.stats || {},
  checks: {
    pages: pageChecks,
    failedPages: pageChecks.filter((item) => !item.ok),
    publicBooks: bootstrap.stats?.publicBooks || 0,
    completedTexts: bootstrap.stats?.completedTexts || 0,
    collections: bootstrap.collections?.length || 0,
    healthOk: Boolean(health.ok),
    mysqlActive: health.storageMode === "mysql"
  }
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.checks.failedPages.length === 0 && report.checks.healthOk, outputFile, version: report.version }, null, 2));

