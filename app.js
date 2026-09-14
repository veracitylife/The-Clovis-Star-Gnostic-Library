const DATA_INDEX = "/data/books-index.json";
const SETTINGS_KEY = "clovisstar-admin-settings";
const HIGHLIGHTS_KEY = "clovisstar-highlights";
const AUTH_KEY = "clovisstar-auth";
const fallbackStorage = new Map();
let authState = null;
const DEFAULT_SITE_SETTINGS = {
  members: { allowRegistration: true },
  library: { collectionCardLimit: 12, shuffleCollections: true, copyAttributionEnabled: true },
  audio: { enabled: false, exposePlayerUi: false, defaultProvider: "openai" }
};

export async function loadBooks(options = {}) {
  const { includeAll = false } = options;
  const apiUrl = includeAll ? "/api/books?include=all" : "/api/books";
  try {
    const res = await fetch(apiUrl, { credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      return data.books || [];
    }
  } catch {}

  const res = await fetch(DATA_INDEX, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Book index failed: ${res.status}`);
  const data = await res.json();
  const settings = loadSettings();
  return (data.books || []).map((book) => ({
    ...book,
    visibility: settings.visibility?.[book.slug] || book.visibility || "public"
  }));
}

export async function loadBook(slug, options = {}) {
  const includeAll = options.includeAll ? "?include=all" : "";
  try {
    const res = await fetch(`/api/books/${encodeURIComponent(slug)}${includeAll}`, { credentials: "same-origin" });
    if (res.ok) return res.json();
  } catch {}

  const res = await fetch(`/data/books/${slug}.json`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Book failed: ${slug}`);
  return res.json();
}

export async function loadAdminBootstrap() {
  const res = await authorizedRequest("/api/admin/bootstrap");
  if (!res.ok) throw new Error((await safeJson(res)).error || "Admin bootstrap failed.");
  return res.json();
}

export async function loadSiteBootstrap() {
  try {
    const res = await authorizedRequest("/api/site/bootstrap");
    if (res.ok) {
      const data = await res.json();
      return {
        collections: data.collections || [],
        stats: data.stats || {},
        siteSettings: data.siteSettings || DEFAULT_SITE_SETTINGS
      };
    }
  } catch {}
  return { collections: [], stats: {}, siteSettings: DEFAULT_SITE_SETTINGS };
}

export async function loadAdminSettings() {
  const res = await authorizedRequest("/api/admin/settings");
  if (!res.ok) throw new Error((await safeJson(res)).error || "Settings load failed.");
  return (await res.json()).settings || {};
}

export async function saveAdminSettings(settings) {
  const res = await authorizedRequest("/api/admin/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
  if (!res.ok) throw new Error((await safeJson(res)).error || "Settings save failed.");
  return (await res.json()).settings || {};
}

export async function loadMemberPreferences() {
  const res = await authorizedRequest("/api/member/preferences");
  if (!res.ok) return { showBookmarksInSidebar: false };
  return (await res.json()).preferences || { showBookmarksInSidebar: false };
}

export async function saveMemberPreferences(preferences) {
  const res = await authorizedRequest("/api/member/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preferences)
  });
  if (!res.ok) throw new Error((await safeJson(res)).error || "Preference save failed.");
  return (await res.json()).preferences || { showBookmarksInSidebar: false };
}

export async function loadReviewQueue() {
  const res = await authorizedRequest("/api/admin/review-queue");
  if (!res.ok) throw new Error((await safeJson(res)).error || "Review queue load failed.");
  return (await res.json()).reviewQueue || [];
}

export async function updateReviewItem(id, input) {
  const res = await authorizedRequest(`/api/admin/review-queue/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error((await safeJson(res)).error || "Review item update failed.");
  return (await res.json()).reviewItem || null;
}

export async function updateBookAdminState(slug, input) {
  const res = await authorizedRequest(`/api/admin/books/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error((await safeJson(res)).error || "Book update failed.");
  return (await res.json()).override || null;
}

export function loadSettings() {
  return readStoredJson(SETTINGS_KEY, {});
}

export function saveSettings(settings) {
  writeStoredJson(SETTINGS_KEY, settings);
}

export function loadHighlights() {
  return readStoredJson(HIGHLIGHTS_KEY, []);
}

export async function saveHighlight(item) {
  const signedIn = Boolean(getAuth()?.user);
  try {
    const res = await fetch("/api/highlights", {
      method: "POST",
      headers: withCsrfHeaders({ "content-type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify(item)
    });
    if (res.ok) return loadAccountHighlights();
    if (signedIn || res.status !== 401) throw new Error((await safeJson(res)).error || "Could not save highlight.");
  } catch (error) {
    if (signedIn) throw error;
  }
  const highlights = loadHighlights();
  highlights.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...item });
  writeStoredJson(HIGHLIGHTS_KEY, highlights);
  return highlights;
}

export async function loadAccountHighlights() {
  try {
    const res = await fetch("/api/highlights", { credentials: "same-origin" });
    if (res.ok) return (await res.json()).highlights || [];
  } catch {}
  return loadHighlights();
}

export async function updateHighlightNote(id, note) {
  const signedIn = Boolean(getAuth()?.user);
  try {
    const res = await fetch(`/api/highlights/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: withCsrfHeaders({ "content-type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify({ note })
    });
    if (res.ok) return (await res.json()).highlight || null;
    if (signedIn || res.status !== 401) throw new Error((await safeJson(res)).error || "Could not update note.");
  } catch (error) {
    if (signedIn) throw error;
  }
  const highlights = loadHighlights().map((item) => item.id === id ? { ...item, note } : item);
  writeStoredJson(HIGHLIGHTS_KEY, highlights);
  return highlights.find((item) => item.id === id) || null;
}

export function clearHighlights() {
  removeStoredValue(HIGHLIGHTS_KEY);
}

export async function deleteHighlight(id) {
  const signedIn = Boolean(getAuth()?.user);
  try {
    const res = await fetch(`/api/highlights/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: withCsrfHeaders(),
      credentials: "same-origin"
    });
    if (res.ok) return;
    if (signedIn || res.status !== 401) throw new Error((await safeJson(res)).error || "Could not delete highlight.");
  } catch {}
  if (signedIn) throw new Error("Could not delete highlight.");
  writeStoredJson(HIGHLIGHTS_KEY, loadHighlights().filter((item) => item.id !== id));
}

export function getAuth() {
  if (authState) return authState;
  authState = readStoredJson(AUTH_KEY, null);
  return authState;
}

export function setAuth(auth) {
  authState = auth || null;
  if (!auth) removeStoredValue(AUTH_KEY);
  else writeStoredJson(AUTH_KEY, auth);
}

export async function syncAuthFromServer() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) {
      setAuth(null);
      return null;
    }
    const data = await res.json();
    const auth = { user: data.user };
    setAuth(auth);
    return auth;
  } catch {
    return getAuth();
  }
}

