const ResponseUtil = require('../utils/response.util');

// Simple in-memory rate limiter using Map
const rateLimitMap = new Map();

/**
 * Creates a rate limiter middleware
 * @param {number} maxRequests - Max requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 */
const createRateLimiter = (maxRequests = 30, windowMs = 60000) => {
  return (req, res, next) => {
    // Get IP address, fallback to a dummy if undefined
    const ip = req.ip || req.connection.remoteAddress || 'unknown-ip';
    const now = Date.now();
    
    // Clean up expired entries (simple garbage collection on each request)
    // In a production app with high traffic, a better approach (like Redis) is recommended,
    // but this is perfect for an MVP.
    for (const [key, value] of rateLimitMap.entries()) {
      if (now > value.resetTime) {
        rateLimitMap.delete(key);
      }
    }

    let record = rateLimitMap.get(ip);
    
    if (!record || now > record.resetTime) {
      // First request or window expired, reset
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitMap.set(ip, record);
      return next();
    }
    
    // Increment count
    record.count++;
    
    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return ResponseUtil.error(res, 'Too many requests, please try again later.', 429);
    }
    
    // Continue
    next();
  };
};

module.exports = { createRateLimiter };
