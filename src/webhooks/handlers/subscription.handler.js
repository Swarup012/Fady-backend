// src/webhooks/handlers/subscription.handler.js

/**
 * =====================================================
 * SUBSCRIPTION EVENT HANDLERS
 * =====================================================
 * Handle all subscription lifecycle events
 * =====================================================
 */

const subscriptionService = require('../../services/subscription.service');
const { supabaseAdmin } = require('../../config/supabase.config');

/**
 * Subscription Created
 * WHY: Track when subscription is first created
 */
async function handleSubscriptionCreated(event) {
  try {
    const subscription = event.data.object;
    const organizationId = subscription.metadata?.organization_id;

    if (!organizationId) {
      console.warn('⚠️  No organization_id in subscription metadata');
      return { success: false, error: 'Missing organization_id' };
    }

    console.log(`📝 Subscription created: ${subscription.id}`);
    console.log(`   Organization: ${organizationId}`);
    console.log(`   Status: ${subscription.status}`);

    const subscriptionData = {
      status: subscription.status,
      plan: 'pro',
      subscriptionId: subscription.id,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      trialEnd: subscription.trial_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };

    await subscriptionService.updateSubscriptionStatus(organizationId, subscriptionData);
    await subscriptionService.logSubscriptionHistory(
      organizationId,
      'subscription_created',
      null,
      { status: subscription.status, plan: 'pro' },
      event.id
    );

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling subscription created:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Subscription Updated
 * WHY: Track changes (plan changes, cancellation scheduled, etc.)
 */
async function handleSubscriptionUpdated(event) {
  try {
    const subscription = event.data.object;
    const previousAttributes = event.data.previous_attributes;
    const organizationId = subscription.metadata?.organization_id;

    if (!organizationId) {
      // Try to find organization by subscription ID
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('stripe_subscription_id', subscription.id)
        .single();

      if (!org) {
        console.error('❌ Could not find organization for subscription:', subscription.id);
        return { success: false, error: 'Organization not found' };
      }
      
      organizationId = org.id;
    }

    console.log(`🔄 Subscription updated: ${subscription.id}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Cancel at period end: ${subscription.cancel_at_period_end}`);
    if (previousAttributes) {
      console.log(`   Previous attributes:`, previousAttributes);
    }

    const subscriptionData = {
      status: subscription.status,
      plan: 'pro',
      subscriptionId: subscription.id,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      trialEnd: subscription.trial_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };

    await subscriptionService.updateSubscriptionStatus(organizationId, subscriptionData);
    
    // Log what changed
    await subscriptionService.logSubscriptionHistory(
      organizationId,
      'subscription_updated',
      previousAttributes,
      { status: subscription.status, plan: 'pro' },
      event.id
    );

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling subscription updated:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Subscription Deleted (Canceled)
 * WHY: Revoke access when subscription ends
 */
async function handleSubscriptionDeleted(event) {
  try {
    const subscription = event.data.object;
    const organizationId = subscription.metadata?.organization_id;

    if (!organizationId) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('stripe_subscription_id', subscription.id)
        .single();

      if (!org) {
        console.error('❌ Could not find organization for subscription:', subscription.id);
        return { success: false, error: 'Organization not found' };
      }
      
      organizationId = org.id;
    }

    console.log(`❌ Subscription deleted: ${subscription.id}`);
    console.log(`   Organization: ${organizationId}`);
    console.log(`   Canceled at: ${new Date(subscription.canceled_at * 1000)}`);

    // Revert to free plan
    const subscriptionData = {
      status: 'canceled',
      plan: 'free',
      subscriptionId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
    };

    await subscriptionService.updateSubscriptionStatus(organizationId, subscriptionData);
    await subscriptionService.logSubscriptionHistory(
      organizationId,
      'subscription_deleted',
      { status: subscription.status, plan: 'pro' },
      { status: 'canceled', plan: 'free' },
      event.id
    );

    console.log(`✅ Organization ${organizationId} reverted to free plan`);

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling subscription deleted:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Trial Will End (3 days before)
 * WHY: Send reminder email to convert trial to paid
 */
async function handleTrialWillEnd(event) {
  try {
    const subscription = event.data.object;
    const organizationId = subscription.metadata?.organization_id;

    if (!organizationId) {
      return { success: false, error: 'Missing organization_id' };
    }

    console.log(`⏰ Trial ending soon for subscription: ${subscription.id}`);
    console.log(`   Trial ends: ${new Date(subscription.trial_end * 1000)}`);
    console.log(`   Organization: ${organizationId}`);

    // TODO: Send email notification to organization owner
    // Get owner's email and send trial ending reminder

    await subscriptionService.logSubscriptionHistory(
      organizationId,
      'trial_will_end',
      null,
      { trial_end: new Date(subscription.trial_end * 1000) },
      event.id
    );

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling trial will end:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleTrialWillEnd,
};
