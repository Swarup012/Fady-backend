// src/services/trial.service.js

/**
 * =====================================================
 * TRIAL MANAGEMENT SERVICE
 * =====================================================
 * Handles 14-day trial periods for Starter plan
 * 
 * Business Logic:
 * - Trial duration: 14 days
 * - No charges during trial (including overage)
 * - Auto-convert to active after trial
 * - Allow skip trial option
 * - Send reminder emails (7 days, 3 days, 1 day before end)
 * =====================================================
 */

const { supabaseAdmin } = require('../config/supabase.config');
const { stripe } = require('../config/stripe.config');

class TrialService {

  /**
   * Start trial for an organization
   * @param {string} organizationId - Organization UUID
   * @param {string} subscriptionId - Stripe subscription ID
   * @param {Date} trialEndsAt - Trial end date
   */
  async startTrial(organizationId, subscriptionId, trialEndsAt) {
    try {
      console.log(`🎁 Starting trial for org ${organizationId}`);

      // Update organization
      await supabaseAdmin
        .from('organizations')
        .update({
          subscription_status: 'trialing',
          subscription_plan: 'starter',
          trial_started_at: new Date().toISOString(),
          trial_ends_at: trialEndsAt.toISOString(),
          stripe_subscription_id: subscriptionId,
          subscription_updated_at: new Date().toISOString()
        })
        .eq('id', organizationId);

      // Record in subscription history
      await supabaseAdmin
        .from('subscription_history')
        .insert({
          organization_id: organizationId,
          event_type: 'trial_started',
          previous_status: 'free',
          new_status: 'trialing',
          previous_plan: 'free',
          new_plan: 'starter',
          metadata: {
            trial_days: 14,
            trial_ends_at: trialEndsAt.toISOString()
          }
        });

      console.log(`✅ Trial started successfully for org ${organizationId}`);

      // TODO: Send welcome email with trial info
      // await emailService.sendTrialStartedEmail(organizationId);

      return { success: true, trialEndsAt };

    } catch (error) {
      console.error('Error starting trial:', error);
      throw error;
    }
  }

  /**
   * Check if organization is in trial period
   * @param {string} organizationId - Organization UUID
   * @returns {object} { inTrial, daysRemaining, trialEndsAt }
   */
  async checkTrialStatus(organizationId) {
    try {
      const { data: org, error } = await supabaseAdmin
        .from('organizations')
        .select('subscription_status, trial_ends_at, trial_started_at')
        .eq('id', organizationId)
        .single();

      if (error) throw error;

      const inTrial = org.subscription_status === 'trialing';
      
      if (!inTrial || !org.trial_ends_at) {
        return {
          inTrial: false,
          daysRemaining: 0,
          trialEndsAt: null,
          expired: false
        };
      }

      const now = new Date();
      const trialEnd = new Date(org.trial_ends_at);
      const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      const expired = daysRemaining <= 0;

      return {
        inTrial: inTrial && !expired,
        daysRemaining: Math.max(0, daysRemaining),
        trialEndsAt: org.trial_ends_at,
        trialStartedAt: org.trial_started_at,
        expired
      };

    } catch (error) {
      console.error('Error checking trial status:', error);
      throw error;
    }
  }

  /**
   * Convert trial to active subscription
   * Called automatically when trial ends and payment succeeds
   * @param {string} organizationId - Organization UUID
   */
  async convertTrialToActive(organizationId) {
    try {
      console.log(`🔄 Converting trial to active for org ${organizationId}`);

      // Update organization
      await supabaseAdmin
        .from('organizations')
        .update({
          subscription_status: 'active',
          subscription_updated_at: new Date().toISOString()
        })
        .eq('id', organizationId);

      // Record in subscription history
      await supabaseAdmin
        .from('subscription_history')
        .insert({
          organization_id: organizationId,
          event_type: 'trial_ended',
          previous_status: 'trialing',
          new_status: 'active',
          new_plan: 'starter',
          metadata: {
            converted: true,
            converted_at: new Date().toISOString()
          }
        });

      console.log(`✅ Trial converted to active for org ${organizationId}`);

      // TODO: Send welcome email
      // await emailService.sendTrialConvertedEmail(organizationId);

      return { success: true, status: 'active' };

    } catch (error) {
      console.error('Error converting trial:', error);
      throw error;
    }
  }

