// src/jobs/tracked-users-reset.job.js

/**
 * =====================================================
 * MONTHLY TRACKED USERS RESET JOB
 * =====================================================
 * Purpose: Reset tracked users cache at the start of each month
 * Schedule: Runs on the 1st day of every month at 00:01 UTC
 * 
 * What it does:
 * 1. Resets tracked_users_count_cache to 0 for all organizations
 * 2. Logs the reset for audit trail
 * 3. Preserves all historical data (no deletion)
 * 
 * Data Retention:
 * - All tracked_users records are kept indefinitely
 * - Each month has separate billing_period (e.g., "2026-01", "2026-02")
 * - Historical data used for analytics and trends
 * =====================================================
 */

const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Reset monthly cache for all organizations
 */
async function resetMonthlyTrackedUsersCache() {
  const startTime = Date.now();
  console.log('🔄 Starting monthly tracked users cache reset...');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  
  try {
    // Get current and previous period
    const currentPeriod = getCurrentBillingPeriod();
    const previousPeriod = getPreviousBillingPeriod();
    
    console.log(`📊 Previous Period: ${previousPeriod}`);
    console.log(`📊 Current Period: ${currentPeriod}`);
    
    // Get all organizations
    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain, tracked_users_count_cache');
    
    if (orgsError) throw orgsError;
    
    console.log(`🏢 Found ${orgs.length} organizations to reset`);
    
    // Log previous month's stats before reset
    const stats = [];
    for (const org of orgs) {
      const { count } = await supabaseAdmin
        .from('tracked_users')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .eq('billing_period', previousPeriod);
      
      stats.push({
        org_id: org.id,
        org_name: org.name,
        previous_cache: org.tracked_users_count_cache,
        actual_count_last_month: count
      });
    }
    
    // Log stats to console
    console.log('\n📈 Previous Month Summary:');
    console.table(stats);
    
    // Reset cache to 0 for all organizations
    const { error: resetError } = await supabaseAdmin
      .from('organizations')
      .update({ 
        tracked_users_count_cache: 0,
        updated_at: new Date().toISOString()
      })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all
    
    if (resetError) throw resetError;
    
    // Create audit log entry
    await createAuditLog({
      event_type: 'monthly_reset',
      billing_period: previousPeriod,
      organizations_count: orgs.length,
      stats: stats,
      timestamp: new Date().toISOString()
    });
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Monthly reset completed successfully!`);
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📊 Reset ${orgs.length} organizations to 0 / limit`);
    console.log(`📅 New billing period: ${currentPeriod}\n`);
    
    return {
      success: true,
      duration,
      organizations_reset: orgs.length,
      previous_period: previousPeriod,
      current_period: currentPeriod,
      stats
    };
    
  } catch (error) {
    console.error('❌ Error during monthly reset:', error);
    
    // Log error for monitoring
    await createAuditLog({
      event_type: 'monthly_reset_error',
      error_message: error.message,
      error_stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    throw error;
  }
}

/**
 * Get current billing period (YYYY-MM format)
 */
function getCurrentBillingPeriod() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get previous billing period
 */
function getPreviousBillingPeriod() {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() - 1);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Create audit log entry
 */
async function createAuditLog(logData) {
  try {
    // Store in a simple audit table or log file
    console.log('📝 Audit Log:', JSON.stringify(logData, null, 2));
    
    // Optional: Store in database if you have an audit_logs table
    // await supabaseAdmin.from('audit_logs').insert(logData);
    
  } catch (error) {
    console.error('⚠️  Failed to create audit log:', error.message);
    // Don't throw - audit logging failure shouldn't break the reset
  }
}

/**
 * Verify reset was successful
 */
async function verifyReset() {
  try {
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name, tracked_users_count_cache')
      .gt('tracked_users_count_cache', 0);
    
    if (orgs && orgs.length > 0) {
      console.warn('⚠️  Warning: Some organizations still have non-zero cache:');
      console.table(orgs);
      return false;
    }
    
    console.log('✅ Verification passed: All organizations reset to 0');
    return true;
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  }
}

module.exports = {
  resetMonthlyTrackedUsersCache,
  verifyReset,
  getCurrentBillingPeriod,
  getPreviousBillingPeriod
};
