// src/middleware/plan-limits.middleware.js
const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Plan Limits Configuration
 * 
 * Free Plan: $0/month - Basic features for small teams
 * Starter Plan: $19/month or $180/year - Professional features with overage billing
 */
const PLAN_LIMITS = {
  free: {
    max_boards: 3,
    max_posts_per_board: 5, // 5 posts per board
    max_posts_per_month: 15, // 3 boards * 5 posts = 15 total (fallback)
    max_team_members: 3, // 3 team members total (including owner)
    max_tracked_users: 20, // 20 tracked users (voters/commenters) - HARD LIMIT
    max_roadmap_items: 1, // 1 roadmap
    overage_allowed: false, // No overage billing
  },
  starter: {
    max_boards: Infinity, // Unlimited
    max_posts_per_board: Infinity, // Unlimited
    max_posts_per_month: Infinity, // Unlimited
    max_team_members: 5, // 5 team members
    max_tracked_users: 125, // 125 tracked users included
    max_roadmap_items: 1, // 1 roadmap
    overage_allowed: true, // Can exceed 125 with $6/50 users billing
    grace_buffer: 25, // 20% grace (don't charge until 150 users)
    overage_price_per_block: 6.00, // $6 per 50 users
    overage_block_size: 50, // 50 users per block
  },
  // Keep 'pro' as alias for backward compatibility during migration
  pro: {
    max_boards: Infinity,
    max_posts_per_board: Infinity,
    max_posts_per_month: Infinity,
    max_team_members: 5, // 5 team members
    max_tracked_users: 125,
    max_roadmap_items: 1,
    overage_allowed: true,
    grace_buffer: 25,
    overage_price_per_block: 6.00,
    overage_block_size: 50,
  },
};

// Debug: Log plan limits on module load
console.log('🚨 PLAN_LIMITS MODULE LOADED:', {
  free_max_boards: PLAN_LIMITS.free.max_boards,
  starter_max_boards: PLAN_LIMITS.starter.max_boards,
  pro_max_boards: PLAN_LIMITS.pro.max_boards
});

/**
 * Check if organization has an active subscription
 * Returns true if subscription is active or in trial period
 */
async function hasActiveSubscription(organizationId) {
  try {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('subscription_status')
      .eq('id', organizationId)
      .single();

    if (error) {
      console.error('Error checking subscription:', error);
      return false;
    }

    // Active or trialing = Starter plan access
    return org.subscription_status === 'active' || org.subscription_status === 'trialing';
  } catch (error) {
    console.error('Error in hasActiveSubscription:', error);
    return false;
  }
}

/**
 * Get current plan limits for an organization
 * Returns limits based on subscription_plan value (free, starter, pro)
 */
async function getPlanLimits(organizationId) {
  try {
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('subscription_plan, subscription_status')
      .eq('id', organizationId)
      .single();

    if (error) {
      console.error('Error fetching organization plan:', error);
      return PLAN_LIMITS.free;
    }

    // Determine plan based on subscription_plan field
    const plan = org.subscription_plan || 'free';
    
    console.log('🔍 getPlanLimits - Organization data:', { 
      organizationId, 
      subscription_plan: org.subscription_plan,
      subscription_status: org.subscription_status,
      effectivePlan: plan === 'pro' ? 'starter' : plan 
    });
    
    // Map 'pro' to 'starter' for backward compatibility
    const effectivePlan = plan === 'pro' ? 'starter' : plan;
    
    // Verify subscription is active/trialing for paid plans
    if (effectivePlan === 'starter') {
      const isActive = ['active', 'trialing'].includes(org.subscription_status);
      if (!isActive) {
        console.warn(`Organization ${organizationId} has '${plan}' plan but status is '${org.subscription_status}', defaulting to free`);
        return PLAN_LIMITS.free;
      }
    }

    const returnedLimits = PLAN_LIMITS[effectivePlan] || PLAN_LIMITS.free;
    console.log('🔍 getPlanLimits - Returning limits:', {
      effectivePlan,
      max_boards: returnedLimits.max_boards,
      fullLimits: returnedLimits
    });
    return returnedLimits;
  } catch (error) {
    console.error('Error in getPlanLimits:', error);
    return PLAN_LIMITS.free;
  }
}

/**
 * Middleware: Check board creation limit
 */
