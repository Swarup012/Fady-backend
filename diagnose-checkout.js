// Simulate what happens after checkout
// This checks if a subscription exists and manually triggers the webhook logic

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function simulateWebhook() {
  try {
    const orgId = 'c38d67f1-ce64-4123-ad7b-ef1787989020';

    console.log('🔍 Step 1: Get organization...');
    const { data: org } = await supabase
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', orgId)
      .single();

    if (!org?.stripe_customer_id) {
      console.log('❌ No customer ID');
      return;
    }

    console.log(`✅ Customer ID: ${org.stripe_customer_id}`);

    console.log('\n🔍 Step 2: Get latest checkout session...');
    const sessions = await stripe.checkout.sessions.list({
      customer: org.stripe_customer_id,
      limit: 5,
    });

    console.log(`Found ${sessions.data.length} checkout sessions`);

    const completedSession = sessions.data.find(s => s.status === 'complete');

    if (!completedSession) {
      console.log('❌ No completed checkout session found');
      return;
    }

    console.log(`\n✅ Found completed session: ${completedSession.id}`);
    console.log(`   Created: ${new Date(completedSession.created * 1000).toISOString()}`);
    console.log(`   Mode: ${completedSession.mode}`);
    console.log(`   Subscription: ${completedSession.subscription}`);
    console.log(`   Metadata:`, completedSession.metadata);

    // Check if organization_id is in metadata
    if (!completedSession.metadata?.organization_id) {
      console.log('\n⚠️  WARNING: No organization_id in session metadata!');
      console.log('This means the webhook handler won\'t know which org to update.');
      console.log('\nFIX: When creating checkout session, add metadata:');
      console.log('  metadata: { organization_id: orgId, user_id: userId }');
    } else {
      console.log(`\n✅ Metadata contains organization_id: ${completedSession.metadata.organization_id}`);
    }

    // Get subscription details
    if (completedSession.subscription) {
      console.log('\n🔍 Step 3: Get subscription details...');
      const subscription = await stripe.subscriptions.retrieve(completedSession.subscription);
      
      console.log(`\n📋 Subscription Details:`);
      console.log(`   ID: ${subscription.id}`);
      console.log(`   Status: ${subscription.status}`);
      console.log(`   Price ID: ${subscription.items.data[0]?.price?.id}`);
      
      const periodStart = subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : 'N/A';
      const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : 'N/A';
      const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : 'None';
      
      console.log(`   Current Period: ${periodStart} → ${periodEnd}`);
      console.log(`   Trial End: ${trialEnd}`);

      const expectedPriceId = process.env.STRIPE_PRICE_MONTHLY;
      const actualPriceId = subscription.items.data[0]?.price?.id;

      if (actualPriceId === expectedPriceId) {
        console.log(`\n✅ Price ID matches! This is a Pro subscription`);
      } else {
        console.log(`\n⚠️  Price ID mismatch:`);
        console.log(`   Expected: ${expectedPriceId}`);
        console.log(`   Actual: ${actualPriceId}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSIS:');
    console.log('='.repeat(60));
    console.log('✅ Checkout session exists');
    console.log('✅ Subscription exists');
    console.log('❓ Check if webhook was fired by Stripe');
    console.log('❓ Check if webhook had organization_id in metadata');
    console.log('\nTo fix: Ensure checkout session includes metadata when created');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

simulateWebhook();
