const { supabase } = require('../config/supabase.config');
const ResponseUtil = require('../utils/response.util');

const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return ResponseUtil.error(res, 'No token provided', 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return ResponseUtil.error(res, 'Invalid or expired token', 401);
    }

    // Get user profile from database
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return ResponseUtil.error(res, 'User profile not found', 404);
    }

    // Attach user and token to request
    req.user = profile;
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return ResponseUtil.error(res, 'Authentication failed', 401);
  }
};

// Optional: Role-based middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return ResponseUtil.error(res, 'Not authenticated', 401);
    }

    if (!roles.includes(req.user.role)) {
      return ResponseUtil.error(res, 'Insufficient permissions', 403);
    }

    next();
  };
};

module.exports = { authenticate, authorize };
