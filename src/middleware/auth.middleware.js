const { supabase, supabaseAdmin } = require('../config/supabase.config');
const ResponseUtil = require('../utils/response.util');
const cache = require('../services/redis.service');

const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header OR from cookies (for cross-subdomain auth)
    const authHeader = req.headers.authorization;
    let token;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    } else if (req.cookies && req.cookies.access_token) {
      // Fallback to cookie if no Authorization header
      token = req.cookies.access_token;
    }
    
    if (!token) {
      return ResponseUtil.error(res, 'No token provided', 401);
    }

    // 🔴 CACHE: Try to get user session from cache first
    // Create cache key from FULL token hash (not just first 32 chars - they're identical for all Supabase JWTs!)
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 32);
    const sessionCacheKey = `user:session:${tokenHash}`;
    
    // 🐛 DEBUG: Log token info
    console.log('🔑 DEBUG - Auth Middleware:', {
      tokenHash: tokenHash,
      cacheKey: sessionCacheKey,
      fullToken: token.substring(0, 50) + '...',
    });
    
    // 🔧 DISABLED: Cache temporarily disabled to fix stale org data after invite acceptance
    const cachedSession = null; // await cache.get(sessionCacheKey);
    if (cachedSession) {
      console.log(`🔴 Session cache HIT for user: ${cachedSession.email}`);
      console.log('🐛 DEBUG - Cached Session:', {
        email: cachedSession.email,
        userId: cachedSession.id,
        orgRole: cachedSession.organization_role,
      });
      req.user = cachedSession;
      req.token = token;
      return next();
    }

    console.log(`❌ Session cache MISS - fetching from database`);

    let userId;
    
    // Try to verify as Supabase token first
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      // If Supabase verification fails, try to verify as custom JWT (from Google OAuth)
      console.log('⚠️ Supabase token verification failed, trying custom JWT...');
      
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        userId = decoded.userId;
        console.log('✅ Custom JWT verified for user:', userId);
      } catch (jwtError) {
        console.error('❌ Custom JWT verification failed:', jwtError.message);
        return ResponseUtil.error(res, 'Invalid or expired token', 401);
      }
    } else {
      userId = user.id;
      console.log('✅ Supabase token verified for user:', userId);
    }

    // Get user profile from database (use supabaseAdmin to bypass RLS)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
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

    // 🔴 CACHE: Store user session in cache (TTL: 30 minutes = 1800 seconds)
    await cache.set(sessionCacheKey, profile, 1800);
    console.log(`✅ Session cached for user: ${profile.email}`);
    console.log('🐛 DEBUG - Caching Session:', {
      email: profile.email,
      userId: profile.id,
      tokenHash: tokenHash,
      cacheKey: sessionCacheKey,
      orgRole: profile.organization_role,
    });

    // Attach user and token to request
    req.user = profile;
    req.token = token;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return ResponseUtil.error(res, 'Authentication failed', 401);
  }
};

// Optional authentication - doesn't fail if no token, just sets req.user if available
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without user
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    
    // 🔴 CACHE: Try to get user session from cache first
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 32);
    const sessionCacheKey = `user:session:${tokenHash}`;
    
    console.log('🔑 DEBUG - Optional Auth:', { tokenHash, cacheKey: sessionCacheKey });
    
    const cachedSession = await cache.get(sessionCacheKey);
    if (cachedSession) {
      console.log(`🔴 Optional session cache HIT for user: ${cachedSession.email}`);
      console.log('🐛 DEBUG - Optional Cached User:', { email: cachedSession.email, userId: cachedSession.id });
      req.user = cachedSession;
      req.token = token;
      return next();
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      // Invalid token, continue without user
      req.user = null;
      return next();
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile) {
      req.user = null;
      return next();
    }

    // Get organization membership
    if (profile.current_organization_id) {
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select('role, job_role, organization_id')
        .eq('user_id', profile.id)
        .eq('organization_id', profile.current_organization_id)
        .single();
      
      if (membership) {
        profile.organization_role = membership.role;
        profile.job_role = membership.job_role;
        profile.organization_id = membership.organization_id;
      }
    }

    // 🔴 CACHE: Store user session in cache (TTL: 30 minutes)
    await cache.set(sessionCacheKey, profile, 1800);
    console.log(`✅ Optional session cached for user: ${profile.email}`);

    req.user = profile;
    req.token = token;
    next();
  } catch (error) {
    console.error('Optional authentication error:', error);
    req.user = null;
    next();
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

/**
 * Optional authentication middleware
 * Authenticates user if token is present, but doesn't fail if not
 * Useful for hybrid endpoints that work for both authenticated and unauthenticated users
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      // No token provided, continue as unauthenticated
      req.user = null;
      return next();
    }

    // Verify token
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      // Invalid token, continue as unauthenticated
      req.user = null;
      return next();
    }

    // Valid token, attach user
    req.user = user;
    next();
  } catch (error) {
    // Any error, continue as unauthenticated
    req.user = null;
    next();
  }
};

module.exports = { authenticate, optionalAuthenticate, authorize, optionalAuth };
