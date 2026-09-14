const DATA_INDEX = "/data/books-index.json";
const SETTINGS_KEY = "clovisstar-admin-settings";
const HIGHLIGHTS_KEY = "clovisstar-highlights";
const AUTH_KEY = "clovisstar-auth";
const RECENT_BOOKS_KEY = "clovisstar-recent-books";
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
        version: data.version || "",
        releaseName: data.releaseName || "",
        collections: data.collections || [],
        stats: data.stats || {},
        siteSettings: data.siteSettings || DEFAULT_SITE_SETTINGS
      };
    }
  } catch {}
  return { version: "", releaseName: "", collections: [], stats: {}, siteSettings: DEFAULT_SITE_SETTINGS };
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

export async function loadContentOperations() {
  const res = await authorizedRequest("/api/admin/content-operations");
  if (!res.ok) throw new Error((await safeJson(res)).error || "Content operations load failed.");
  return (await res.json()).operations || {};
}

export async function runContentBatchAction(bucket, action) {
  const res = await authorizedRequest("/api/admin/content-operations/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bucket, action })
  });
  if (!res.ok) throw new Error((await safeJson(res)).error || "Batch action failed.");
  return (await res.json()).result || { bucket, action, updated: 0 };
}

export async function loadQaReport(refresh = false) {
  const res = await authorizedRequest(`/api/admin/qa-report${refresh ? "?refresh=1" : ""}`);
  if (!res.ok) throw new Error((await safeJson(res)).error || "QA report load failed.");
  return (await res.json()).report || {};
}

export async function generateQaReport() {
  const res = await authorizedRequest("/api/admin/qa-report", { method: "POST" });
  if (!res.ok) throw new Error((await safeJson(res)).error || "QA report generation failed.");
  return (await res.json()).report || {};
}

export async function searchLibrary(query, filters = {}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  for (const [key, value] of Object.entries(filters || {})) {
    if (value) params.set(key, value);
  }
  const res = await fetch(`/api/library/search?${params.toString()}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error((await safeJson(res)).error || "Search failed.");
  return res.json();
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

export async function updateUserApiAccess(userId, input) {
  const res = await authorizedRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error((await safeJson(res)).error || "User update failed.");
  return (await res.json()).user || null;
}

export async function loadApiProfile() {
  const res = await authorizedRequest("/api/member/api-token");
  if (!res.ok) return { apiEnabled: false, hasToken: false, tokenPrefix: "", tokenCreatedAt: "" };
  return (await res.json()).api || { apiEnabled: false, hasToken: false, tokenPrefix: "", tokenCreatedAt: "" };
}

export async function rotateApiToken() {
  const res = await authorizedRequest("/api/member/api-token", { method: "POST" });
  if (!res.ok) throw new Error((await safeJson(res)).error || "Token rotation failed.");
  return (await res.json()).api || null;
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

export async function updateHighlightDetails(id, input) {
  const signedIn = Boolean(getAuth()?.user);
  try {
    const res = await fetch(`/api/highlights/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: withCsrfHeaders({ "content-type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify(input)
    });
    if (res.ok) return (await res.json()).highlight || null;
    if (signedIn || res.status !== 401) throw new Error((await safeJson(res)).error || "Could not update highlight.");
  } catch (error) {
    if (signedIn) throw error;
  }
  const highlights = loadHighlights().map((item) => item.id === id ? { ...item, ...input } : item);
  writeStoredJson(HIGHLIGHTS_KEY, highlights);
  return highlights.find((item) => item.id === id) || null;
}

export function recordRecentBook(book) {
  if (!book?.slug) return;
  const recent = loadRecentBooks().filter((item) => item.slug !== book.slug);
  recent.unshift({
    slug: book.slug,
    title: book.title || book.slug,
    collection: book.collection || "Library",
    viewedAt: new Date().toISOString()
  });
  writeStoredJson(RECENT_BOOKS_KEY, recent.slice(0, 24));
}

export function loadRecentBooks() {
  return readStoredJson(RECENT_BOOKS_KEY, []);
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
  const featuredImage = renderBookFeaturedImage(book);
  const videoEmbed = renderBookVideoEmbed(book);
  let videoPlaced = false;

  container.innerHTML = featuredImage + (book.paragraphs || []).map((paragraph, index) => {
    const paragraphHtml = `<p data-paragraph="${index}">${linkifyEscapedText(escapeHtml(paragraph))}</p>`;
    if (!videoPlaced && videoEmbed && String(paragraph).toLowerCase().includes("watch the source video")) {
      videoPlaced = true;
      return `${paragraphHtml}${videoEmbed}`;
    }
    return paragraphHtml;
  }).join("") + (!videoPlaced && videoEmbed ? videoEmbed : "");
}

function renderBookFeaturedImage(book) {
  const image = (book?.media || []).find((item) => item?.type === "image" && (item.src || item.publicUrl || item.url));
  if (!image) return "";

  const imageUrl = String(image.src || image.publicUrl || image.url || "");
  if (!imageUrl.startsWith("/") && !imageUrl.startsWith("https://www.clovisstar.com/")) return "";

  const alt = escapeHtml(image.title || book.title || "Clovis Star featured image");
  const caption = image.description ? `<figcaption>${escapeHtml(image.description)}</figcaption>` : "";
  return `
    <figure class="book-featured-image">
      <img src="${escapeHtml(imageUrl)}" alt="${alt}" loading="eager" decoding="async">
      ${caption}
    </figure>
  `;
}

