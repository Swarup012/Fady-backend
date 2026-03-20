// src/controllers/stripe.controller.js

/**
 * =====================================================
 * STRIPE CONTROLLER
 * =====================================================
 * Handles API requests from frontend
 * =====================================================
 */

const stripeService = require('../services/stripe.service');
const paddleService = require('../services/paddle.service');
const subscriptionService = require('../services/subscription.service');
const { getPricingConfig } = require('../config/plans.config');
const responseUtil = require('../utils/response.util');
const { supabaseAdmin } = require('../config/supabase.config');

const stripeController = {
  /**
   * =====================================================
   * CREATE CHECKOUT SESSION
   * =====================================================
   * POST /api/stripe/create-checkout-session
   * Body: { plan?, billingCycle?, skipTrial?, priceId?, successUrl?, cancelUrl? }
   */
  createCheckoutSession: async (req, res) => {
    try {
      const { 
        plan, 
        billingCycle, 
        skipTrial, 
        priceId, 
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

      // Use Paddle for all new users (billing_provider = 'paddle')
      // You can add logic here to use Stripe for legacy/future users if needed
      let checkoutUrl;
      if (process.env.USE_PADDLE === 'true' || true) { // Always use Paddle for now
        console.log('🔍 Paddle checkout requested', { organizationId, plan, billingCycle, priceId });
        console.log('🔍 Paddle env vars', {
          PADDLE_STARTER_PLAN_ID_MONTHLY: process.env.PADDLE_STARTER_PLAN_ID_MONTHLY,
          PADDLE_STARTER_PLAN_ID_YEARLY: process.env.PADDLE_STARTER_PLAN_ID_YEARLY,
          PADDLE_API_KEY: !!process.env.PADDLE_API_KEY,
          PADDLE_VENDOR_ID: process.env.PADDLE_VENDOR_ID,
        });
        // Map billingCycle to correct Paddle product ID for starter plan
        let paddlePlanId = null;
        if (plan === 'starter') {
          if (billingCycle === 'yearly') {
            paddlePlanId = process.env.PADDLE_STARTER_PLAN_ID_YEARLY;
          } else {
            paddlePlanId = process.env.PADDLE_STARTER_PLAN_ID_MONTHLY;
          }
        }
        if (!paddlePlanId) {
          return responseUtil.error(res, 'Invalid plan or billing cycle for Paddle', 400);
        }
        const paddleCheckout = await paddleService.createCheckoutLink(
          organizationId,
          userEmail,
          paddlePlanId,
          successUrl || `${process.env.FRONTEND_URL}/admin?checkout=success`,
          cancelUrl || `${process.env.FRONTEND_URL}/pricing?checkout=cancelled`
        );
        // Set billing_provider to 'paddle' in DB
        await supabaseAdmin
          .from('organizations')
          .update({ billing_provider: 'paddle', updated_at: new Date().toISOString() })
          .eq('id', organizationId);
        
        // Return both URL (for redirect) and transactionId (for overlay)
        return responseUtil.success(res, 'Paddle checkout link created', {
          url: paddleCheckout.url,
          transactionId: paddleCheckout.transactionId
        });
      } else {
        // Stripe logic (kept for legacy/future use)
        let finalPriceId = priceId;
        if (plan && billingCycle && !finalPriceId) {
          // Use environment variable price IDs for Stripe
          finalPriceId = billingCycle === 'monthly' 
            ? process.env.STRIPE_PRICE_STARTER_MONTHLY
            : process.env.STRIPE_PRICE_STARTER_YEARLY;
        }
        const session = await stripeService.createCheckoutSession(
          organizationId,
          userId,
          finalPriceId,
          successUrl || `${process.env.FRONTEND_URL}/admin?checkout=success`,
          cancelUrl || `${process.env.FRONTEND_URL}/pricing?checkout=cancelled`,
          skipTrial === true ? false : true
        );
        return responseUtil.success(res, 'Stripe checkout session created', {
          sessionId: session.id,
          url: session.url,
        });
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * =====================================================
   * CREATE CUSTOMER PORTAL SESSION
   * =====================================================
   * POST /api/stripe/create-portal-session
   * Body: { returnUrl }
   */
  createPortalSession: async (req, res) => {
    try {
      const { returnUrl } = req.body;
      const organizationId = req.user.current_organization_id || req.organization?.id;

      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }

      if (!returnUrl) {
        return responseUtil.error(res, 'Return URL is required', 400);
      }

      // Check if organization has Stripe customer
      const subscriptionInfo = await subscriptionService.getSubscriptionInfo(organizationId);
      if (!subscriptionInfo?.stripe_customer_id) {
        return responseUtil.error(res, 'No Stripe customer found for this organization', 404);
      }

      // Create portal session
      const session = await stripeService.createPortalSession(organizationId, returnUrl);

      console.log(`✅ Portal session created for org ${organizationId}`);

      return responseUtil.success(res, 'Portal session created', {
        url: session.url,
      });

    } catch (error) {
      console.error('Error creating portal session:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * =====================================================
   * GET SUBSCRIPTION STATUS
   * =====================================================
   * GET /api/stripe/subscription
   */
  getSubscription: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;

      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }

      const subscriptionInfo = await subscriptionService.getSubscriptionInfo(organizationId);

      if (!subscriptionInfo) {
        return responseUtil.success(res, 'No subscription found', {
          status: 'free',
          plan: 'free',
        });
      }

      // Return subscription details
      return responseUtil.success(res, 'Subscription retrieved', {
        status: subscriptionInfo.subscription_status,
        plan: subscriptionInfo.subscription_plan,
        trialEndsAt: subscriptionInfo.trial_ends_at,
        currentPeriodStart: subscriptionInfo.current_period_start,
        currentPeriodEnd: subscriptionInfo.current_period_end,
        cancelAtPeriodEnd: subscriptionInfo.cancel_at_period_end,
        hasActiveSubscription: ['active', 'trialing'].includes(subscriptionInfo.subscription_status),
        billingProvider: subscriptionInfo.billing_provider || 'stripe', // Default to stripe for legacy users
      });

    } catch (error) {
      console.error('Error getting subscription:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * =====================================================
   * GET PRICING CONFIGURATION
   * =====================================================
   * GET /api/stripe/pricing
   * Public endpoint - no auth required
   */
  getPricing: async (req, res) => {
    try {
      const pricing = getPricingConfig();
      return responseUtil.success(res, 'Pricing retrieved', pricing);
    } catch (error) {
      console.error('Error getting pricing:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * =====================================================
   * GET INVOICES
   * =====================================================
   * GET /api/stripe/invoices?limit=10
   */
  getInvoices: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      const limit = parseInt(req.query.limit) || 10;

      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }

      const invoices = await stripeService.getInvoices(organizationId, limit);

      // Format invoices for frontend
      const formattedInvoices = invoices.map(invoice => ({
        id: invoice.id,
        date: new Date(invoice.created * 1000),
        amount: invoice.amount_paid / 100,
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        pdfUrl: invoice.invoice_pdf,
        hostedUrl: invoice.hosted_invoice_url,
      }));

      return responseUtil.success(res, 'Invoices retrieved', {
        invoices: formattedInvoices,
      });

    } catch (error) {
      console.error('Error getting invoices:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * =====================================================
   * CANCEL SUBSCRIPTION
   * =====================================================
   * POST /api/stripe/cancel-subscription
   * Body: { immediately?: boolean }
   * 
   * NOTE: Better to use Customer Portal for this
   */
  cancelSubscription: async (req, res) => {
    try {
      const { immediately = false } = req.body;
      const organizationId = req.user.current_organization_id || req.organization?.id;
      const userRole = req.user.organization_role;

      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }

      // Only owners and admins can cancel
      if (!['owner', 'admin'].includes(userRole)) {
        return responseUtil.error(res, 'Only organization owners and admins can cancel subscriptions', 403);
      }

      await stripeService.cancelSubscription(organizationId, immediately);

      return responseUtil.success(res, immediately 
        ? 'Subscription canceled immediately'
        : 'Subscription will cancel at period end'
      );

    } catch (error) {
      console.error('Error canceling subscription:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },

  /**
   * =====================================================
   * GET SUBSCRIPTION HISTORY
   * =====================================================
   * GET /api/stripe/subscription/history?limit=50
   */
  getSubscriptionHistory: async (req, res) => {
    try {
      const organizationId = req.user.current_organization_id || req.organization?.id;
      const limit = parseInt(req.query.limit) || 50;

      if (!organizationId) {
        return responseUtil.error(res, 'No organization context found', 400);
      }

      const history = await subscriptionService.getSubscriptionHistory(organizationId, limit);

      return responseUtil.success(res, 'Subscription history retrieved', {
        history,
      });

    } catch (error) {
      console.error('Error getting subscription history:', error);
      return responseUtil.error(res, error.message, 500);
    }
  },
};

module.exports = stripeController;
