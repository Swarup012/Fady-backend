// src/services/overage.service.js

/**
 * =====================================================
 * OVERAGE BILLING SERVICE
 * =====================================================
 * Handles tracked users overage calculation and Stripe billing
 * 
 * Business Logic:
 * - Base limit: 125 tracked users (Starter plan)
 * - Grace buffer: 25 users (20%)
 * - Effective limit: 150 users (no charge until exceeded)
 * - Overage: $6 per 50 users (billed monthly)
 * - Peak tracking: Use highest usage during billing period
 * =====================================================
 */

const { supabaseAdmin } = require('../config/supabase.config');
const { stripe, STRIPE_CONFIG } = require('../config/stripe.config');
const cache = require('./redis.service');

class OverageService {
  
  /**
   * Calculate overage blocks for an organization
   * @param {string} organizationId - Organization UUID
   * @returns {object} { blocks, overageUsers, totalCharge, inGracePeriod }
   */
  async calculateOverageBlocks(organizationId) {
    try {
      const { data: org, error } = await supabaseAdmin
        .from('organizations')
        .select('subscription_plan, tracked_users_peak_this_month, tracked_users_count_cache')
        .eq('id', organizationId)
        .single();

      if (error) throw error;

      // Only calculate for starter/pro plans
      if (!['starter', 'pro'].includes(org.subscription_plan)) {
        return {
          blocks: 0,
          overageUsers: 0,
          totalCharge: 0,
          inGracePeriod: false,
          reason: 'free_plan'
        };
      }

      // Get configuration from plan limits
      const baseLimit = 125;
      const graceBuffer = 25;
      const effectiveLimit = baseLimit + graceBuffer; // 150
      const blockSize = 50;
      const pricePerBlock = 6.00;

      // Use peak usage (highest point during billing period)
      const peakUsers = org.tracked_users_peak_this_month || org.tracked_users_count_cache || 0;

      // Check if within grace period
      if (peakUsers <= effectiveLimit) {
        return {
          blocks: 0,
          overageUsers: 0,
          peakUsers,
          baseLimit,
          effectiveLimit,
          totalCharge: 0,
          inGracePeriod: peakUsers > baseLimit && peakUsers <= effectiveLimit,
          reason: peakUsers > baseLimit ? 'in_grace_period' : 'under_limit'
        };
      }

      // Calculate overage
      const overageUsers = peakUsers - effectiveLimit;
      const blocks = Math.ceil(overageUsers / blockSize);
      const totalCharge = blocks * pricePerBlock;

      return {
        blocks,
        overageUsers,
        peakUsers,
        baseLimit,
        effectiveLimit,
        totalCharge,
        inGracePeriod: false,
        reason: 'overage_applies'
      };

    } catch (error) {
      console.error('Error calculating overage blocks:', error);
      throw error;
    }
  }

