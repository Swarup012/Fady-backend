const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function testTrackedUsers() {
  console.log('🧪 Testing Tracked Users Feature\n');

  // Test 1: Check if tables exist
  console.log('1️⃣ Checking tracked_users table...');
  const { data: trackedUsers, error: trackedError } = await supabase
    .from('tracked_users')
    .select('*')
    .limit(5);

  if (trackedError) {
    console.error('❌ Error:', trackedError.message);
  } else {
    console.log(`✅ tracked_users table exists (${trackedUsers.length} records found)`);
  }

  // Test 2: Check organizations table columns
  console.log('\n2️⃣ Checking organizations table columns...');
  const { data: orgs, error: orgsError } = await supabase
    .from('organizations')
    .select('id, name, tracked_users_limit, tracked_users_count_cache')
    .limit(3);

  if (orgsError) {
    console.error('❌ Error:', orgsError.message);
  } else {
    console.log('✅ Organizations table updated with tracking columns:');
    orgs.forEach(org => {
      console.log(`   - ${org.name}: limit=${org.tracked_users_limit || 'not set'}, cached_count=${org.tracked_users_count_cache || 0}`);
    });
  }

  // Test 3: Check tracked_user_actions table
  console.log('\n3️⃣ Checking tracked_user_actions table...');
  const { data: actions, error: actionsError } = await supabase
    .from('tracked_user_actions')
    .select('*')
    .limit(1);

  if (actionsError) {
    console.error('❌ Error:', actionsError.message);
  } else {
    console.log(`✅ tracked_user_actions table exists`);
  }

  // Test 4: Test helper function
  console.log('\n4️⃣ Testing get_current_billing_period function...');
  const { data: period, error: periodError } = await supabase
    .rpc('get_current_billing_period');

  if (periodError) {
    console.error('❌ Error:', periodError.message);
  } else {
    console.log(`✅ Current billing period: ${period}`);
  }

  // Test 5: Check if limits are set
  console.log('\n5️⃣ Checking if plan limits are set...');
  const { data: limitsCheck, error: limitsError } = await supabase
    .from('organizations')
    .select('id, name, subscription_plan, tracked_users_limit')
    .neq('tracked_users_limit', null);

  if (limitsError) {
    console.error('❌ Error:', limitsError.message);
  } else {
    if (limitsCheck.length === 0) {
      console.log('⚠️  No organizations have limits set yet');
      console.log('   Run this SQL to set defaults:');
      console.log('   UPDATE organizations SET tracked_users_limit = CASE subscription_plan');
      console.log('     WHEN \'free\' THEN 100 WHEN \'pro\' THEN 5000 ELSE 100 END;');
    } else {
      console.log(`✅ ${limitsCheck.length} organizations have limits configured`);
    }
  }

  console.log('\n✅ All tests completed!\n');
}

testTrackedUsers().catch(console.error);
