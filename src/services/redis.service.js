const { getRedisClient, REDIS_ENV } = require("../config/redis.config");

/**
 * Cache Service
 * Provides caching operations with support for both ioredis (Docker) and Upstash
 */
class CacheService {
  constructor() {
    this.enabled = true;
  }

  /**
   * Get value from cache
   */
  async get(key) {
    if (!this.enabled) return null;

    try {
      const client = getRedisClient();
      if (!client) return null;

      const value = await client.get(key);
      
      if (value) {
        console.log(`✅ Cache HIT: ${key}`);
        // Parse JSON if it's a stringified object
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      } else {
        console.log(`❌ Cache MISS: ${key}`);
        return null;
      }
    } catch (error) {
      console.error(`❌ Cache GET error for ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Set value in cache with optional TTL (in seconds)
   */
  async set(key, value, ttlSeconds = 3600) {
    if (!this.enabled) return false;

    try {
      const client = getRedisClient();
      if (!client) return false;

      // Stringify objects/arrays
      const stringValue = typeof value === "string" ? value : JSON.stringify(value);

      if (REDIS_ENV === "development") {
        // ioredis syntax
        await client.set(key, stringValue, "EX", ttlSeconds);
      } else {
        // Upstash syntax
        await client.set(key, stringValue, { ex: ttlSeconds });
      }

      console.log(`✅ Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
      return true;
    } catch (error) {
      console.error(`❌ Cache SET error for ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Delete specific key(s) from cache
   */
  async delete(...keys) {
    if (!this.enabled || keys.length === 0) return false;

    try {
      const client = getRedisClient();
      if (!client) return false;

      await client.del(...keys);
      console.log(`🗑️  Cache DELETE: ${keys.join(", ")}`);
      return true;
    } catch (error) {
      console.error(`❌ Cache DELETE error:`, error.message);
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern (e.g., "boards:*")
   */
  async deletePattern(pattern) {
    if (!this.enabled) return false;

    try {
      const client = getRedisClient();
      if (!client) return false;

      if (REDIS_ENV === "development") {
        // ioredis: use SCAN for safe deletion
        const stream = client.scanStream({
          match: pattern,
          count: 100,
        });

        const keysToDelete = [];
        
        stream.on("data", (keys) => {
          if (keys.length) {
            keysToDelete.push(...keys);
          }
        });

        await new Promise((resolve, reject) => {
          stream.on("end", resolve);
          stream.on("error", reject);
        });

        if (keysToDelete.length > 0) {
          await client.del(...keysToDelete);
          console.log(`🗑️  Cache DELETE pattern "${pattern}": ${keysToDelete.length} keys`);
        }
      } else {
        // Upstash: SCAN not available on REST API, use KEYS (safe for small datasets)
        const keys = await client.keys(pattern);
        if (keys && keys.length > 0) {
          await client.del(...keys);
          console.log(`🗑️  Cache DELETE pattern "${pattern}": ${keys.length} keys`);
        }
      }

      return true;
    } catch (error) {
      console.error(`❌ Cache DELETE pattern error for ${pattern}:`, error.message);
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!this.enabled) return false;

    try {
      const client = getRedisClient();
      if (!client) return false;

      const exists = await client.exists(key);
      return exists === 1;
    } catch (error) {
      console.error(`❌ Cache EXISTS error for ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Get remaining TTL for a key (in seconds)
   */
  async ttl(key) {
    if (!this.enabled) return -1;

    try {
      const client = getRedisClient();
      if (!client) return -1;

      return await client.ttl(key);
    } catch (error) {
      console.error(`❌ Cache TTL error for ${key}:`, error.message);
      return -1;
    }
  }

  /**
   * Increment a counter
   */
  async increment(key, amount = 1) {
    if (!this.enabled) return null;

    try {
      const client = getRedisClient();
      if (!client) return null;

      if (amount === 1) {
        return await client.incr(key);
      } else {
        return await client.incrby(key, amount);
      }
    } catch (error) {
      console.error(`❌ Cache INCREMENT error for ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Set multiple fields in a hash
   */
  async hset(key, field, value) {
    if (!this.enabled) return false;

    try {
      const client = getRedisClient();
      if (!client) return false;

      const stringValue = typeof value === "string" ? value : JSON.stringify(value);
      await client.hset(key, field, stringValue);
      console.log(`✅ Cache HSET: ${key}.${field}`);
      return true;
    } catch (error) {
      console.error(`❌ Cache HSET error for ${key}:`, error.message);
      return false;
    }
  }

  /**
   * Get field from hash
   */
  async hget(key, field) {
    if (!this.enabled) return null;

    try {
      const client = getRedisClient();
      if (!client) return null;

      const value = await client.hget(key, field);
      
      if (value) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return null;
    } catch (error) {
      console.error(`❌ Cache HGET error for ${key}.${field}:`, error.message);
      return null;
    }
  }

  /**
   * Get all fields from hash
   */
  async hgetall(key) {
    if (!this.enabled) return null;

    try {
      const client = getRedisClient();
      if (!client) return null;

      const data = await client.hgetall(key);
      
      if (data && Object.keys(data).length > 0) {
        // Parse JSON values
        const parsed = {};
        for (const [field, value] of Object.entries(data)) {
          try {
            parsed[field] = JSON.parse(value);
          } catch {
            parsed[field] = value;
          }
        }
        return parsed;
      }
      return null;
    } catch (error) {
      console.error(`❌ Cache HGETALL error for ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Disable cache (useful for testing)
   */
  disable() {
    this.enabled = false;
    console.log("⚠️  Cache disabled");
  }

  /**
   * Enable cache
   */
  enable() {
    this.enabled = true;
    console.log("✅ Cache enabled");
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    try {
      const client = getRedisClient();
      if (!client) return null;

      if (REDIS_ENV === "development") {
        const info = await client.info("stats");
        return info;
      } else {
        // Upstash doesn't support INFO command via REST
        return { message: "Stats not available on Upstash REST API" };
      }
    } catch (error) {
      console.error("❌ Cache STATS error:", error.message);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new CacheService();
