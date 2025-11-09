const { supabase, supabaseAdmin } = require('../config/supabase.config');
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

    // Get user profile from database (use supabaseAdmin to bypass RLS)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return ResponseUtil.error(res, 'User profile not found', 404);
    }

    console.log('🔍 Middleware - User profile:', {
      email: profile.email,
      old_org_role: profile.organization_role,
      current_org_id: profile.current_organization_id
    });

    // Get organization role from organization_members table
    if (profile.current_organization_id) {
      const { data: membership, error: membershipError } = await supabaseAdmin
        .from('organization_members')
        .select('role, organization_id')
        .eq('user_id', profile.id)
        .eq('organization_id', profile.current_organization_id)
        .single();
      
      console.log('🔍 Middleware - Membership query:', {
        found: !!membership,
        role: membership?.role,
        error: membershipError?.message
      });
      
      if (membership) {
        // Override with current organization role from organization_members
        profile.organization_role = membership.role;
        profile.organization_id = membership.organization_id;
        console.log('✅ Middleware - Updated org_role to:', membership.role);
      } else {
        console.log('❌ Middleware - No membership found, keeping old role:', profile.organization_role);
      }
    }
    
    console.log('📤 Middleware - Final profile.organization_role:', profile.organization_role);

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
