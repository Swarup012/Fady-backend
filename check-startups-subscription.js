// Check if startups org has a subscription in Stripe
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkStartupsSubscription() {
  try {
    const orgId = '0be30cb8-de75-41ff-b7c2-e954fa3c3941'; // startups org

    console.log('🔍 Checking startups organization...\n');

    const { data: org, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (error) throw error;

    console.log('📋 Database:');
    console.log(`   Name: ${org.name}`);
    console.log(`   Status: ${org.subscription_status || 'NULL'}`);
    console.log(`   Plan: ${org.subscription_plan || 'NULL'}`);
    console.log(`   Customer ID: ${org.stripe_customer_id || 'NULL'}`);
    console.log(`   Subscription ID: ${org.stripe_subscription_id || 'NULL'}`);

    if (!org.stripe_customer_id) {
      console.log('\n❌ No Stripe customer ID - organization has never interacted with Stripe');
      return;
    }

    console.log('\n🔍 Checking Stripe...');
    
    const subscriptions = await stripe.subscriptions.list({
      customer: org.stripe_customer_id,
      limit: 10,
    });

    console.log(`\n📋 Found ${subscriptions.data.length} subscriptions in Stripe:`);

    if (subscriptions.data.length === 0) {
      console.log('❌ No active subscriptions');
      return;
    }

    subscriptions.data.forEach((sub, i) => {
      console.log(`\n${i + 1}. Subscription ${sub.id}:`);
      console.log(`   Status: ${sub.status}`);
      console.log(`   Price: ${sub.items.data[0]?.price?.id}`);
      console.log(`   Created: ${new Date(sub.created * 1000).toISOString()}`);
      if (sub.trial_end) {
        console.log(`   Trial End: ${new Date(sub.trial_end * 1000).toISOString()}`);
      }
    });

    const latestSub = subscriptions.data[0];
    const priceId = latestSub.items.data[0]?.price?.id;
    const expectedPriceId = process.env.STRIPE_PRICE_MONTHLY;

    console.log('\n' + '='.repeat(60));
    if (priceId === expectedPriceId && ['active', 'trialing'].includes(latestSub.status)) {
      console.log('✅ Should be Pro plan - needs database update!');
      console.log('\nRun: node sync-stripe-subscription.js');
    } else {
      console.log('❌ No active Pro subscription');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkStartupsSubscription();
