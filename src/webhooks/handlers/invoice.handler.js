// src/webhooks/handlers/invoice.handler.js

/**
 * =====================================================
 * INVOICE/PAYMENT EVENT HANDLERS
 * =====================================================
 * Handle payment successes and failures
 * =====================================================
 */

const subscriptionService = require('../../services/subscription.service');
const { supabaseAdmin } = require('../../config/supabase.config');

/**
 * Invoice Payment Succeeded
 * WHY: Confirm recurring payment succeeded
 */
async function handleInvoicePaymentSucceeded(event) {
  try {
    const invoice = event.data.object;
    const subscriptionId = invoice.subscription;
    const customerId = invoice.customer;

    console.log(`💰 Invoice payment succeeded: ${invoice.id}`);
    console.log(`   Amount: $${(invoice.amount_paid / 100).toFixed(2)}`);
    console.log(`   Subscription: ${subscriptionId}`);

    if (!subscriptionId) {
      // One-time payment, not subscription
      console.log('ℹ️  One-time invoice payment (not subscription)');
      return { success: true };
    }

    // Find organization by customer ID
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, subscription_status')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!org) {
      console.error('❌ Organization not found for customer:', customerId);
      return { success: false, error: 'Organization not found' };
    }

    // If subscription was past_due, reactivate it
    if (org.subscription_status === 'past_due') {
      console.log(`✅ Reactivating subscription after successful payment`);
      
      const { error } = await supabaseAdmin
        .from('organizations')
        .update({
          subscription_status: 'active',
          subscription_updated_at: new Date().toISOString(),
        })
        .eq('id', org.id);

      if (error) {
        console.error('Error reactivating subscription:', error);
      }
    }

    await subscriptionService.logSubscriptionHistory(
      org.id,
      'invoice_payment_succeeded',
      { status: org.subscription_status },
      { status: 'active', amount: invoice.amount_paid },
      event.id
    );

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling invoice payment succeeded:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Invoice Payment Failed
 * WHY: Mark subscription as past_due, notify user
 * CRITICAL: Don't immediately revoke access - Stripe retries
 */
async function handleInvoicePaymentFailed(event) {
  try {
    const invoice = event.data.object;
    const subscriptionId = invoice.subscription;
    const customerId = invoice.customer;

    console.log(`❌ Invoice payment failed: ${invoice.id}`);
    console.log(`   Amount: $${(invoice.amount_due / 100).toFixed(2)}`);
    console.log(`   Attempt: ${invoice.attempt_count}`);
    console.log(`   Next attempt: ${invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : 'None'}`);

    if (!subscriptionId) {
      return { success: true };
    }

    // Find organization
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, subscription_status, name')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!org) {
      console.error('❌ Organization not found for customer:', customerId);
      return { success: false, error: 'Organization not found' };
    }

    // Update status to past_due
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({
        subscription_status: 'past_due',
        subscription_updated_at: new Date().toISOString(),
      })
      .eq('id', org.id);

    if (error) {
      console.error('Error updating subscription status:', error);
    }

    await subscriptionService.logSubscriptionHistory(
      org.id,
      'invoice_payment_failed',
      { status: org.subscription_status },
      { status: 'past_due', attempt: invoice.attempt_count },
      event.id
    );

    console.log(`⚠️  Organization ${org.id} (${org.name}) marked as past_due`);
    
    // TODO: Send email notification to organization owner
    // Include link to update payment method

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling invoice payment failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Invoice Upcoming
 * WHY: Notify user about upcoming charge (7 days before)
 */
async function handleInvoiceUpcoming(event) {
  try {
    const invoice = event.data.object;
    const customerId = invoice.customer;

    console.log(`📅 Upcoming invoice: ${invoice.id}`);
    console.log(`   Amount: $${(invoice.amount_due / 100).toFixed(2)}`);
    console.log(`   Billing date: ${new Date(invoice.period_end * 1000)}`);

    // Find organization
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!org) {
      return { success: false, error: 'Organization not found' };
    }

    await subscriptionService.logSubscriptionHistory(
      org.id,
      'invoice_upcoming',
      null,
      { amount: invoice.amount_due, billing_date: new Date(invoice.period_end * 1000) },
      event.id
    );

    // TODO: Send "upcoming charge" email notification

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling invoice upcoming:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleInvoiceUpcoming,
};
