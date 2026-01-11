// test-admin-api.js

/**
 * Test admin API endpoints
 */

const { supabaseAdmin } = require('./src/config/supabase.config');
const { 
  getCurrentBillingPeriod, 
  getPreviousBillingPeriod 
} = require('./src/jobs/tracked-users-reset.job');

async function testAdminAPI() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 TESTING ADMIN API ENDPOINTS (Simulated)');
  console.log('='.repeat(70) + '\n');
  
  try {
    // Simulate GET /api/admin/reset-status
    console.log('📡 Endpoint: GET /api/admin/reset-status');
    console.log('─'.repeat(70));
    
    const currentPeriod = getCurrentBillingPeriod();
    const previousPeriod = getPreviousBillingPeriod();
    
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subdomain, tracked_users_count_cache, tracked_users_limit')
      .order('name');
    
    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const { count } = await supabaseAdmin
          .from('tracked_users')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .eq('billing_period', currentPeriod);
        
        return {
          name: org.name,
          subdomain: org.subdomain,
          cache: org.tracked_users_count_cache,
          limit: org.tracked_users_limit,
          actual_count: count,
          usage_pct: org.tracked_users_limit 
            ? Math.round((org.tracked_users_count_cache / org.tracked_users_limit) * 100)
            : 0
        };
      })
    );
    
    console.log(`\n📅 Current Period: ${currentPeriod}`);
    console.log(`📅 Previous Period: ${previousPeriod}\n`);
    console.log('📊 Organizations Status:');
    console.table(orgsWithCounts);
    
    console.log(`\n✅ Total Organizations: ${orgsWithCounts.length}`);
    console.log(`✅ Total Cached Users: ${orgsWithCounts.reduce((sum, org) => sum + org.cache, 0)}`);
    
    // Show sample response
    console.log('\n📝 Sample API Response:');
    console.log(JSON.stringify({
      success: true,
      data: {
        current_period: currentPeriod,
        previous_period: previousPeriod,
        organizations: orgsWithCounts.slice(0, 2), // Show first 2
        total_organizations: orgsWithCounts.length,
        total_cached_users: orgsWithCounts.reduce((sum, org) => sum + org.cache, 0)
      }
    }, null, 2));
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ ADMIN API TEST COMPLETED');
    console.log('='.repeat(70) + '\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testAdminAPI();
