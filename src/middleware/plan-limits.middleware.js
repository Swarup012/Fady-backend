// src/middleware/plan-limits.middleware.js
const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Plan Limits Configuration
 */
const PLAN_LIMITS = {
  free: {
    max_boards: 1,
    max_posts_per_month: 5,
    max_team_members: 3,
  },
  pro: {
    max_boards: Infinity, // Unlimited
    max_posts_per_month: Infinity, // Unlimited
    max_team_members: Infinity, // Unlimited
  },
};

/**
 * Check if organization has an active subscription
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

    // Active or trialing = Pro plan access
    return org.subscription_status === 'active' || org.subscription_status === 'trialing';
  } catch (error) {
    console.error('Error in hasActiveSubscription:', error);
    return false;
  }
}

/**
 * Get current plan limits for an organization
 */
async function getPlanLimits(organizationId) {
  const hasProAccess = await hasActiveSubscription(organizationId);
  return hasProAccess ? PLAN_LIMITS.pro : PLAN_LIMITS.free;
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
      return res.status(403).json({
        success: false,
        message: `Board limit reached. Free plan allows ${limits.max_boards} board(s). Upgrade to Pro for unlimited boards.`,
        error: 'BOARD_LIMIT_REACHED',
        upgrade_required: true,
        current_count: count,
        max_allowed: limits.max_boards,
      });
    }

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
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      // User without organization can create unlimited posts (for now)
      return next();
    }

    // Get plan limits
    const limits = await getPlanLimits(organizationId);

    // If unlimited, skip check
    if (limits.max_posts_per_month === Infinity) {
      return next();
    }

    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Count posts created this month by users in this organization
    const { data: orgMembers } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId);

    if (!orgMembers || orgMembers.length === 0) {
      return next();
    }

    const userIds = orgMembers.map(m => m.user_id);

    // Count posts created this month
    const { count, error } = await supabaseAdmin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .in('author_id', userIds)
      .gte('created_at', startOfMonth.toISOString());

    if (error) {
      console.error('Error counting posts:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking post limit',
      });
    }

    // Check if limit reached
    if (count >= limits.max_posts_per_month) {
      return res.status(403).json({
        success: false,
        message: `Post limit reached. Free plan allows ${limits.max_posts_per_month} posts per month. Upgrade to Pro for unlimited posts.`,
        error: 'POST_LIMIT_REACHED',
        upgrade_required: true,
        current_count: count,
        max_allowed: limits.max_posts_per_month,
        resets_at: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      });
    }

    // Limit not reached, proceed
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

    // Count boards
    const { count: boardCount } = await supabaseAdmin
      .from('boards')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    // Get start of current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get organization members
    const { data: orgMembers } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId);

    const userIds = orgMembers ? orgMembers.map(m => m.user_id) : [];

    // Count posts this month
    const { count: postCount } = await supabaseAdmin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .in('author_id', userIds)
      .gte('created_at', startOfMonth.toISOString());

    // Check if has pro subscription
    const hasProAccess = await hasActiveSubscription(organizationId);

    return res.json({
      success: true,
      data: {
        plan: hasProAccess ? 'pro' : 'free',
        usage: {
          boards: {
            current: boardCount || 0,
            limit: limits.max_boards === Infinity ? 'unlimited' : limits.max_boards,
            remaining: limits.max_boards === Infinity ? 'unlimited' : Math.max(0, limits.max_boards - (boardCount || 0)),
          },
          posts: {
            current: postCount || 0,
            limit: limits.max_posts_per_month === Infinity ? 'unlimited' : limits.max_posts_per_month,
            remaining: limits.max_posts_per_month === Infinity ? 'unlimited' : Math.max(0, limits.max_posts_per_month - (postCount || 0)),
            resets_at: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
          },
          team_members: {
            current: userIds.length,
            limit: limits.max_team_members === Infinity ? 'unlimited' : limits.max_team_members,
            remaining: limits.max_team_members === Infinity ? 'unlimited' : Math.max(0, limits.max_team_members - userIds.length),
          },
        },
      },
    });
  } catch (error) {
    console.error('Error getting usage stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving usage statistics',
    });
  }
}

module.exports = {
  checkBoardLimit,
  checkPostLimit,
  getUsageStats,
  getPlanLimits,
  hasActiveSubscription,
  PLAN_LIMITS,
};
