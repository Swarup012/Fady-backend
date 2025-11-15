const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Middleware to inject organization context from subdomain
 * Must be used AFTER authenticate middleware
 * 
 * How it works:
 * 1. Extract subdomain from x-subdomain header (set by Next.js middleware)
 * 2. Load organization by subdomain
 * 3. Verify user belongs to this organization (if authenticated)
 * 4. Attach organization to req.organization
 * 
 * IMPORTANT: This middleware is OPTIONAL - it tries to inject organization context
 * but doesn't fail if no subdomain or organization is found. Routes can use
 * requireOrganization() middleware if organization context is mandatory.
 */
const injectOrganization = async (req, res, next) => {
  try {
    // Extract subdomain from headers (set by Next.js middleware)
    const subdomain = req.headers['x-subdomain'];
    
    if (subdomain) {
      console.log(`🔍 Organization middleware - Subdomain from header: ${subdomain}`);
    }

    // CASE 1: Subdomain provided - load organization by subdomain
    if (subdomain) {
      const { data: organization, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('*')
        .eq('subdomain', subdomain)
        .single();

      if (orgError || !organization) {
        console.warn(`⚠️ Organization not found for subdomain: ${subdomain}`);
        req.organization = null;
        return next(); // Continue without org context instead of failing
      }

      // If user is authenticated, verify they belong to this organization
      if (req.user) {
        const { data: membership, error: memberError } = await supabaseAdmin
          .from('organization_members')
          .select('role')
          .eq('user_id', req.user.id)
          .eq('organization_id', organization.id)
          .single();

        if (memberError || !membership) {
          console.warn(`⚠️ User ${req.user.email} tried to access ${organization.name} but is not a member`);
          
          // Instead of blocking, fall back to user's current organization
          console.log(`🔄 Falling back to user's current organization...`);
          const { data: user } = await supabaseAdmin
            .from('users')
            .select('current_organization_id')
            .eq('id', req.user.id)
            .single();

          if (user?.current_organization_id) {
            const { data: currentOrg } = await supabaseAdmin
              .from('organizations')
              .select('*')
              .eq('id', user.current_organization_id)
              .single();

            if (currentOrg) {
              const { data: currentMembership } = await supabaseAdmin
                .from('organization_members')
                .select('role')
                .eq('user_id', req.user.id)
                .eq('organization_id', currentOrg.id)
                .single();

              req.organization = currentOrg;
              req.organizationRole = currentMembership?.role;
              console.log(`✅ Using user's current org: ${currentOrg.name} as ${currentMembership?.role}`);
              return next();
            }
          }

          // If no fallback available, return error
          return res.status(403).json({
            success: false,
            error: 'You do not have access to this organization',
            message: 'You are not a member of this organization'
          });
        }

        req.organizationRole = membership.role;
        console.log(`✅ User ${req.user.email} accessing ${organization.name} as ${membership.role}`);
      }

      req.organization = organization;
      console.log(`✅ Organization context: ${organization.name} (${organization.subdomain})`);
      return next();
    }

    // CASE 2: No subdomain - try to load user's current organization
    if (!subdomain && req.user) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('current_organization_id')
        .eq('id', req.user.id)
        .single();

      if (user?.current_organization_id) {
        const { data: organization } = await supabaseAdmin
          .from('organizations')
          .select('*')
          .eq('id', user.current_organization_id)
          .single();

        if (organization) {
          // Get user's role in this organization
          const { data: membership } = await supabaseAdmin
            .from('organization_members')
            .select('role')
            .eq('user_id', req.user.id)
            .eq('organization_id', organization.id)
            .single();

          req.organization = organization;
          req.organizationRole = membership?.role;
          console.log(`✅ User ${req.user.email} using current org: ${organization.name} as ${membership?.role}`);
          return next();
        }
      }

      console.log('ℹ️ No subdomain and no current_organization_id, proceeding without organization context');
      req.organization = null;
      return next();
    }

    // CASE 3: No subdomain and no user - proceed without organization
    console.log('ℹ️ No subdomain provided, proceeding without organization context');
    req.organization = null;
    next();

  } catch (error) {
    console.error('❌ Organization middleware error:', error);
    // Don't fail - just proceed without organization context
    req.organization = null;
    next();
  }
};

/**
 * Optional middleware to REQUIRE organization context
 * Use this for routes that MUST have an organization
 */
const requireOrganization = (req, res, next) => {
  if (!req.organization) {
    return res.status(400).json({
      success: false,
      error: 'Organization context required. Please access via subdomain (e.g., acme.fady.com)'
    });
  }
  next();
};

module.exports = { 
  injectOrganization,
  requireOrganization
};
