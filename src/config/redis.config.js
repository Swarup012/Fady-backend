const Redis = require("ioredis");
const { Redis: UpstashRedis } = require("@upstash/redis");

const REDIS_ENV = process.env.REDIS_ENV || "development"; // development, staging, production

let redisClient = null;

/**
 * Initialize Redis client based on environment
 */
function initializeRedis() {
  if (redisClient) {
    return redisClient;
  }

  try {
    if (REDIS_ENV === "development") {
      // Use local Docker Redis (ioredis)
      console.log("🔴 Initializing Redis: Docker (local)");
      
      redisClient = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD || undefined,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      redisClient.on("connect", () => {
        console.log("✅ Redis Docker connected successfully");
      });

      redisClient.on("error", (err) => {
        console.error("❌ Redis Docker error:", err.message);
      });

      redisClient.on("ready", () => {
        console.log("🚀 Redis Docker ready to accept commands");
      });

    } else {
      // Use Upstash Redis (staging/production)
      console.log("🔴 Initializing Redis: Upstash (cloud)");
      
      if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new Error("Upstash credentials not found. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
      }

      redisClient = new UpstashRedis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });

      console.log("✅ Upstash Redis initialized");
    }

    return redisClient;
  } catch (error) {
    console.error("❌ Failed to initialize Redis:", error.message);
    console.warn("⚠️  Continuing without Redis cache");
    return null;
  }
}

/**
 * Get Redis client instance
 */
function getRedisClient() {
  if (!redisClient) {
    return initializeRedis();
  }
  return redisClient;
}

/**
 * Close Redis connection
 */
async function closeRedis() {
  if (redisClient) {
    if (REDIS_ENV === "development") {
      await redisClient.quit();
    }
    redisClient = null;
    console.log("🔴 Redis connection closed");
  }
}

/**
 * Test Redis connection
 */
async function testRedisConnection() {
  try {
    const client = getRedisClient();
    if (!client) {
      return false;
    }

    if (REDIS_ENV === "development") {
      const pong = await client.ping();
      return pong === "PONG";
    } else {
      // Upstash test
      await client.set("test:connection", "ok", { ex: 10 });
      const result = await client.get("test:connection");
      return result === "ok";
    }
  } catch (error) {
    console.error("❌ Redis connection test failed:", error.message);
    return false;
  }
}

module.exports = {
  initializeRedis,
  getRedisClient,
  closeRedis,
  testRedisConnection,
  REDIS_ENV,
};
