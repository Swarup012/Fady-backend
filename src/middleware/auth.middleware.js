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
      current_org_id: profile.current_organization_id
    });

    // Get organization role and job_role from organization_members table
    let membership = null;
    
    if (profile.current_organization_id) {
      // Try to get membership for current org
      const { data: currentMembership, error: membershipError } = await supabaseAdmin
        .from('organization_members')
        .select('role, job_role, organization_id')
        .eq('user_id', profile.id)
        .eq('organization_id', profile.current_organization_id)
        .single();
      
      console.log('🔍 Middleware - Membership query for current org:', {
        found: !!currentMembership,
        role: currentMembership?.role,
        job_role: currentMembership?.job_role,
        error: membershipError?.message
      });
      
      membership = currentMembership;
    }
    
    // Fallback: If no current_organization_id or membership not found, get first organization
    if (!membership) {
      console.log('⚠️ Middleware - No current org, searching for any membership...');
      const { data: anyMembership } = await supabaseAdmin
        .from('organization_members')
        .select('role, job_role, organization_id')
        .eq('user_id', profile.id)
        .limit(1)
        .single();
      
      if (anyMembership) {
        membership = anyMembership;
        // Update current_organization_id in users table
        await supabaseAdmin
          .from('users')
          .update({ current_organization_id: anyMembership.organization_id })
          .eq('id', profile.id);
        
        profile.current_organization_id = anyMembership.organization_id;
        console.log('✅ Middleware - Auto-set current_organization_id to:', anyMembership.organization_id);
      }
    }
    
    if (membership) {
      // Set organization context from membership
      profile.organization_role = membership.role;
      profile.job_role = membership.job_role;
      profile.organization_id = membership.organization_id;
      console.log('✅ Middleware - Final org context:', {
        organization_id: membership.organization_id,
        organization_role: membership.role,
        job_role: membership.job_role
      });
    } else {
      console.log('❌ Middleware - No membership found for user');
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
// Checks organization_role (owner/admin/member) from organization_members table
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return ResponseUtil.error(res, 'Not authenticated', 401);
    }

    // Check organization_role instead of global role (which doesn't exist anymore)
    const userRole = req.user.organization_role;
    
    if (!userRole) {
      console.log('❌ Authorize: No organization_role found for user');
      return ResponseUtil.error(res, 'No organization membership found', 403);
    }

    // Flatten roles array in case an array is passed (e.g., authorize(['admin', 'owner']))
    const allowedRoles = roles.flat();

    if (!allowedRoles.includes(userRole)) {
      console.log(`❌ Authorize: User role ${userRole} not in allowed roles:`, allowedRoles);
      return ResponseUtil.error(res, 'Insufficient permissions', 403);
    }

    console.log(`✅ Authorize: User role ${userRole} authorized`);
    next();
  };
};

module.exports = { authenticate, authorize };
