// Check subscription status in database
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkSubscriptions() {
  try {
    console.log('🔍 Checking subscription status...\n');

    const { data: orgs, error } = await supabase
      .from('organizations')
      .select('id, name, subscription_status, subscription_plan, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end')
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`Found ${orgs.length} organizations:\n`);

    orgs.forEach((org, index) => {
      console.log(`${index + 1}. ${org.name} (${org.id})`);
      console.log(`   Status: ${org.subscription_status || 'NULL'}`);
      console.log(`   Plan: ${org.subscription_plan || 'NULL'}`);
      console.log(`   Customer ID: ${org.stripe_customer_id || 'NULL'}`);
      console.log(`   Subscription ID: ${org.stripe_subscription_id || 'NULL'}`);
      console.log(`   Period: ${org.current_period_start || 'NULL'} → ${org.current_period_end || 'NULL'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkSubscriptions();
