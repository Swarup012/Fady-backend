// Check stripe_events table for failed events
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkStripeEvents() {
  try {
    console.log('🔍 Checking stripe_events table...\n');

    const { data: events, error } = await supabase
      .from('stripe_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!events || events.length === 0) {
      console.log('❌ No events in stripe_events table');
      console.log('\nThis means either:');
      console.log('1. Stripe CLI is not forwarding events');
      console.log('2. Backend webhook endpoint is not saving events');
      console.log('3. Event processing is failing before it reaches the save step');
      return;
    }

    console.log(`✅ Found ${events.length} events:\n`);

    events.forEach((event, i) => {
      console.log(`${i + 1}. Event ID: ${event.id}`);
      console.log(`   Type: ${event.event_type}`);
      console.log(`   Processed: ${event.processed}`);
      console.log(`   Organization: ${event.organization_id || 'NULL'}`);
      console.log(`   Created: ${event.created_at}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkStripeEvents();
