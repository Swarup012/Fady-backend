// src/middleware/tracking.middleware.js

/**
 * =====================================================
 * TRACKING MIDDLEWARE
 * =====================================================
 * Purpose: Intercept user actions and trigger tracking
 * 
 * Key Features:
 * - Non-blocking (fire-and-forget)
 * - Extracts user identifier from request
 * - Tracks posts, votes, comments
 * - Handles team member submissions on behalf of customers
 * =====================================================
 */

const trackedUsersService = require('../services/tracked-users.service');

/**
 * =====================================================
 * EXTRACT USER IDENTIFIER
 * =====================================================
 * Get email or user_id from authenticated request
 */
function extractUserIdentifier(req) {
  // Priority order:
  // 1. Email (if available)
  // 2. User ID
  // 3. Custom identifier
  
  if (req.user?.email) {
    return {
      identifier: req.user.email,
      details: {
        name: req.user.name,
        email: req.user.email
      }
    };
  }
  
  if (req.user?.id) {
    return {
      identifier: req.user.id,
      details: {
        name: req.user.name
      }
    };
  }
  
  return null;
}

/**
 * =====================================================
 * EXTRACT ORGANIZATION ID
 * =====================================================
 */
async function extractOrganizationId(req) {
  // 🎯 For post-related tracking, ALWAYS get organization from the post
  // (not from user's current_organization_id, since they might be viewing a different org)
  if (req.params?.id) {
    try {
      const { supabaseAdmin } = require('../config/supabase.config');
      const { data: post } = await supabaseAdmin
        .from('posts')
        .select('board_id, boards!inner(organization_id)')
        .eq('id', req.params.id)
        .single();
      
      if (post && post.boards) {
        const orgId = post.boards.organization_id;
        console.log(`📊 Extracted organization from post: ${orgId}`);
        return orgId;
      }
    } catch (error) {
      console.error('Error extracting organization from post:', error);
    }
  }
  
  // Fallback: try to get from user context (for organization members)
  const orgId = req.user?.current_organization_id || 
                req.organization?.id || 
                req.params?.organizationId ||
                req.body?.organization_id;
  
  return orgId;
}

/**
 * =====================================================
 * TRACK USER (Non-Blocking)
 * =====================================================
 * Fire-and-forget pattern - don't wait for tracking
 * Only tracks external users, skips internal team members
 */
async function trackUserAction(organizationId, userIdentifier, actionType, userDetails, userId = null) {
  console.log(`🎯 trackUserAction called:`, { organizationId, userIdentifier, actionType, userId });
  
  // Don't await - continue immediately
  (async () => {
    try {
      // Check if user is internal team member (skip tracking if true)
      if (userId) {
        console.log(`🎯 Checking if userId ${userId} is internal to org ${organizationId}`);
        const isInternal = await isInternalTeamMember(userId, organizationId);
        console.log(`🎯 isInternal result: ${isInternal}`);
        if (isInternal) {
          console.log(`⏭️  Skipping tracking for internal team member: ${userIdentifier}`);
          return;
        }
      }
      
      // Track external user
      console.log(`🎯 About to track external user: ${userIdentifier}`);
      await trackedUsersService.trackUser(organizationId, userIdentifier, actionType, userDetails);
      console.log(`✅ Tracked user: ${userIdentifier} [${actionType}]`);
    } catch (err) {
      console.error(`❌ Tracking error [${actionType}]:`, err.message);
      // TODO: Log to error tracking service (Sentry, etc.)
    }
  })();
}

/**
 * =====================================================
 * MIDDLEWARE: Track Post Creation
 * =====================================================
 * Use AFTER post is created successfully
 */