async function checkBoardLimit(req, res, next) {
  try {
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      // User without organization can create unlimited boards (for now)
      return next();
    }

    // Get plan limits
    const limits = await getPlanLimits(organizationId);

    // If unlimited, skip check
    if (limits.max_boards === Infinity) {
      return next();
    }

    // Count existing boards for this organization
    const { count, error } = await supabaseAdmin
      .from('boards')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if (error) {
      console.error('Error counting boards:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking board limit',
      });
    }

    // Check if limit reached
    if (count >= limits.max_boards) {
      console.log(`🚫 Board limit reached for org ${organizationId}: count=${count}, limit=${limits.max_boards}`);
      return res.status(403).json({
        success: false,
        message: `Board limit reached. Free plan allows ${limits.max_boards} board(s). Upgrade to Starter for unlimited boards.`,
        error: 'BOARD_LIMIT_REACHED',
        upgrade_required: true,
        current_count: count,
        max_allowed: limits.max_boards,
      });
    }

    console.log(`✅ Board limit check passed for org ${organizationId}: count=${count}, limit=${limits.max_boards}`);
    // Limit not reached, proceed
    next();
  } catch (error) {
    console.error('Error in checkBoardLimit middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking board limit',
    });
  }
}

/**
 * Middleware: Check post creation limit (per month)
 */
async function checkPostLimit(req, res, next) {
  try {
    const userId = req.user.id;
    const userOrganizationId = req.user.organization_id;
    
    // Get the board to check if it's public and find its organization
    const boardSlug = req.params.slug;
    if (!boardSlug) {
      return next(); // No board slug, skip check
    }

    const { data: board, error: boardError } = await supabaseAdmin
      .from('boards')
      .select('id, organization_id, is_private')
      .eq('slug', boardSlug)
      .single();

    if (boardError || !board) {
      console.error('❌ Board not found:', boardSlug, boardError?.message);
      return res.status(404).json({
        success: false,
        message: `Board '${boardSlug}' not found`,
        error: 'BOARD_NOT_FOUND',
      });
    }

    const boardOrganizationId = board.organization_id;
    const isPublicBoard = !board.is_private;

    // Check if user is a member of the board's organization
    let isMember = false;
    if (boardOrganizationId && userId) {
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', boardOrganizationId)
        .eq('user_id', userId)
        .single();
      
      isMember = !!membership;
    }

    // Use board's organization for limit checks (even for external users)
    const organizationId = boardOrganizationId || userOrganizationId;

    if (!organizationId) {
      // User without organization can create unlimited posts
      return next();
    }

    // Get plan limits for the board's organization
    const limits = await getPlanLimits(organizationId);

    // If unlimited, skip check
    if (limits.max_posts_per_board === Infinity) {
      console.log(`✅ Unlimited plan - post allowed for ${isMember ? 'member' : 'external user'}: ${userId}`);
      return next();
    }

    // Count posts on THIS specific board
    const { count, error } = await supabaseAdmin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', board.id);

    if (error) {
      console.error('Error counting posts:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking post limit',
      });
    }

    // Check if per-board limit reached
    if (count >= limits.max_posts_per_board) {
      // Get organization name for better error message
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .single();
      
      const orgName = org?.name || 'This board';
      
      return res.status(403).json({
        success: false,
        message: isMember 
          ? `Post limit reached for this board. Free plan allows ${limits.max_posts_per_board} posts per board. Upgrade to Starter for unlimited posts.`
          : `${orgName} has reached the post limit for this board (${limits.max_posts_per_board} posts per board). The organization needs to upgrade to Starter for unlimited feedback submissions.`,
        error: 'POST_LIMIT_REACHED',
        upgrade_required: true,
        current_count: count,
        max_allowed: limits.max_posts_per_board,
        is_external_user: !isMember,
      });
    }

    // Limit not reached, proceed
    console.log(`✅ Post limit OK (${count}/${limits.max_posts_per_board}) - ${isMember ? 'member' : 'external user'}: ${userId}`);
    next();
  } catch (error) {
    console.error('Error in checkPostLimit middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking post limit',
    });
  }
}

/**
 * Get current usage stats for an organization
 */
