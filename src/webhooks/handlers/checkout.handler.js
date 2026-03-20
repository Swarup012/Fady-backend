// src/webhooks/handlers/checkout.handler.js

/**
 * =====================================================
 * CHECKOUT SESSION COMPLETED HANDLER
 * =====================================================
 * WHY: This is the ONLY place we trust payment confirmation
 * WHEN: User completes payment on Stripe Checkout
 * 
 * CRITICAL: Never trust frontend success pages!
 * =====================================================
 */

const subscriptionService = require('../../services/subscription.service');

async function handleCheckoutCompleted(event) {
  try {
    const session = event.data.object;
    
    console.log('🎉 Checkout session completed:', session.id);
    console.log('   Customer:', session.customer);
    console.log('   Subscription:', session.subscription);
    console.log('   Mode:', session.mode);
    console.log('   Payment status:', session.payment_status);

    // Extract metadata (THIS is why we attached it!)
    const organizationId = session.metadata?.organization_id;
    const userId = session.metadata?.user_id;

    if (!organizationId) {
      console.error('❌ No organization_id in session metadata!');
      return { success: false, error: 'Missing organization_id' };
    }

    // For subscription mode
    if (session.mode === 'subscription') {
      const subscriptionId = session.subscription;
      
      if (!subscriptionId) {
        console.error('❌ No subscription ID in completed session');
        return { success: false, error: 'Missing subscription_id' };
      }

      // Get full subscription details from Stripe
      const stripe = require('../../config/stripe.config').stripe; // DEPRECATED - legacy webhook
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      // Determine status
      let status = subscription.status;
      let plan = 'pro';

      // Update organization with subscription details
      const subscriptionData = {
        status,
        plan,
        subscriptionId: subscription.id,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        trialEnd: subscription.trial_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };

      await subscriptionService.updateSubscriptionStatus(organizationId, subscriptionData);

      // Log history
      await subscriptionService.logSubscriptionHistory(
        organizationId,
        'checkout_completed',
        null,
        { status, plan },
        event.id
      );

      console.log(`✅ Subscription activated for organization: ${organizationId}`);
      console.log(`   Plan: ${plan}`);
      console.log(`   Status: ${status}`);
      console.log(`   Trial end: ${subscription.trial_end ? new Date(subscription.trial_end * 1000) : 'N/A'}`);

      return { success: true, organizationId, subscriptionId };
    }

    // For one-time payment mode (if you add it later)
    if (session.mode === 'payment') {
      console.log('ℹ️  One-time payment completed (not subscription)');
      // Handle one-time payments if needed
      return { success: true };
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling checkout completed:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { handleCheckoutCompleted };
