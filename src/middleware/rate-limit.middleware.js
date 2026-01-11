const { redisClient } = require('../config/redis.config');

/**
 * Rate Limiting Middleware
 * Prevents spam and abuse by limiting requests per IP address
 */

/**
 * Generic rate limiter
 * @param {string} action - Action name (e.g., 'create_post', 'vote', 'comment')
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowSeconds - Time window in seconds
 * @param {string} scope - 'ip' or 'user' (who to track)
 */
function createRateLimiter(action, maxRequests, windowSeconds, scope = 'ip') {
  return async (req, res, next) => {
    try {
      // Get identifier (IP or user ID)
      let identifier;
      if (scope === 'ip') {
        identifier = req.ip || req.connection.remoteAddress || 'unknown';
      } else if (scope === 'user') {
        identifier = req.user?.id || req.ip || 'anonymous';
      }

      const key = `rate_limit:${action}:${scope}:${identifier}`;
      
      // Get current count
      const current = await redisClient.get(key);
      const count = current ? parseInt(current) : 0;

      // Check if limit exceeded
      if (count >= maxRequests) {
        // Get TTL to show when limit resets
        const ttl = await redisClient.ttl(key);
        const resetTime = ttl > 0 ? Math.ceil(ttl / 60) : Math.ceil(windowSeconds / 60);
        
        console.log(`⚠️ Rate limit exceeded for ${action} - ${scope}: ${identifier} (${count}/${maxRequests})`);
        
        return res.status(429).json({
          success: false,
          message: `Too many requests. Please try again in ${resetTime} minute${resetTime > 1 ? 's' : ''}.`,
          error: 'RATE_LIMIT_EXCEEDED',
          limit: maxRequests,
          window: `${windowSeconds / 60} minutes`,
          resetIn: ttl > 0 ? ttl : windowSeconds,
        });
      }

      // Increment counter
      if (count === 0) {
        // First request - set counter with expiry
        await redisClient.setex(key, windowSeconds, 1);
      } else {
        // Increment existing counter
        await redisClient.incr(key);
      }

      // Add rate limit info to response headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count - 1));
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + windowSeconds);

      console.log(`✅ Rate limit OK for ${action} - ${scope}: ${identifier} (${count + 1}/${maxRequests})`);
      next();
    } catch (error) {
      console.error('❌ Rate limit error:', error);
      // On error, allow request (fail open)
      next();
    }
  };
}

/**
 * Rate limiters for different actions
 */

// Post creation rate limit
// External users: 10 posts per hour per IP
// Authenticated users: 20 posts per hour per user
const rateLimitPostCreation = async (req, res, next) => {
  try {
    const isExternalUser = !req.user?.organization_id;
    
    if (isExternalUser) {
      // External user - strict IP-based limit
      return createRateLimiter('create_post', 10, 3600, 'ip')(req, res, next);
    } else {
      // Organization member - more lenient user-based limit
      return createRateLimiter('create_post', 20, 3600, 'user')(req, res, next);
    }
  } catch (error) {
    console.error('❌ Post rate limit error:', error);
    next();
  }
};

// Comment creation rate limit
// 30 comments per hour per user/IP
const rateLimitCommentCreation = createRateLimiter('create_comment', 30, 3600, 'user');

// Vote rate limit
// 100 votes per hour per user/IP
const rateLimitVote = createRateLimiter('vote', 100, 3600, 'user');

// Login attempts rate limit
// 10 login attempts per 15 minutes per IP (prevent brute force)
const rateLimitLogin = createRateLimiter('login', 10, 900, 'ip');

// API general rate limit
// 1000 requests per hour per IP (very generous, catches abuse)
const rateLimitAPI = createRateLimiter('api', 1000, 3600, 'ip');

module.exports = {
  createRateLimiter,
  rateLimitPostCreation,
  rateLimitCommentCreation,
  rateLimitVote,
  rateLimitLogin,
  rateLimitAPI,
};
