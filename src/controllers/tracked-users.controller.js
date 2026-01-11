// src/controllers/tracked-users.controller.js

/**
 * =====================================================
 * TRACKED USERS CONTROLLER
 * =====================================================
 * Handles API requests for tracked users data
 * =====================================================
 */

const trackedUsersService = require('../services/tracked-users.service');
const responseUtil = require('../utils/response.util');
const { getPlanLimits } = require('../middleware/plan-limits.middleware');

const trackedUsersController = {
  
  /**
   * GET /api/tracked-users/count
   * Get current tracked user count
   */
  getCount: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      
      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }
      
      const billingPeriod = req.query.period || trackedUsersService.getCurrentBillingPeriod();
      const count = await trackedUsersService.getTrackedUserCount(organizationId, billingPeriod);
      
      // Get limit from organization
      const { supabaseAdmin } = require('../config/supabase.config');
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_limit, tracked_users_count_cache')
        .eq('id', organizationId)
        .single();
      
      // Get plan-based limits
      const planLimits = await getPlanLimits(organizationId);
      const defaultLimit = planLimits.max_tracked_users === Infinity ? 100000 : planLimits.max_tracked_users;
      
      const limit = org?.tracked_users_limit || defaultLimit; // Use plan limit as default (20 for free, unlimited for pro)
      const usagePercent = ((count / limit) * 100).toFixed(1);
      
      return responseUtil.success(res, 'Tracked user count retrieved', {
        current_period: billingPeriod,
        count,
        limit,
        usage_percent: parseFloat(usagePercent),
        cached_count: org?.tracked_users_count_cache || 0
      });
      
    } catch (error) {
      console.error('Error getting tracked user count:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },
  
  /**
   * GET /api/tracked-users/usage
   * Get detailed usage stats for dashboard
   */
  getUsageStats: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      
      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }
      
      const stats = await trackedUsersService.getUsageStats(organizationId);
      
      return responseUtil.success(res, 'Usage stats retrieved', stats);
      
    } catch (error) {
      console.error('Error getting usage stats:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },
  
  /**
   * GET /api/tracked-users/list
   * Get paginated list of tracked users
   */
  getList: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      
      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }
      
      const {
        period = trackedUsersService.getCurrentBillingPeriod(),
        page = 1,
        limit = 50,
        sortBy = 'total_actions',
        sortOrder = 'desc'
      } = req.query;
      
      const result = await trackedUsersService.getTrackedUsersList(
        organizationId,
        period,
        {
          page: parseInt(page),
          limit: parseInt(limit),
          sortBy,
          sortOrder
        }
      );
      
      return responseUtil.success(res, 'Tracked users list retrieved', result);
      
    } catch (error) {
      console.error('Error getting tracked users list:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },
  
  /**
   * GET /api/tracked-users/history
   * Get historical data for past months
   */
  getHistory: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      
      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }
      
      const months = parseInt(req.query.months) || 6;
      const history = [];
      
      // Get data for past N months (reversed to show oldest first)
      for (let i = months - 1; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const period = `${year}-${month}`;
        
        // Get count for this period
        const count = await trackedUsersService.getTrackedUserCount(organizationId, period);
        
        // Get detailed breakdown for this period
        const { supabaseAdmin } = require('../config/supabase.config');
        const { data: users } = await supabaseAdmin
          .from('tracked_users')
          .select('posts_created, votes_cast, comments_made, total_actions')
          .eq('organization_id', organizationId)
          .eq('billing_period', period);
        
        const breakdown = users?.reduce((acc, user) => ({
          create_post: acc.create_post + (user.posts_created || 0),
          vote: acc.vote + (user.votes_cast || 0),
          comment: acc.comment + (user.comments_made || 0)
        }), { create_post: 0, vote: 0, comment: 0 }) || { create_post: 0, vote: 0, comment: 0 };
        
        const totalActions = users?.reduce((sum, user) => sum + (user.total_actions || 0), 0) || 0;
        
        history.push({
          billing_period: period,
          total_users: count,
          total_actions: totalActions,
          breakdown,
          month_name: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        });
      }
      
      // Get organization limit
      const { supabaseAdmin } = require('../config/supabase.config');
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_limit')
        .eq('id', organizationId)
        .single();
      
      // Get plan-based limits
      const planLimits = await getPlanLimits(organizationId);
      const defaultLimit = planLimits.max_tracked_users === Infinity ? 100000 : planLimits.max_tracked_users;
      
      const limit = org?.tracked_users_limit || defaultLimit; // Use plan limit as default (20 for free, unlimited for pro)
      
      return responseUtil.success(res, 'Historical data retrieved', {
        history,
        limit
      });
      
    } catch (error) {
      console.error('Error getting history:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },
  
  /**
   * GET /api/tracked-users/export
   * Export tracked users as CSV
   */
  exportCSV: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      
      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }
      
      const period = req.query.period || trackedUsersService.getCurrentBillingPeriod();
      
      // Get all users (no pagination)
      const { users } = await trackedUsersService.getTrackedUsersList(
        organizationId,
        period,
        { page: 1, limit: 10000 }
      );
      
      // Generate CSV
      const headers = [
        'Email',
        'Display Name',
        'Total Actions',
        'Posts Created',
        'Votes Cast',
        'Comments Made',
        'First Tracked',
        'Last Activity'
      ];
      
      const rows = users.map(user => [
        user.email || user.user_identifier,
        user.display_name || '',
        user.total_actions,
        user.posts_created,
        user.votes_cast,
        user.comments_made,
        new Date(user.first_tracked_at).toISOString(),
        new Date(user.last_activity_at).toISOString()
      ]);
      
      // Convert to CSV string
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
      // Set headers for file download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="tracked-users-${period}.csv"`);
      
      return res.send(csvContent);
      
    } catch (error) {
      console.error('Error exporting CSV:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },
  
  /**
   * POST /api/tracked-users/recalculate
   * Recalculate cache (admin only)
   */
  recalculateCache: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      
      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }
      
      // Check if user is owner/admin
      if (!['owner', 'admin'].includes(req.user.organization_role)) {
        return responseUtil.error(res, 'Insufficient permissions', 403);
      }
      
      const period = req.body?.period || trackedUsersService.getCurrentBillingPeriod();
      const actualCount = await trackedUsersService.recalculateCache(organizationId, period);
      
      return responseUtil.success(res, 'Cache recalculated', {
        period,
        count: actualCount
      });
      
    } catch (error) {
      console.error('Error recalculating cache:', error);
      return responseUtil.error(res, error.message, 500);
    }
  }
};

module.exports = trackedUsersController;