export async function registerAccount(input) {
  return authRequest("/api/auth/register", input);
}

export async function loginAccount(input) {
  return authRequest("/api/auth/login", input);
}

export async function logoutAccount() {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: withCsrfHeaders(),
    credentials: "same-origin"
  });
  setAuth(null);
}

async function authRequest(url, input) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input)
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || "Account request failed.");
  const auth = { user: data.user };
  setAuth(auth);
  return auth;
}

async function authorizedRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("clovisstar_csrf");
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  return fetch(url, { credentials: "same-origin", ...options, headers });
}

async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

function getStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredJson(key, fallback) {
  const storage = getStorage();
  try {
    const raw = storage ? storage.getItem(key) : fallbackStorage.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  const raw = JSON.stringify(value, null, 2);
  fallbackStorage.set(key, raw);
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, raw);
  } catch {}
}

function removeStoredValue(key) {
  fallbackStorage.delete(key);
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {}
}

export function highlightBookHref(item) {
  return `/books/?book=${encodeURIComponent(item.bookSlug || "")}`;
}

export function highlightBookLabel(item) {
  return item.bookTitle || item.bookSlug || "Open text";
}

export function groupHighlightsByBook(highlights) {
  return highlights.reduce((groups, item) => {
    const key = item.bookTitle || "Untitled";
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
  }, {});
}

export function renderBookOptions(select, books, selected) {
  select.innerHTML = books
    .filter((book) => book.visibility !== "private")
    .map((book) => `<option value="${book.slug}" ${book.slug === selected ? "selected" : ""}>${escapeHtml(book.title)}</option>`)
    .join("");
}

export function renderBookContent(container, book) {
  container.innerHTML = (book.paragraphs || []).map((paragraph, index) => (
    `<p data-paragraph="${index}">${escapeHtml(paragraph)}</p>`
  )).join("");
}

export function currentSelectionText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : "";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function installCopyAttribution(siteSettings = DEFAULT_SITE_SETTINGS) {
  if (!siteSettings?.library?.copyAttributionEnabled || window.__clovisCopyAttributionInstalled) return;
  window.__clovisCopyAttributionInstalled = true;
  document.addEventListener("copy", (event) => {
    const selection = window.getSelection()?.toString().trim();
    if (!selection || !event.clipboardData) return;
    const attribution = `\n\nSource: ${window.location.origin}${window.location.pathname}${window.location.search}`;
    event.clipboardData.setData("text/plain", `${selection}${attribution}`);
    event.preventDefault();
  });
}

function withCsrfHeaders(input = {}) {
  const headers = new Headers(input);
  const csrf = readCookie("clovisstar_csrf");
  if (csrf) headers.set("x-csrf-token", csrf);
  return headers;
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(/;\s*/)) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return "";
}

