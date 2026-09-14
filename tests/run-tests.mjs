import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRoot = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clovisstar-static-test-"));
const tempDataDir = path.join(tempRoot, "data");
const tempDbDir = path.join(tempRoot, "db");

async function main() {
  fs.cpSync(path.join(workspaceRoot, "data"), tempDataDir, { recursive: true });
  fs.mkdirSync(tempDbDir, { recursive: true });
  const testIndex = JSON.parse(fs.readFileSync(path.join(tempDataDir, "books-index.json"), "utf8"));
  const expectedBookCount = testIndex.books.length;
  const testBookSlug = testIndex.books[0].slug;
  const testBookTitle = testIndex.books[0].title;

  process.env.CLOVISSTAR_DATA_DIR = tempDataDir;
  process.env.CLOVISSTAR_DB_DIR = tempDbDir;
  process.env.CLOVIS_STORAGE = "json";
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "0";
  process.env.CLOVIS_ADMIN_EMAILS = "admin@example.com";

  const serverModule = await import(`${pathToFileURL(path.join(workspaceRoot, "server.js")).href}?test=${Date.now()}`);
  const runtime = await serverModule.startServer({ port: 0, host: "127.0.0.1" });
  const baseUrl = `http://${runtime.host}:${runtime.port}`;

  function createClient() {
    const cookieJar = new Map();
    return {
      async request(pathname, options = {}) {
        const headers = new Headers(options.headers || {});
        const method = String(options.method || "GET").toUpperCase();
        const cookie = [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
        if (cookie) headers.set("cookie", cookie);
        if (!["GET", "HEAD", "OPTIONS"].includes(method) && cookieJar.has("clovisstar_csrf")) {
          headers.set("x-csrf-token", cookieJar.get("clovisstar_csrf"));
        }
        const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
        const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
        for (const item of setCookie) {
          const [pair] = item.split(";");
          const eq = pair.indexOf("=");
          if (eq === -1) continue;
          const name = pair.slice(0, eq);
          const value = pair.slice(eq + 1);
          if (value) cookieJar.set(name, value);
          else cookieJar.delete(name);
        }
        const text = await response.text();
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        return { status: response.status, body };
      }
    };
  }

  const admin = createClient();
  const member = createClient();

  try {
    let response = await admin.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        password: "AdminPass123!",
        displayName: "Admin"
      })
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.role, "admin");

    response = await admin.request("/api/auth/me");
    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, "admin@example.com");
    assert.equal(response.body.siteSettings.members.allowRegistration, true);

    response = await admin.request("/api/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.storageMode, "json");
    assert.equal(response.body.books, expectedBookCount);

    response = await admin.request("/api/member/preferences");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.preferences, { showBookmarksInSidebar: false });

    response = await admin.request("/api/member/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showBookmarksInSidebar: true })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.preferences, { showBookmarksInSidebar: true });

    response = await admin.request("/api/highlights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bookSlug: testBookSlug,
        bookTitle: testBookTitle,
        color: "yellow",
        text: "Beloved, believe not every spirit.",
        note: "Research note",
        folder: "Pneumatology",
        tags: "spirit, testing"
      })
    });
    assert.equal(response.status, 201);
    const highlightId = response.body.highlight.id;
    assert.equal(response.body.highlight.folder, "Pneumatology");
    assert.deepEqual(response.body.highlight.tags, ["spirit", "testing"]);

    response = await admin.request("/api/highlights");
    assert.equal(response.status, 200);
    assert.equal(response.body.highlights.length, 1);
    assert.equal(response.body.highlights[0].id, highlightId);

    response = await admin.request(`/api/highlights/${encodeURIComponent(highlightId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Updated note", folder: "Doctrine", tags: "discernment" })
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.highlight.note, "Updated note");
    assert.equal(response.body.highlight.folder, "Doctrine");
    assert.deepEqual(response.body.highlight.tags, ["discernment"]);

    response = await admin.request("/api/library/search?sourceConfidence=source-linked");
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.results));
    assert.ok(response.body.results.every((book) => book.sourceConfidence === "source-linked"));

    response = await admin.request("/api/admin/content-operations");
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.operations.summary.provenanceNeedsReview, "number");

    response = await admin.request("/api/admin/content-operations/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bucket: "provenanceNeedsReview", action: "mark_in_progress" })
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.result.bucket, "provenanceNeedsReview");
    assert.equal(response.body.result.action, "mark_in_progress");
    assert.equal(typeof response.body.result.updated, "number");

    response = await member.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "member@example.com",
        password: "MemberPass123!",
        displayName: "Member"
      })
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.role, "member");

    response = await member.request("/api/admin/bootstrap");
    assert.equal(response.status, 403);

    response = await member.request("/api/member/api-token");
    assert.equal(response.status, 200);
    assert.equal(response.body.api.apiEnabled, false);

    response = await member.request("/api/member/api-token", { method: "POST" });
    assert.equal(response.status, 403);

    response = await admin.request("/api/admin/bootstrap");
    assert.equal(response.status, 200);
    const memberUser = response.body.users.find((item) => item.email === "member@example.com");
    assert.ok(memberUser);

    response = await admin.request(`/api/admin/users/${encodeURIComponent(memberUser.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiEnabled: true })
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.apiEnabled, true);

    response = await member.request("/api/member/api-token");
    assert.equal(response.status, 200);
    assert.equal(response.body.api.apiEnabled, true);
    assert.equal(response.body.api.hasToken, false);

    response = await member.request("/api/member/api-token", { method: "POST" });
    assert.equal(response.status, 201);
    assert.match(response.body.api.token, /^cs_/);
    const apiToken = response.body.api.token;

    response = await member.request("/api/member/api-token");
    assert.equal(response.status, 200);
    assert.equal(response.body.api.hasToken, true);
    assert.equal(response.body.api.token, undefined);

    let apiResponse = await fetch(`${baseUrl}/api/v1/openapi.json`);
    assert.equal(apiResponse.status, 200);
    assert.equal(apiResponse.headers.get("access-control-allow-origin"), "*");
    let apiBody = await apiResponse.json();
    assert.equal(apiBody.info.title, "Clovis Star Catalog API");

    apiResponse = await fetch(`${baseUrl}/api/v1/catalog`, { method: "OPTIONS" });
    assert.equal(apiResponse.status, 204);
    assert.equal(apiResponse.headers.get("access-control-allow-origin"), "*");
    assert.match(apiResponse.headers.get("access-control-allow-methods") || "", /GET/);

    apiResponse = await fetch(`${baseUrl}/api/v1/catalog`);
    assert.equal(apiResponse.status, 401);
    assert.equal(apiResponse.headers.get("access-control-allow-origin"), "*");
    assert.match(apiResponse.headers.get("www-authenticate") || "", /Bearer/);

    apiResponse = await fetch(`${baseUrl}/api/v1/catalog`, { headers: { authorization: "Bearer invalid" } });
    assert.equal(apiResponse.status, 401);
    assert.equal(apiResponse.headers.get("access-control-allow-origin"), "*");

    apiResponse = await fetch(`${baseUrl}/api/v1/catalog`, { headers: { authorization: `Bearer ${apiToken}` } });
    assert.equal(apiResponse.status, 200);
    assert.equal(apiResponse.headers.get("access-control-allow-origin"), "*");
    apiBody = await apiResponse.json();
    assert.ok(Array.isArray(apiBody.books));
    assert.ok(apiBody.books.some((book) => book.slug === testBookSlug));

    apiResponse = await fetch(`${baseUrl}/api/v1/books/${encodeURIComponent(testBookSlug)}`, { headers: { authorization: `Bearer ${apiToken}` } });
    assert.equal(apiResponse.status, 200);
    apiBody = await apiResponse.json();
    assert.equal(apiBody.slug, testBookSlug);
    assert.ok(Array.isArray(apiBody.paragraphs));

    response = await admin.request(`/api/admin/books/${encodeURIComponent(testBookSlug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: "private", reviewStatus: "in_progress" })
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.override.visibility, "private");

    response = await member.request("/api/books");
    assert.equal(response.status, 200);
    assert.equal(response.body.books.some((book) => book.slug === testBookSlug), false);

    response = await member.request(`/api/books/${encodeURIComponent(testBookSlug)}`);
    assert.equal(response.status, 404);

    response = await admin.request("/api/books?include=all");
    assert.equal(response.status, 200);
    assert.equal(response.body.books.some((book) => book.slug === testBookSlug), true);

    apiResponse = await fetch(`${baseUrl}/api/v1/books/${encodeURIComponent(testBookSlug)}`, { headers: { authorization: `Bearer ${apiToken}` } });
    assert.equal(apiResponse.status, 404);

    response = await admin.request("/api/admin/bootstrap");
    assert.equal(response.status, 200);
    assert.equal(response.body.stats.publicBooks, expectedBookCount - 1);

    response = await admin.request("/api/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.publicBooks, expectedBookCount - 1);

    response = await admin.request("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ members: { allowRegistration: false } })
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.settings.members.allowRegistration, false);

    response = await member.request("/api/auth/logout", { method: "POST" });
    assert.equal(response.status, 200);

    response = await member.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "another@example.com",
        password: "AnotherPass123!",
        displayName: "Another"
      })
    });
    assert.equal(response.status, 403);

    response = await admin.request(`/api/highlights/${encodeURIComponent(highlightId)}`, {
      method: "DELETE"
    });
    assert.equal(response.status, 200);

    response = await admin.request("/api/highlights");
    assert.equal(response.status, 200);
    assert.equal(response.body.highlights.length, 0);

    response = await admin.request("/api/auth/logout", { method: "POST" });
    assert.equal(response.status, 200);

    response = await admin.request("/api/auth/me");
    assert.equal(response.status, 401);

    const cleanup = await runtime.cleanupTransients({ optimize: false });
    assert.equal(typeof cleanup.rateLimitBuckets, "number");
    assert.equal(typeof cleanup.expiredSessions, "number");

    console.log("tests ok");
  } finally {
    await new Promise((resolve, reject) => runtime.server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  process.exit(1);
});