  /**
   * Update daily peak tracked users
   * Called by cron job daily at midnight
   */
  async recordDailyPeak(organizationId) {
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_count_cache, tracked_users_peak_this_month')
        .eq('id', organizationId)
        .single();

      if (!org) return;

      const currentCount = org.tracked_users_count_cache || 0;
      const currentPeak = org.tracked_users_peak_this_month || 0;
      const newPeak = Math.max(currentCount, currentPeak);

      // Update peak if higher
      if (newPeak > currentPeak) {
        await supabaseAdmin
          .from('organizations')
          .update({
            tracked_users_peak_this_month: newPeak,
            tracked_users_peak_reset_at: new Date().toISOString()
          })
          .eq('id', organizationId);

        console.log(`📊 Updated peak for org ${organizationId}: ${currentPeak} → ${newPeak}`);
      }

      // Record daily peak in history table
      await supabaseAdmin
        .from('tracked_users_daily_peaks')
        .upsert({
          organization_id: organizationId,
          date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
          peak_users: currentCount
        }, {
          onConflict: 'organization_id,date'
        });

    } catch (error) {
      console.error('Error recording daily peak:', error);
      // Don't throw - this shouldn't break other operations
    }
  }

  /**
   * Update peaks for ALL organizations
   * Called by daily cron job
   */
  async updateAllPeaks() {
    try {
      console.log('🔄 Starting daily peak update for all organizations...');

      const { data: orgs, error } = await supabaseAdmin
        .from('organizations')
        .select('id, name, subscription_plan')
        .in('subscription_plan', ['starter', 'pro', 'free']);

      if (error) throw error;

      let updated = 0;
      for (const org of orgs) {
        await this.recordDailyPeak(org.id);
        updated++;
      }

      console.log(`✅ Daily peak update complete: ${updated} organizations processed`);
      return { success: true, updated };

    } catch (error) {
      console.error('❌ Error updating all peaks:', error);
      throw error;
    }
  }

  /**
   * Calculate and record overage charge at end of billing period
   * @param {string} organizationId - Organization UUID
   * @param {string} billingPeriod - Format: YYYY-MM
   */
  async calculateMonthlyOverage(organizationId, billingPeriod) {
    try {
      console.log(`💰 Calculating overage for org ${organizationId}, period ${billingPeriod}`);

      // Get overage calculation
      const overage = await this.calculateOverageBlocks(organizationId);

      if (overage.blocks === 0) {
        console.log(`✅ No overage for org ${organizationId}: ${overage.reason}`);
        return { charged: false, reason: overage.reason, overage };
      }

      // Get billing period dates
      const [year, month] = billingPeriod.split('-');
      const billingStart = new Date(year, month - 1, 1);
      const billingEnd = new Date(year, month, 0, 23, 59, 59);

      // Record overage charge
      const { data: charge, error } = await supabaseAdmin
        .from('overage_charges')
        .insert({
          organization_id: organizationId,
          billing_period: billingPeriod,
          billing_start: billingStart.toISOString(),
          billing_end: billingEnd.toISOString(),
          base_limit: overage.baseLimit,
          grace_buffer: 25,
          peak_users: overage.peakUsers,
          billable_overage: overage.overageUsers,
          blocks_charged: overage.blocks,
          price_per_block: 6.00,
          total_charge: overage.totalCharge,
          charge_status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      // Update organization overage fields
      await supabaseAdmin
        .from('organizations')
        .update({
          overage_blocks_charged: overage.blocks,
          overage_amount_this_month: overage.totalCharge,
          last_overage_charge_date: new Date().toISOString()
        })
        .eq('id', organizationId);

      console.log(`✅ Recorded overage: ${overage.blocks} blocks × $6 = $${overage.totalCharge}`);

      return {
        charged: true,
        chargeId: charge.id,
        overage,
        charge
      };

    } catch (error) {
      console.error('Error calculating monthly overage:', error);
      throw error;
    }
  }

  /**
   * Report usage to Stripe (for metered billing)
   * @param {string} organizationId - Organization UUID
   * @param {number} blocks - Number of 50-user blocks to charge
   */
  async reportUsageToStripe(organizationId, blocks) {
    try {
      if (blocks === 0) return { reported: false, reason: 'no_usage' };

      // Get organization's Stripe subscription
      const { data: org, error } = await supabaseAdmin
        .from('organizations')
        .select('stripe_subscription_id, stripe_customer_id')
        .eq('id', organizationId)
        .single();

      if (error || !org.stripe_subscription_id) {
        throw new Error('Organization has no active Stripe subscription');
      }

      // Get the subscription to find the overage line item
      const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
      
      // Find the overage price item
      const overageItem = subscription.items.data.find(
        item => item.price.id === STRIPE_CONFIG.prices.overage_metered
      );

      if (!overageItem) {
        console.warn(`⚠️  Overage price not found in subscription for org ${organizationId}`);
        return { reported: false, reason: 'no_overage_item' };
      }

      // Report usage to Stripe
      const usageRecord = await stripe.subscriptionItems.createUsageRecord(
        overageItem.id,
        {
          quantity: blocks,
          timestamp: Math.floor(Date.now() / 1000),
          action: 'set' // Replace previous usage (use 'increment' to add)
        }
      );

      console.log(`✅ Reported ${blocks} blocks to Stripe for org ${organizationId}`);

      return {
        reported: true,
        usageRecord,
        blocks,
        amount: blocks * 6.00
      };

    } catch (error) {
      console.error('Error reporting usage to Stripe:', error);
      throw error;
    }
  }

  /**
   * Process end-of-month billing for all organizations
   * Called by monthly cron job
   */
  async processMonthlyBilling() {
    try {
      const billingPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM
      console.log(`🔄 Starting monthly billing for period: ${billingPeriod}`);

      // Get all organizations with starter/pro plans
      const { data: orgs, error } = await supabaseAdmin
        .from('organizations')
        .select('id, name, subscription_plan, subscription_status')
        .in('subscription_plan', ['starter', 'pro'])
        .in('subscription_status', ['active', 'trialing']);

      if (error) throw error;

      const results = {
        total: orgs.length,
        charged: 0,
        noCharge: 0,
        errors: 0
      };

      for (const org of orgs) {
        try {
          // Calculate overage
          const result = await this.calculateMonthlyOverage(org.id, billingPeriod);
          
          if (result.charged) {
            // Report to Stripe
            await this.reportUsageToStripe(org.id, result.overage.blocks);
            results.charged++;
          } else {
            results.noCharge++;
          }

        } catch (error) {
          console.error(`Error processing billing for org ${org.id}:`, error);
          results.errors++;
        }
      }

      console.log(`✅ Monthly billing complete:`, results);
      return results;

    } catch (error) {
      console.error('Error processing monthly billing:', error);
      throw error;
    }
  }

  /**
   * Reset monthly peak at start of new billing period
   * @param {string} organizationId - Organization UUID
   */
  async resetMonthlyPeak(organizationId) {
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('tracked_users_count_cache')
        .eq('id', organizationId)
        .single();

      await supabaseAdmin
        .from('organizations')
        .update({
          tracked_users_peak_this_month: org.tracked_users_count_cache || 0,
          tracked_users_peak_reset_at: new Date().toISOString(),
          overage_blocks_charged: 0,
          overage_amount_this_month: 0,
          last_overage_charge_date: null
        })
        .eq('id', organizationId);

      console.log(`🔄 Reset monthly peak for org ${organizationId}`);

    } catch (error) {
      console.error('Error resetting monthly peak:', error);
      throw error;
    }
  }

  /**
   * Get overage status for dashboard display
   * @param {string} organizationId - Organization UUID
   * @returns {object} Overage status with warnings
   */
  async getOverageStatus(organizationId) {
    try {
      const overage = await this.calculateOverageBlocks(organizationId);
      
      // Determine warning level
      let warningLevel = 'none';
      let warningMessage = '';

      if (overage.inGracePeriod) {
        warningLevel = 'warning';
        warningMessage = `You're in the grace period (${overage.peakUsers}/${overage.effectiveLimit} users). No charges yet.`;
      } else if (overage.blocks > 0) {
        warningLevel = 'critical';
        warningMessage = `Overage charges apply: $${overage.totalCharge.toFixed(2)} for ${overage.overageUsers} extra users.`;
      } else if (overage.peakUsers >= overage.baseLimit * 0.9) {
        warningLevel = 'info';
        warningMessage = `Approaching limit: ${overage.peakUsers}/${overage.baseLimit} users (${Math.round(overage.peakUsers / overage.baseLimit * 100)}%)`;
      }

      return {
        ...overage,
        warningLevel,
        warningMessage
      };

    } catch (error) {
      console.error('Error getting overage status:', error);
      throw error;
    }
  }
}

module.exports = new OverageService();
