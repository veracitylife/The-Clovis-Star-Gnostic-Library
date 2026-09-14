import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const defaultAllowedMimeTypes = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "video/mp4"
];

const extensionByMimeType = new Map([
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["text/markdown", ".md"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
  ["video/mp4", ".mp4"]
]);

function cleanSegment(value, fallback = "files") {
  const clean = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

function parseAllowedMimeTypes(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class LocalStorageDriver {
  constructor(options = {}) {
    this.rootPath = path.resolve(options.rootPath || process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), "storage", "uploads"));
    this.publicBaseUrl = String(options.publicBaseUrl || process.env.PUBLIC_FILE_BASE_URL || "/uploads").replace(/\/+$/, "");
    this.maxUploadBytes = Math.max(1, Number(options.maxUploadSizeMb || process.env.MAX_UPLOAD_SIZE_MB || 100)) * 1024 * 1024;
    this.allowedMimeTypes = new Set(parseAllowedMimeTypes(options.allowedMimeTypes || process.env.ALLOWED_UPLOAD_MIME_TYPES).length
      ? parseAllowedMimeTypes(options.allowedMimeTypes || process.env.ALLOWED_UPLOAD_MIME_TYPES)
      : defaultAllowedMimeTypes);
  }

  validate({ mimeType, size }) {
    if (!this.allowedMimeTypes.has(mimeType)) {
      const error = new Error("File type is not allowed.");
      error.status = 415;
      throw error;
    }
    if (size > this.maxUploadBytes) {
      const error = new Error("File is larger than the configured upload limit.");
      error.status = 413;
      throw error;
    }
  }

  makeRelativePath({ contentType = "files", mimeType, now = new Date() }) {
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const extension = extensionByMimeType.get(mimeType) || "";
    const storedFilename = `${crypto.randomUUID()}${extension}`;
    return path.posix.join(year, month, cleanSegment(contentType), storedFilename);
  }

  async save(buffer, options = {}) {
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    const mimeType = String(options.mimeType || "application/octet-stream").toLowerCase();
    this.validate({ mimeType, size: body.length });
    const relativePath = this.makeRelativePath({ contentType: options.contentType, mimeType });
    const targetPath = path.join(this.rootPath, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, body, { flag: "wx" });
    const fileHash = crypto.createHash("sha256").update(body).digest("hex");
    return {
      storageDriver: "local",
      originalFilename: String(options.originalFilename || "upload").slice(0, 255),
      storedFilename: path.basename(relativePath),
      relativePath,
      mimeType,
      fileSize: body.length,
      fileHash,
      publicUrl: this.getPublicUrl({ relativePath }),
      visibility: options.visibility === "private" ? "private" : "public"
    };
  }

  getPublicUrl(fileAsset) {
    const relativePath = String(fileAsset.relativePath || "").replace(/^\/+/, "");
    if (!relativePath) return this.publicBaseUrl;
    return `${this.publicBaseUrl}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  }

  async exists(fileAsset) {
    try {
      await fs.access(path.join(this.rootPath, ...String(fileAsset.relativePath || "").split("/")));
      return true;
    } catch {
      return false;
    }
  }

  async delete(fileAsset) {
    await fs.rm(path.join(this.rootPath, ...String(fileAsset.relativePath || "").split("/")), { force: true });
  }

  async status() {
    await fs.mkdir(this.rootPath, { recursive: true });
    let fileCount = 0;
    let totalBytes = 0;
    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          fileCount += 1;
          totalBytes += (await fs.stat(full)).size;
        }
      }
    }
    await walk(this.rootPath);
    return {
      ok: true,
      driver: "local",
      rootPath: this.rootPath,
      publicBaseUrl: this.publicBaseUrl,
      fileCount,
      totalBytes,
      maxUploadBytes: this.maxUploadBytes,
      allowedMimeTypes: [...this.allowedMimeTypes]
    };
  }
}

