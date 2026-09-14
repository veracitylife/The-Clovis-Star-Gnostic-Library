import { LocalStorageDriver } from "./local-storage-driver.js";

export function createStorageService(options = {}) {
  const driverName = String(options.driver || process.env.STORAGE_DRIVER || "local").toLowerCase();
  if (driverName !== "local") {
    return {
      driverName,
      async save() {
        throw new Error(`Storage driver "${driverName}" is not configured yet. Use STORAGE_DRIVER=local until cloud credentials are added.`);
      },
      async delete() {
        throw new Error(`Storage driver "${driverName}" is not configured yet.`);
      },
      getPublicUrl() {
        throw new Error(`Storage driver "${driverName}" is not configured yet.`);
      },
      async exists() {
        return false;
      },
      async status() {
        return { ok: false, driver: driverName, message: "Driver stub only. Configure local, s3, r2, wasabi, or b2 implementation before use." };
      }
    };
  }

  const driver = new LocalStorageDriver(options);
  return {
    driverName: "local",
    save: (...args) => driver.save(...args),
    delete: (...args) => driver.delete(...args),
    getPublicUrl: (...args) => driver.getPublicUrl(...args),
    exists: (...args) => driver.exists(...args),
    status: (...args) => driver.status(...args)
  };
}

