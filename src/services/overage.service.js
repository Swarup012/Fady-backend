// src/services/overage.service.js

/**
 * =====================================================
 * OVERAGE BILLING SERVICE
 * =====================================================
 * Handles tracked users overage calculation and Paddle billing.
 *
 * Business Logic:
 * - Base limit: 125 tracked users (Starter plan)
 * - Grace buffer: 25 users (20%)
 * - Effective limit: 150 users (no charge until exceeded)
 * - Overage: $6 per 50 users (billed monthly via Paddle one-time transaction)
 * - Peak tracking: Use highest usage during billing period
 * =====================================================
 */

const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase.config');
const { PLAN_CONFIG } = require('../config/plans.config');
const cache = require('./redis.service');

// ── Paddle client config (mirrors paddle.service.js) ──────────────────────────
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const IS_SANDBOX = PADDLE_API_KEY && PADDLE_API_KEY.includes('_sdbx_');
const PADDLE_API_URL = IS_SANDBOX
  ? 'https://sandbox-api.paddle.com'
  : 'https://api.paddle.com';
// ──────────────────────────────────────────────────────────────────────────────

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
   * Report overage to Paddle via a one-time transaction.
   *
   * Idempotency: caller must verify no 'charged' row already exists for this
   * billing period before calling this method.
   *
   * @param {string} organizationId  - Organization UUID
   * @param {number} blocks          - Number of 50-user blocks to charge
   * @param {number} totalCharge     - Dollar amount (e.g. 12.00 for 2 blocks)
   * @param {string} billingPeriod   - YYYY-MM string used to label the charge
   * @returns {{ reported: boolean, transactionId?: string, amount?: number }}
   */
  async reportUsageToPaddle(organizationId, blocks, totalCharge, billingPeriod) {
    if (blocks === 0) return { reported: false, reason: 'no_usage' };

    if (!PADDLE_API_KEY) {
      throw new Error('PADDLE_API_KEY is not configured — cannot charge overage');
    }

    // ── 1. Fetch the org's Paddle customer and subscription IDs ─────────────
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('paddle_customer_id, paddle_subscription_id, name')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) {
      throw new Error(`Cannot find organization ${organizationId} to charge overage`);
    }

    if (!org.paddle_subscription_id) {
      throw new Error(
        `Organization ${organizationId} (${org.name}) has no paddle_subscription_id — ` +
        'they must have an active Paddle subscription to be charged overage.'
      );
    }

    // ── 2. POST a one-time charge to the subscription ────────────────────────
    const amountCents = Math.round(totalCharge * 100); // Paddle expects cents as a string
    const description =
      `Overage – ${billingPeriod}: ${blocks} block${blocks > 1 ? 's' : ''} × $6 ` +
      `(${blocks * 50} extra tracked users)`;

    console.log(
      `💳 Charging Paddle overage for org ${organizationId} (${org.name}): ` +
      `${blocks} blocks = $${totalCharge}`
    );

    const response = await axios.post(
      `${PADDLE_API_URL}/subscriptions/${org.paddle_subscription_id}/charge`,
      {
        effective_from: 'immediately',
        items: [
          {
            price: {
              product: {
                name: 'Tracked Users Overage',
                tax_category: 'standard',
              },
              description,
              unit_price: {
                amount: String(amountCents),
                currency_code: 'USD',
              },
            },
            quantity: 1,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${PADDLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Paddle's POST /subscriptions/{id}/charge endpoint returns the subscription entity,
    // not the new transaction. To get the transaction ID for our records, we fetch the 
    // latest transaction for this subscription.
    let transactionId = null;
    try {
      const txns = await axios.get(
        `${PADDLE_API_URL}/transactions`,
        {
          params: { subscription_id: org.paddle_subscription_id, order_by: 'id[DESC]', per_page: 1 },
          headers: { Authorization: `Bearer ${PADDLE_API_KEY}` }
        }
      );
      transactionId = txns.data?.data?.[0]?.id || null;
    } catch (err) {
      console.warn(`⚠️ Could not fetch resulting transaction ID for org ${organizationId}`, err.message);
    }

    console.log(
      `✅ Paddle overage charge created for org ${organizationId}: ` +
      `${transactionId || 'Unknown ID'} ($${totalCharge})`
    );

    // ── 3. Mark the overage_charges row as 'charged' ───────────────────────
    const { error: updateError } = await supabaseAdmin
      .from('overage_charges')
      .update({
        charge_status: 'charged',
        paddle_charge_id: transactionId,      // existing column (paddle_migration.sql)
        paddle_transaction_id: transactionId, // new column (paddle_overage_migration.sql)
      })
      .eq('organization_id', organizationId)
      .eq('billing_period', billingPeriod)
      .eq('charge_status', 'pending');

    if (updateError) {
      // Transaction succeeded in Paddle but we failed to record it locally.
      // Log prominently — this needs a manual fix, not a re-charge.
      console.error(
        `⚠️  RECONCILIATION NEEDED: Paddle transaction ${transactionId} was ` +
        `created for org ${organizationId} but DB update failed:`,
        updateError
      );
    }

    return {
      reported: true,
      transactionId,
      blocks,
      amount: totalCharge,
    };
  }

  /**
   * Process end-of-month billing for all organizations.
   * Called by the monthly cron job (scheduler.js).
   *
   * @param {{ dryRun?: boolean }} [options]
   *   dryRun = true  → calculates everything and logs, but does NOT call Paddle or
   *                     write 'charged' status. Use this for staging / manual QA.
   *   dryRun = false (default) → live mode, charges Paddle and updates DB.
   */
  async processMonthlyBilling({ dryRun = false } = {}) {
    const billingPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

    console.log('\n' + '='.repeat(60));
    console.log(`💰 Monthly billing | period: ${billingPeriod} | dryRun: ${dryRun}`);
    console.log('='.repeat(60));

    // ── 1. Fetch orgs on paid plans ────────────────────────────────────────
    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, subscription_plan, subscription_status')
      .in('subscription_plan', ['starter', 'pro'])
      .in('subscription_status', ['active', 'trialing']);

    if (orgsError) throw orgsError;

    const results = {
      billingPeriod,
      dryRun,
      total: orgs.length,
      charged: 0,
      noCharge: 0,
      skippedAlreadyCharged: 0,
      errors: 0,
      failures: [], // { orgId, orgName, error } for each failed charge
    };

    // ── 2. Process each org individually — never let one crash the loop ────
    for (const org of orgs) {
      try {
        // ── 2a. Calculate whether overage is owed ─────────────────────────
        const result = await this.calculateMonthlyOverage(org.id, billingPeriod);

        if (!result.charged) {
          // No overage this month
          console.log(
            `  ✅ No overage | ${org.name} (${org.id}) | reason: ${result.reason}`
          );
          results.noCharge++;
          continue;
        }

        const { blocks, totalCharge } = result.overage;

        // ── 2b. Idempotency: skip if already charged this period ───────────
        const { data: existingCharge } = await supabaseAdmin
          .from('overage_charges')
          .select('id, charge_status')
          .eq('organization_id', org.id)
          .eq('billing_period', billingPeriod)
          .eq('charge_status', 'charged')
          .maybeSingle();

        if (existingCharge) {
          console.warn(
            `  ⚠️  Already charged | ${org.name} (${org.id}) | ` +
            `skipping to prevent double-charge`
          );
          results.skippedAlreadyCharged++;
          continue;
        }

        // ── 2c. Dry-run: log only, don't charge ───────────────────────────
        if (dryRun) {
          console.log(
            `  🧪 [DRY RUN] Would charge | ${org.name} (${org.id}) | ` +
            `${blocks} blocks × $6 = $${totalCharge}`
          );
          results.charged++; // count as "would charge" for summary
          continue;
        }

        // ── 2d. Live: charge via Paddle ────────────────────────────────────
        console.log(
          `  💳 Charging | ${org.name} (${org.id}) | ` +
          `${blocks} blocks × $6 = $${totalCharge}`
        );
        await this.reportUsageToPaddle(org.id, blocks, totalCharge, billingPeriod);
        results.charged++;

      } catch (err) {
        // Isolate failures — one bad org must not block the rest
        let errMsg = err.message || String(err);
        if (err?.response?.data) {
          errMsg = `Paddle API Error: ${JSON.stringify(err.response.data)}`;
        }
        console.error(
          `  ❌ CHARGE FAILED | ${org.name} (${org.id}) |\n` +
          `  Error Details: ${errMsg}`
        );
        results.errors++;
        results.failures.push({
          orgId: org.id,
          orgName: org.name,
          error: errMsg,
        });
      }
    }

    // ── 3. Summary ─────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('📊 Monthly billing summary:');
    console.log(
      `   Total: ${results.total} | ` +
      `Charged: ${results.charged} | ` +
      `No Charge: ${results.noCharge} | ` +
      `Already Charged: ${results.skippedAlreadyCharged} | ` +
      `Errors: ${results.errors}`
    );
    if (results.failures.length > 0) {
      console.error('   ❌ Failed organizations:');
      results.failures.forEach(f =>
        console.error(`      - ${f.orgName} (${f.orgId}): ${f.error}`)
      );
    }
    console.log('='.repeat(60) + '\n');

    return results;
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
