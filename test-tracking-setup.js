const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function testMiddlewareSetup() {
  console.log('🔍 Testing Tracked Users Setup\n');

  // Test 1: Check if tables exist
  console.log('1️⃣ Checking database tables...');
  const { data: tables, error: tableError } = await supabase
    .from('tracked_users')
    .select('*')
    .limit(1);

  if (tableError) {
    console.error('   ❌ tracked_users table error:', tableError.message);
    return;
  }
  console.log('   ✅ tracked_users table exists');

  // Test 2: Check if organizations have limits set
  console.log('\n2️⃣ Checking organization limits...');
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, tracked_users_limit, tracked_users_count_cache');

  orgs.forEach(org => {
    const status = org.tracked_users_limit > 0 ? '✅' : '⚠️';
    console.log(`   ${status} ${org.name}: limit=${org.tracked_users_limit || 'NOT SET'}, cache=${org.tracked_users_count_cache || 0}`);
  });

  // Test 3: Check if helper functions exist
  console.log('\n3️⃣ Testing helper functions...');
  try {
    const { data: period } = await supabase.rpc('get_current_billing_period');
    console.log(`   ✅ get_current_billing_period: ${period}`);
  } catch (error) {
    console.log('   ❌ get_current_billing_period failed:', error.message);
  }

  // Test 4: Manual tracking test
  console.log('\n4️⃣ Testing manual tracking...');
  
  if (orgs.length === 0) {
    console.log('   ⚠️ No organizations found');
    return;
  }

  const testOrg = orgs[0];
  const testUserId = 'test-user@example.com';
  const billingPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

  try {
    // Try to insert a test tracked user
    const { data: tracked, error: trackError } = await supabase
      .from('tracked_users')
      .insert({
        organization_id: testOrg.id,
        user_identifier: testUserId,
        billing_period: billingPeriod,
        posts_created: 1,
        votes_cast: 0,
        comments_made: 0
      })
      .select()
      .single();

    if (trackError) {
      if (trackError.code === '23505') {
        console.log(`   ⚠️ Test user already tracked (this is OK)`);
        
        // Update instead
        const { error: updateError } = await supabase
          .from('tracked_users')
          .update({ posts_created: supabase.sql`posts_created + 1` })
          .eq('organization_id', testOrg.id)
          .eq('user_identifier', testUserId)
          .eq('billing_period', billingPeriod);
        
        if (!updateError) {
          console.log('   ✅ Updated existing tracked user');
        }
      } else {
        console.log('   ❌ Track error:', trackError.message);
      }
    } else {
      console.log('   ✅ Successfully tracked test user');
    }

    // Update cache
    const { error: cacheError } = await supabase
      .from('organizations')
      .update({ 
        tracked_users_count_cache: supabase.sql`(
          SELECT COUNT(DISTINCT user_identifier)
          FROM tracked_users
          WHERE organization_id = ${testOrg.id}
            AND billing_period = ${billingPeriod}
        )`
      })
      .eq('id', testOrg.id);

    if (!cacheError) {
      console.log('   ✅ Cache updated successfully');
    }

    // Check final count
    const { data: finalOrg } = await supabase
      .from('organizations')
      .select('tracked_users_count_cache')
      .eq('id', testOrg.id)
      .single();

    console.log(`\n   📊 Final count for ${testOrg.name}: ${finalOrg.tracked_users_count_cache}`);

  } catch (error) {
    console.error('   ❌ Manual tracking failed:', error.message);
  }

  console.log('\n✅ Setup test complete!');
  console.log('\n💡 Next steps:');
  console.log('   1. Go to your frontend at localhost:5173');
  console.log('   2. Create a post on any board');
  console.log('   3. Check admin dashboard to see tracked users count');
  console.log('   4. Run: node check-current-subscription.js to verify');
}

testMiddlewareSetup().catch(console.error);
