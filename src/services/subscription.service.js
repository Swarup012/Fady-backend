// src/services/subscription.service.js
const { supabaseAdmin } = require('../config/supabase.config');

const subscriptionService = {
  /**
   * =====================================================
   * UPDATE SUBSCRIPTION STATUS
   * =====================================================
   * WHY: Single source of truth for subscription state
   * CALLED BY: Webhook handlers
   */
  async updateSubscriptionStatus(organizationId, subscriptionData) {
    try {
      const updateData = {
        subscription_status: subscriptionData.status,
        subscription_plan: subscriptionData.plan || 'pro',
        paddle_subscription_id: subscriptionData.subscriptionId,
        current_period_start: subscriptionData.currentPeriodStart 
          ? new Date(subscriptionData.currentPeriodStart * 1000).toISOString() 
          : null,
        current_period_end: subscriptionData.currentPeriodEnd 
          ? new Date(subscriptionData.currentPeriodEnd * 1000).toISOString() 
          : null,
        trial_ends_at: subscriptionData.trialEnd 
          ? new Date(subscriptionData.trialEnd * 1000).toISOString() 
          : null,
        cancel_at_period_end: subscriptionData.cancelAtPeriodEnd || false,
        subscription_updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from('organizations')
        .update(updateData)
        .eq('id', organizationId)
        .select()
        .single();

      if (error) throw error;

      console.log(`✅ Updated subscription status for org ${organizationId}: ${subscriptionData.status}`);
      return data;
    } catch (error) {
      console.error('Error updating subscription status:', error);
      throw error;
    }
  },

  /**
   * =====================================================
   * LOG SUBSCRIPTION HISTORY
   * =====================================================
   * WHY: Audit trail for debugging and analytics
   */
  async logSubscriptionHistory(organizationId, eventType, previousData, newData, stripeEventId) {
    try {
      const { error } = await supabaseAdmin
        .from('subscription_history')
        .insert({
          organization_id: organizationId,
          event_type: eventType,
          previous_status: previousData?.status,
          new_status: newData?.status,
          previous_plan: previousData?.plan,
          new_plan: newData?.plan,
          stripe_event_id: stripeEventId,
          metadata: {
            previous: previousData,
            new: newData,
          },
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error logging subscription history:', error);
      // Don't throw - history logging shouldn't break main flow
    }
  },

  /**
   * =====================================================
   * CHECK IF EVENT ALREADY PROCESSED
   * =====================================================
   * WHY: Idempotency - prevent duplicate webhook processing
   * CRITICAL: Always check before processing webhooks
   */
  async isEventProcessed(eventId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('stripe_events')
        .select('id')
        .eq('event_id', eventId)
        .single();

      return !!data; // Returns true if event exists
    } catch (error) {
      // If error is "not found", event hasn't been processed
      return false;
    }
  },

  /**
   * =====================================================
   * MARK EVENT AS PROCESSED
   * =====================================================
   * WHY: Prevent duplicate processing of same webhook
   */
  async markEventProcessed(eventId, eventType, organizationId, eventData) {
    try {
      const { error } = await supabaseAdmin
        .from('stripe_events')
        .insert({
          event_id: eventId,
          event_type: eventType,
          organization_id: organizationId,
          processed: true,
          data: eventData,
        });

      if (error) {
        // If unique constraint violation, event already processed
        if (error.code === '23505') {
          console.log(`⚠️  Event ${eventId} already processed (caught by DB constraint)`);
          return false;
        }
        throw error;
      }

      console.log(`✅ Marked event as processed: ${eventId}`);
      return true;
    } catch (error) {
      console.error('Error marking event as processed:', error);
      throw error;
    }
  },

  /**
   * =====================================================
   * GET SUBSCRIPTION INFO
   * =====================================================
   * WHY: Return subscription details to frontend
   */
  async getSubscriptionInfo(organizationId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select(`
          subscription_status,
          subscription_plan,
          trial_ends_at,
          current_period_start,
          current_period_end,
          cancel_at_period_end,
          paddle_customer_id,
          paddle_subscription_id,
          billing_provider
        `)
        .eq('id', organizationId)
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error getting subscription info:', error);
      return null;
    }
  },

  /**
   * =====================================================
   * CHECK IF SUBSCRIPTION IS ACTIVE
   * =====================================================
   * WHY: Used in middleware to gate features
   */
  async hasActiveSubscription(organizationId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('subscription_status')
        .eq('id', organizationId)
        .single();

      if (error) return false;

      return ['active', 'trialing'].includes(data.subscription_status);
    } catch (error) {
      return false;
    }
  },

  /**
   * =====================================================
   * GET SUBSCRIPTION HISTORY
   * =====================================================
   * WHY: Show subscription timeline for debugging
   */
  async getSubscriptionHistory(organizationId, limit = 50) {
    try {
      const { data, error } = await supabaseAdmin
        .from('subscription_history')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error getting subscription history:', error);
      return [];
    }
  },
};

module.exports = subscriptionService;
