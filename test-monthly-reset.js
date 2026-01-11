// test-monthly-reset.js

/**
 * Test script for monthly reset functionality
 * 
 * Tests:
 * 1. Manual trigger of reset
 * 2. Verification
 * 3. Status check
 */

const { 
  resetMonthlyTrackedUsersCache, 
  verifyReset,
  getCurrentBillingPeriod,
  getPreviousBillingPeriod
} = require('./src/jobs/tracked-users-reset.job');

async function testMonthlyReset() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 TESTING MONTHLY RESET JOB');
  console.log('='.repeat(70) + '\n');
  
  try {
    // Show current billing periods
    console.log('📅 Billing Periods:');
    console.log(`   Current: ${getCurrentBillingPeriod()}`);
    console.log(`   Previous: ${getPreviousBillingPeriod()}\n`);
    
    // Show current state BEFORE reset
    console.log('📊 STATE BEFORE RESET:');
    const { supabaseAdmin } = require('./src/config/supabase.config');
    const { data: orgsBefore } = await supabaseAdmin
      .from('organizations')
      .select('name, subdomain, tracked_users_count_cache, tracked_users_limit')
      .order('name');
    
    console.table(orgsBefore);
    
    // Trigger reset
    console.log('\n🔄 Triggering reset...\n');
    const result = await resetMonthlyTrackedUsersCache();
    
    // Show state AFTER reset
    console.log('\n📊 STATE AFTER RESET:');
    const { data: orgsAfter } = await supabaseAdmin
      .from('organizations')
      .select('name, subdomain, tracked_users_count_cache, tracked_users_limit')
      .order('name');
    
    console.table(orgsAfter);
    
    // Verify
    console.log('\n🔍 Running verification...');
    const verified = await verifyReset();
    
    console.log('\n' + '='.repeat(70));
    console.log(verified ? '✅ TEST PASSED' : '❌ TEST FAILED');
    console.log('='.repeat(70) + '\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  }
}

testMonthlyReset();
