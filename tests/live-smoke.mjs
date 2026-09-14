import assert from "node:assert/strict";

const base = process.env.CLOVIS_LIVE_BASE_URL || "https://clovisstar.com";

async function status(pathname, expected = 200) {
  const response = await fetch(`${base}${pathname}`, { redirect: "manual" });
  assert.equal(response.status, expected, `${pathname} expected ${expected}, got ${response.status}`);
  return response;
}

await status("/");
await status("/books/");
await status("/compare/");
await status("/members/");
await status("/members/instructions/");
await status("/admin/");
await status("/api/");
await status("/api/v1/openapi.json");
await status("/api/v1/catalog", 401);

const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.ok, true);
assert.match(health.version || "", /^\d+\.\d+\.\d+$/);
assert.equal(health.storageMode, "mysql");
assert.equal(health.openReviewItems, 0);

const bootstrap = await (await fetch(`${base}/api/site/bootstrap`)).json();
assert.equal(bootstrap.version, health.version);

const apiDocs = await (await fetch(`${base}/api/v1/openapi.json`)).json();
assert.equal(apiDocs.info.title, "Clovis Star Catalog API");

const search = await (await fetch(`${base}/api/library/search?q=thoth&hasSource=0`)).json();
assert.equal(Array.isArray(search.results), true);
assert.equal(typeof search.count, "number");

console.log(JSON.stringify({ ok: true, base, health }, null, 2));

