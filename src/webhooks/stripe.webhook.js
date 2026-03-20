// src/webhooks/stripe.webhook.js

/**
 * =====================================================
 * STRIPE WEBHOOK ENDPOINT
 * =====================================================
 * SECURITY CRITICAL: This is where we verify payments
 * 
 * RULES:
 * 1. ALWAYS verify signature
 * 2. ALWAYS check idempotency
 * 3. NEVER trust frontend for payment status
 * 4. Return 200 to Stripe even if processing fails (after verification)
 * =====================================================
 */

const { stripe } = require('../config/stripe.config'); // DEPRECATED - kept for legacy webhooks
const subscriptionService = require('../services/subscription.service');

// Import event handlers
const { handleCheckoutCompleted } = require('./handlers/checkout.handler');
const {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleTrialWillEnd,
} = require('./handlers/subscription.handler');
const {
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleInvoiceUpcoming,
} = require('./handlers/invoice.handler');

/**
 * Main webhook handler
 * CRITICAL: This must use RAW body, not parsed JSON
 */
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET not configured!');
    return res.status(500).json({ 
      error: 'Webhook secret not configured',
      received: false 
    });
  }

  let event;

  try {
    // =====================================================
    // STEP 1: VERIFY SIGNATURE (SECURITY CRITICAL)
    // =====================================================
    // This prevents attackers from sending fake webhooks
    event = stripe.webhooks.constructEvent(
      req.body,  // Must be raw buffer, not parsed JSON!
      sig,
      webhookSecret
    );

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎣 Webhook received: ${event.type}`);
    console.log(`   Event ID: ${event.id}`);
    console.log(`   Created: ${new Date(event.created * 1000).toISOString()}`);
    console.log(`${'='.repeat(60)}\n`);

  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).json({ 
      error: `Webhook Error: ${err.message}`,
      received: false 
    });
  }

  // =====================================================
  // STEP 2: CHECK IDEMPOTENCY
  // =====================================================
  // Prevent processing same event twice
  try {
    const alreadyProcessed = await subscriptionService.isEventProcessed(event.id);
    
    if (alreadyProcessed) {
      console.log(`⚠️  Event ${event.id} already processed, skipping`);
      return res.status(200).json({ 
        received: true, 
        message: 'Event already processed' 
      });
    }
  } catch (error) {
    console.error('Error checking event idempotency:', error);
    // Continue processing - better to risk duplicate than miss event
  }

  // =====================================================
  // STEP 3: ROUTE TO APPROPRIATE HANDLER
  // =====================================================
  let result = { success: false };

  try {
    switch (event.type) {
      // Checkout completed - NEW subscription
      case 'checkout.session.completed':
        result = await handleCheckoutCompleted(event);
        break;

      // Subscription lifecycle
      case 'customer.subscription.created':
        result = await handleSubscriptionCreated(event);
        break;

      case 'customer.subscription.updated':
        result = await handleSubscriptionUpdated(event);
        break;

      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(event);
        break;

      case 'customer.subscription.trial_will_end':
        result = await handleTrialWillEnd(event);
        break;

      // Payment events
      case 'invoice.payment_succeeded':
        result = await handleInvoicePaymentSucceeded(event);
        break;

      case 'invoice.payment_failed':
        result = await handleInvoicePaymentFailed(event);
        break;

      case 'invoice.upcoming':
        result = await handleInvoiceUpcoming(event);
        break;

      // Unhandled event types
      default:
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
        result = { success: true, message: 'Event type not handled' };
    }

    // =====================================================
    // STEP 4: MARK EVENT AS PROCESSED
    // =====================================================
    if (result.success) {
      await subscriptionService.markEventProcessed(
        event.id,
        event.type,
        result.organizationId || null,
        event.data.object
      );
    }

  } catch (error) {
    console.error(`❌ Error processing webhook ${event.type}:`, error);
    
    // IMPORTANT: Still return 200 to Stripe
    // Otherwise Stripe will retry, potentially causing issues
    // We've already verified signature, so we know it's a real event
    return res.status(200).json({ 
      received: true,
      error: error.message,
      message: 'Event received but processing failed'
    });
  }

  // =====================================================
  // STEP 5: RESPOND TO STRIPE
  // =====================================================
  // ALWAYS return 200 after signature verification
  // Otherwise Stripe keeps retrying
  console.log(`✅ Webhook ${event.type} processed successfully\n`);
  
  return res.status(200).json({ 
    received: true,
    processed: result.success,
    eventId: event.id,
    eventType: event.type
  });
}

module.exports = { handleStripeWebhook };