async function getUsageStats(req, res) {
  try {
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'No organization associated with user',
      });
    }

    // Get plan limits
    const limits = await getPlanLimits(organizationId);
    console.log('🔍 getUsageStats - Plan limits for org:', { organizationId, limits });

    // Count boards
    const { count: boardCount } = await supabaseAdmin
      .from('boards')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    
    console.log('🔍 getUsageStats - Board count:', { boardCount, max_boards: limits.max_boards });

    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get organization members
    const { data: orgMembers } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId);

    const userIds = orgMembers ? orgMembers.map(m => m.user_id) : [];

    // Count total posts across all boards (for backward compatibility)
    const { count: totalPostCount } = await supabaseAdmin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    // Check if has starter subscription
    const hasStarterAccess = await hasActiveSubscription(organizationId);

    return res.json({
      success: true,
      data: {
        plan: hasStarterAccess ? 'starter' : 'free',
        usage: {
          boards: {
            current: boardCount || 0,
            limit: limits.max_boards === Infinity ? 'unlimited' : limits.max_boards,
            remaining: limits.max_boards === Infinity ? 'unlimited' : Math.max(0, limits.max_boards - (boardCount || 0)),
          },
          posts: {
            current: totalPostCount || 0,
            limit: limits.max_posts_per_board === Infinity ? 'unlimited' : limits.max_posts_per_board,
            remaining: limits.max_posts_per_board === Infinity ? 'unlimited' : `${limits.max_posts_per_board} per board`,
            per_board_limit: limits.max_posts_per_board === Infinity ? 'unlimited' : limits.max_posts_per_board,
          },
          team_members: {
            current: userIds.length,
            limit: limits.max_team_members === Infinity ? 'unlimited' : limits.max_team_members,
            remaining: limits.max_team_members === Infinity ? 'unlimited' : Math.max(0, limits.max_team_members - userIds.length),
          },
        },
      },
    });
    
    console.log('🔍 getUsageStats - Final response:', {
      plan: hasStarterAccess ? 'starter' : 'free',
      boardsLimit: limits.max_boards === Infinity ? 'unlimited' : limits.max_boards,
      boardsCurrent: boardCount || 0
    });
  } catch (error) {
    console.error('Error getting usage stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving usage statistics',
    });
  }
}

/**
 * Middleware: Check invitation limit (pending invitations)
 */
async function checkInvitationLimit(req, res, next) {
  try {
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'No organization associated with user',
      });
    }

    // Get plan limits
    const limits = await getPlanLimits(organizationId);

    // If unlimited, skip check
    if (limits.max_team_members === Infinity) {
      return next();
    }

    // Count current members in the organization
    const { count: memberCount, error: memberError } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if (memberError) {
      console.error('Error counting members:', memberError);
      return res.status(500).json({
        success: false,
        message: 'Error checking team member limit',
      });
    }

    // Count pending invitations for this organization
    const { count: pendingInviteCount, error: inviteError } = await supabaseAdmin
      .from('organization_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'pending');

    if (inviteError) {
      console.error('Error counting invitations:', inviteError);
      return res.status(500).json({
        success: false,
        message: 'Error checking invitation limit',
      });
    }

    // Total = current members + pending invitations
    const totalCount = memberCount + pendingInviteCount;

    // Check if limit reached
    if (totalCount >= limits.max_team_members) {
      return res.status(403).json({
        success: false,
        message: `Team member limit reached. Free plan allows ${limits.max_team_members} team member(s). You currently have ${memberCount} member(s) and ${pendingInviteCount} pending invitation(s). Upgrade to Starter for unlimited team members.`,
        error: 'TEAM_MEMBER_LIMIT_REACHED',
        upgrade_required: true,
        current_members: memberCount,
        pending_invitations: pendingInviteCount,
        total_count: totalCount,
        max_allowed: limits.max_team_members,
      });
    }

    console.log(`✅ Team member check passed: ${memberCount} members + ${pendingInviteCount} pending = ${totalCount}/${limits.max_team_members}`);
    
    // Limit not reached, proceed
    next();
  } catch (error) {
    console.error('Error in checkInvitationLimit middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking team member limit',
    });
  }
}

/**
 * Middleware: Check roadmap creation limit (for multi-roadmap feature)
 * Checks the number of roadmaps (not roadmap items)
 */
async function checkRoadmapLimit(req, res, next) {
  try {
    const organizationId = req.user.current_organization_id || req.user.organization_id;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'No organization associated with user',
      });
    }

    // Get plan limits
    const limits = await getPlanLimits(organizationId);

    // If unlimited, skip check
    if (limits.max_roadmap_items === Infinity) {
      return next();
    }

    // Count existing roadmaps (not roadmap_items) for this organization
    const { count, error } = await supabaseAdmin
      .from('roadmaps')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('is_archived', false); // Only count non-archived roadmaps

    if (error) {
      console.error('Error counting roadmaps:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking roadmap limit',
      });
    }

    // Check if limit reached
    if (count >= limits.max_roadmap_items) {
      return res.status(403).json({
        success: false,
        message: `Roadmap limit reached. Free plan allows ${limits.max_roadmap_items} roadmap(s). Upgrade to Starter for 1 roadmap.`,
        error: 'ROADMAP_LIMIT_REACHED',
        upgrade_required: true,
        current_count: count,
        max_allowed: limits.max_roadmap_items,
      });
    }

    // Limit not reached, proceed
    next();
  } catch (error) {
    console.error('Error in checkRoadmapLimit middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking roadmap limit',
    });
  }
}

module.exports = {
  checkBoardLimit,
  checkPostLimit,
  checkInvitationLimit,
  checkRoadmapLimit,
  getUsageStats,
  getPlanLimits,
  hasActiveSubscription,
  PLAN_LIMITS,
};
