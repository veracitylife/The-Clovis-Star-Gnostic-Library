import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionFile = path.join(root, "data", "site-version.json");
const packageFile = path.join(root, "package.json");
const packageLockFile = path.join(root, "package-lock.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function nextPatchVersion(version) {
  const parts = String(version || "").split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  parts[2] += 1;
  return parts.join(".");
}

const siteVersion = readJson(versionFile);
const nextVersion = process.argv[2] || nextPatchVersion(siteVersion.version);

siteVersion.version = nextVersion;
siteVersion.bumpStep = "0.0.1";
siteVersion.updatedAt = new Date().toISOString();
writeJson(versionFile, siteVersion);

const pkg = readJson(packageFile);
pkg.version = nextVersion;
writeJson(packageFile, pkg);

if (fs.existsSync(packageLockFile)) {
  const lock = readJson(packageLockFile);
  lock.version = nextVersion;
  if (lock.packages?.[""]) lock.packages[""].version = nextVersion;
  writeJson(packageLockFile, lock);
}

console.log(JSON.stringify({ version: nextVersion, file: path.relative(root, versionFile) }, null, 2));

