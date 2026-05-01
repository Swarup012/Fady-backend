// src/controllers/paddle.controller.js
const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase.config');
const paddleService = require('../services/paddle.service');
const subscriptionService = require('../services/subscription.service');
const responseUtil = require('../utils/response.util');

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const IS_SANDBOX = PADDLE_API_KEY && PADDLE_API_KEY.includes('_sdbx_');
const PADDLE_API_URL = IS_SANDBOX 
  ? 'https://sandbox-api.paddle.com'
  : 'https://api.paddle.com';

/**
 * Get pricing configuration
 */
async function getPricing(req, res) {
  try {
    const pricing = {
      plans: {
        free: {
          name: 'Free',
          price: 0,
          features: [
            '1 organization',
            '3 boards',
            '5 posts per board',
            '3 team members',
            '20 tracked users/month',
            'Basic analytics',
            'Community support'
          ]
        },
        starter: {
          name: 'Starter',
          monthly: {
            price: 19,
            priceId: process.env.PADDLE_STARTER_PLAN_ID_MONTHLY
          },
          yearly: {
            price: 180,
            priceId: process.env.PADDLE_STARTER_PLAN_ID_YEARLY
          },
          features: [
            '1 organization',
            'Unlimited boards',
            'Unlimited posts',
            '5 team members',
            '125 tracked users/month',
            'Advanced analytics',
            'Custom branding',
            'API access'
          ]
        },
        pro: {
          name: 'Pro',
          monthly: {
            price: 49,
            priceId: process.env.PADDLE_PRO_PLAN_ID_MONTHLY
          },
          yearly: {
            price: 540,
            priceId: process.env.PADDLE_PRO_PLAN_ID_YEARLY
          },
          features: [
            '1 organization',
            'Unlimited boards',
            'Unlimited posts',
            '15 team members',
            '125 tracked users/month',
            'Priority support',
            'Advanced analytics',
            'Custom branding',
            'API access',
            'Dedicated account manager'
          ]
        }
      }
    };
    
    return responseUtil.success(res, 'Pricing retrieved', pricing);
  } catch (error) {
    console.error('Error getting pricing:', error);
    return responseUtil.error(res, 'Failed to get pricing', 500);
  }
}

/**
 * Create Paddle checkout session
 */
async function createCheckoutSession(req, res) {
  try {
    const { 
      plan, 
      billingCycle, 
      skipTrial, 
      successUrl, 
      cancelUrl 
    } = req.body;
    const userId = req.user.id;
    const organizationId = req.user.current_organization_id || req.organization?.id;
    const userEmail = req.user.email;

    // Validation
    if (!organizationId) {
      return responseUtil.error(res, 'No organization context found', 400);
    }

    // Check if organization already has active subscription
    const subscriptionInfo = await subscriptionService.getSubscriptionInfo(organizationId);
    if (subscriptionInfo && ['active', 'trialing'].includes(subscriptionInfo.subscription_status)) {
      return responseUtil.error(res, 'Organization already has an active subscription', 400);
    }

    // Map billingCycle to correct Paddle product ID
    let paddlePlanId = null;
    if (plan === 'starter') {
      if (billingCycle === 'yearly') {
        // Use no-trial price if skipTrial is true
        paddlePlanId = skipTrial
          ? process.env.PADDLE_STARTER_PLAN_ID_YEARLY_NO_TRIAL
          : process.env.PADDLE_STARTER_PLAN_ID_YEARLY;
      } else {
        paddlePlanId = skipTrial
          ? process.env.PADDLE_STARTER_PLAN_ID_MONTHLY_NO_TRIAL
          : process.env.PADDLE_STARTER_PLAN_ID_MONTHLY;
      }
    } else if (plan === 'pro') {
      if (billingCycle === 'yearly') {
        paddlePlanId = skipTrial
          ? process.env.PADDLE_PRO_PLAN_ID_YEARLY_NO_TRIAL
          : process.env.PADDLE_PRO_PLAN_ID_YEARLY;
      } else {
        paddlePlanId = skipTrial
          ? process.env.PADDLE_PRO_PLAN_ID_MONTHLY_NO_TRIAL
          : process.env.PADDLE_PRO_PLAN_ID_MONTHLY;
      }
    }
    
    if (!paddlePlanId) {
      return responseUtil.error(res, 'Invalid plan or billing cycle for Paddle', 400);
    }
    
    console.log('🔍 Creating Paddle checkout', { organizationId, plan, billingCycle, paddlePlanId, skipTrial });

    const paddleCheckout = await paddleService.createCheckoutLink(
      organizationId,
      userEmail,
      paddlePlanId,
      successUrl || `${process.env.FRONTEND_URL}/admin?checkout=success`,
      cancelUrl || `${process.env.FRONTEND_URL}/pricing?checkout=cancelled`,
      skipTrial  // Pass skipTrial to service
    );
    
    // Set billing_provider to 'paddle' in DB
    await supabaseAdmin
      .from('organizations')
      .update({ billing_provider: 'paddle', updated_at: new Date().toISOString() })
      .eq('id', organizationId);
    
    console.log('✅ Paddle checkout created:', paddleCheckout.url);
    
    // Return both URL (for redirect) and transactionId (for overlay)
    return responseUtil.success(res, 'Paddle checkout link created', {
      url: paddleCheckout.url,
      transactionId: paddleCheckout.transactionId
    });
    
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return responseUtil.error(res, error.message, 500);
  }
}

