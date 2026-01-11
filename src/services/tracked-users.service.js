// src/services/tracked-users.service.js

/**
 * =====================================================
 * TRACKED USERS SERVICE
 * =====================================================
 * Purpose: Track unique users who interact with feedback
 * for usage-based pricing and analytics
 * 
 * Core Functions:
 * - Track user actions (posts, votes, comments)
 * - Enforce plan limits
 * - Calculate usage metrics
 * - Handle billing period resets
 * =====================================================
 */

const { supabaseAdmin } = require('../config/supabase.config');
const { getPlanLimits } = require('../middleware/plan-limits.middleware');

const trackedUsersService = {
  
  /**
   * =====================================================
   * MAIN TRACKING FUNCTION
   * =====================================================
   * Called when user performs an action (post/vote/comment)
   * 
   * @param {string} organizationId - UUID of the organization
   * @param {string} userIdentifier - Email or user_id
   * @param {string} actionType - 'create_post', 'vote', 'comment'
   * @param {object} userDetails - Optional: { name, email }
   * @returns {object} { tracked: boolean, new_user: boolean, count: number }
   */
  async trackUser(organizationId, userIdentifier, actionType, userDetails = {}) {
    try {
      const billingPeriod = this.getCurrentBillingPeriod();
      
      // Check if user already tracked this period
      const existingUser = await this.findTrackedUser(
        organizationId,
        userIdentifier,
        billingPeriod
      );
      
      if (existingUser) {
        // Update existing record
        await this.updateTrackedUser(existingUser.id, actionType);
        return {
          tracked: true,
          new_user: false,
          count: existingUser.total_actions + 1,
          within_limit: true
        };
      }
      
      // Check if within limits before adding new user
      const limitCheck = await this.checkTrackingLimit(organizationId);
      
      if (!limitCheck.allowed) {
        console.warn(`Tracking limit reached for org ${organizationId}`);
        return {
          tracked: false,
          new_user: false,
          count: limitCheck.current_count,
          within_limit: false,
          reason: 'limit_reached'
        };
      }
      
      // Add new tracked user
      const newUser = await this.addTrackedUser(
        organizationId,
        userIdentifier,
        actionType,
        billingPeriod,
        userDetails
      );
      
      return {
        tracked: true,
        new_user: true,
        count: 1,
        within_limit: true,
        total_tracked: limitCheck.current_count + 1
      };
      
    } catch (error) {
      console.error('Error tracking user:', error);
      // Don't throw - tracking failure shouldn't break user actions
      return {
        tracked: false,
        error: error.message
      };
    }
  },
  
  /**
   * =====================================================
   * FIND EXISTING TRACKED USER
   * =====================================================
   */
  async findTrackedUser(organizationId, userIdentifier, billingPeriod) {
    try {
      const { data, error } = await supabaseAdmin
        .from('tracked_users')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('user_identifier', userIdentifier)
        .eq('billing_period', billingPeriod)
        .single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 = not found
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error finding tracked user:', error);
      return null;
    }
  },
  
  /**
   * =====================================================
   * ADD NEW TRACKED USER
   * =====================================================
   */
  async addTrackedUser(organizationId, userIdentifier, actionType, billingPeriod, userDetails) {
    try {
      // Prepare action counts
      const actionCounts = {
        posts_created: actionType === 'create_post' ? 1 : 0,
        votes_cast: actionType === 'vote' ? 1 : 0,
        comments_made: actionType === 'comment' ? 1 : 0
      };
      
      // Insert tracked user
      const { data: trackedUser, error } = await supabaseAdmin
        .from('tracked_users')
        .insert({
          organization_id: organizationId,
          user_identifier: userIdentifier,
          identification_method: userIdentifier.includes('@') ? 'email' : 'user_id',
          display_name: userDetails.name || null,
          email: userDetails.email || (userIdentifier.includes('@') ? userIdentifier : null),
          billing_period: billingPeriod,
          total_actions: 1,
          ...actionCounts,
          metadata: userDetails.metadata || {}
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Update organization cache
      await this.incrementOrgCache(organizationId);
      
      // Check if notification needed
      await this.checkAndNotify(organizationId);
      
      console.log(`✅ Tracked new user ${userIdentifier} for org ${organizationId}`);
      
      return trackedUser;
    } catch (error) {
      console.error('Error adding tracked user:', error);
      throw error;
    }
  },
  
  /**
   * =====================================================
   * UPDATE EXISTING TRACKED USER
   * =====================================================
   */
  async updateTrackedUser(trackedUserId, actionType) {
    try {
      // First, fetch the current values
      const { data: currentUser, error: fetchError } = await supabaseAdmin
        .from('tracked_users')
        .select('total_actions, posts_created, votes_cast, comments_made')
        .eq('id', trackedUserId)
        .single();
      
      if (fetchError) throw fetchError;
      
      // Calculate new values
      const newTotalActions = (currentUser?.total_actions || 0) + 1;
      const newPostsCreated = (currentUser?.posts_created || 0) + (actionType === 'create_post' ? 1 : 0);
      const newVotesCast = (currentUser?.votes_cast || 0) + (actionType === 'vote' ? 1 : 0);
      const newCommentsMade = (currentUser?.comments_made || 0) + (actionType === 'comment' ? 1 : 0);
      
      // Update with new values
      const { error } = await supabaseAdmin
        .from('tracked_users')
        .update({
          last_activity_at: new Date().toISOString(),
          total_actions: newTotalActions,
          posts_created: newPostsCreated,
          votes_cast: newVotesCast,
          comments_made: newCommentsMade
        })
        .eq('id', trackedUserId);
      
      if (error) throw error;
      
      console.log(`✅ Updated tracked user ${trackedUserId} - action: ${actionType} (total: ${newTotalActions})`);
    } catch (error) {
      console.error('Error updating tracked user:', error);
      throw error;
    }
  },
  
  /**
   * =====================================================
   * GET CURRENT BILLING PERIOD
   * =====================================================
   * Returns format: "YYYY-MM" (e.g., "2026-01")
   */
  getCurrentBillingPeriod() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  },
  
  /**
   * =====================================================
   * CHECK TRACKING LIMIT
   * =====================================================
   */
  async checkTrackingLimit(organizationId) {
    try {
      const { data: org, error } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_limit, tracked_users_count_cache, tracked_users_overage_allowed')
        .eq('id', organizationId)
        .single();
      
      if (error) throw error;
      
      // Get plan-based limits
      const planLimits = await getPlanLimits(organizationId);
      const defaultLimit = planLimits.max_tracked_users === Infinity ? 100000 : planLimits.max_tracked_users;
      
      const currentCount = org.tracked_users_count_cache || 0;
      const limit = org.tracked_users_limit || defaultLimit; // Use plan limit as default
      const overageAllowed = org.tracked_users_overage_allowed || false;
      
      const usagePercent = (currentCount / limit) * 100;
      
      // If over limit
      if (currentCount >= limit) {
        if (overageAllowed) {
          // Allow overage (will bill later)
          return {
            allowed: true,
            overage: true,
            current_count: currentCount,
            limit,
            usage_percent: usagePercent
          };
        } else {
          // Hard limit - block
          return {
            allowed: false,
            current_count: currentCount,
            limit,
            usage_percent: usagePercent,
            reason: 'limit_reached'
          };
        }
      }
      
      return {
        allowed: true,
        overage: false,
        current_count: currentCount,
        limit,
        usage_percent: usagePercent
      };
      
    } catch (error) {
      console.error('Error checking tracking limit:', error);
      // Default to allowing on error (don't break user actions)
      return { allowed: true, error: error.message };
    }
  },
  
  /**
   * =====================================================
   * INCREMENT ORGANIZATION CACHE
   * =====================================================
   */
  async incrementOrgCache(organizationId) {
    try {
      // Get current cache value
      const { data: org, error: fetchError } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_count_cache')
        .eq('id', organizationId)
        .single();
      
      if (fetchError) throw fetchError;
      
      const currentCache = org?.tracked_users_count_cache || 0;
      
      // Update with incremented value
      const { error } = await supabaseAdmin
        .from('organizations')
        .update({
          tracked_users_count_cache: currentCache + 1
        })
        .eq('id', organizationId);
      
      if (error) throw error;
    } catch (error) {
      console.error('Error incrementing org cache:', error);
      // Don't throw - this is non-critical
    }
  },
  
  /**
   * =====================================================
   * GET TRACKED USER COUNT
   * =====================================================
   */
  async getTrackedUserCount(organizationId, billingPeriod = null) {
    try {
      const period = billingPeriod || this.getCurrentBillingPeriod();
      
      const { count, error } = await supabaseAdmin
        .from('tracked_users')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('billing_period', period);
      
      if (error) throw error;
      
      return count || 0;
    } catch (error) {
      console.error('Error getting tracked user count:', error);
      return 0;
    }
  },
  
  /**
   * =====================================================
   * GET TRACKED USERS LIST
   * =====================================================
   */
  async getTrackedUsersList(organizationId, billingPeriod = null, options = {}) {
    try {
      const period = billingPeriod || this.getCurrentBillingPeriod();
      const { page = 1, limit = 50, sortBy = 'total_actions', sortOrder = 'desc' } = options;
      
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      
      const { data, error, count } = await supabaseAdmin
        .from('tracked_users')
        .select('*', { count: 'exact' })
        .eq('organization_id', organizationId)
        .eq('billing_period', period)
        .order(sortBy, { ascending: sortOrder === 'asc' })
        .range(from, to);
      
      if (error) throw error;
      
      return {
        users: data,
        total: count,
        page,
        limit,
        total_pages: Math.ceil(count / limit)
      };
    } catch (error) {
      console.error('Error getting tracked users list:', error);
      throw error;
    }
  },
  
  /**
   * =====================================================
   * CHECK AND SEND NOTIFICATIONS
   * =====================================================
   */
  async checkAndNotify(organizationId) {
    try {
      const { data: org, error } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_count_cache, tracked_users_limit, tracked_users_notification_sent_at, name')
        .eq('id', organizationId)
        .single();
      
      if (error) throw error;
      
      // Get plan-based limits
      const planLimits = await getPlanLimits(organizationId);
      const defaultLimit = planLimits.max_tracked_users === Infinity ? 100000 : planLimits.max_tracked_users;
      
      const currentCount = org.tracked_users_count_cache || 0;
      const limit = org.tracked_users_limit || defaultLimit; // Use plan limit as default
      const usagePercent = (currentCount / limit) * 100;
      
      // Check if notification already sent recently (within 24 hours)
      if (org.tracked_users_notification_sent_at) {
        const lastNotification = new Date(org.tracked_users_notification_sent_at);
        const hoursSince = (Date.now() - lastNotification.getTime()) / (1000 * 60 * 60);
        
        if (hoursSince < 24) {
          return; // Don't spam notifications
        }
      }
      
      // Determine if notification needed
      let notificationType = null;
      
      if (usagePercent >= 100) {
        notificationType = 'limit_reached';
      } else if (usagePercent >= 90) {
        notificationType = 'approaching_limit_90';
      } else if (usagePercent >= 80) {
        notificationType = 'approaching_limit_80';
      }
      
      if (notificationType) {
        console.log(`📧 Sending ${notificationType} notification to org ${organizationId}`);
        
        // TODO: Implement email service
        // await emailService.sendTrackingLimitNotification(org, notificationType, currentCount, limit);
        
        // Update notification timestamp
        await supabaseAdmin
          .from('organizations')
          .update({ tracked_users_notification_sent_at: new Date().toISOString() })
          .eq('id', organizationId);
      }
      
    } catch (error) {
      console.error('Error checking notifications:', error);
      // Don't throw - notification failure shouldn't break tracking
    }
  },
  
  /**
   * =====================================================
   * RECALCULATE CACHE (Safety Net)
   * =====================================================
   * Use this to fix cache discrepancies
   */
  async recalculateCache(organizationId, billingPeriod = null) {
    try {
      const period = billingPeriod || this.getCurrentBillingPeriod();
      
      // Get actual count from database
      const actualCount = await this.getTrackedUserCount(organizationId, period);
      
      // Update cache
      const { error } = await supabaseAdmin
        .from('organizations')
        .update({ tracked_users_count_cache: actualCount })
        .eq('id', organizationId);
      
      if (error) throw error;
      
      console.log(`✅ Recalculated cache for org ${organizationId}: ${actualCount}`);
      
      return actualCount;
    } catch (error) {
      console.error('Error recalculating cache:', error);
      throw error;
    }
  },
  
  /**
   * =====================================================
   * RESET MONTHLY TRACKING (Cron Job)
   * =====================================================
   * Run on 1st of each month at 00:00 UTC
   */
  async resetMonthlyTracking() {
    try {
      console.log('🔄 Starting monthly tracking reset...');
      
      // Reset all organization caches
      const { error } = await supabaseAdmin
        .from('organizations')
        .update({
          tracked_users_count_cache: 0,
          tracked_users_last_reset: new Date().toISOString(),
          tracked_users_notification_sent_at: null
        })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all (dummy condition)
      
      if (error) throw error;
      
      console.log('✅ Monthly tracking reset complete');
      
      return { success: true };
    } catch (error) {
      console.error('Error resetting monthly tracking:', error);
      throw error;
    }
  },
  
  /**
   * =====================================================
   * GET USAGE STATS FOR DASHBOARD
   * =====================================================
   */
  async getUsageStats(organizationId) {
    try {
      const billingPeriod = this.getCurrentBillingPeriod();
      
      const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_limit, tracked_users_count_cache, subscription_plan')
        .eq('id', organizationId)
        .single();
      
      if (orgError) throw orgError;
      
      // Get plan-based limits
      const planLimits = await getPlanLimits(organizationId);
      const defaultLimit = planLimits.max_tracked_users === Infinity ? 100000 : planLimits.max_tracked_users;
      
      const currentCount = org.tracked_users_count_cache || 0;
      const limit = org.tracked_users_limit || defaultLimit; // Use plan limit as default
      const usagePercent = ((currentCount / limit) * 100).toFixed(1);
      
      // Get breakdown
      const { data: users, error: usersError } = await supabaseAdmin
        .from('tracked_users')
        .select('posts_created, votes_cast, comments_made')
        .eq('organization_id', organizationId)
        .eq('billing_period', billingPeriod);
      
      if (usersError) throw usersError;
      
      const breakdown = users.reduce((acc, user) => ({
        posts: acc.posts + (user.posts_created || 0),
        votes: acc.votes + (user.votes_cast || 0),
        comments: acc.comments + (user.comments_made || 0)
      }), { posts: 0, votes: 0, comments: 0 });
      
      // Calculate days remaining
      const now = new Date();
      const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      const daysRemaining = Math.ceil((endOfMonth - now) / (1000 * 60 * 60 * 24));
      
      return {
        current_period: billingPeriod,
        count: currentCount,
        limit,
        usage_percent: parseFloat(usagePercent),
        plan: org.subscription_plan || 'free',
        plan_type: org.subscription_plan || 'free', // Add plan_type for frontend compatibility
        days_remaining: daysRemaining,
        breakdown,
        status: currentCount >= limit ? 'at_limit' : usagePercent >= 80 ? 'warning' : 'ok'
      };
      
    } catch (error) {
      console.error('Error getting usage stats:', error);
      throw error;
    }
  }
};

module.exports = trackedUsersService;