  /**
   * Cancel trial (user canceled before trial ended)
   * @param {string} organizationId - Organization UUID
   */
  async cancelTrial(organizationId) {
    try {
      console.log(`❌ Canceling trial for org ${organizationId}`);

      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('stripe_subscription_id')
        .eq('id', organizationId)
        .single();

      // Cancel Stripe subscription
      if (org.stripe_subscription_id) {
        await stripe.subscriptions.cancel(org.stripe_subscription_id);
      }

      // Downgrade to free
      await supabaseAdmin
        .from('organizations')
        .update({
          subscription_status: 'canceled',
          subscription_plan: 'free',
          trial_ends_at: null,
          trial_started_at: null,
          stripe_subscription_id: null,
          subscription_updated_at: new Date().toISOString()
        })
        .eq('id', organizationId);

      // Record in history
      await supabaseAdmin
        .from('subscription_history')
        .insert({
          organization_id: organizationId,
          event_type: 'trial_canceled',
          previous_status: 'trialing',
          new_status: 'canceled',
          previous_plan: 'starter',
          new_plan: 'free',
          metadata: {
            canceled_at: new Date().toISOString()
          }
        });

      console.log(`✅ Trial canceled for org ${organizationId}`);

      return { success: true, status: 'canceled' };

    } catch (error) {
      console.error('Error canceling trial:', error);
      throw error;
    }
  }

  /**
   * Send trial reminder emails
   * Called by cron job daily
   */
  async sendTrialReminders() {
    try {
      console.log('📧 Checking for trial reminder emails...');

      const now = new Date();
      
      // Get all organizations in trial
      const { data: orgs, error } = await supabaseAdmin
        .from('organizations')
        .select('id, name, trial_ends_at, trial_started_at')
        .eq('subscription_status', 'trialing')
        .not('trial_ends_at', 'is', null);

      if (error) throw error;

      const reminders = {
        day7: [],
        day3: [],
        day1: []
      };

      for (const org of orgs) {
        const trialEnd = new Date(org.trial_ends_at);
        const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));

        // Check if we need to send reminder
        if (daysRemaining === 7) {
          reminders.day7.push(org.id);
          // TODO: Send email
          // await emailService.sendTrialReminder(org.id, 7);
        } else if (daysRemaining === 3) {
          reminders.day3.push(org.id);
          // TODO: Send email
          // await emailService.sendTrialReminder(org.id, 3);
        } else if (daysRemaining === 1) {
          reminders.day1.push(org.id);
          // TODO: Send email
          // await emailService.sendTrialReminder(org.id, 1);
        }
      }

      console.log(`✅ Trial reminders sent:`, {
        day7: reminders.day7.length,
        day3: reminders.day3.length,
        day1: reminders.day1.length
      });

      return reminders;

    } catch (error) {
      console.error('Error sending trial reminders:', error);
      throw error;
    }
  }

  /**
   * Check for expired trials and handle them
   * Called by daily cron job
   */
  async checkExpiredTrials() {
    try {
      console.log('🔍 Checking for expired trials...');

      const now = new Date();

      // Get all trials that have ended
      const { data: orgs, error } = await supabaseAdmin
        .from('organizations')
        .select('id, name, stripe_subscription_id, trial_ends_at')
        .eq('subscription_status', 'trialing')
        .lt('trial_ends_at', now.toISOString());

      if (error) throw error;

      if (orgs.length === 0) {
        console.log('✅ No expired trials found');
        return { expired: 0 };
      }

      console.log(`⚠️  Found ${orgs.length} expired trials`);

      for (const org of orgs) {
        try {
          // Check payment status in Stripe
          if (org.stripe_subscription_id) {
            const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
            
            if (subscription.status === 'active') {
              // Payment succeeded, convert to active
              await this.convertTrialToActive(org.id);
            } else {
              // Payment failed, cancel subscription
              await this.cancelTrial(org.id);
            }
          } else {
            // No subscription, downgrade to free
            await this.cancelTrial(org.id);
          }

        } catch (error) {
          console.error(`Error processing expired trial for org ${org.id}:`, error);
        }
      }

      return { expired: orgs.length };

    } catch (error) {
      console.error('Error checking expired trials:', error);
      throw error;
    }
  }

  /**
   * Skip trial and start paying immediately
   * @param {string} organizationId - Organization UUID
   * @param {string} subscriptionId - Stripe subscription ID
   */
  async skipTrial(organizationId, subscriptionId) {
    try {
      console.log(`⏭️  Skipping trial for org ${organizationId}`);

      // Cancel trial in Stripe and start billing immediately
      await stripe.subscriptions.update(subscriptionId, {
        trial_end: 'now' // End trial immediately
      });

      // Update organization
      await supabaseAdmin
        .from('organizations')
        .update({
          subscription_status: 'active',
          subscription_plan: 'starter',
          trial_ends_at: null,
          trial_started_at: null,
          subscription_updated_at: new Date().toISOString()
        })
        .eq('id', organizationId);

      // Record in history
      await supabaseAdmin
        .from('subscription_history')
        .insert({
          organization_id: organizationId,
          event_type: 'trial_skipped',
          new_status: 'active',
          new_plan: 'starter',
          metadata: {
            skipped_at: new Date().toISOString()
          }
        });

      console.log(`✅ Trial skipped, subscription active for org ${organizationId}`);

      return { success: true, status: 'active' };

    } catch (error) {
      console.error('Error skipping trial:', error);
      throw error;
    }
  }
}

module.exports = new TrialService();
