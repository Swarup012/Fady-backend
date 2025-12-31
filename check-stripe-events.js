require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkStripeEvents() {
  const { data: events, error } = await supabase
    .from('stripe_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!events || events.length === 0) {
    console.log('❌ No Stripe webhook events in database');
    console.log('\n💡 This means webhooks are NOT working yet.\n');
    console.log('To fix:');
    console.log('1. Make sure Stripe CLI is running: stripe listen --forward-to localhost:5000/api/webhooks/stripe');
    console.log('2. Or configure production webhooks in Stripe Dashboard');
    return;
  }

  console.log(`📋 Found ${events.length} webhook events:\n`);
  
  events.forEach((e, i) => {
    const time = new Date(e.created_at).toLocaleString();
    const processed = e.processed ? '✅' : '❌';
    console.log(`${i + 1}. ${processed} ${e.event_type}`);
    console.log(`   Event ID: ${e.stripe_event_id}`);
    console.log(`   Time: ${time}`);
    if (e.error_message) {
      console.log(`   Error: ${e.error_message}`);
    }
    console.log('');
  });

  const unprocessed = events.filter(e => !e.processed);
  if (unprocessed.length > 0) {
    console.log(`⚠️  ${unprocessed.length} events failed to process`);
  } else {
    console.log('✅ All events processed successfully!');
  }
}

checkStripeEvents();