/**
 * Get invoices from Paddle
 */
async function getInvoices(req, res) {
  try {
    const organizationId = req.user.current_organization_id || req.organization?.id;
    const limit = parseInt(req.query.limit) || 1; // Default to 1 (last transaction only)

    if (!organizationId) {
      return responseUtil.error(res, 'No organization context found', 400);
    }

    // Get organization's Paddle customer ID
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('paddle_customer_id, billing_provider')
      .eq('id', organizationId)
      .single();
    
    if (orgError || !org) {
      return responseUtil.error(res, 'Organization not found', 404);
    }
    
    if (org.billing_provider !== 'paddle' || !org.paddle_customer_id) {
      return responseUtil.success(res, 'No invoices found', { invoices: [] });
    }

    // Check if customer ID is fake/test (starts with 'ctm_01real_')
    if (org.paddle_customer_id.includes('real_customer_id')) {
      console.log('⚠️ Detected test/fake customer ID, returning empty invoices');
      return responseUtil.success(res, 'No invoices found (test mode)', { invoices: [] });
    }

    // Fetch invoices from Paddle API
    const response = await axios.get(
      `${PADDLE_API_URL}/transactions`,
      {
        params: {
          customer_id: org.paddle_customer_id,
          per_page: limit,
          status: 'paid,completed',
          type: 'payment' // Only show actual payments, not authorizations or other transaction types
        },
        headers: {
          'Authorization': `Bearer ${PADDLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`📄 Fetched ${response.data.data.length} transactions from Paddle`);

    // Format invoices for frontend
    const formattedInvoices = response.data.data
      .filter(transaction => {
        // Filter out test transactions (in sandbox mode)
        // Test transactions often have specific IDs or metadata
        const isTest = transaction.id.includes('test') || transaction.mode === 'test';

        // Filter out $0 transactions (trial starts, subscription events)
        const isZeroAmount = parseFloat(transaction.details.totals.total) === 0;

        if (isTest) {
          console.log(`⚠️ Filtering out test transaction: ${transaction.id}`);
        }
        if (isZeroAmount) {
          console.log(`⚠️ Filtering out $0 transaction: ${transaction.id}`);
        }

        return !isTest && !isZeroAmount;
      })
      .map(transaction => {
        // Use our backend proxy endpoint for invoice download
        const invoiceUrl = `${process.env.API_URL || 'http://localhost:3000'}/api/paddle/invoices/${transaction.id}/download`;

        return {
          id: transaction.id,
          date: new Date(transaction.created_at),
          amount: parseFloat(transaction.details.totals.total) / 100, // Paddle returns cents, convert to dollars
          currency: transaction.currency_code,
          status: transaction.status,
          invoiceUrl: invoiceUrl,
          receiptUrl: null, // Paddle doesn't provide separate receipt URL
          hasInvoice: true, // Assume invoice is available (will be verified on download)
        };
      });

    console.log(`📄 Returning ${formattedInvoices.length} filtered invoices`);

    return responseUtil.success(res, 'Invoices retrieved', {
      invoices: formattedInvoices,
    });

  } catch (error) {
    console.error('Error getting Paddle invoices:', error.response?.data || error.message);
    
    // Return empty array instead of error for better UX
    if (error.response?.status === 404) {
      return responseUtil.success(res, 'No invoices found', { invoices: [] });
    }
    
    return responseUtil.error(res, 'Failed to get invoices', 500);
  }
}

/**
 * Download Invoice PDF
 */
async function downloadInvoice(req, res) {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return responseUtil.error(res, 'Transaction ID is required', 400);
    }

    console.log('📄 Downloading invoice for transaction:', transactionId);

    // Step 1: Get invoice URL from Paddle API
    const paddleResponse = await axios.get(
      `${PADDLE_API_URL}/transactions/${transactionId}/invoice`,
      {
        headers: {
          'Authorization': `Bearer ${PADDLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('📄 Paddle response status:', paddleResponse.status);

    // Extract the invoice URL from Paddle's response
    const invoiceUrl = paddleResponse.data?.data?.url;

    if (!invoiceUrl) {
      console.error('❌ No invoice URL in Paddle response:', paddleResponse.data);
      return responseUtil.error(res, 'Invoice URL not found in Paddle response', 404);
    }

    console.log('📄 Invoice URL obtained:', invoiceUrl);

    // Step 2: Fetch the actual PDF from the S3 URL with retry logic
    let pdfResponse;
    let lastError;
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📄 Attempt ${attempt}/${maxRetries} to fetch PDF from S3...`);
        pdfResponse = await axios.get(invoiceUrl, {
          responseType: 'arraybuffer',
          timeout: 60000, // 60 second timeout
          maxContentLength: 10 * 1024 * 1024, // 10MB max
        });
        console.log('✅ PDF fetched successfully on attempt', attempt);
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);

        if (attempt < maxRetries) {
          console.log(`⏳ Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    if (!pdfResponse) {
      console.error('❌ All retry attempts failed');
      throw lastError || new Error('Failed to fetch PDF after multiple attempts');
    }

    console.log('📄 PDF fetched, size:', pdfResponse.data?.length, 'bytes');
    console.log('📄 PDF Content-Type:', pdfResponse.headers['content-type']);

    // Check if we got actual PDF data
    if (!pdfResponse.data || pdfResponse.data.length === 0) {
      console.error('❌ No PDF data received from S3');
      return responseUtil.error(res, 'No PDF data received', 500);
    }

    // Get content type from response
    const contentType = pdfResponse.headers['content-type'] || 'application/pdf';

    // Set headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${transactionId}.pdf"`);
    res.setHeader('Content-Length', pdfResponse.data.length);

    // Send the PDF data
    console.log('✅ Sending PDF to client');
    return res.send(pdfResponse.data);

  } catch (error) {
    console.error('❌ Error downloading invoice:', error.response?.data || error.message);

    // Parse the error response if it's a buffer
    let errorMessage = 'Failed to download invoice';
    if (error.response?.data) {
      try {
        const errorData = JSON.parse(error.response.data.toString());
        console.error('Paddle API error:', errorData);
        if (errorData.error?.code === 'not_found') {
          errorMessage = 'Invoice not available for this transaction. This may be a one-time payment or the invoice is not yet generated.';
        } else if (errorData.error?.code === 'forbidden') {
          errorMessage = 'Access denied to invoice. Please contact support.';
        }
      } catch (e) {
        // If we can't parse the error, use the default message
      }
    }

    if (error.response?.status === 404) {
      return responseUtil.error(res, errorMessage, 404);
    }

    if (error.response?.status === 403) {
      return responseUtil.error(res, errorMessage, 403);
    }

    return responseUtil.error(res, errorMessage, 500);
  }
}

/**
 * Cancel Paddle Subscription
 */
async function cancelSubscription(req, res) {
  try {
    const organizationId = req.organization?.id || req.user?.current_organization_id;
    
    if (!organizationId) {
      return responseUtil.error(res, 'Organization not found', 404);
    }
    
    // Get Paddle subscription ID from database
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('paddle_subscription_id, billing_provider')
      .eq('id', organizationId)
      .single();
    
    if (orgError || !org) {
      return responseUtil.error(res, 'Organization not found', 404);
    }
    
    if (org.billing_provider !== 'paddle') {
      return responseUtil.error(res, 'This subscription is not managed by Paddle', 400);
    }
    
    if (!org.paddle_subscription_id) {
      return responseUtil.error(res, 'No active Paddle subscription found', 404);
    }
    
    // Cancel subscription via Paddle API
    console.log('🔴 Cancelling Paddle subscription:', org.paddle_subscription_id);
    
    const response = await axios.post(
      `${PADDLE_API_URL}/subscriptions/${org.paddle_subscription_id}/cancel`,
      {
        effective_from: 'next_billing_period' // Cancel at end of billing period
      },
      {
        headers: {
          'Authorization': `Bearer ${PADDLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Paddle subscription cancelled:', response.data);
    
    // Update local database
    await supabaseAdmin
      .from('organizations')
      .update({
        cancel_at_period_end: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', organizationId);
    
    return responseUtil.success(res, 'Subscription will be cancelled at the end of billing period', {
      cancelled: true,
      effective_from: 'next_billing_period'
    });
    
  } catch (error) {
    console.error('❌ Error cancelling Paddle subscription:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      return responseUtil.error(res, 'Subscription not found or already cancelled', 404);
    }
    
    return responseUtil.error(res, 'Failed to cancel subscription', 500);
  }
}

/**
 * Get Paddle Subscription Details
 */
async function getSubscription(req, res) {
  try {
    const organizationId = req.organization?.id || req.user?.current_organization_id;
    
    if (!organizationId) {
      return responseUtil.error(res, 'Organization not found', 404);
    }
    
    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('subscription_status, subscription_plan, billing_provider, paddle_subscription_id, paddle_plan_id, cancel_at_period_end, trial_ends_at, current_period_start, current_period_end')
      .eq('id', organizationId)
      .single();
    
    if (error || !org) {
      return responseUtil.error(res, 'Organization not found', 404);
    }
    
    // Determine billing cycle from paddle_plan_id
    let billingCycle = 'monthly'; // Default
    if (org.paddle_plan_id) {
      // Check if the plan ID matches yearly plans
      if (org.paddle_plan_id === process.env.PADDLE_STARTER_PLAN_ID_YEARLY || 
          org.paddle_plan_id === process.env.PADDLE_PRO_PLAN_ID_YEARLY) {
        billingCycle = 'yearly';
      }
    }
    
    // If no billing provider or not Paddle, check if there's still an active subscription
    // (This handles legacy subscriptions or subscriptions activated via webhooks)
    if (!org.billing_provider || org.billing_provider !== 'paddle') {
      const isActive = ['active', 'trialing'].includes(org.subscription_status);
      const isPaidPlan = org.subscription_plan && org.subscription_plan !== 'free';
      
      return responseUtil.success(res, 'Subscription details retrieved', {
        status: org.subscription_status || 'free',
        plan: org.subscription_plan || 'free',
        billingCycle: billingCycle,
        trialEndsAt: org.trial_ends_at || null,
        currentPeriodStart: org.current_period_start || null,
        currentPeriodEnd: org.current_period_end || null,
        cancelAtPeriodEnd: org.cancel_at_period_end || false,
        hasActiveSubscription: isActive || isPaidPlan,
        billingProvider: org.billing_provider || 'none'
      });
    }
    
    // Return Paddle subscription details
    return responseUtil.success(res, 'Subscription details retrieved', {
      status: org.subscription_status,
      plan: org.subscription_plan,
      billingCycle: billingCycle,
      trialEndsAt: org.trial_ends_at,
      currentPeriodStart: org.current_period_start,
      currentPeriodEnd: org.current_period_end,
      cancelAtPeriodEnd: org.cancel_at_period_end || false,
      hasActiveSubscription: org.subscription_status === 'active' || org.subscription_status === 'trialing',
      billingProvider: 'paddle',
      subscriptionId: org.paddle_subscription_id,
      planId: org.paddle_plan_id
    });
    
  } catch (error) {
    console.error('Error getting Paddle subscription:', error);
    return responseUtil.error(res, 'Failed to get subscription details', 500);
  }
}

/**
 * Update subscription plan (upgrade/downgrade)
 */
async function updateSubscriptionPlan(req, res) {
  try {
    const { newPlan, billingCycle } = req.body;
    const organizationId = req.user.current_organization_id || req.organization?.id;

    if (!organizationId) {
      return responseUtil.error(res, 'No organization context found', 400);
    }

    if (!newPlan || !['starter', 'pro'].includes(newPlan)) {
      return responseUtil.error(res, 'Invalid plan. Must be "starter" or "pro"', 400);
    }

    // Get organization's current subscription
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('paddle_subscription_id, subscription_plan, billing_provider')
      .eq('id', organizationId)
      .single();

    if (orgError || !org) {
      return responseUtil.error(res, 'Organization not found', 404);
    }

    if (org.billing_provider !== 'paddle' || !org.paddle_subscription_id) {
      return responseUtil.error(res, 'No active Paddle subscription found', 400);
    }

    if (org.subscription_plan === newPlan) {
      return responseUtil.error(res, `Already on ${newPlan} plan`, 400);
    }

    // Determine new price ID based on plan and billing cycle
    let newPriceId;
    if (newPlan === 'pro') {
      newPriceId = billingCycle === 'yearly' 
        ? process.env.PADDLE_PRO_PLAN_ID_YEARLY
        : process.env.PADDLE_PRO_PLAN_ID_MONTHLY;
    } else if (newPlan === 'starter') {
      newPriceId = billingCycle === 'yearly'
        ? process.env.PADDLE_STARTER_PLAN_ID_YEARLY
        : process.env.PADDLE_STARTER_PLAN_ID_MONTHLY;
    }

    if (!newPriceId) {
      return responseUtil.error(res, 'Price ID not configured for this plan', 500);
    }

    // Get current subscription details to check status
    const currentSubscription = await paddleService.getSubscriptionDetails(org.paddle_subscription_id);
    
    // Determine proration mode based on subscription status
    // If in trial, Paddle requires 'do_not_bill'
    const isTrialing = currentSubscription.status === 'trialing';
    const prorationMode = isTrialing ? 'do_not_bill' : 'prorated_immediately';
    
    console.log('🔄 Upgrading subscription', {
      organizationId,
      from: org.subscription_plan,
      to: newPlan,
      subscriptionId: org.paddle_subscription_id,
      newPriceId,
      status: currentSubscription.status,
      prorationMode
    });

    // Update subscription in Paddle
    const result = await paddleService.updateSubscription(
      org.paddle_subscription_id,
      newPriceId,
      prorationMode // 'do_not_bill' for trial, 'prorated_immediately' for active
    );

    // Update subscription plan in database
    const { error: updateError } = await supabaseAdmin
      .from('organizations')
      .update({
        subscription_plan: newPlan,
        updated_at: new Date().toISOString()
      })
      .eq('id', organizationId);

    if (updateError) {
      console.error('Error updating organization plan:', updateError);
      return responseUtil.error(res, 'Failed to update plan in database', 500);
    }

    console.log('✅ Subscription upgraded successfully');

    return responseUtil.success(res, 'Subscription updated successfully', {
      newPlan,
      billingCycle,
      message: org.subscription_plan === 'starter' && newPlan === 'pro'
        ? 'Upgraded to Pro plan! You now have access to 15 team members and priority support.'
        : 'Plan updated successfully!'
    });

  } catch (error) {
    console.error('Error updating subscription:', error);
    return responseUtil.error(res, error.message || 'Failed to update subscription', 500);
  }
}

module.exports = {
  getPricing,
  createCheckoutSession,
  getSubscription,
  getInvoices,
  downloadInvoice,
  cancelSubscription,
  updateSubscriptionPlan
};