const trackPostCreation = (req, res, next) => {
  // Store original methods
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Function to perform tracking
  const performTracking = async () => {
    console.log('📊 trackPostCreation: Attempting to track post creation', {
      statusCode: res.statusCode,
      hasUser: !!req.user,
      userId: req.user?.id,
    });
    
    // Only track on successful post creation (status 200 or 201)
    if (res.statusCode === 200 || res.statusCode === 201) {
      const organizationId = await extractOrganizationId(req);
      const userInfo = extractUserIdentifier(req);
      const userId = req.user?.id;
      
      console.log('📊 Tracking data:', {
        organizationId,
        userIdentifier: userInfo?.identifier,
        userDetails: userInfo?.details,
        userId
      });
      
      // Check if submitted on behalf of customer
      const onBehalfOfEmail = req.body?.customer_email || req.body?.on_behalf_of;
      
      if (onBehalfOfEmail) {
        // Track the customer, not the team member (external user, no userId)
        console.log('📊 Tracking on behalf of:', onBehalfOfEmail);
        trackUserAction(organizationId, onBehalfOfEmail, 'create_post', {
          email: onBehalfOfEmail,
          via: 'team_member'
        }, null); // No userId = external user
      } else if (userInfo && organizationId) {
        // Check if internal team member
        console.log('📊 Checking if user is internal team member...');
        trackUserAction(organizationId, userInfo.identifier, 'create_post', userInfo.details, userId);
      } else {
        console.log('⚠️ Cannot track: missing user info or organization ID');
      }
    }
  };
  
  // Override both send and json methods
  res.send = function(data) {
    performTracking();
    return originalSend.call(this, data);
  };
  
  res.json = function(data) {
    performTracking();
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * =====================================================
 * MIDDLEWARE: Track Vote
 * =====================================================
 */
const trackVote = (req, res, next) => {
  console.log('📊 trackVote middleware called');
  const originalSend = res.send;
  const originalJson = res.json;
  
  const performTracking = async () => {
    console.log('📊 performTracking called, statusCode:', res.statusCode);
    console.log('📊 req.user:', {
      id: req.user?.id,
      email: req.user?.email,
      organization_role: req.user?.organization_role,
      current_organization_id: req.user?.current_organization_id
    });
    
    if (res.statusCode === 200 || res.statusCode === 201) {
      const organizationId = await extractOrganizationId(req);
      const userInfo = extractUserIdentifier(req);
      const userId = req.user?.id;
      
      console.log('📊 Tracking data:', { organizationId, userIdentifier: userInfo?.identifier, userId });
      
      if (userInfo && organizationId) {
        trackUserAction(organizationId, userInfo.identifier, 'vote', userInfo.details, userId);
      } else {
        console.log('⚠️ Cannot track: missing data', { hasUserInfo: !!userInfo, hasOrgId: !!organizationId });
      }
    }
  };
  
  res.send = function(data) {
    console.log('📊 res.send intercepted');
    performTracking();
    return originalSend.call(this, data);
  };
  
  res.json = function(data) {
    console.log('📊 res.json intercepted');
    performTracking();
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * =====================================================
 * MIDDLEWARE: Track Comment
 * =====================================================
 */
const trackComment = (req, res, next) => {
  const originalSend = res.send;
  const originalJson = res.json;
  
  const performTracking = async () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      const organizationId = await extractOrganizationId(req);
      const userInfo = extractUserIdentifier(req);
      const userId = req.user?.id;
      
      // Check if commenting on behalf of customer
      const onBehalfOfEmail = req.body?.customer_email || req.body?.on_behalf_of;
      
      if (onBehalfOfEmail) {
        trackUserAction(organizationId, onBehalfOfEmail, 'comment', {
          email: onBehalfOfEmail,
          via: 'team_member'
        }, null); // External user
      } else if (userInfo && organizationId) {
        trackUserAction(organizationId, userInfo.identifier, 'comment', userInfo.details, userId);
      }
    }
  };
  
  res.send = function(data) {
    performTracking();
    return originalSend.call(this, data);
  };
  
  res.json = function(data) {
    performTracking();
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * =====================================================
 * ALTERNATIVE: Direct Tracking (Use in Controllers)
 * =====================================================
 * If you prefer to track directly in controllers instead of middleware
 */
const trackUserDirectly = async (organizationId, userIdentifier, actionType, userDetails = {}) => {
  try {
    // Non-blocking
    trackUserAction(organizationId, userIdentifier, actionType, userDetails);
    return { success: true };
  } catch (error) {
    console.error('Direct tracking error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * =====================================================
 * HELPER: Check if User is Internal Team Member
 * =====================================================
 * Don't track internal team members (they're already in users table)
 */
async function isInternalTeamMember(userId, organizationId) {
  try {
    // Check if user is a team member of this organization
    const { supabaseAdmin } = require('../config/supabase.config');
    
    console.log(`🔍 Checking if user ${userId} is internal team member of org ${organizationId}`);
    
    const { data, error } = await supabaseAdmin
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .single();
    
    console.log(`🔍 organization_members query result:`, { data, error: error?.message });
    
    if (error) {
      console.log(`🔍 No membership found (error), checking if user OWNS this org...`);
      
      // Also check if user owns the organization
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('owner_id')
        .eq('id', organizationId)
        .single();
      
      console.log(`🔍 Organization owner check:`, { owner_id: org?.owner_id, userId, isOwner: org?.owner_id === userId });
      
      if (org && org.owner_id === userId) {
        console.log(`🔍 User IS the owner! Skipping tracking.`);
        return true;
      }
      
      return false;
    }
    
    // Team members are those with 'owner', 'admin', or 'member' roles
    const isTeamMember = data && ['owner', 'admin', 'member'].includes(data.role);
    console.log(`🔍 Is team member: ${isTeamMember}`);
    return isTeamMember;
  } catch (error) {
    console.log(`🔍 Error in isInternalTeamMember:`, error.message);
    return false;
  }
}

/**
 * =====================================================
 * SMART TRACKING MIDDLEWARE (Advanced)
 * =====================================================
 * Only tracks external users, skips internal team
 */
const smartTrackAction = (actionType) => {
  return (req, res, next) => {
    const originalSend = res.send;
    
    res.send = async function(data) {
      if (res.statusCode === 200 || res.statusCode === 201) {
        const organizationId = extractOrganizationId(req);
        const userInfo = extractUserIdentifier(req);
        
        if (userInfo && organizationId) {
          // Check if internal team member
          const isInternal = await isInternalTeamMember(req.user?.id, organizationId);
          
          if (!isInternal) {
            // External user - track them
            trackUserAction(organizationId, userInfo.identifier, actionType, userInfo.details);
          } else {
            console.log(`Skipping tracking for internal team member: ${userInfo.identifier}`);
          }
        }
      }
      
      originalSend.call(this, data);
    };
    
    next();
  };
};

module.exports = {
  trackPostCreation,
  trackVote,
  trackComment,
  trackUserDirectly,
  smartTrackAction,
  extractUserIdentifier,
  extractOrganizationId
};