function linkifyEscapedText(value) {
  return String(value)
    .replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      const cleanUrl = url.replace(/[),.;]+$/g, "");
      const suffix = url.slice(cleanUrl.length);
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${suffix}`;
    })
    .replace(/(^|[\s(])((?:\/books\/\?book=)[a-z0-9-]+(?:&amp;[a-zA-Z0-9_=%+.-]+)*)/g, (match, prefix, url) => {
      return `${prefix}<a href="${url}">${url}</a>`;
    });
}

function renderBookVideoEmbed(book) {
  const video = (book?.media || []).find((item) => item?.type === "video" && (item.embedUrl || item.url));
  if (!video) return "";

  const embedUrl = safeYouTubeEmbedUrl(video.embedUrl || video.url);
  if (!embedUrl) return "";

  const title = escapeHtml(video.title || book.title || "Clovis Star video");
  return `
    <figure class="book-video-embed">
      <iframe
        src="${embedUrl}"
        title="${title}"
        loading="lazy"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen></iframe>
    </figure>
  `;
}

function safeYouTubeEmbedUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.replace(/^www\./, "");
    const allowedHosts = new Set(["youtube.com", "youtube-nocookie.com", "youtu.be"]);
    if (!allowedHosts.has(host)) return "";

    let videoId = "";
    if (host === "youtu.be") {
      videoId = url.pathname.replace(/^\/+/, "").split("/")[0];
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/").filter(Boolean)[1] || "";
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") || "";
    }

    if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return "";

    const cleanUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
    const si = url.searchParams.get("si");
    if (si && /^[a-zA-Z0-9_-]+$/.test(si)) cleanUrl.searchParams.set("si", si);
    return cleanUrl.toString();
  } catch {
    return "";
  }
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

export function installHeroSigilAnimation(options = {}) {
  const image = document.querySelector("[data-hero-sigil-image]");
  const art = image?.closest(".gt-hero__art");
  if (!image || !art || window.__clovisHeroSigilInstalled) return;
  window.__clovisHeroSigilInstalled = true;

  const audioSrc = options.audioSrc || "/assets/audio/hero-loop.wav";
  const openSrc = image?.dataset.openSrc || "/assets/img/hero-pyramid-open.png";
  const closedSrc = image?.dataset.closedSrc || "/assets/img/hero-pyramid-closed.png";
  const openWebp = image?.dataset.openWebp || "";
  const closedWebp = image?.dataset.closedWebp || "";
  const webpSource =
    image?.parentElement?.tagName?.toLowerCase() === "picture"
      ? image.parentElement.querySelector('source[type="image/webp"]')
      : null;
  const blinkClosedMs = Number(options.blinkClosedMs || 450);
  const blinkIntervalMs = Number(options.blinkIntervalMs || 9000);
  let audio = null;
  let active = false;
  let blinkTimer = null;
  let reopenTimer = null;

  const preloadedOpen = new Image();
  const preloadedClosed = new Image();
  preloadedOpen.src = openSrc;
  preloadedClosed.src = closedSrc;
  showOpenFrame();

  function showOpenFrame() {
    if (webpSource && openWebp) webpSource.setAttribute("srcset", openWebp);
    if (image) image.src = openSrc;
  }

  function showClosedFrame() {
    if (webpSource && closedWebp) webpSource.setAttribute("srcset", closedWebp);
    if (image) image.src = closedSrc;
  }

  function blinkOnce() {
    if (!image) return;
    art.classList.add("is-sigil-blinking");
    showClosedFrame();
    clearTimeout(reopenTimer);
    reopenTimer = setTimeout(() => {
      showOpenFrame();
      art.classList.remove("is-sigil-blinking");
    }, blinkClosedMs);
  }

  function stopBlinkLoop() {
    clearInterval(blinkTimer);
    clearTimeout(reopenTimer);
    blinkTimer = null;
    reopenTimer = null;
    art.classList.remove("is-sigil-blinking");
    showOpenFrame();
  }

  function startBlinkLoop() {
    stopBlinkLoop();
    showOpenFrame();
    blinkOnce();
    blinkTimer = setInterval(blinkOnce, blinkIntervalMs);
  }

  async function setActive(nextActive) {
    active = nextActive;
    art.classList.toggle("is-sigil-awake", active);

    if (!active) {
      stopBlinkLoop();
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      return;
    }

    startBlinkLoop();

    if (!audio) {
      audio = new Audio(audioSrc);
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0.65;
    }

    try {
      await audio.play();
    } catch {
      // The visual animation still works if the audio cannot play.
    }
  }

  function triggerSequence() {
    if (active) {
      blinkOnce();
      if (audio?.paused) {
        audio.play().catch(() => {});
      }
      return;
    }
    setActive(true);
  }

  image.addEventListener("click", (event) => {
    event.preventDefault();
    triggerSequence();
    image.blur();
  });

  image.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    triggerSequence();
    image.blur();
  });

  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      triggerSequence();
    }
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

