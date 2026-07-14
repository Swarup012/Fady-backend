// src/routes/admin.routes.js

/**
 * =====================================================
 * ADMIN ROUTES
 * =====================================================
 * Protected routes for admin operations
 * Only accessible by organization owners
 * =====================================================
 */

const express = require('express');
const router = express.Router();
const { manualTriggerReset } = require('../jobs/scheduler');
const overageService = require('../services/overage.service');
const { 
  resetMonthlyTrackedUsersCache, 
  verifyReset,
  getCurrentBillingPeriod,
  getPreviousBillingPeriod
} = require('../jobs/tracked-users-reset.job');

/**
 * POST /api/admin/reset-tracked-users
 * Manually trigger monthly reset (for testing)
 * 
 * ⚠️ WARNING: This resets tracked_users_count_cache to 0 for ALL organizations
 * Use with extreme caution - only for testing or emergency manual reset
 */
router.post('/reset-tracked-users', async (req, res) => {
  try {
    console.log('⚠️  Manual reset triggered by admin');
    console.log(`👤 User: ${req.user?.email}`);
    console.log(`🏢 Organization: ${req.organization?.name}`);
    
    // Run the reset
    const result = await manualTriggerReset();
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Reset failed',
        message: result.error
      });
    }
    
    res.json({
      success: true,
      message: 'Monthly reset completed successfully',
      data: {
        organizations_reset: result.result.organizations_reset,
        previous_period: result.result.previous_period,
        current_period: result.result.current_period,
        duration_ms: result.result.duration,
        verified: result.verified,
        stats: result.result.stats
      }
    });
    
  } catch (error) {
    console.error('❌ Manual reset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset tracked users',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/reset-status
 * Get status of all organizations' tracked users cache
 */
router.get('/reset-status', async (req, res) => {
  try {
    const { supabaseAdmin } = require('../config/supabase.config');
    
    // Get current period info
    const currentPeriod = getCurrentBillingPeriod();
    const previousPeriod = getPreviousBillingPeriod();
    
    // Get all organizations with their cache and limits
    const { data: orgs, error } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain, tracked_users_count_cache, tracked_users_limit')
      .order('name');
    
    if (error) throw error;
    
    // Get actual counts for current period
    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const { count } = await supabaseAdmin
          .from('tracked_users')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .eq('billing_period', currentPeriod);
        
        return {
          ...org,
          actual_count_current_month: count,
          usage_percentage: org.tracked_users_limit 
            ? Math.round((org.tracked_users_count_cache / org.tracked_users_limit) * 100)
            : 0
        };
      })
    );
    
    res.json({
      success: true,
      data: {
        current_period: currentPeriod,
        previous_period: previousPeriod,
        organizations: orgsWithCounts,
        total_organizations: orgsWithCounts.length,
        total_cached_users: orgsWithCounts.reduce((sum, org) => sum + org.tracked_users_count_cache, 0)
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching reset status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reset status',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/verify-reset
 * Verify that all caches are at 0 (after reset)
 */
router.post('/verify-reset', async (req, res) => {
  try {
    const verified = await verifyReset();
    
    res.json({
      success: true,
      verified,
      message: verified 
        ? 'All organizations have cache reset to 0'
        : 'Some organizations still have non-zero cache'
    });
    
  } catch (error) {
    console.error('❌ Error verifying reset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify reset',
      message: error.message
    });
  }
});

// =====================================================
// OVERAGE BILLING — MANUAL TRIGGERS
// =====================================================

/**
 * POST /api/admin/billing/dry-run
 * Simulate the monthly overage billing job without charging anyone.
 * Safe to run at any time — reads DB and logs what WOULD happen.
 *
 * Response includes:
 *   - billingPeriod   : YYYY-MM currently being simulated
 *   - total           : number of active paid orgs evaluated
 *   - charged         : orgs that WOULD be charged (dry-run)
 *   - noCharge        : orgs with no overage this period
 *   - skippedAlreadyCharged : orgs already marked 'charged' (idempotency)
 *   - failures[]      : any unexpected errors during calculation
 */
router.post('/billing/dry-run', async (req, res) => {
  try {
    console.log(`🧪 [DRY RUN] Manual billing trigger by ${req.user?.email}`);
    const results = await overageService.processMonthlyBilling({ dryRun: true });
    return res.json({
      success: true,
      message: 'Dry-run complete — no charges were made',
      data: results,
    });
  } catch (error) {
    console.error('❌ Billing dry-run error:', error);
    return res.status(500).json({
      success: false,
      error: 'Dry-run failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/billing/run-now
 * Manually trigger the monthly overage billing job in LIVE mode.
 * This is idempotent: orgs already marked 'charged' this period are skipped.
 *
 * ⚠️  Use only when:
 *   1. The cron job failed and you need to re-run it manually.
 *   2. You confirmed the dry-run results look correct.
 *
 * Body (optional): { "confirm": true }  — acts as a safety gate.
 */
router.post('/billing/run-now', async (req, res) => {
  if (!req.body?.confirm) {
    return res.status(400).json({
      success: false,
      error: 'Safety gate: pass { "confirm": true } in the request body to proceed.',
    });
  }

  try {
    console.log(`⚡ [LIVE] Manual billing trigger by ${req.user?.email}`);
    const results = await overageService.processMonthlyBilling({ dryRun: false });
    return res.json({
      success: true,
      message: 'Live billing run complete',
      data: results,
    });
  } catch (error) {
    console.error('❌ Live billing trigger error:', error);
    return res.status(500).json({
      success: false,
      error: 'Billing run failed',
      message: error.message,
    });
  }
});

module.exports = router;
