// Sync subscription from Stripe to database
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function syncSubscription() {
  try {
    // Get org ID from command line argument or use default
    const orgId = process.argv[2] || '0be30cb8-de75-41ff-b7c2-e954fa3c3941'; // startups org (or pass org ID as argument)

    console.log('🔍 Fetching organization from database...');
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', orgId)
      .single();

    if (orgError) throw orgError;
    if (!org.stripe_customer_id) {
      console.log('❌ No Stripe customer ID found');
      return;
    }

    console.log(`✅ Customer ID: ${org.stripe_customer_id}`);
    console.log('\n🔍 Fetching subscriptions from Stripe...');

    // Get all subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: org.stripe_customer_id,
      limit: 10,
    });

    console.log(`Found ${subscriptions.data.length} subscriptions\n`);

    if (subscriptions.data.length === 0) {
      console.log('❌ No active subscriptions found in Stripe');
      return;
    }

    // Get the most recent subscription
    const subscription = subscriptions.data[0];
    
    console.log('📋 Latest Subscription:');
    console.log(`   ID: ${subscription.id}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Plan: ${subscription.items.data[0]?.price?.id}`);
    
    // Safely convert timestamps
    const periodStart = subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null;
    const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
    
    console.log(`   Current Period: ${periodStart} → ${periodEnd}`);
    console.log(`   Trial End: ${trialEnd || 'None'}`);

    // Determine plan from price ID
    const priceId = subscription.items.data[0]?.price?.id;
    let plan = 'free';
    
    // Check if it matches the Pro monthly price
    if (priceId === process.env.STRIPE_PRICE_MONTHLY || priceId === process.env.STRIPE_PRICE_YEARLY) {
      plan = 'pro';
    }

    console.log(`\n✅ Price ID: ${priceId}`);
    console.log(`   Expected: ${process.env.STRIPE_PRICE_MONTHLY}`);
    console.log(`   Detected Plan: ${plan}`);

    // Update database
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        subscription_status: subscription.status,
        subscription_plan: plan,
        stripe_subscription_id: subscription.id,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        trial_ends_at: trialEnd,
      })
      .eq('id', orgId);

    if (updateError) throw updateError;

    console.log('✅ Database updated successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

syncSubscription();
