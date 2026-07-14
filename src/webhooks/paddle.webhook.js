// src/webhooks/paddle.webhook.js
const crypto = require('crypto');
const paddleService = require('../services/paddle.service');
const { supabaseAdmin } = require('../config/supabase.config');

/**
 * Verify Paddle webhook signature for security
 * Paddle uses HMAC SHA256 signature in x-paddle-signature header
 */
function verifyPaddleWebhook(req) {
  // Paddle Billing (new API) uses 'paddle-signature' header
  const signature = req.headers['paddle-signature'];
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  
  if (!signature) {
    console.error('❌ Missing Paddle signature header (paddle-signature)');
    return false;
  }
  
  if (!webhookSecret) {
    console.error('❌ PADDLE_WEBHOOK_SECRET not configured - signature verification failed');
    return false;
  }

  // The Express route must capture the raw body (e.g., via express.json({ verify: ... }))
  const rawBody = req.rawBody;
  if (typeof rawBody !== 'string') {
    console.error('❌ Missing req.rawBody - Express middleware must capture raw body for verification');
    return false;
  }
  
  try {
    // Format: "ts=timestamp;h1=signature"
    const parts = signature.split(';');
    let timestamp = '';
    let h1Signature = '';
    
    parts.forEach(part => {
      const [key, value] = part.split('=');
      if (key === 'ts') timestamp = value;
      if (key === 'h1') h1Signature = value;
    });
    
    if (!timestamp || !h1Signature) {
      console.error('❌ Invalid Paddle signature format');
      return false;
    }

    // Construct the signed payload: timestamp:raw_body
    const signedPayload = timestamp + ':' + rawBody;
    
    // Calculate HMAC
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(signedPayload);
    const calculatedSignature = hmac.digest('hex');
    
    // Compare signatures
    const isValid = h1Signature === calculatedSignature;
    
    if (!isValid) {
      console.error('❌ Paddle signature mismatch');
      console.error('   Expected:', calculatedSignature);
      console.error('   Received:', h1Signature);
      return false;
    }
    
    console.log('✅ Paddle signature verified successfully');
    return true;
  } catch (error) {
    console.error('❌ Error verifying Paddle signature:', error);
    return false;
  }
}

