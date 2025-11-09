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

      // Get user's organization role
      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('organization_role')
        .eq('id', userId)
        .eq('organization_id', organizationId)
        .single();

      if (error || !user) {
        console.error('❌ User not found in organization:', error);
        return res.status(403).json({
          success: false,
          error: 'User not member of this organization'
        });
      }

      const userRole = user.organization_role;
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

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('organization_role')
      .eq('id', userId)
      .eq('organization_id', organizationId)
      .single();

    req.organizationRole = user?.organization_role || null;
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
