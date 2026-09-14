import fs from "node:fs";
import path from "node:path";

const dataRoot = process.env.CLOVISSTAR_DATA_DIR ? path.resolve(process.env.CLOVISSTAR_DATA_DIR) : "data";
const required = [
  "index.html",
  "books/index.html",
  "compare/index.html",
  "admin/index.html",
  "members/index.html",
  "members/instructions/index.html",
  "assets/css/styles.css",
  "assets/js/app.js",
  path.join(dataRoot, "books-index.json"),
  path.join(dataRoot, "cleanup-report.json"),
  path.join(dataRoot, "review-queue.json"),
  path.join(dataRoot, "site-statistics.json"),
  path.join(dataRoot, "site-version.json"),
  "server.js",
  "scripts/migrate-research-tools.js",
  "scripts/nightly-qa-report.js",
  "db/.gitkeep",
  ".env.example"
];

let ok = true;
for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}`);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log("health ok");

