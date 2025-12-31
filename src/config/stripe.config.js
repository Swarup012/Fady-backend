// src/config/stripe.config.js
const Stripe = require('stripe');

// =====================================================
// STRIPE CONFIGURATION
// NEVER hardcode keys - always use environment variables
// =====================================================

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn('⚠️  STRIPE_WEBHOOK_SECRET not set - webhook signature verification will fail');
}

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia', // Use latest stable API version
  typescript: false,
  maxNetworkRetries: 3, // Retry failed requests
  timeout: 30000, // 30 second timeout
});

// =====================================================
// STRIPE PRICING CONFIGURATION
// In production, these should come from Stripe Dashboard
// =====================================================

const STRIPE_CONFIG = {
  // Pricing IDs (create these in Stripe Dashboard)
  prices: {
    monthly: process.env.STRIPE_PRICE_MONTHLY || 'price_xxx', // Replace with actual price ID
    yearly: process.env.STRIPE_PRICE_YEARLY || 'price_yyy',   // Optional: yearly plan
  },

  // Plan configurations
  plans: {
    free: {
      name: 'Free',
      price: 0,
      features: {
        boards: 1,
        posts_per_month: 50,
        team_members: 3,
        custom_branding: false,
        priority_support: false,
        advanced_analytics: false,
      },
    },
    pro: {
      name: 'Pro',
      price: 2900, // $29.00 (in cents)
      currency: 'usd',
      interval: 'month',
      features: {
        boards: -1, // Unlimited
        posts_per_month: -1, // Unlimited
        team_members: -1, // Unlimited
        custom_branding: true,
        priority_support: true,
        advanced_analytics: true,
      },
    },
  },

  // Trial configuration
  trial: {
    enabled: true,
    days: 14, // 14-day trial
  },

  // Webhook events we handle
  webhookEvents: [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'customer.subscription.trial_will_end',
    'invoice.upcoming',
  ],

  // Customer Portal configuration
  customerPortal: {
    features: [
      'subscription_cancel',
      'subscription_update',
      'payment_method_update',
      'invoice_history',
    ],
  },
};

// =====================================================
// STRIPE HELPER FUNCTIONS
// =====================================================

/**
 * Validate Stripe configuration on startup
 */
const validateStripeConfig = async () => {
  try {
    // Test API connection
    const balance = await stripe.balance.retrieve();
    console.log('✅ Stripe connected successfully');
    console.log(`💰 Account balance: ${balance.available[0].amount / 100} ${balance.available[0].currency.toUpperCase()}`);
    
    // Warn if using test mode in production
    if (process.env.NODE_ENV === 'production' && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
      console.warn('⚠️  WARNING: Using Stripe TEST mode in production environment!');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Stripe configuration error:', error.message);
    throw new Error('Failed to initialize Stripe. Check your STRIPE_SECRET_KEY.');
  }
};

/**
 * Get pricing information for frontend
 * NEVER expose secret keys to frontend
 */
const getPricingConfig = () => {
  return {
    plans: STRIPE_CONFIG.plans,
    trial: STRIPE_CONFIG.trial,
    currency: 'USD',
    // DO NOT include: secret keys, webhook secrets, internal IDs
  };
};

module.exports = {
  stripe,
  STRIPE_CONFIG,
  validateStripeConfig,
  getPricingConfig,
};