async function handlePaddleWebhook(req, res) {
  const event = req.body;
  
  // =====================================================
  // STEP 1: VERIFY SIGNATURE (SECURITY CRITICAL)
  // =====================================================
  if (!verifyPaddleWebhook(req)) {
    console.error('❌ Paddle webhook signature verification failed');
    return res.status(401).json({ 
      error: 'Unauthorized - Invalid signature',
      received: false 
    });
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎣 Paddle Webhook received: ${event.event_type || event.alert_name}`);
  console.log(`   Event ID: ${event.id || event.event_id}`);
  console.log(`${'='.repeat(60)}\n`);
  
  try {
    // Paddle Billing (new API) uses different event names with dots
    const eventType = event.event_type || event.alert_name;
    
    // Parse organization_id from custom_data (Paddle Billing) or passthrough (Classic)
    let organizationId = event.organization_id;
    
    // Try custom_data first (Paddle Billing)
    if (!organizationId && event.data && event.data.custom_data) {
      organizationId = event.data.custom_data.organization_id;
    }
    
    // Fallback to passthrough (Paddle Classic)
    if (!organizationId && event.passthrough) {
      try {
        const passthrough = JSON.parse(event.passthrough);
        organizationId = passthrough.organization_id;
      } catch (e) {}
    }
    
    console.log(`📋 Organization ID: ${organizationId || 'NOT FOUND'}`);
    console.log(`📋 Event Data:`, JSON.stringify(event.data || {}, null, 2).substring(0, 200));
    
    // =====================================================
    // STEP 2: HANDLE DIFFERENT EVENT TYPES
    // =====================================================
    
    switch (eventType) {
      // ---------------------------------------------------
      // SUBSCRIPTION CREATED
      // When a customer completes checkout and subscription is created
      // ---------------------------------------------------
      case 'subscription.created':
      case 'subscription_created': // Also support old format
        if (organizationId) {
          console.log(`✅ Processing subscription_created for org: ${organizationId}`);
          
          // Extract data from Paddle Billing format (nested in event.data)
          const subscriptionData = event.data || event;
          const customerId = subscriptionData.customer_id || event.user_id;
          const subscriptionId = subscriptionData.id || event.subscription_id;
          const priceId = subscriptionData.items?.[0]?.price?.id || event.subscription_plan_id;
          // Capture address_id now so overage charges don't need a live Paddle lookup later
          const addressId = subscriptionData.address_id || null;
          
          console.log(`📋 Subscription details:`, {
            customerId,
            subscriptionId,
            priceId,
            addressId
          });
          
          await paddleService.storePaddleSubscription(
            organizationId,
            customerId,
            subscriptionId,
            priceId
          );
          
          // Determine plan and billing cycle based on price ID
          let planName = 'starter'; // Default
          let billingCycle = 'monthly'; // Default
          
          if (priceId === process.env.PADDLE_PRO_PLAN_ID_MONTHLY) {
            planName = 'pro';
            billingCycle = 'monthly';
          } else if (priceId === process.env.PADDLE_PRO_PLAN_ID_YEARLY) {
            planName = 'pro';
            billingCycle = 'yearly';
          } else if (priceId === process.env.PADDLE_STARTER_PLAN_ID_MONTHLY) {
            planName = 'starter';
            billingCycle = 'monthly';
          } else if (priceId === process.env.PADDLE_STARTER_PLAN_ID_YEARLY) {
            planName = 'starter';
            billingCycle = 'yearly';
          }
          
          console.log(`📋 Detected plan: ${planName} (${billingCycle}) - Price ID: ${priceId}`);
          
          // Update organization subscription status, plan, and address
          const updatePayload = {
            subscription_status: subscriptionData.status || 'active',
            subscription_plan: planName,
            tracked_users_limit: planName === 'pro' || planName === 'starter' ? 125 : 20,
            updated_at: new Date().toISOString()
          };
          // Cache address_id if present — needed for automatic overage transactions
          if (addressId) updatePayload.paddle_address_id = addressId;

          const { error: updateError } = await supabaseAdmin
            .from('organizations')
            .update(updatePayload)
            .eq('id', organizationId);
          
          if (updateError) {
            console.error('❌ Error updating subscription status:', updateError);
          } else {
            console.log(`✅ Subscription updated to: ${planName} plan (${subscriptionData.status || 'active'})`);
          }
          
          console.log(`✅ Subscription activated for org: ${organizationId}`);
        }
        break;

      // ---------------------------------------------------
      // SUBSCRIPTION UPDATED
      // When subscription plan changes or billing details updated
      // ---------------------------------------------------
      case 'subscription.updated':
      case 'subscription_updated':
        if (organizationId) {
          console.log(`🔄 Processing subscription_updated for org: ${organizationId}`);
          
          // Check if this is a scheduled cancellation
          const scheduledChange = event.scheduled_change;
          
          const updateData = {
            paddle_plan_id: event.subscription_plan_id,
            subscription_status: event.status,
            updated_at: new Date().toISOString()
          };
          
          // If subscription is scheduled for cancellation
          if (scheduledChange && scheduledChange.action === 'cancel') {
            updateData.cancel_at_period_end = true;
            updateData.subscription_end_date = scheduledChange.effective_at;
            console.log(`🔄 Subscription scheduled for cancellation at: ${scheduledChange.effective_at}`);
          } else if (event.status === 'active') {
            // If status is active and no cancellation scheduled, clear flags
            updateData.cancel_at_period_end = false;
            updateData.subscription_end_date = null;
          }
          
          await supabaseAdmin
            .from('organizations')
            .update(updateData)
            .eq('id', organizationId);
          
          console.log(`✅ Subscription updated: ${event.subscription_id}`);
          console.log(`   Status: ${event.status}`);
        }
        break;

      // ---------------------------------------------------
      // SUBSCRIPTION RESUMED
      // When customer resumes a scheduled-for-cancellation subscription
      // ---------------------------------------------------
      case 'subscription.resumed':
        if (organizationId) {
          console.log(`🔄 Processing subscription_resumed for org: ${organizationId}`);
          
          await supabaseAdmin
            .from('organizations')
            .update({
              cancel_at_period_end: false,
              subscription_end_date: null,
              subscription_status: 'active',
              updated_at: new Date().toISOString()
            })
            .eq('id', organizationId);
          
          console.log(`✅ Subscription resumed: ${event.subscription_id}`);
          console.log(`   Cancellation schedule removed`);
        }
        break;

      // ---------------------------------------------------
      // SUBSCRIPTION CANCELLED
      // When customer cancels their subscription
      // ---------------------------------------------------
      case 'subscription.canceled':
      case 'subscription_cancelled':
        if (organizationId) {
          console.log(`❌ Processing subscription_cancelled for org: ${organizationId}`);
          
          // Get current organization data
          const { data: org } = await supabaseAdmin
            .from('organizations')
            .select('subscription_plan, paddle_subscription_id')
            .eq('id', organizationId)
            .single();
          
          const previousPlan = org?.subscription_plan || 'unknown';
          
          // Revert to free plan and clear subscription data
          await supabaseAdmin
            .from('organizations')
            .update({
              subscription_status: 'cancelled',
              subscription_plan: 'free', // Revert to free plan
              subscription_end_date: event.cancellation_effective_date || new Date().toISOString(),
              paddle_subscription_id: null, // Clear subscription ID
              paddle_plan_id: null, // Clear plan ID
              tracked_users_limit: 20, // Reset to free tier limit
              cancel_at_period_end: false, // Clear cancel flag
              updated_at: new Date().toISOString()
            })
            .eq('id', organizationId);
          
          console.log(`✅ Subscription cancelled: ${event.subscription_id}`);
          console.log(`   Organization ${organizationId} reverted from ${previousPlan} to free plan`);
          console.log(`   Tracked users limit reset to 20`);
        }
        break;

      // ---------------------------------------------------
      // SUBSCRIPTION PAYMENT SUCCEEDED
      // When recurring payment succeeds
      // ---------------------------------------------------
      case 'subscription_payment_succeeded':
        if (organizationId) {
          console.log(`💰 Processing payment_succeeded for org: ${organizationId}`);
          
          // Update subscription status to active (in case it was past_due)
          await supabaseAdmin
            .from('organizations')
            .update({
              subscription_status: 'active',
              updated_at: new Date().toISOString()
            })
            .eq('id', organizationId);
          
          // Optional: Log payment in subscription_history table
          const { error: historyError } = await supabaseAdmin
            .from('subscription_history')
            .insert({
              organization_id: organizationId,
              event_type: 'payment_succeeded',
              paddle_subscription_id: event.subscription_id,
              paddle_payment_id: event.order_id,
              amount: event.sale_gross,
              currency: event.currency,
              created_at: new Date().toISOString()
            });
          
          if (historyError) {
            console.warn('⚠️ Failed to log payment history:', historyError.message);
          }
          
          console.log(`✅ Payment succeeded: ${event.order_id}`);
        }
        break;

      // ---------------------------------------------------
      // SUBSCRIPTION PAYMENT FAILED
      // When recurring payment fails
      // ---------------------------------------------------
      case 'subscription_payment_failed':
        if (organizationId) {
          console.log(`⚠️ Processing payment_failed for org: ${organizationId}`);
          
          // Update subscription status to past_due
          await supabaseAdmin
            .from('organizations')
            .update({
              subscription_status: 'past_due',
              updated_at: new Date().toISOString()
            })
            .eq('id', organizationId);
          
          // Optional: Log failed payment
          const { error: historyError } = await supabaseAdmin
            .from('subscription_history')
            .insert({
              organization_id: organizationId,
              event_type: 'payment_failed',
              paddle_subscription_id: event.subscription_id,
              paddle_payment_id: event.order_id,
              amount: event.amount,
              currency: event.currency,
              created_at: new Date().toISOString()
            });
          
          if (historyError) {
            console.warn('⚠️ Failed to log payment failure:', historyError.message);
          }
          
          // TODO: Send email notification to customer about failed payment
          console.log(`⚠️ Payment failed: ${event.subscription_id}`);
        }
        break;

      // ---------------------------------------------------
      // DEFAULT: Log unhandled events
      // ---------------------------------------------------
      default:
        console.log(`ℹ️ Unhandled webhook event: ${eventType}`);
        break;
    }

    // =====================================================
    // STEP 3: LOG ALL EVENTS TO DATABASE
    // =====================================================
    await supabaseAdmin.from('paddle_events').insert({
      event_id: event.id || event.event_id || `evt_${Date.now()}`,
      event_type: eventType,
      organization_id: organizationId,
      data: event,
      processed: true,
      created_at: new Date().toISOString()
    });

    console.log(`✅ Webhook processed successfully: ${eventType}`);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Paddle webhook error:', error);
    res.status(500).send('Webhook error');
  }
}

module.exports = { handlePaddleWebhook };
