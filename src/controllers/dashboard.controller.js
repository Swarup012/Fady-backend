const dashboardService = require('../services/dashboard.service');
const ResponseUtil = require('../utils/response.util');

class DashboardController {
  /**
   * GET /api/dashboard/stats
   * Returns pre-aggregated dashboard stats for the current organization
   */
  async getDashboardStats(req, res) {
    try {
      const organizationId = req.organization?.id || req.user?.current_organization_id;

      if (!organizationId) {
        return ResponseUtil.error(res, 'No organization found. Please complete onboarding.', 400);
      }

      const stats = await dashboardService.getDashboardStats(organizationId);
      return ResponseUtil.success(res, 'Dashboard stats retrieved', stats);
    } catch (error) {
      console.error('Dashboard stats error:', error);
      return ResponseUtil.error(res, 'Failed to load dashboard stats', 500);
    }
  }
}

module.exports = new DashboardController();
