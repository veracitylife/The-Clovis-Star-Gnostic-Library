import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const imageDir = path.join(root, "assets", "img");
const quality = Number(process.env.CLOVIS_MEDIA_WEBP_QUALITY || 78);

function commandExists(command) {
  const probe = spawnSync(command, ["-version"], { encoding: "utf8", stdio: "pipe" });
  return !probe.error && probe.status === 0;
}

function optimizeWithCwebp(file) {
  const ext = path.extname(file).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(ext)) return null;
  const output = file.replace(ext, ".webp");
  const sourceStat = fs.statSync(file);
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= sourceStat.mtimeMs) {
    return { file, output, status: "fresh" };
  }
  const result = spawnSync("cwebp", ["-quiet", "-q", String(quality), file, "-o", output], { encoding: "utf8" });
  if (result.status !== 0) {
    return { file, output, status: "failed", error: result.stderr || result.stdout || "cwebp failed" };
  }
  return { file, output, status: "optimized" };
}

function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(current);
    return [current];
  });
}

function main() {
  const tools = {
    magick: commandExists("magick"),
    cwebp: commandExists("cwebp"),
    ffmpeg: commandExists("ffmpeg")
  };
  const files = collectFiles(imageDir)
    .filter((file) => /hero-bg-|hero-pyramid-|emblem/.test(path.basename(file)))
    .filter((file) => /\.(jpe?g|png)$/i.test(file));
  const results = [];
  if (tools.cwebp) {
    for (const file of files) results.push(optimizeWithCwebp(file));
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    tools,
    scanned: files.length,
    optimized: results.filter((item) => item?.status === "optimized").length,
    fresh: results.filter((item) => item?.status === "fresh").length,
    failed: results.filter((item) => item?.status === "failed").length,
    results: results.filter(Boolean).map((item) => ({
      file: path.relative(root, item.file),
      output: path.relative(root, item.output),
      status: item.status,
      error: item.error || ""
    }))
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}

main();

