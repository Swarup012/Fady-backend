/**
 * Organization Role Authorization Middleware
 * Canny-style per-organization permission checks
 */

const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Check if user has specific organization role
 * @param {Array<string>} allowedRoles - Array of allowed roles (e.g., ['owner', 'admin'])
 */
const authorizeOrgRole = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const organizationId = req.organization?.id;

      if (!userId) {
        console.error('❌ No user in request');
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      if (!organizationId) {
        console.error('❌ No organization in request');
        return res.status(400).json({
          success: false,
          error: 'Organization context required'
        });
      }

      // Get user's organization role from organization_members table
      console.log('🔍 Checking organization_members table...');
      console.log('   - Query: user_id =', userId);
      console.log('   - Query: organization_id =', organizationId);
      
      const { data: membership, error } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .single();

      console.log('   - Membership found:', membership);
      console.log('   - Error:', error);

      if (error || !membership) {
        console.error('❌ User not found in organization:', error);
        return res.status(403).json({
          success: false,
          error: 'User not member of this organization'
        });
      }

      const userRole = membership.role;
      console.log('   - User role:', userRole);
      console.log(`🔐 Checking org role: user=${userRole}, allowed=${allowedRoles.join(',')}`);

      // Check if user has required role
      if (!allowedRoles.includes(userRole)) {
        console.log(`❌ Access denied: ${userRole} not in [${allowedRoles.join(', ')}]`);
        return res.status(403).json({
          success: false,
          error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
          userRole: userRole
        });
      }

      console.log(`✅ Organization role authorized: ${userRole}`);
      req.organizationRole = userRole; // Attach role to request
      next();
    } catch (error) {
      console.error('❌ Organization role check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Authorization check failed'
      });
    }
  };
};

/**
 * Check if user is organization owner
 */
const requireOwner = authorizeOrgRole(['owner']);

/**
 * Check if user is admin or owner
 */
const requireAdmin = authorizeOrgRole(['owner', 'admin']);

/**
 * Check if user is member (any role)
 */
const requireMember = authorizeOrgRole(['owner', 'admin', 'member']);

/**
 * Utility to check organization role without blocking request
 * Attaches role to req.organizationRole
 */
const attachOrgRole = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const organizationId = req.organization?.id;

    if (!userId || !organizationId) {
      req.organizationRole = null;
      return next();
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .single();

    if (membershipError) {
      console.error('❌ Error fetching organization role:', membershipError);
    }

    req.organizationRole = membership?.role || null;
    console.log('✅ injectOrganizationRole - Set req.organizationRole:', req.organizationRole);
    next();
  } catch (error) {
    console.error('❌ Attach org role error:', error);
    req.organizationRole = null;
    next();
  }
};

module.exports = {
  authorizeOrgRole,
  requireOwner,
  requireAdmin,
  requireMember,
  attachOrgRole
};
