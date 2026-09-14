#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run crawl:front
npm run ingest:front
npm run health
node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("./data/books-index.json","utf8")); console.log("Imported books:", j.count);'

