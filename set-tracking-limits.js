const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function setTrackedUsersLimits() {
  console.log('🔧 Setting tracked users limits based on subscription plans\n');

  // First, let's see current state
  const { data: orgs, error: fetchError } = await supabase
    .from('organizations')
    .select('id, name, subscription_plan, tracked_users_limit');

  if (fetchError) {
    console.error('❌ Error fetching organizations:', fetchError.message);
    return;
  }

  console.log('Current organizations:');
  orgs.forEach(org => {
    console.log(`  - ${org.name}: plan=${org.subscription_plan || 'none'}, limit=${org.tracked_users_limit || 'not set'}`);
  });

  console.log('\n📝 Updating limits...');

  // Update each organization based on their plan
  for (const org of orgs) {
    let limit;
    
    switch (org.subscription_plan) {
      case 'free':
        limit = 100;
        break;
      case 'starter':
        limit = 1000;
        break;
      case 'pro':
      case 'professional':
        limit = 5000;
        break;
      case 'business':
      case 'enterprise':
        limit = 999999; // Virtually unlimited
        break;
      default:
        limit = 100; // Default for null/unknown plans
    }

    const { error: updateError } = await supabase
      .from('organizations')
      .update({ 
        tracked_users_limit: limit,
        tracked_users_count_cache: 0 
      })
      .eq('id', org.id);

    if (updateError) {
      console.error(`❌ Error updating ${org.name}:`, updateError.message);
    } else {
      console.log(`✅ ${org.name}: Set limit to ${limit} (plan: ${org.subscription_plan || 'default'})`);
    }
  }

  console.log('\n✅ All limits updated!\n');

  // Show final state
  const { data: finalOrgs } = await supabase
    .from('organizations')
    .select('name, subscription_plan, tracked_users_limit, tracked_users_count_cache');

  console.log('Final configuration:');
  finalOrgs.forEach(org => {
    console.log(`  - ${org.name}: plan=${org.subscription_plan}, limit=${org.tracked_users_limit}, current_count=${org.tracked_users_count_cache}`);
  });
}

setTrackedUsersLimits().catch(console.error);
