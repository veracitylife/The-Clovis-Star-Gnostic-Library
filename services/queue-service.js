export function createQueueService(options = {}) {
  const requestedDriver = String(options.driver || process.env.QUEUE_DRIVER || "redis").toLowerCase();
  const redisUrl = process.env.REDIS_URL || "";
  const redisConfigured = requestedDriver === "redis" && Boolean(redisUrl);
  const driver = redisConfigured ? "redis" : "database";

  return {
    driver,
    requestedDriver,
    async status() {
      return {
        ok: true,
        driver,
        requestedDriver,
        redisConfigured,
        message: driver === "redis"
          ? "Redis is configured. Install a Redis client worker before using background queues."
          : "Redis is not available; jobs should use database-backed or synchronous fallback."
      };
    },
    async enqueue(type, payload = {}) {
      return {
        id: cryptoRandomId(),
        type,
        payload,
        status: driver === "redis" ? "pending" : "sync_fallback"
      };
    }
  };
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

