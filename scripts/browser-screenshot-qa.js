import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.CLOVIS_LIVE_BASE_URL || "https://clovisstar.com").replace(/\/$/, "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "storage", "qa-screenshots", stamp);
const reportFile = path.join(root, "db", "browser-screenshot-report.json");

const pages = [
  { name: "home-desktop", path: "/", size: "1440,860" },
  { name: "books-desktop", path: "/books/", size: "1440,860" },
  { name: "members-desktop", path: "/members/", size: "1440,860" },
  { name: "admin-desktop", path: "/admin/", size: "1440,860" },
  { name: "home-mobile", path: "/", size: "390,844" }
];

async function findChrome() {
  const candidates = [
    process.env.CLOVIS_CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "chrome"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync("sh", ["-lc", `command -v ${candidate}`], { timeout: 3000 });
      const command = stdout.trim();
      if (command) return command;
    } catch {}
  }
  return "";
}

async function captureWithPlaywright() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-chromium"));
  } catch (error) {
    return { available: false, reason: error?.message || "playwright-chromium is not installed" };
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const page of pages) {
      const file = path.join(outputDir, `${page.name}.png`);
      const [width, height] = page.size.split(",").map((value) => Number(value));
      const context = await browser.newContext({ viewport: { width, height } });
      const browserPage = await context.newPage();
      const url = `${base}${page.path}`;
      try {
        await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await browserPage.waitForTimeout(1800);
        await browserPage.screenshot({ path: file, fullPage: true });
        const stats = fs.statSync(file);
        results.push({ ...page, url, file, ok: stats.size > 2000, bytes: stats.size, engine: "playwright-chromium" });
      } catch (error) {
        results.push({ ...page, url, file, ok: false, error: error?.message || "screenshot failed", engine: "playwright-chromium" });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { available: true, results };
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, skipped: report.skipped, outputDir: report.outputDir, reportFile }, null, 2));
}

const chrome = await findChrome();
if (!chrome) {
  fs.mkdirSync(outputDir, { recursive: true });
  const playwrightResult = await captureWithPlaywright();
  if (playwrightResult.available) {
    const report = {
      generatedAt: new Date().toISOString(),
      ok: playwrightResult.results.every((item) => item.ok),
      skipped: false,
      chrome: "playwright-chromium",
      outputDir,
      results: playwrightResult.results
    };
    writeReport(report);
    process.exit(report.ok ? 0 : 2);
  }
  writeReport({
    generatedAt: new Date().toISOString(),
    ok: false,
    skipped: true,
    reason: `No Chrome or Chromium binary was found. Playwright fallback unavailable: ${playwrightResult.reason}`,
    outputDir: ""
  });
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const results = [];
for (const page of pages) {
  const file = path.join(outputDir, `${page.name}.png`);
  const url = `${base}${page.path}`;
  try {
    await execFileAsync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--window-size=${page.size}`,
      `--screenshot=${file}`,
      url
    ], { timeout: 45000 });
    const stats = fs.statSync(file);
    results.push({ ...page, url, file, ok: stats.size > 2000, bytes: stats.size });
  } catch (error) {
    results.push({ ...page, url, file, ok: false, error: error?.message || "screenshot failed" });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: results.every((item) => item.ok),
  skipped: false,
  chrome,
  outputDir,
  results
};
writeReport(report);
process.exitCode = report.ok ? 0 : 2;

